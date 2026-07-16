import { describe, expect, it } from "vitest";
import {
  createRunner,
  ScriptedMockLlm,
  Guardrail,
  InMemoryApprovalStore,
  FileTools,
  HarnessDispatcher,
  InMemoryTraceStore,
  inspectUnifiedDiff,
  ContextBuilder,
  InMemoryMemoryRepository,
  MemoryStore,
  type AgentRunner,
  type LlmTurnContext,
  type ToolDispatcher,
  type Clock,
  type WorkspaceFs,
  type SearchMatch,
} from "../src/index.js";
import type { PathResolver } from "../src/guardrail.js";
import type { Action } from "@todex/contracts";

interface TrackingDispatcher extends ToolDispatcher {
  readonly calls: ReadonlyArray<{ action: Action; actionId: string }>;
}

function fakeDispatcher(): TrackingDispatcher & { calls: { action: Action; actionId: string }[] } {
  const calls: { action: Action; actionId: string }[] = [];
  return {
    calls,
    dispatch: async (action, ctx) => {
      calls.push({ action, actionId: ctx.actionId });
      return {
        resultId: `${ctx.actionId}-result`,
        actionId: ctx.actionId,
        status: "succeeded" as const,
        summary: `${action.tool} ok`,
      };
    },
  };
}

class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date = new Date("2026-01-01T00:00:00Z")) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
}

class FakePathResolver implements PathResolver {
  resolveCanonical(workspaceRoot: string, path: string): string {
    const root = this.normalize(workspaceRoot);
    const isAbsolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
    const joined = isAbsolute ? path : `${root}/${path}`;
    return this.normalize(joined);
  }

  normalize(p: string): string {
    p = p.replace(/\\/g, "/");
    const isAbsolute = p.startsWith("/") || /^[A-Za-z]:/.test(p);
    const parts = p.split("/");
    const result: string[] = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (result.length > 0 && result[result.length - 1] !== "..") {
          result.pop();
        } else {
          result.push("..");
        }
      } else {
        result.push(part);
      }
    }
    const body = result.join("/");
    if (isAbsolute && !/^[A-Za-z]:/.test(body)) {
      return "/" + body;
    }
    return body;
  }
}

function createMonotonicIdFactory(): () => string {
  let n = 0;
  return () => `approval-${++n}`;
}

function makeGovernance(workspaceRoot = "/workspace") {
  const clock = new FakeClock();
  const resolver = new FakePathResolver();
  const store = new InMemoryApprovalStore({
    clock,
    idFactory: createMonotonicIdFactory(),
  });
  const guardrail = new Guardrail({
    pathResolver: resolver,
    approvalStore: store,
    clock,
    approvalIdFactory: createMonotonicIdFactory(),
  });
  return { clock, resolver, store, guardrail, workspaceRoot };
}

function makeRunner(workspaceRoot = "/workspace") {
  const gov = makeGovernance(workspaceRoot);
  const dispatcher = fakeDispatcher();
  return {
    ...gov,
    dispatcher,
    createRunner: (llm: ScriptedMockLlm) =>
      createRunner({
        llm,
        dispatcher,
        governance: gov.guardrail,
        approvalStore: gov.store,
        clock: gov.clock,
      }),
  };
}

describe("AgentRunner scripted loop", () => {
  it("records read_file then finish from a scripted LLM", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/app.ts" },
      { tool: "finish", summary: "inspected source" },
    ]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r1",
      projectId: "p1",
      task: "inspect app",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0].action.tool).toBe("read_file");
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "action_requested",
      "run_completed",
    ]);
  });

  it("does not dispatch finish and completes with verified status", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-finish-only",
      projectId: "p1",
      task: "do nothing",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "run_completed",
    ]);
  });

  it("completes as completed_unverified when finish has unverified completion", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done", completion: "unverified" },
    ]);
    const { createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-unverified",
      projectId: "p1",
      task: "unverified task",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed_unverified");
  });

  it("feeds ToolResult into the next LlmTurnContext.previousResults", async () => {
    let captured: LlmTurnContext | null = null;
    const llm = new ScriptedMockLlm(
      [
        { tool: "read_file", path: "src/a.ts" },
        { tool: "finish", summary: "done" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.previousResults.length >= 1) {
            captured = ctx;
          }
        },
      },
    );
    const { createRunner: make } = makeRunner();
    const runner = make(llm);

    await runner.run({
      runId: "r-feed",
      projectId: "p1",
      task: "feed test",
      workspaceRoot: "/workspace",
    });

    expect(captured).not.toBeNull();
    expect(captured!.previousResults).toHaveLength(1);
    expect(captured!.previousResults[0].status).toBe("succeeded");
  });

  it("snapshots previousResults per turn so later mutations do not leak back", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/app.ts" },
      { tool: "finish", summary: "done" },
    ]);
    const { createRunner: make } = makeRunner();
    const runner = make(llm);

    await runner.run({
      runId: "r-snapshot",
      projectId: "p1",
      task: "snapshot test",
      workspaceRoot: "/workspace",
    });

    expect(llm.contexts).toHaveLength(2);
    expect(llm.contexts[0].previousResults).toHaveLength(0);
    expect(llm.contexts[1].previousResults).toHaveLength(1);
    expect(llm.contexts[1].previousResults[0].status).toBe("succeeded");
  });
});

