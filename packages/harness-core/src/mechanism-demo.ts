import type {
  Action,
  ConfiguredCommand,
  RunStatus,
  ToolResult,
} from "@todex/contracts";
import type { TraceEventType } from "./trace-store.js";
import { ScriptedMockLlm } from "./mock-llm.js";
import { createRunner } from "./agent-runner.js";
import { Guardrail, normalizePath, type PathResolver } from "./guardrail.js";
import { InMemoryApprovalStore } from "./approval-store.js";
import { VerificationRunner, type CommandExecution, type CommandExecutionCondition, type CommandRunner, type ConfiguredCommandRegistry } from "./verification-runner.js";
import { FileTools, type SearchMatch, type WorkspaceFs } from "./file-tools.js";
import type { Clock, GovernanceContext, ToolDispatcher } from "./llm.js";

export interface WorkspaceEscapeDemo {
  readonly passed: boolean;
  readonly status: RunStatus;
  readonly denialReason: "workspace_escape";
  readonly dispatcherCalls: number;
  readonly traceTypes: readonly TraceEventType[];
}

export interface RepairFeedbackDemo {
  readonly passed: boolean;
  readonly status: RunStatus;
  readonly verificationCalls: number;
  readonly failedFeedbackObserved: boolean;
  readonly repairApplied: boolean;
  readonly traceTypes: readonly TraceEventType[];
}

export interface ApprovalIsolationDemo {
  readonly passed: boolean;
  readonly runAStatus: RunStatus;
  readonly runBStatus: RunStatus;
  readonly runADispatcherCalls: number;
  readonly runBDispatcherCalls: number;
  readonly approvalScope: "run";
  readonly runBTraceTypes: readonly TraceEventType[];
}

export interface MechanismDemoReport {
  readonly allPassed: boolean;
  readonly workspaceEscape: WorkspaceEscapeDemo;
  readonly repairFeedback: RepairFeedbackDemo;
  readonly approvalIsolation: ApprovalIsolationDemo;
}

const WORKSPACE_ROOT = "/workspace";
const PROJECT_ID = "demo";

const PRICE_SOURCE_BUG = "export function add(left, right) { return left - right; }\n";
const PATCH_FIRST_ATTEMPT =
  "--- a/src/price.js\n+++ b/src/price.js\n@@ -1 +1 @@\n-export function add(left, right) { return left - right; }\n+export function add(left, right) { return right - left; }\n";
const PATCH_REPAIR =
  "--- a/src/price.js\n+++ b/src/price.js\n@@ -1 +1 @@\n-export function add(left, right) { return right - left; }\n+export function add(left, right) { return left + right; }\n";

class DemoClock implements Clock {
  private readonly current: Date;
  constructor(initial: Date = new Date("2026-01-01T00:00:00Z")) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
}

class DemoPathResolver implements PathResolver {
  resolveCanonical(workspaceRoot: string, path: string): string {
    const root = normalizePath(workspaceRoot.replace(/\\/g, "/"));
    const normalizedPath = path.replace(/\\/g, "/");
    const isAbsolute = normalizedPath.startsWith("/") || /^[A-Za-z]:/.test(normalizedPath);
    const joined = isAbsolute ? normalizedPath : `${root}/${normalizedPath}`;
    return normalizePath(joined);
  }
}

class InMemoryWorkspaceFs implements WorkspaceFs {
  private readonly files: Map<string, string> = new Map();

  constructor(initial: Record<string, string>) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, content);
    }
  }

  async list(path: string, maxDepth: number): Promise<readonly string[]> {
    const prefix = path === "." || path === "" ? "" : `${path}/`;
    const prefixDepth = prefix === "" ? 0 : prefix.split("/").length;
    return [...this.files.keys()]
      .filter((key) => {
        if (!key.startsWith(prefix)) return false;
        const relativeDepth = key.split("/").length - prefixDepth;
        return relativeDepth <= maxDepth;
      })
      .slice(0, 100);
  }

  async readText(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error("not_found");
    }
    return content;
  }

  async searchText(path: string, query: string): Promise<readonly SearchMatch[]> {
    const prefix = path === "." || path === "" ? "" : `${path}/`;
    const matches: SearchMatch[] = [];
    for (const [filePath, content] of this.files) {
      if (!filePath.startsWith(prefix)) continue;
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(query)) {
          matches.push({ path: filePath, line: index + 1, context: lines[index] });
        }
      }
    }
    return matches.slice(0, 20);
  }

  async snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    for (const path of paths) {
      result.set(path, this.files.get(path));
    }
    return result;
  }

  async commit(next: ReadonlyMap<string, string | undefined>): Promise<void> {
    for (const [path, content] of next) {
      if (content === undefined) {
        this.files.delete(path);
      } else {
        this.files.set(path, content);
      }
    }
  }

  readContent(path: string): string | undefined {
    return this.files.get(path);
  }
}

