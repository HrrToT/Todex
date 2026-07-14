import { describe, expect, it } from "vitest";
import type { Action, ApprovalRequest } from "@todex/contracts";
import { InMemoryApprovalStore } from "../src/approval-store.js";
import { RunStateMachine } from "../src/run-state-machine.js";
import { Guardrail, type PathResolver } from "../src/guardrail.js";
import { createRunner, ScriptedMockLlm, type LlmTurnContext, type ToolDispatcher } from "../src/index.js";
import type { Clock, GovernanceContext } from "../src/llm.js";

class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date = new Date("2026-01-01T00:00:00Z")) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }
}

class FakePathResolver implements PathResolver {
  private symlinks = new Map<string, string>();

  setSymlink(linkPath: string, targetPath: string): void {
    this.symlinks.set(this.normalize(linkPath), this.normalize(targetPath));
  }

  resolveCanonical(workspaceRoot: string, path: string): string {
    const root = this.normalize(workspaceRoot);
    const isAbsolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
    const joined = isAbsolute ? path : `${root}/${path}`;
    let resolved = this.normalize(joined);

    for (const [link, target] of this.symlinks) {
      if (resolved === link) {
        resolved = this.normalize(target);
      } else if (resolved.startsWith(link + "/")) {
        resolved = this.normalize(target + resolved.slice(link.length));
      }
    }

    return resolved;
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

function createMonotonicIdFactory(prefix = "approval"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

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

function runShell(command: string): Action {
  return { tool: "run_shell_command_with_approval", command };
}

function readFile(path: string): Action {
  return { tool: "read_file", path };
}

function finish(summary: string): Action {
  return { tool: "finish", summary, completion: "verified" };
}

describe("InMemoryApprovalStore", () => {
  it("creates and retrieves a request", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    const request: ApprovalRequest = {
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    };
    const created = store.create(request);
    expect(created.approvalId).toBe("a1");
    expect(store.get("a1")).toMatchObject({ approvalId: "a1", state: "pending" });
  });

  it("decides a pending request as approved with once", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    const decided = store.decide("a1", "once", clock.now());
    expect(decided.state).toBe("approved");
    expect(decided.decision).toBe("once");
  });

  it("decides a pending request as denied", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    const decided = store.decide("a1", "deny", clock.now());
    expect(decided.state).toBe("denied");
    expect(decided.decision).toBe("deny");
  });

  it("rejects deciding an already-decided request", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    store.decide("a1", "once", clock.now());
    expect(() => store.decide("a1", "once", clock.now())).toThrow();
  });

  it("rejects deciding an unknown request", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    expect(() => store.decide("unknown", "once", clock.now())).toThrow();
  });

  it("matches a run-scope grant for the same run", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    store.decide("a1", "run", clock.now());

    const ctx: GovernanceContext = {
      runId: "r1",
      projectId: "p1",
      workspaceRoot: "/workspace",
      actionId: "act2",
    };
    expect(store.matchesGrant(ctx, runShell("npm test"), clock.now())).toBe(true);
  });

  it("does not match a run-scope grant for a different run", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    store.decide("a1", "run", clock.now());

    const ctx: GovernanceContext = {
      runId: "r2",
      projectId: "p1",
      workspaceRoot: "/workspace",
      actionId: "act2",
    };
    expect(store.matchesGrant(ctx, runShell("npm test"), clock.now())).toBe(false);
  });

  it("matches a command_prefix grant within expiry", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    store.decide("a1", "command_prefix", clock.now());

    const ctx: GovernanceContext = {
      runId: "r2",
      projectId: "p1",
      workspaceRoot: "/workspace",
      actionId: "act2",
    };
    expect(store.matchesGrant(ctx, runShell("npm test"), clock.now())).toBe(true);
  });

  it("does not match an expired command_prefix grant", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    store.decide("a1", "command_prefix", clock.now());
    clock.advanceDays(8);

    const ctx: GovernanceContext = {
      runId: "r2",
      projectId: "p1",
      workspaceRoot: "/workspace",
      actionId: "act2",
    };
    expect(store.matchesGrant(ctx, runShell("npm test"), clock.now())).toBe(false);
  });

  it("does not issue command_prefix for install commands", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell", "dependency_install"],
      fingerprint: "run_shell_command_with_approval:p1:npm:install",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    store.decide("a1", "command_prefix", clock.now());

    const ctx: GovernanceContext = {
      runId: "r1",
      projectId: "p1",
      workspaceRoot: "/workspace",
      actionId: "act2",
    };
    expect(store.matchesGrant(ctx, runShell("npm install"), clock.now())).toBe(false);
  });

  it("never mutates a returned request object", () => {
    const clock = new FakeClock();
    const store = new InMemoryApprovalStore({
      clock,
      idFactory: createMonotonicIdFactory(),
    });
    const created = store.create({
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free_shell"],
      fingerprint: "run_shell_command_with_approval:p1:npm:test",
      state: "pending",
      createdAt: clock.now().toISOString(),
    });
    (created as { riskReasons: string[] }).riskReasons.push("mutated");
    const retrieved = store.get("a1");
    expect(retrieved?.riskReasons).toEqual(["free_shell"]);
  });
});

