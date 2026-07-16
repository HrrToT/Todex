import { describe, expect, it } from "vitest";
import {
  createRunner,
  ScriptedMockLlm,
  Guardrail,
  InMemoryApprovalStore,
  VerificationRunner,
  type AgentRunner,
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

function getVerification(ctx: LlmTurnContext): { classification: string; repairAttempts: number } | undefined {
  return ctx.verification;
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

class CancellingCommandRunner implements CommandRunner {
  public readonly calls: {
    argv: readonly string[];
    workingDirectory: string;
    timeoutMs: number;
  }[] = [];
  constructor(
    private readonly execution: CommandExecution,
    private readonly cancelFn: () => void,
  ) {}
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
    this.cancelFn();
    return this.execution;
  }
}

describe("Repair limit enforcement", () => {
  it("stops after the initial patch plus three failed repair patches without a fifth LLM call", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "apply_patch", patch: PATCH_2 },
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "apply_patch", patch: PATCH_2 },
    ]);
    const commandRunner = new ScriptedCommandRunner([
      makeExecution("test_failure", { stderr: "src/f1.ts error" }),
      makeExecution("test_failure", { stderr: "src/f2.ts error" }),
      makeExecution("test_failure", { stderr: "src/f3.ts error" }),
      makeExecution("test_failure", { stderr: "src/f4.ts error" }),
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
      runId: "r-repair-limit",
      projectId: "p1",
      task: "repair limit",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed_repair_limit");
    expect(result.stopReason).toBe("failed_repair_limit");
    expect(llm.contexts).toHaveLength(4);
    expect(commandRunner.calls).toHaveLength(4);
    expect(getVerification(llm.contexts[1])?.repairAttempts).toBe(0);
    expect(getVerification(llm.contexts[2])?.repairAttempts).toBe(1);
    expect(getVerification(llm.contexts[3])?.repairAttempts).toBe(2);
  });

  it.each([
    ["quality_failure"],
    ["build_failure"],
  ])("treats %s as repairable and feeds feedback to next LLM turn", async (condition) => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "apply_patch", patch: PATCH_2 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([
      makeExecution(condition as CommandExecutionCondition, { stderr: "src/f.ts issue" }),
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
      runId: `r-repair-${condition}`,
      projectId: "p1",
      task: `repair ${condition}`,
      workspaceRoot: "/workspace",
    });

    expect(getVerification(llm.contexts[1])?.classification).toBe(condition);
    expect(getVerification(llm.contexts[2])?.classification).toBe("passed");
    expect(result.status).toBe("completed");
  });
});

describe("Environment failure stops", () => {
  it.each([
    ["dependency_missing"],
    ["command_not_found"],
    ["timeout"],
    ["execution_error"],
  ])(
    "stops %s as failed_environment without consuming repair attempts or calling LLM again",
    async (condition) => {
      const llm = new ScriptedMockLlm([
        { tool: "apply_patch", patch: PATCH_1 },
      ]);
      const commandRunner = new ScriptedCommandRunner([
        makeExecution(condition as CommandExecutionCondition),
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
        runId: `r-env-${condition}`,
        projectId: "p1",
        task: `environment ${condition}`,
        workspaceRoot: "/workspace",
      });

      expect(result.status).toBe("failed_environment");
      expect(result.stopReason).toBe(condition);
      expect(llm.contexts).toHaveLength(1);
      expect(commandRunner.calls).toHaveLength(1);
    },
  );
});