describe("AgentRunner malformed actions", () => {
  it("rejects unknown tool with action_rejected and run_failed, never dispatches", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "launch_missiles", target: "moon" },
    ]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-unknown",
      projectId: "p1",
      task: "bad tool",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_rejected",
      "run_failed",
    ]);
  });

  it("rejects missing tool field with action_rejected and run_failed", async () => {
    const llm = new ScriptedMockLlm([{ path: "src/a.ts" }]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-missing",
      projectId: "p1",
      task: "missing tool",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((event) => event.type === "action_rejected")).toBe(true);
    expect(result.trace.some((event) => event.type === "run_failed")).toBe(true);
  });

  it("rejects non-object action with action_rejected and run_failed", async () => {
    const llm = new ScriptedMockLlm(["not-an-object"]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-nonobj",
      projectId: "p1",
      task: "non-object",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((event) => event.type === "action_rejected")).toBe(true);
    expect(result.trace.some((event) => event.type === "run_failed")).toBe(true);
  });
});

describe("AgentRunner max steps", () => {
  it("fails with max_steps_exceeded when maxSteps is reached", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      { tool: "read_file", path: "src/b.ts" },
      { tool: "read_file", path: "src/c.ts" },
    ]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-max",
      projectId: "p1",
      task: "max steps",
      workspaceRoot: "/workspace",
      maxSteps: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("max_steps_exceeded");
    expect(dispatcher.calls).toHaveLength(1);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "run_failed",
    ]);
  });
});

describe("AgentRunner mock script exhausted", () => {
  it("fails when the mock script is exhausted before finish", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
    ]);
    const { dispatcher, createRunner: make } = makeRunner();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-exhausted",
      projectId: "p1",
      task: "exhaust script",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed");
    expect(result.stopReason).toContain("mock script exhausted");
    expect(dispatcher.calls).toHaveLength(1);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "run_failed",
    ]);
  });
});

describe("AgentRunner cancellation", () => {
  it("stops with run_cancelled when cancellation is requested before next LLM call", async () => {
    const holder: { runner?: AgentRunner } = {};
    const llm = new ScriptedMockLlm(
      [
        { tool: "read_file", path: "src/app.ts" },
        { tool: "read_file", path: "src/other.ts" },
        { tool: "finish", summary: "done" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.trace.length >= 2 && holder.runner) {
            holder.runner.cancel(ctx.runId);
          }
        },
      },
    );
    const { createRunner: make } = makeRunner();
    const runner = make(llm);
    holder.runner = runner;

    const result = await runner.run({
      runId: "r-cancel",
      projectId: "p1",
      task: "cancel test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(result.trace.some((event) => event.type === "run_cancelled")).toBe(true);
    const actionRequests = result.trace.filter(
      (event) => event.type === "action_requested",
    );
    expect(actionRequests).toHaveLength(2);
  });
});

describe("AgentRunner dispatcher errors", () => {
  it("records a failed ToolResult when dispatch throws and continues to finish", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/app.ts" },
      { tool: "finish", summary: "done" },
    ]);
    const gov = makeGovernance();
    const dispatcher: ToolDispatcher = {
      dispatch: async () => {
        throw new Error("disk unavailable");
      },
    };
    const runner = createRunner({
      llm,
      dispatcher,
      governance: gov.guardrail,
      approvalStore: gov.store,
      clock: gov.clock,
    });

    const result = await runner.run({
      runId: "r-dispatch-err",
      projectId: "p1",
      task: "dispatch error test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].summary).toContain("dispatcher error: disk unavailable");
    expect(llm.contexts).toHaveLength(2);
    expect(llm.contexts[1].previousResults).toHaveLength(1);
    expect(llm.contexts[1].previousResults[0].status).toBe("failed");
    expect(llm.contexts[1].previousResults[0].summary).toContain("disk unavailable");
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "action_requested",
      "run_completed",
    ]);
  });
});