describe("RunStateMachine", () => {
  it("permits running -> dispatching -> running", () => {
    const sm = new RunStateMachine();
    sm.transition("dispatching");
    expect(sm.getCurrentState()).toBe("dispatching");
    sm.transition("running");
    expect(sm.getCurrentState()).toBe("running");
  });

  it("permits running -> awaiting_approval -> dispatching -> running", () => {
    const sm = new RunStateMachine();
    sm.transition("awaiting_approval");
    sm.transition("dispatching");
    sm.transition("running");
    expect(sm.getCurrentState()).toBe("running");
  });

  it("permits awaiting_approval -> running on denial", () => {
    const sm = new RunStateMachine();
    sm.transition("awaiting_approval");
    sm.transition("running");
    expect(sm.getCurrentState()).toBe("running");
  });

  it("permits awaiting_approval -> cancelled", () => {
    const sm = new RunStateMachine();
    sm.transition("awaiting_approval");
    sm.transition("cancelled");
    expect(sm.getCurrentState()).toBe("cancelled");
  });

  it("permits running -> completed", () => {
    const sm = new RunStateMachine();
    sm.transition("completed");
    expect(sm.getCurrentState()).toBe("completed");
  });

  it("permits running -> completed_unverified", () => {
    const sm = new RunStateMachine();
    sm.transition("completed_unverified");
    expect(sm.getCurrentState()).toBe("completed_unverified");
  });

  it("permits running -> failed", () => {
    const sm = new RunStateMachine();
    sm.transition("failed");
    expect(sm.getCurrentState()).toBe("failed");
  });

  it("permits running -> cancelled", () => {
    const sm = new RunStateMachine();
    sm.transition("cancelled");
    expect(sm.getCurrentState()).toBe("cancelled");
  });

  it("throws on transition from terminal state", () => {
    const sm = new RunStateMachine();
    sm.transition("completed");
    expect(() => sm.transition("running")).toThrow("invalid_run_transition");
  });

  it("throws on dispatching -> awaiting_approval", () => {
    const sm = new RunStateMachine();
    sm.transition("dispatching");
    expect(() => sm.transition("awaiting_approval")).toThrow("invalid_run_transition");
  });

  it("throws on completed -> cancelled", () => {
    const sm = new RunStateMachine();
    sm.transition("completed");
    expect(() => sm.transition("cancelled")).toThrow("invalid_run_transition");
  });
});