describe("Cancellation during verification", () => {
  it("cancels safely before verification without extra dispatch or LLM turn", async () => {
    const holder: { runner?: AgentRunner } = {};
    const llm = new ScriptedMockLlm(
      [{ tool: "apply_patch", patch: PATCH_1 }],
      {
        onTurn: (ctx) => {
          if (holder.runner) {
            holder.runner.cancel(ctx.runId);
          }
        },
      },
    );
    const commandRunner = new ScriptedCommandRunner([]);
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { dispatcher, createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);
    holder.runner = runner;

    const result = await runner.run({
      runId: "r-cancel-before",
      projectId: "p1",
      task: "cancel before verification",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(commandRunner.calls).toHaveLength(0);
    expect(llm.contexts).toHaveLength(1);
    expect(dispatcher.calls).toHaveLength(1);
  });

  it("cancels safely after verification without extra LLM turn", async () => {
    const holder: { runner?: AgentRunner } = {};
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new CancellingCommandRunner(
      makeExecution("test_failure", { stderr: "src/f.ts error" }),
      () => holder.runner?.cancel("r-cancel-after"),
    );
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);
    holder.runner = runner;

    const result = await runner.run({
      runId: "r-cancel-after",
      projectId: "p1",
      task: "cancel after verification",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(llm.contexts).toHaveLength(1);
  });
});

describe("CommandRunner reject convergence in AgentRunner", () => {
  it("stops as failed_environment when CommandRunner throws, with verification_completed and run_failed traces", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
    ]);
    const throwingRunner: CommandRunner = {
      run: async () => {
        throw new Error("spawn failed TOKEN=secret-value at /home/user/project/src/file.ts");
      },
    };
    const verificationRunner = new VerificationRunner({
      registry: makeRegistry([makeCommand()]),
      commandRunner: throwingRunner,
    });
    const { createRunner: make } = makeRunnerWithVerification({
      verificationRunner,
      verificationCommandId: "p1.test",
    });
    const runner = make(llm);

    const result = await runner.run({
      runId: "r-throw",
      projectId: "p1",
      task: "throw test",
      workspaceRoot: "/workspace",
    });

    expect(result.status).toBe("failed_environment");
    expect(result.stopReason).toBe("execution_error");
    expect(llm.contexts).toHaveLength(1);
    expect(result.trace.some((e) => e.type === "verification_completed")).toBe(true);
    expect(result.trace.some((e) => e.type === "run_failed")).toBe(true);
    const allTraceText = JSON.stringify(result.trace);
    expect(allTraceText).not.toContain("secret-value");
    expect(allTraceText).not.toContain("/home/user");
  });
});

describe("P1-3: absolute path and secret redaction in trace and LLM context", () => {
  it("does not leak absolute paths or secrets into trace payload or next LLM context", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "apply_patch", patch: PATCH_2 },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([
      makeExecution("test_failure", {
        stderr: 'at (/home/lenovo/project/src/a.ts:12)\nfile="/private/tmp/error.log"\nTOKEN=secret-value\nsrc/relative.ts',
      }),
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
      runId: "r-redact",
      projectId: "p1",
      task: "redaction test",
      workspaceRoot: "/workspace",
    });

    const traceText = JSON.stringify(result.trace);
    expect(traceText).not.toContain("secret-value");
    expect(traceText).not.toContain("/home/lenovo");
    expect(traceText).not.toContain("/private/tmp");

    const ctx1Verification = llm.contexts[1].verification;
    expect(ctx1Verification).toBeDefined();
    const ctxText = JSON.stringify(ctx1Verification);
    expect(ctxText).not.toContain("secret-value");
    expect(ctxText).not.toContain("/home/lenovo");
    expect(ctxText).not.toContain("/private/tmp");
    expect(ctx1Verification?.relatedPaths).toContain("src/relative.ts");
    expect(ctx1Verification?.relatedPaths.some((p) => p.includes("home"))).toBe(false);
    expect(ctx1Verification?.relatedPaths.some((p) => p.includes("private"))).toBe(false);
  });
});