class InMemoryWorkspaceFs implements WorkspaceFs {
  private files = new Map<string, string>();

  setFile(path: string, content: string): void {
    this.files.set(this.normalize(path), content);
  }

  getFile(path: string): string | undefined {
    return this.files.get(this.normalize(path));
  }

  async list(path: string, maxDepth: number): Promise<readonly string[]> {
    const prefix = this.normalize(path);
    const result: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath === prefix) continue;
      let relative: string;
      if (prefix === ".") {
        relative = filePath;
      } else if (filePath.startsWith(prefix + "/")) {
        relative = filePath.slice(prefix.length + 1);
      } else {
        continue;
      }
      const depth = relative.includes("/") ? relative.split("/").length - 1 : 0;
      if (depth <= maxDepth) {
        result.push(filePath);
      }
    }
    result.sort();
    return result;
  }

  async readText(path: string): Promise<string> {
    const content = this.files.get(this.normalize(path));
    if (content === undefined) {
      throw new Error(`file not found: ${path}`);
    }
    return content;
  }

  async searchText(path: string, query: string): Promise<readonly SearchMatch[]> {
    const prefix = this.normalize(path);
    const matches: SearchMatch[] = [];
    for (const [filePath, content] of this.files) {
      if (prefix === "." || filePath === prefix || filePath.startsWith(prefix + "/")) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({ path: filePath, line: i + 1, context: lines[i] });
          }
        }
      }
    }
    return matches;
  }

  async snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    for (const p of paths) {
      result.set(p, this.files.get(this.normalize(p)));
    }
    return result;
  }

  async commit(next: ReadonlyMap<string, string | undefined>): Promise<void> {
    for (const [path, content] of next) {
      if (content === undefined) {
        this.files.delete(this.normalize(path));
      } else {
        this.files.set(this.normalize(path), content);
      }
    }
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  }
}

function makePatchOfByteLength(byteLength: number): string {
  const header = "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-x\n+y";
  const padding = "z".repeat(Math.max(0, byteLength - header.length - 1));
  return header + padding + "\n";
}

function makeMultiFilePatch(fileCount: number): string {
  let patch = "";
  for (let i = 0; i < fileCount; i++) {
    patch += `--- a/f${i}\n+++ b/f${i}\n@@ -1 +1 @@\n-old${i}\n+new${i}\n`;
  }
  return patch;
}

function makeRunnerWithFileTools(workspaceRoot = "/workspace") {
  const fs = new InMemoryWorkspaceFs();
  const pathResolver = new FakePathResolver();
  const fileTools = new FileTools({ workspaceRoot, fs, pathResolver });
  const clock = new FakeClock();
  const store = new InMemoryApprovalStore({
    clock,
    idFactory: createMonotonicIdFactory(),
  });
  const guardrail = new Guardrail({
    pathResolver,
    approvalStore: store,
    clock,
    approvalIdFactory: createMonotonicIdFactory(),
    inspectPatch: inspectUnifiedDiff,
  });
  const calls: { action: Action; actionId: string }[] = [];
  const dispatcher: ToolDispatcher = {
    dispatch: async (action, ctx) => {
      calls.push({ action, actionId: ctx.actionId });
      return fileTools.dispatch(action, ctx);
    },
  };
  return {
    clock,
    resolver: pathResolver,
    store,
    guardrail,
    dispatcher,
    fs,
    fileTools,
    calls,
    createRunner: (llm: ScriptedMockLlm) =>
      createRunner({
        llm,
        dispatcher,
        governance: guardrail,
        approvalStore: store,
        clock,
      }),
  };
}