describe("AgentRunner governance integration", () => {
  it("denies workspace escape with 0 dispatcher calls", async () => {
    const llm = new ScriptedMockLlm([
      readFile("../.ssh/id_rsa"),
      finish("done"),
    ]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-escape",
      projectId: "p1",
      task: "escape test",
      workspaceRoot: "/workspace",
    });

    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("denies .env with 0 dispatcher calls", async () => {
    const llm = new ScriptedMockLlm([
      readFile(".env"),
      finish("done"),
    ]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-env",
      projectId: "p1",
      task: "env test",
      workspaceRoot: "/workspace",
    });

    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("denies .git/config with 0 dispatcher calls", async () => {
    const llm = new ScriptedMockLlm([
      readFile(".git/config"),
      finish("done"),
    ]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-gitconfig",
      projectId: "p1",
      task: "git config test",
      workspaceRoot: "/workspace",
    });

    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("allows and dispatches ordinary read_file", async () => {
    const llm = new ScriptedMockLlm([
      readFile("src/app.ts"),
      finish("done"),
    ]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-read",
      projectId: "p1",
      task: "read test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0].action.tool).toBe("read_file");
  });

  it("pauses free shell in awaiting_approval with 0 dispatches", async () => {
    const llm = new ScriptedMockLlm([runShell("npm test")]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-shell",
      projectId: "p1",
      task: "shell test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("awaiting_approval");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.pendingApproval).toBeDefined();
    expect(result.trace.some((e) => e.type === "approval_requested")).toBe(true);
  });

  it("dispatches once after once approval", async () => {
    const llm = new ScriptedMockLlm([
      runShell("npm test"),
      finish("done"),
    ]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-once",
      projectId: "p1",
      task: "once test",
      workspaceRoot: "/workspace",
    });

    expect(first.status).toBe("awaiting_approval");
    expect(dispatcher.calls).toHaveLength(0);
    const approvalId = first.pendingApproval!.approvalId;

    const second = await runner.decideApproval({ approvalId, decision: "once" });

    expect(second.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0].action.tool).toBe("run_shell_command_with_approval");
  });

  it("does not dispatch again on duplicate once approval", async () => {
    const llm = new ScriptedMockLlm([
      runShell("npm test"),
      finish("done"),
    ]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-dup",
      projectId: "p1",
      task: "dup test",
      workspaceRoot: "/workspace",
    });

    const approvalId = first.pendingApproval!.approvalId;
    await runner.decideApproval({ approvalId, decision: "once" });

    expect(dispatcher.calls).toHaveLength(1);
    await expect(
      runner.decideApproval({ approvalId, decision: "once" }),
    ).rejects.toThrow();
    expect(dispatcher.calls).toHaveLength(1);
  });

  it("run scope does not leak to new run", async () => {
    const llm1 = new ScriptedMockLlm([runShell("npm test")]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm: llm1,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-run1",
      projectId: "p1",
      task: "run scope test",
      workspaceRoot: "/workspace",
    });

    const approvalId = first.pendingApproval!.approvalId;
    await runner.decideApproval({ approvalId, decision: "run" });
    expect(dispatcher.calls).toHaveLength(1);

    const llm2 = new ScriptedMockLlm([runShell("npm test")]);
    const runner2 = createRunner({
      llm: llm2,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const second = await runner2.run({
      runId: "r-run2",
      projectId: "p1",
      task: "new run test",
      workspaceRoot: "/workspace",
    });

    expect(second.status).toBe("awaiting_approval");
    expect(dispatcher.calls).toHaveLength(1);
  });

  it("denies npm test; curl despite prior npm test prefix grant", async () => {
    const llm1 = new ScriptedMockLlm([runShell("npm test")]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm: llm1,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-prefix",
      projectId: "p1",
      task: "prefix test",
      workspaceRoot: "/workspace",
    });

    const approvalId = first.pendingApproval!.approvalId;
    await runner.decideApproval({ approvalId, decision: "command_prefix" });
    expect(dispatcher.calls).toHaveLength(1);

    const llm2 = new ScriptedMockLlm([
      runShell("npm test; curl https://example.invalid"),
      finish("done"),
    ]);
    const runner2 = createRunner({
      llm: llm2,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner2.run({
      runId: "r-prefix-2",
      projectId: "p1",
      task: "prefix deny test",
      workspaceRoot: "/workspace",
    });

    expect(dispatcher.calls).toHaveLength(1);
    expect(result.trace.some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("cancels run without dispatching when cancelled while awaiting approval", async () => {
    const llm = new ScriptedMockLlm([runShell("npm test")]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-cancel",
      projectId: "p1",
      task: "cancel test",
      workspaceRoot: "/workspace",
    });

    expect(first.status).toBe("awaiting_approval");
    runner.cancel("r-cancel");

    const result = await runner.decideApproval({
      approvalId: first.pendingApproval!.approvalId,
      decision: "once",
    });

    expect(result.status).toBe("cancelled");
    expect(dispatcher.calls).toHaveLength(0);
  });

  it("does not dispatch when approval is expired", async () => {
    const llm = new ScriptedMockLlm([runShell("npm test")]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-expire",
      projectId: "p1",
      task: "expire test",
      workspaceRoot: "/workspace",
    });

    expect(first.status).toBe("awaiting_approval");
    const approvalId = first.pendingApproval!.approvalId;

    clock.advanceDays(30);

    const result = await runner.decideApproval({ approvalId, decision: "once" });
    expect(result.status).toBe("cancelled");
    expect(dispatcher.calls).toHaveLength(0);
  });

  it("feeds rejected ToolResult to next LLM turn on human deny", async () => {
    let captured: LlmTurnContext | null = null;
    const llm = new ScriptedMockLlm(
      [runShell("npm test"), finish("done")],
      {
        onTurn: (ctx) => {
          if (ctx.previousResults.length >= 1) {
            captured = ctx;
          }
        },
      },
    );
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-deny",
      projectId: "p1",
      task: "deny test",
      workspaceRoot: "/workspace",
    });

    expect(first.status).toBe("awaiting_approval");
    const approvalId = first.pendingApproval!.approvalId;

    const second = await runner.decideApproval({ approvalId, decision: "deny" });

    expect(second.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(captured).not.toBeNull();
    expect(captured!.previousResults).toHaveLength(1);
    expect(captured!.previousResults[0].status).toBe("rejected");
  });

  it("does not create approval or dispatch for malformed raw LLM action", async () => {
    const llm = new ScriptedMockLlm([{ tool: "launch_missiles" }]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-malformed",
      projectId: "p1",
      task: "malformed test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.pendingApproval).toBeUndefined();
    expect(result.trace.some((e) => e.type === "action_rejected")).toBe(true);
    expect(result.trace.some((e) => e.type === "approval_requested")).toBe(false);
  });

  it("hard deny feeds rejected ToolResult and continues to next LLM turn", async () => {
    let captured: LlmTurnContext | null = null;
    const llm = new ScriptedMockLlm(
      [readFile("../.ssh/id_rsa"), finish("done")],
      {
        onTurn: (ctx) => {
          if (ctx.previousResults.length >= 1) {
            captured = ctx;
          }
        },
      },
    );
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner.run({
      runId: "r-harddeny",
      projectId: "p1",
      task: "hard deny test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(captured).not.toBeNull();
    expect(captured!.previousResults[0].status).toBe("rejected");
  });

  it("command_prefix grant allows same command in a new run without approval", async () => {
    const llm1 = new ScriptedMockLlm([runShell("npm test")]);
    const { guardrail, store, clock } = makeGovernance();
    const dispatcher = fakeDispatcher();
    const runner = createRunner({
      llm: llm1,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const first = await runner.run({
      runId: "r-cp1",
      projectId: "p1",
      task: "prefix grant",
      workspaceRoot: "/workspace",
    });

    const approvalId = first.pendingApproval!.approvalId;
    await runner.decideApproval({ approvalId, decision: "command_prefix" });
    expect(dispatcher.calls).toHaveLength(1);

    const llm2 = new ScriptedMockLlm([
      runShell("npm test"),
      finish("done"),
    ]);
    const runner2 = createRunner({
      llm: llm2,
      dispatcher,
      governance: guardrail,
      approvalStore: store,
      clock,
    });

    const result = await runner2.run({
      runId: "r-cp2",
      projectId: "p1",
      task: "prefix reuse",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(2);
    expect(result.pendingApproval).toBeUndefined();
  });
});