describe("P1-4: VerificationFeedback per-turn immutability", () => {
  it("provides independent failure feedback snapshots; mutation of first context does not affect next turn", async () => {
    let firstClassification = "";
    let firstRepairAttempts = -1;
    let firstRelatedPaths: string[] = [];
    let mutationThrew = false;
    const llm = new ScriptedMockLlm(
      [
        { tool: "apply_patch", patch: PATCH_1 },
        { tool: "read_file", path: "src/a.ts" },
        { tool: "apply_patch", patch: PATCH_2 },
        { tool: "finish", summary: "done", completion: "verified" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.verification && firstClassification === "") {
            firstClassification = ctx.verification.classification;
            firstRepairAttempts = ctx.verification.repairAttempts;
            firstRelatedPaths = [...ctx.verification.relatedPaths];
            try {
              const v = ctx.verification as unknown as {
                classification: string;
                repairAttempts: number;
                relatedPaths: string[];
              };
              v.classification = "passed";
              v.repairAttempts = 999;
              v.relatedPaths.push("injected/path.ts");
            } catch {
              mutationThrew = true;
            }
          }
        },
      },
    );
    const commandRunner = new ScriptedCommandRunner([
      makeExecution("test_failure", { stderr: "src/failing.ts error" }),
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

    await runner.run({
      runId: "r-immutable-fail",
      projectId: "p1",
      task: "immutability test",
      workspaceRoot: "/workspace",
    });

    expect(firstClassification).toBe("test_failure");
    expect(firstRepairAttempts).toBe(0);
    expect(firstRelatedPaths).toContain("src/failing.ts");
    expect(mutationThrew).toBe(true);

    expect(llm.contexts[2].verification?.classification).toBe("test_failure");
    expect(llm.contexts[2].verification?.repairAttempts).toBe(0);
    expect(llm.contexts[2].verification?.relatedPaths).not.toContain("injected/path.ts");
    expect(llm.contexts[2].verification?.relatedPaths).toContain("src/failing.ts");
  });

  it("provides independent passed feedback snapshots; mutation does not affect next turn", async () => {
    let firstClassification = "";
    let mutationThrew = false;
    const llm = new ScriptedMockLlm(
      [
        { tool: "apply_patch", patch: PATCH_1 },
        { tool: "read_file", path: "src/a.ts" },
        { tool: "finish", summary: "done", completion: "verified" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.verification && firstClassification === "") {
            firstClassification = ctx.verification.classification;
            try {
              const v = ctx.verification as unknown as {
                classification: string;
                relatedPaths: string[];
              };
              v.classification = "test_failure";
              v.relatedPaths.push("injected/path.ts");
            } catch {
              mutationThrew = true;
            }
          }
        },
      },
    );
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

    await runner.run({
      runId: "r-immutable-pass",
      projectId: "p1",
      task: "immutability pass test",
      workspaceRoot: "/workspace",
    });

    expect(firstClassification).toBe("passed");
    expect(mutationThrew).toBe(true);

    expect(llm.contexts[2].verification?.classification).toBe("passed");
    expect(llm.contexts[2].verification?.relatedPaths).not.toContain("injected/path.ts");
  });
});

describe("P1-4 rework: runtime frozen verification feedback", () => {
  it("freezes failure feedback and relatedPaths in LLM context; mutation throws TypeError", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "read_file", path: "src/a.ts" },
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const commandRunner = new ScriptedCommandRunner([
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

    await runner.run({
      runId: "r-freeze-fail",
      projectId: "p1",
      task: "freeze fail test",
      workspaceRoot: "/workspace",
    });

    const v = llm.contexts[1].verification;
    expect(v).toBeDefined();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v!.relatedPaths)).toBe(true);

    expect(() => {
      (v as unknown as { classification: string }).classification = "passed";
    }).toThrow(TypeError);
    expect(() => {
      (v as unknown as { relatedPaths: string[] }).relatedPaths.push("injected.ts");
    }).toThrow(TypeError);

    expect(llm.contexts[2].verification?.classification).toBe("test_failure");
    expect(llm.contexts[2].verification?.relatedPaths).not.toContain("injected.ts");
  });

  it("freezes passed feedback and relatedPaths in LLM context; mutation throws TypeError", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "apply_patch", patch: PATCH_1 },
      { tool: "read_file", path: "src/a.ts" },
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

    await runner.run({
      runId: "r-freeze-pass",
      projectId: "p1",
      task: "freeze pass test",
      workspaceRoot: "/workspace",
    });

    const v = llm.contexts[1].verification;
    expect(v).toBeDefined();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v!.relatedPaths)).toBe(true);

    expect(() => {
      (v as unknown as { classification: string }).classification = "test_failure";
    }).toThrow(TypeError);
    expect(() => {
      (v as unknown as { relatedPaths: string[] }).relatedPaths.push("injected.ts");
    }).toThrow(TypeError);

    expect(llm.contexts[2].verification?.classification).toBe("passed");
    expect(llm.contexts[2].verification?.relatedPaths).not.toContain("injected.ts");
  });
});