describe("AgentRunner patch approval", () => {
  it("pauses an 8193-byte patch before dispatch", async () => {
    const patch = makePatchOfByteLength(8193);
    expect(Buffer.byteLength(patch, "utf8")).toBe(8193);
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch },
    ]);
    const { calls, createRunner: make } = makeRunnerWithFileTools();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-patch-approval",
      projectId: "p1",
      task: "apply large patch",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("awaiting_approval");
    expect(calls).toHaveLength(0);
  });

  it("dispatches an 8192-byte patch without approval", async () => {
    const patch = makePatchOfByteLength(8192);
    expect(Buffer.byteLength(patch, "utf8")).toBe(8192);
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch },
      { tool: "finish", summary: "done" },
    ]);
    const { calls, createRunner: make } = makeRunnerWithFileTools();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-patch-auto",
      projectId: "p1",
      task: "apply small patch",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(calls[0].action.tool).toBe("apply_patch");
  });
});

function makeRunnerWithFileToolsNoInspector(workspaceRoot = "/workspace") {
  const fs = new InMemoryWorkspaceFs();
  const pathResolver = new FakePathResolver();
  const fileTools = new FileTools({ workspaceRoot, fs, pathResolver });
  const clock = new FakeClock();
  const store = new InMemoryApprovalStore({
    clock,
    idFactory: createMonotonicIdFactory(),
  });
  const guardrail = new Guardrail({
    pathResolver,
    approvalStore: store,
    clock,
    approvalIdFactory: createMonotonicIdFactory(),
  });
  const calls: { action: Action; actionId: string }[] = [];
  const dispatcher: ToolDispatcher = {
    dispatch: async (action, ctx) => {
      calls.push({ action, actionId: ctx.actionId });
      return fileTools.dispatch(action, ctx);
    },
  };
  return {
    clock,
    resolver: pathResolver,
    store,
    guardrail,
    dispatcher,
    fs,
    fileTools,
    calls,
    createRunner: (llm: ScriptedMockLlm) =>
      createRunner({
        llm,
        dispatcher,
        governance: guardrail,
        approvalStore: store,
        clock,
      }),
  };
}

describe("AgentRunner patch approval without explicit inspector", () => {
  it("pauses an 8193-byte patch before dispatch without injected inspector", async () => {
    const patch = makePatchOfByteLength(8193);
    expect(Buffer.byteLength(patch, "utf8")).toBe(8193);
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch },
    ]);
    const { calls, createRunner: make } = makeRunnerWithFileToolsNoInspector();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-patch-no-insp",
      projectId: "p1",
      task: "apply large patch without inspector",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("awaiting_approval");
    expect(calls).toHaveLength(0);
  });

  it("dispatches an 8192-byte patch without injected inspector", async () => {
    const patch = makePatchOfByteLength(8192);
    expect(Buffer.byteLength(patch, "utf8")).toBe(8192);
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch },
      { tool: "finish", summary: "done" },
    ]);
    const { calls, createRunner: make } = makeRunnerWithFileToolsNoInspector();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-patch-auto-no-insp",
      projectId: "p1",
      task: "apply small patch without inspector",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(calls[0].action.tool).toBe("apply_patch");
  });

  it("pauses an 11-file patch before dispatch without injected inspector", async () => {
    const patch = makeMultiFilePatch(11);
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch },
    ]);
    const { calls, createRunner: make } = makeRunnerWithFileToolsNoInspector();
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-patch-11files-no-insp",
      projectId: "p1",
      task: "apply 11-file patch without inspector",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("awaiting_approval");
    expect(calls).toHaveLength(0);
  });
});

function makeRunnerWithMemory(workspaceRoot = "/workspace") {
  const gov = makeGovernance(workspaceRoot);
  const dispatcher = fakeDispatcher();
  const repository = new InMemoryMemoryRepository();
  const memoryStore = new MemoryStore({
    repository,
    clock: gov.clock,
    memoryIdFactory: createMonotonicIdFactory(),
  });
  const contextBuilder = new ContextBuilder({ repository });
  return {
    ...gov,
    dispatcher,
    repository,
    memoryStore,
    contextBuilder,
    createRunner: (llm: ScriptedMockLlm) =>
      createRunner({
        llm,
        dispatcher,
        governance: gov.guardrail,
        approvalStore: gov.store,
        clock: gov.clock,
        contextBuilder,
      }),
  };
}