class CountingDispatcher implements ToolDispatcher {
  private readonly callsByRun = new Map<string, number>();

  async dispatch(
    action: Action,
    context: { runId: string; actionId: string; projectId: string },
  ): Promise<ToolResult> {
    this.callsByRun.set(context.runId, (this.callsByRun.get(context.runId) ?? 0) + 1);
    return {
      resultId: `${context.actionId}-result`,
      actionId: context.actionId,
      status: "succeeded",
      summary: "ok",
    };
  }

  callsFor(runId: string): number {
    return this.callsByRun.get(runId) ?? 0;
  }
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

function createMonotonicIdFactory(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

function makeCommand(): ConfiguredCommand {
  return {
    commandId: "demo.test",
    projectId: PROJECT_ID,
    purpose: "test",
    argv: ["node", "--test"],
    workingDirectory: ".",
    timeoutMs: 10_000,
    confirmedByUser: true,
  };
}

function makeRegistry(command: ConfiguredCommand): ConfiguredCommandRegistry {
  return {
    find: (projectId, commandId) =>
      command.projectId === projectId && command.commandId === commandId ? command : undefined,
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function buildGuardrail(): {
  readonly clock: DemoClock;
  readonly resolver: DemoPathResolver;
  readonly store: InMemoryApprovalStore;
  readonly guardrail: Guardrail;
} {
  const clock = new DemoClock();
  const resolver = new DemoPathResolver();
  const store = new InMemoryApprovalStore({
    clock,
    idFactory: createMonotonicIdFactory("approval"),
  });
  const guardrail = new Guardrail({
    pathResolver: resolver,
    approvalStore: store,
    clock,
    approvalIdFactory: createMonotonicIdFactory("approval"),
  });
  return { clock, resolver, store, guardrail };
}

async function runWorkspaceEscapeScenario(): Promise<WorkspaceEscapeDemo> {
  const { clock, store, guardrail } = buildGuardrail();
  const dispatcher = new CountingDispatcher();
  const readAction: Action = { tool: "read_file", path: "../.ssh/id_rsa" };
  const govContext: GovernanceContext = {
    runId: "demo-escape",
    projectId: PROJECT_ID,
    workspaceRoot: WORKSPACE_ROOT,
    actionId: "demo-escape-step-0",
  };
  const decision = guardrail.evaluate(readAction, govContext);
  const actualReason = decision.decision === "deny" ? decision.reason : "";

  const llm = new ScriptedMockLlm([
    readAction,
    { tool: "finish", summary: "blocked" },
  ]);
  const runner = createRunner({
    llm,
    dispatcher,
    governance: guardrail,
    approvalStore: store,
    clock,
  });

  const result = await runner.run({
    runId: "demo-escape",
    projectId: PROJECT_ID,
    task: "read sensitive file outside workspace",
    workspaceRoot: WORKSPACE_ROOT,
  });

  const expectedTrace = ["action_requested", "action_rejected", "action_requested", "run_completed"];
  const traceTypes = result.trace.map((event) => event.type);
  const passed =
    result.status === "completed" &&
    dispatcher.callsFor("demo-escape") === 0 &&
    actualReason === "workspace_escape" &&
    traceTypes.length === expectedTrace.length &&
    traceTypes.every((type, index) => type === expectedTrace[index]);

  return {
    passed,
    status: result.status,
    denialReason: "workspace_escape",
    dispatcherCalls: dispatcher.callsFor("demo-escape"),
    traceTypes,
  };
}

async function runRepairFeedbackScenario(): Promise<RepairFeedbackDemo> {
  const { clock, resolver, store, guardrail } = buildGuardrail();
  const fs = new InMemoryWorkspaceFs({ "src/price.js": PRICE_SOURCE_BUG });
  const fileTools = new FileTools({
    workspaceRoot: WORKSPACE_ROOT,
    fs,
    pathResolver: resolver,
  });
  const commandRunner = new ScriptedCommandRunner([
    makeExecution("test_failure", {
      stderr: "AssertionError: expected 5 received -1 at /home/user/project/src/bug.ts API_KEY=secret-value",
    }),
    makeExecution("success"),
  ]);
  const verificationRunner = new VerificationRunner({
    registry: makeRegistry(makeCommand()),
    commandRunner,
  });
  const llm = new ScriptedMockLlm([
    { tool: "apply_patch", patch: PATCH_FIRST_ATTEMPT },
    { tool: "apply_patch", patch: PATCH_REPAIR },
    { tool: "finish", summary: "repaired", completion: "verified" },
  ]);
  const runner = createRunner({
    llm,
    dispatcher: fileTools,
    governance: guardrail,
    approvalStore: store,
    clock,
    verificationRunner,
    verificationCommandId: "demo.test",
  });

  const result = await runner.run({
    runId: "demo-repair",
    projectId: PROJECT_ID,
    task: "fix arithmetic bug",
    workspaceRoot: WORKSPACE_ROOT,
  });

  const contexts = llm.contexts;
  const failedFeedbackObserved = contexts[1]?.verification?.classification === "test_failure";
  const passedFeedbackObserved = contexts[2]?.verification?.classification === "passed";
  const finalSource = fs.readContent("src/price.js") ?? "";
  const repairApplied = finalSource.includes("return left + right;") && passedFeedbackObserved;
  const traceTypes = result.trace.map((event) => event.type);
  const passed =
    result.status === "completed" &&
    commandRunner.calls.length === 2 &&
    failedFeedbackObserved &&
    repairApplied;

  return {
    passed,
    status: result.status,
    verificationCalls: commandRunner.calls.length,
    failedFeedbackObserved,
    repairApplied,
    traceTypes,
  };
}

async function runApprovalIsolationScenario(): Promise<ApprovalIsolationDemo> {
  const { clock, store, guardrail } = buildGuardrail();
  const dispatcher = new CountingDispatcher();
  const runAId = "demo-approval-a";
  const runBId = "demo-approval-b";
  const llm = new ScriptedMockLlm([
    { tool: "run_shell_command_with_approval", command: "npm install" },
    { tool: "finish", summary: "installed" },
    { tool: "run_shell_command_with_approval", command: "npm install" },
  ]);
  const runner = createRunner({
    llm,
    dispatcher,
    governance: guardrail,
    approvalStore: store,
    clock,
  });

  const runAResult = await runner.run({
    runId: runAId,
    projectId: PROJECT_ID,
    task: "install dependencies",
    workspaceRoot: WORKSPACE_ROOT,
  });

  const approvalA = runAResult.pendingApproval;
  const runAFinal = await runner.decideApproval({
    approvalId: approvalA?.approvalId ?? "",
    decision: "run",
  });
  const approvedScope = store.get(approvalA?.approvalId ?? "")?.decision ?? "";

  const runBResult = await runner.run({
    runId: runBId,
    projectId: PROJECT_ID,
    task: "install dependencies again",
    workspaceRoot: WORKSPACE_ROOT,
  });

  const runBTraceTypes = runBResult.trace.map((event) => event.type);
  const passed =
    runAResult.status === "awaiting_approval" &&
    runAFinal.status === "completed" &&
    runBResult.status === "awaiting_approval" &&
    dispatcher.callsFor(runAId) === 1 &&
    dispatcher.callsFor(runBId) === 0 &&
    approvedScope === "run" &&
    runBTraceTypes.includes("approval_requested") &&
    !runBTraceTypes.includes("tool_completed");

  return {
    passed,
    runAStatus: runAFinal.status,
    runBStatus: runBResult.status,
    runADispatcherCalls: dispatcher.callsFor(runAId),
    runBDispatcherCalls: dispatcher.callsFor(runBId),
    approvalScope: "run",
    runBTraceTypes,
  };
}

export async function runMechanismDemo(): Promise<MechanismDemoReport> {
  const workspaceEscape = await runWorkspaceEscapeScenario();
  const repairFeedback = await runRepairFeedbackScenario();
  const approvalIsolation = await runApprovalIsolationScenario();

  const report: MechanismDemoReport = {
    allPassed: workspaceEscape.passed && repairFeedback.passed && approvalIsolation.passed,
    workspaceEscape,
    repairFeedback,
    approvalIsolation,
  };

  return deepFreeze(report);
}
