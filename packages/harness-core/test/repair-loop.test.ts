import { describe, expect, it } from "vitest";
import {
  createRunner,
  ScriptedMockLlm,
  Guardrail,
  InMemoryApprovalStore,
  VerificationRunner,
  type CommandExecution,
  type CommandExecutionCondition,
  type CommandRunner,
  type ConfiguredCommandRegistry,
  type LlmTurnContext,
  type ToolDispatcher,
  type Clock,
  type RunnerOptions,
} from "../src/index.js";
import type { PathResolver } from "../src/guardrail.js";
import type { ConfiguredCommand, Action } from "@todex/contracts";

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

function makeCommand(overrides: Partial<ConfiguredCommand> = {}): ConfiguredCommand {
  return {
    commandId: "p1.test",
    projectId: "p1",
    purpose: "test",
    argv: ["pnpm", "test"],
    workingDirectory: ".",
    timeoutMs: 10_000,
    confirmedByUser: true,
    ...overrides,
  };
}

function makeRegistry(commands: ConfiguredCommand[]): ConfiguredCommandRegistry {
  return {
    find: (projectId, commandId) =>
      commands.find((c) => c.projectId === projectId && c.commandId === commandId),
  };
}

function makeExecution(
  condition: CommandExecutionCondition,
  overrides: Partial<CommandExecution> = {},
): CommandExecution {
  return {
    exitCode: condition === "success" ? 0 : 1,
    durationMs: 100,
    stdout: "",
    stderr: "",
    condition,
    ...overrides,
  };
}

class ScriptedCommandRunner implements CommandRunner {
  private index = 0;
  public readonly calls: {
    argv: readonly string[];
    workingDirectory: string;
    timeoutMs: number;
  }[] = [];
  constructor(private readonly executions: readonly CommandExecution[]) {}
  async run(input: {
    readonly argv: readonly string[];
    readonly workingDirectory: string;
    readonly timeoutMs: number;
  }): Promise<CommandExecution> {
    this.calls.push({
      argv: input.argv,
      workingDirectory: input.workingDirectory,
      timeoutMs: input.timeoutMs,
    });
    if (this.index >= this.executions.length) {
      throw new Error("scripted command runner exhausted");
    }
    const execution = this.executions[this.index];
    this.index += 1;
    return execution;
  }
}

function makeRunnerWithVerification(options: {
  verificationRunner?: VerificationRunner;
  verificationCommandId?: string;
  workspaceRoot?: string;
}) {
  const workspaceRoot = options.workspaceRoot ?? "/workspace";
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
        verificationRunner: options.verificationRunner,
        verificationCommandId: options.verificationCommandId,
      } as RunnerOptions),
  };
}

function getVerification(ctx: LlmTurnContext): LlmTurnContext["verification"] {
  return (ctx as unknown as { verification?: unknown }).verification as
    | { classification: string; repairAttempts: number }
    | undefined;
}

const PATCH_1 = "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-x\n+y\n";
const PATCH_2 = "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-x\n+z\n";

describe("Repair loop verification feedback", () => {
  it("feeds a failed verification to the next turn then completes after pass and finish", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "apply_patch", patch: PATCH_2 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([
      makeExecution("test_failure", { stderr: "src/failing.ts assertion error" }),
      makeExecution("success"),
    ]);
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);

    const result = await runner.run({
      runId: "r1",
      projectId: "p1",
      task: "fix test",
      workspaceRoot: "/workspace",
    });

    expect(getVerification(llm.contexts[1])?.classification).toBe("test_failure");
    expect(getVerification(llm.contexts[1])?.repairAttempts).toBe(0);
    expect(getVerification(llm.contexts[2])?.classification).toBe("passed");
    expect(result.status).toBe("completed");
    expect(result.trace.some((e) => e.type === "verification_completed")).toBe(true);
  });

  it("completes as completed_unverified when verification runner is set but no command id", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([]);
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
    });
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-noverify",
      projectId: "p1",
      task: "no verification command",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed_unverified");
    expect(result.trace.some((e) => e.type === "verification_completed")).toBe(false);
  });

  it("completes as completed_unverified when finish(verified) has no current pass", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([]);
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-nopass",
      projectId: "p1",
      task: "no pass",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed_unverified");
  });

  it("invalidates a prior pass when a later patch is applied", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "apply_patch", patch: PATCH_2 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([
      makeExecution("success"),
      makeExecution("test_failure", { stderr: "src/failing.ts error" }),
    ]);
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-invalidate",
      projectId: "p1",
      task: "invalidate pass",
      workspaceRoot: "/workspace",
    });

    expect(getVerification(llm.contexts[1])?.classification).toBe("passed");
    expect(getVerification(llm.contexts[2])?.classification).toBe("test_failure");
    expect(result.status).toBe("completed_unverified");
  });

  it("completes as completed when pass is still current and finish(verified) is sent", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([
      makeExecution("success"),
    ]);
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-pass-finish",
      projectId: "p1",
      task: "pass and finish",
      workspaceRoot: "/workspace",
    });

    expect(getVerification(llm.contexts[1])?.classification).toBe("passed");
    expect(result.status).toBe("completed");
  });

  it("preserves T-003 to T-005 behavior when verification options are absent", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const { createRunner: make } = makeRunnerWithVerification({});
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-compat",
      projectId: "p1",
      task: "compatibility",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("completed");
    expect(result.trace.some((e) => e.type === "verification_completed")).toBe(false);
  });
});