describe("AgentRunner memory context", () => {
  it("passes project-scoped memory to the LLM", async () => {
    const { memoryStore, createRunner: make } = makeRunnerWithMemory();
    memoryStore.remember({
      projectId: "p1",
      kind: "project_profile",
      trustLevel: "verified",
      content: "p1 profile",
      sourceTraceIds: [],
    });
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);

    await runner.run({
      runId: "r-mem",
      projectId: "p1",
      task: "memory test",
      workspaceRoot: "/workspace",
    });

    expect(llm.contexts[0].memory?.entries).toHaveLength(1);
    expect(llm.contexts[0].memory?.entries[0].content).toBe("p1 profile");
  });

  it("provides empty memory context when no builder is configured", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const { createRunner: make } = makeRunner();
    const runner = make(llm);

    await runner.run({
      runId: "r-no-mem",
      projectId: "p1",
      task: "no memory",
      workspaceRoot: "/workspace",
    });

    expect(llm.contexts[0].memory?.entries).toHaveLength(0);
    expect(llm.contexts[0].memory?.totalCharacters).toBe(0);
  });

  it("snapshots memory per turn so later mutations do not leak back", async () => {
    const { memoryStore, createRunner: make } = makeRunnerWithMemory();
    const llm = new ScriptedMockLlm(
      [
        { tool: "read_file", path: "src/a.ts" },
        { tool: "finish", summary: "done" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.trace.length === 0) {
            memoryStore.remember({
              projectId: "p1",
              kind: "project_profile",
              trustLevel: "verified",
              content: "added during run",
              sourceTraceIds: [],
            });
          }
        },
      },
    );
    const runner = make(llm);

    await runner.run({
      runId: "r-mem-snapshot",
      projectId: "p1",
      task: "snapshot test",
      workspaceRoot: "/workspace",
    });

    expect(llm.contexts[0].memory?.entries).toHaveLength(0);
    expect(llm.contexts[1].memory?.entries).toHaveLength(1);
    expect(llm.contexts[1].memory?.entries[0].content).toBe("added during run");
  });

  it("isolates memory by project in the LLM context", async () => {
    const { memoryStore, createRunner: make } = makeRunnerWithMemory();
    memoryStore.remember({
      projectId: "p1",
      kind: "project_profile",
      trustLevel: "verified",
      content: "p1 profile",
      sourceTraceIds: [],
    });
    memoryStore.remember({
      projectId: "p2",
      kind: "project_profile",
      trustLevel: "verified",
      content: "p2 profile",
      sourceTraceIds: [],
    });
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);

    await runner.run({
      runId: "r-mem-iso",
      projectId: "p1",
      task: "isolation test",
      workspaceRoot: "/workspace",
    });

    expect(llm.contexts[0].memory?.entries).toHaveLength(1);
    expect(llm.contexts[0].memory?.entries[0].content).toBe("p1 profile");
  });
});

function makeRunnerWithHarnessDispatcher(workspaceRoot = "/workspace") {
  const fs = new InMemoryWorkspaceFs();
  const pathResolver = new FakePathResolver();
  const fileTools = new FileTools({ workspaceRoot, fs, pathResolver });
  const clock = new FakeClock();
  const store = new InMemoryApprovalStore({
    clock,
    idFactory: createMonotonicIdFactory(),
  });
  const guardrail = new Guardrail({
    pathResolver,
    approvalStore: store,
    clock,
    approvalIdFactory: createMonotonicIdFactory(),
  });
  const repository = new InMemoryMemoryRepository();
  const memoryStore = new MemoryStore({
    repository,
    clock,
    memoryIdFactory: createMonotonicIdFactory(),
  });
  const traceStore = new InMemoryTraceStore();
  const dispatcher = new HarnessDispatcher({ fileTools, memoryStore, traceStore });
  const contextBuilder = new ContextBuilder({ repository });
  return {
    clock,
    resolver: pathResolver,
    store,
    guardrail,
    dispatcher,
    fs,
    fileTools,
    repository,
    memoryStore,
    traceStore,
    contextBuilder,
    createRunner: (llm: ScriptedMockLlm) =>
      createRunner({
        llm,
        dispatcher,
        governance: guardrail,
        approvalStore: store,
        clock,
        contextBuilder,
        traceStore,
      }),
  };
}

describe("AgentRunner remember memory integration", () => {
  it("writes remember to MemoryStore via concrete dispatcher and reuses across runs", async () => {
    const { repository, createRunner: make } = makeRunnerWithHarnessDispatcher();

    const llm1 = new ScriptedMockLlm([
      {
        tool: "remember",
        kind: "project_convention",
        content: "use tabs not spaces",
        traceEventIds: ["r-rem-1-0"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner1 = make(llm1);
    await runner1.run({
      runId: "r-rem-1",
      projectId: "p1",
      task: "remember a convention",
      workspaceRoot: "/workspace",
    });

    const entries = repository.all();
    expect(entries).toHaveLength(1);
    expect(entries[0].projectId).toBe("p1");
    expect(entries[0].kind).toBe("project_convention");
    expect(entries[0].trustLevel).toBe("agent_observed");
    expect(entries[0].content).toBe("use tabs not spaces");
    expect(entries[0].sourceTraceIds).toEqual(["r-rem-1-0"]);

    const llm2 = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner2 = make(llm2);
    await runner2.run({
      runId: "r-rem-2",
      projectId: "p1",
      task: "reuse memory",
      workspaceRoot: "/workspace",
    });

    expect(llm2.contexts[0].memory?.entries).toHaveLength(1);
    expect(llm2.contexts[0].memory?.entries[0].content).toBe("use tabs not spaces");
  });

  it("does not leak remember across projects", async () => {
    const { repository, createRunner: make } = makeRunnerWithHarnessDispatcher();

    const llm1 = new ScriptedMockLlm([
      {
        tool: "remember",
        kind: "project_convention",
        content: "p1 convention",
        traceEventIds: ["r-rem-iso-1-0"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner1 = make(llm1);
    await runner1.run({
      runId: "r-rem-iso-1",
      projectId: "p1",
      task: "remember p1",
      workspaceRoot: "/workspace",
    });

    const llm2 = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner2 = make(llm2);
    await runner2.run({
      runId: "r-rem-iso-2",
      projectId: "p2",
      task: "p2 should not see p1 memory",
      workspaceRoot: "/workspace",
    });

    expect(llm2.contexts[0].memory?.entries).toHaveLength(0);
    const p1Entries = repository.all().filter((e) => e.projectId === "p1");
    const p2Entries = repository.all().filter((e) => e.projectId === "p2");
    expect(p1Entries).toHaveLength(1);
    expect(p2Entries).toHaveLength(0);
  });

  it("rejects sensitive remember content without persisting or leaking", async () => {
    const { repository, createRunner: make } = makeRunnerWithHarnessDispatcher();

    const llm = new ScriptedMockLlm([
      {
        tool: "remember",
        kind: "project_convention",
        content: "TOKEN=secret-value",
        traceEventIds: ["r-rem-secret-0"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);
    const result = await runner.run({
      runId: "r-rem-secret",
      projectId: "p1",
      task: "remember secret",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");

    expect(repository.all()).toHaveLength(0);

    const allText = JSON.stringify(result.results) + JSON.stringify(result.trace);
    expect(allText).not.toContain("secret-value");

    const llm2 = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner2 = make(llm2);
    await runner2.run({
      runId: "r-rem-secret-2",
      projectId: "p1",
      task: "verify no secret",
      workspaceRoot: "/workspace",
    });

    expect(llm2.contexts[0].memory?.entries).toHaveLength(0);
    const contextText = JSON.stringify(llm2.contexts[0].memory);
    expect(contextText).not.toContain("secret-value");
  });

  it("maps remember traceEventIds to MemoryEntry.sourceTraceIds", async () => {
    const { repository, fs, createRunner: make } = makeRunnerWithHarnessDispatcher();
    fs.setFile("src/a.ts", "content");

    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      {
        tool: "remember",
        kind: "failure_resolution",
        content: "fixed flaky test by adding wait",
        traceEventIds: ["r-rem-trace-0", "r-rem-trace-1"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);
    await runner.run({
      runId: "r-rem-trace",
      projectId: "p1",
      task: "remember with trace",
      workspaceRoot: "/workspace",
    });

    const entries = repository.all();
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceTraceIds).toEqual(["r-rem-trace-0", "r-rem-trace-1"]);
  });

  it("rejects agent_observed remember without trace IDs", async () => {
    const { repository, createRunner: make } = makeRunnerWithHarnessDispatcher();

    const llm = new ScriptedMockLlm([
      {
        tool: "remember",
        kind: "project_convention",
        content: "no trace evidence",
        traceEventIds: [],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);
    await runner.run({
      runId: "r-rem-no-trace",
      projectId: "p1",
      task: "remember without trace",
      workspaceRoot: "/workspace",
    });

    expect(repository.all()).toHaveLength(0);
  });
});

describe("AgentRunner remember trace evidence validation", () => {
  it("rejects a forged trace ID that does not exist in the current run", async () => {
    const { repository, createRunner: make } = makeRunnerWithHarnessDispatcher();

    const llm = new ScriptedMockLlm([
      {
        tool: "remember",
        kind: "project_convention",
        content: "forged evidence",
        traceEventIds: ["invented-trace-id"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);
    const result = await runner.run({
      runId: "r-forged",
      projectId: "p1",
      task: "forge trace",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].summary).toBe("invalid_trace_evidence");

    expect(repository.all()).toHaveLength(0);

    const llm2 = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner2 = make(llm2);
    await runner2.run({
      runId: "r-forged-2",
      projectId: "p1",
      task: "verify no memory",
      workspaceRoot: "/workspace",
    });

    expect(llm2.contexts[0].memory?.entries).toHaveLength(0);
  });

  it("rejects a cross-run trace ID that belongs to a different run", async () => {
    const { repository, fs, createRunner: make } = makeRunnerWithHarnessDispatcher();
    fs.setFile("src/a.ts", "content");

    const llm1 = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      { tool: "finish", summary: "done" },
    ]);
    const runner1 = make(llm1);
    await runner1.run({
      runId: "r-cross-1",
      projectId: "p1",
      task: "generate trace",
      workspaceRoot: "/workspace",
    });

    const llm2 = new ScriptedMockLlm([
      {
        tool: "remember",
        kind: "project_convention",
        content: "cross-run evidence",
        traceEventIds: ["r-cross-1-0"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner2 = make(llm2);
    const result = await runner2.run({
      runId: "r-cross-2",
      projectId: "p1",
      task: "use other run trace",
      workspaceRoot: "/workspace",
    });

    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].summary).toBe("invalid_trace_evidence");
    expect(repository.all()).toHaveLength(0);
  });

  it("accepts a current-run real trace ID and persists for cross-run reuse", async () => {
    const { repository, fs, createRunner: make } = makeRunnerWithHarnessDispatcher();
    fs.setFile("src/a.ts", "content");

    const llm1 = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      {
        tool: "remember",
        kind: "failure_resolution",
        content: "fixed flaky test by adding wait",
        traceEventIds: ["r-real-1-0", "r-real-1-1"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner1 = make(llm1);
    await runner1.run({
      runId: "r-real-1",
      projectId: "p1",
      task: "real trace evidence",
      workspaceRoot: "/workspace",
    });

    const entries = repository.all();
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceTraceIds).toEqual(["r-real-1-0", "r-real-1-1"]);

    const llm2 = new ScriptedMockLlm([
      { tool: "finish", summary: "done" },
    ]);
    const runner2 = make(llm2);
    await runner2.run({
      runId: "r-real-2",
      projectId: "p1",
      task: "reuse real memory",
      workspaceRoot: "/workspace",
    });

    expect(llm2.contexts[0].memory?.entries).toHaveLength(1);
    expect(llm2.contexts[0].memory?.entries[0].content).toBe("fixed flaky test by adding wait");
  });

  it("rejects when any one trace ID among multiple is invalid", async () => {
    const { repository, fs, createRunner: make } = makeRunnerWithHarnessDispatcher();
    fs.setFile("src/a.ts", "content");

    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      {
        tool: "remember",
        kind: "project_convention",
        content: "mixed evidence",
        traceEventIds: ["r-mixed-0", "forged-id"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);
    const result = await runner.run({
      runId: "r-mixed",
      projectId: "p1",
      task: "mixed trace",
      workspaceRoot: "/workspace",
    });

    expect(result.results[1].status).toBe("failed");
    expect(result.results[1].summary).toBe("invalid_trace_evidence");
    expect(repository.all()).toHaveLength(0);
  });

  it("rejects duplicate trace IDs", async () => {
    const { repository, fs, createRunner: make } = makeRunnerWithHarnessDispatcher();
    fs.setFile("src/a.ts", "content");

    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      {
        tool: "remember",
        kind: "project_convention",
        content: "duplicate evidence",
        traceEventIds: ["r-dup-0", "r-dup-0"],
      },
      { tool: "finish", summary: "done" },
    ]);
    const runner = make(llm);
    const result = await runner.run({
      runId: "r-dup",
      projectId: "p1",
      task: "duplicate trace",
      workspaceRoot: "/workspace",
    });

    expect(result.results[1].status).toBe("failed");
    expect(result.results[1].summary).toBe("invalid_trace_evidence");
    expect(repository.all()).toHaveLength(0);
  });
});
