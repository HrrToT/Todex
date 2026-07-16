import type { Action, ApprovalRequest, RunStatus, ToolResult, VerificationClassification, VerificationResult } from "@todex/contracts";
import { parseAction } from "@todex/contracts";
import type {
  ApprovalDecisionInput,
  ApprovalStore,
  Clock,
  GovernanceContext,
  GovernanceController,
  LlmClient,
  LlmTurnContext,
  RunInput,
  RunResult,
  ToolDispatcher,
} from "./llm.js";
import type { TraceStore } from "./trace-store.js";
import { InMemoryTraceStore } from "./trace-store.js";
import { RunStateMachine } from "./run-state-machine.js";
import type { ContextBuilder } from "./context-builder.js";
import { EMPTY_MEMORY_CONTEXT } from "./context-builder.js";
import type { VerificationFeedback, VerificationRunner } from "./verification-runner.js";

const DEFAULT_MAX_STEPS = 50;

const REPAIRABLE_CLASSIFICATIONS: ReadonlySet<VerificationClassification> = new Set([
  "test_failure",
  "quality_failure",
  "build_failure",
]);

const ENVIRONMENT_CLASSIFICATIONS: ReadonlySet<VerificationClassification> = new Set([
  "command_not_found",
  "dependency_missing",
  "timeout",
  "execution_error",
]);

export interface RunnerOptions {
  readonly llm: LlmClient;
  readonly dispatcher: ToolDispatcher;
  readonly governance: GovernanceController;
  readonly approvalStore: ApprovalStore;
  readonly clock: Clock;
  readonly traceStore?: TraceStore;
  readonly contextBuilder?: ContextBuilder;
  readonly verificationRunner?: VerificationRunner;
  readonly verificationCommandId?: string;
}

interface PendingAction {
  readonly action: Action;
  readonly actionId: string;
  readonly approval: ApprovalRequest;
}

interface RunState {
  readonly runId: string;
  readonly projectId: string;
  readonly task: string;
  readonly workspaceRoot: string;
  readonly maxSteps: number;
  step: number;
  results: ToolResult[];
  pendingAction?: PendingAction;
  stateMachine: RunStateMachine;
  repairAttempts: number;
  latestVerification?: VerificationResult;
  verificationFeedback?: VerificationFeedback;
}

function summarizeAction(action: Action): string {
  switch (action.tool) {
    case "list_files":
      return `list_files ${action.path}`;
    case "read_file":
      return `read_file ${action.path}`;
    case "search_text":
      return `search_text "${action.query}"`;
    case "apply_patch":
      return `apply_patch (${action.patch.length} chars)`;
    case "run_configured_command":
      return `run_configured_command ${action.commandId}`;
    case "run_shell_command_with_approval":
      return `run_shell_command_with_approval ${action.command}`;
    case "remember":
      return `remember ${action.kind}`;
    case "finish":
      return `finish: ${action.summary}`;
  }
}

export class AgentRunner {
  private readonly llm: LlmClient;
  private readonly dispatcher: ToolDispatcher;
  private readonly governance: GovernanceController;
  private readonly approvalStore: ApprovalStore;
  private readonly clock: Clock;
  private readonly traceStore: TraceStore;
  private readonly contextBuilder?: ContextBuilder;
  private readonly verificationRunner?: VerificationRunner;
  private readonly verificationCommandId?: string;
  private readonly cancelledRuns = new Set<string>();
  private readonly runStates = new Map<string, RunState>();

  constructor(options: RunnerOptions) {
    this.llm = options.llm;
    this.dispatcher = options.dispatcher;
    this.governance = options.governance;
    this.approvalStore = options.approvalStore;
    this.clock = options.clock;
    this.traceStore = options.traceStore ?? new InMemoryTraceStore();
    this.contextBuilder = options.contextBuilder;
    this.verificationRunner = options.verificationRunner;
    this.verificationCommandId = options.verificationCommandId;
  }

  cancel(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  async run(input: RunInput): Promise<RunResult> {
    const state: RunState = {
      runId: input.runId,
      projectId: input.projectId,
      task: input.task,
      workspaceRoot: input.workspaceRoot,
      maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
      step: 0,
      results: [],
      stateMachine: new RunStateMachine(),
      repairAttempts: 0,
    };
    this.runStates.set(input.runId, state);
    return this.runLoop(state);
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<RunResult> {
    const state = this.findPendingRun(input.approvalId);
    if (!state || !state.pendingAction) {
      throw new Error("no_pending_approval");
    }

    if (this.cancelledRuns.has(state.runId)) {
      this.transitionSafely(state, "cancelled");
      this.traceStore.append({
        runId: state.runId,
        type: "run_cancelled",
        payloadSummary: "cancelled while awaiting approval",
      });
      state.pendingAction = undefined;
      return this.buildResult(state, "cancelled", "cancelled");
    }

    const existing = this.approvalStore.get(input.approvalId);
    if (!existing || existing.state !== "pending") {
      throw new Error("approval_not_pending");
    }

    const now = this.clock.now();
    let request: ApprovalRequest;
    try {
      request = this.approvalStore.decide(input.approvalId, input.decision, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "approval_scope_not_allowed") {
        this.traceStore.append({
          runId: state.runId,
          type: "approval_decided",
          payloadSummary: `scope rejected: ${input.decision}`,
        });
        return this.buildResult(
          state,
          "awaiting_approval",
          "approval_scope_not_allowed",
          this.approvalStore.get(input.approvalId) ?? state.pendingAction.approval,
        );
      }
      this.transitionSafely(state, "cancelled");
      this.traceStore.append({
        runId: state.runId,
        type: "run_cancelled",
        payloadSummary: "approval not decidable",
      });
      state.pendingAction = undefined;
      return this.buildResult(state, "cancelled", "approval_not_decidable");
    }

    this.traceStore.append({
      runId: state.runId,
      type: "approval_decided",
      payloadSummary: `${request.state}: ${input.decision}`,
    });

    if (request.state === "denied") {
      const result: ToolResult = {
        resultId: `${state.pendingAction.actionId}-result`,
        actionId: state.pendingAction.actionId,
        status: "rejected",
        summary: "denied by human",
      };
      state.results.push(result);
      this.transitionSafely(state, "running");
      state.pendingAction = undefined;
      state.step += 1;
      return this.runLoop(state);
    }

    this.transitionSafely(state, "dispatching");
    const result = await this.dispatchSafely(
      state.pendingAction.action,
      state.runId,
      state.pendingAction.actionId,
      state.projectId,
    );
    state.results.push(result);
    this.transitionSafely(state, "running");
    this.traceStore.append({
      runId: state.runId,
      type: "tool_completed",
      payloadSummary: `${result.status}: ${result.summary}`,
    });
    const approvedAction = state.pendingAction?.action;
    state.pendingAction = undefined;

    if (
      approvedAction?.tool === "apply_patch" &&
      result.status === "succeeded" &&
      this.verificationRunner &&
      this.verificationCommandId
    ) {
      const terminal = await this.runVerification(state);
      if (terminal) {
        return terminal;
      }
    }

    state.step += 1;
    return this.runLoop(state);
  }

  private async runLoop(state: RunState): Promise<RunResult> {
    while (true) {
      if (this.cancelledRuns.has(state.runId)) {
        this.transitionSafely(state, "cancelled");
        this.traceStore.append({
          runId: state.runId,
          type: "run_cancelled",
          payloadSummary: "cancelled before next LLM call",
        });
        return this.buildResult(state, "cancelled", "cancelled");
      }

      if (state.step >= state.maxSteps) {
        this.transitionSafely(state, "failed");
        this.traceStore.append({
          runId: state.runId,
          type: "run_failed",
          payloadSummary: "max_steps_exceeded",
        });
        return this.buildResult(state, "failed", "max_steps_exceeded");
      }

      const memory = this.contextBuilder?.build({ projectId: state.projectId }) ?? EMPTY_MEMORY_CONTEXT;
      const context: LlmTurnContext = {
        runId: state.runId,
        projectId: state.projectId,
        task: state.task,
        workspaceRoot: state.workspaceRoot,
        previousResults: [...state.results],
        trace: this.traceStore.list(state.runId),
        memory,
        verification: state.verificationFeedback,
      };

      let raw: unknown;
      try {
        raw = await this.llm.nextAction(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.transitionSafely(state, "failed");
        this.traceStore.append({
          runId: state.runId,
          type: "run_failed",
          payloadSummary: message,
        });
        return this.buildResult(state, "failed", message);
      }

      let action: Action;
      try {
        action = parseAction(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.traceStore.append({
          runId: state.runId,
          type: "action_rejected",
          payloadSummary: message,
        });
        this.transitionSafely(state, "failed");
        this.traceStore.append({
          runId: state.runId,
          type: "run_failed",
          payloadSummary: `invalid_action: ${message}`,
        });
        return this.buildResult(state, "failed", `invalid_action: ${message}`);
      }

      this.traceStore.append({
        runId: state.runId,
        type: "action_requested",
        payloadSummary: summarizeAction(action),
      });

      if (action.tool === "finish") {
        let status: RunStatus;
        if (action.completion === "unverified") {
          status = "completed_unverified";
        } else {
          if (this.verificationRunner) {
            status = state.latestVerification?.classification === "passed" ? "completed" : "completed_unverified";
          } else {
            status = "completed";
          }
        }
        this.transitionSafely(state, status);
        this.traceStore.append({
          runId: state.runId,
          type: "run_completed",
          payloadSummary: action.summary,
        });
        return this.buildResult(state, status, "finish");
      }

      const actionId = `${state.runId}-step-${state.step}`;

      const govContext: GovernanceContext = {
        runId: state.runId,
        projectId: state.projectId,
        workspaceRoot: state.workspaceRoot,
        actionId,
      };

      const decision = this.governance.evaluate(action, govContext);

      if (decision.decision === "deny") {
        this.traceStore.append({
          runId: state.runId,
          type: "action_rejected",
          payloadSummary: `denied: ${decision.reason}`,
        });
        const result: ToolResult = {
          resultId: `${actionId}-result`,
          actionId,
          status: "rejected",
          summary: `denied: ${decision.reason}`,
        };
        state.results.push(result);
        state.step += 1;
        continue;
      }

      if (decision.decision === "require_approval") {
        const stored = this.approvalStore.create(decision.request);
        state.pendingAction = { action, actionId, approval: stored };
        this.transitionSafely(state, "awaiting_approval");
        this.traceStore.append({
          runId: state.runId,
          type: "approval_requested",
          payloadSummary: `${action.tool}: ${stored.approvalId}`,
        });
        return this.buildResult(state, "awaiting_approval", "approval_required", stored);
      }

      this.transitionSafely(state, "dispatching");
      const result = await this.dispatchSafely(action, state.runId, actionId, state.projectId);
      state.results.push(result);
      this.transitionSafely(state, "running");
      this.traceStore.append({
        runId: state.runId,
        type: "tool_completed",
        payloadSummary: `${result.status}: ${result.summary}`,
      });

      if (
        action.tool === "apply_patch" &&
        result.status === "succeeded" &&
        this.verificationRunner &&
        this.verificationCommandId
      ) {
        const terminal = await this.runVerification(state);
        if (terminal) {
          return terminal;
        }
      }

      state.step += 1;
    }
  }

  private async runVerification(state: RunState): Promise<RunResult | undefined> {
    if (this.cancelledRuns.has(state.runId)) {
      this.transitionSafely(state, "cancelled");
      this.traceStore.append({
        runId: state.runId,
        type: "run_cancelled",
        payloadSummary: "cancelled before verification",
      });
      return this.buildResult(state, "cancelled", "cancelled");
    }

    const isRepair =
      state.latestVerification !== undefined &&
      REPAIRABLE_CLASSIFICATIONS.has(state.latestVerification.classification);
    if (isRepair) {
      state.repairAttempts += 1;
    }

    state.latestVerification = undefined;
    state.verificationFeedback = undefined;

    const verificationResult = await this.verificationRunner!.run({
      projectId: state.projectId,
      commandId: this.verificationCommandId!,
      runId: state.runId,
    });

    if (this.cancelledRuns.has(state.runId)) {
      this.traceStore.append({
        runId: state.runId,
        type: "verification_completed",
        payloadSummary: `${verificationResult.classification}: cancelled`,
      });
      this.transitionSafely(state, "cancelled");
      this.traceStore.append({
        runId: state.runId,
        type: "run_cancelled",
        payloadSummary: "cancelled after verification",
      });
      return this.buildResult(state, "cancelled", "cancelled");
    }

    this.traceStore.append({
      runId: state.runId,
      type: "verification_completed",
      payloadSummary: `${verificationResult.classification}: ${verificationResult.failureSummary.slice(0, 100)}`,
    });

    state.latestVerification = verificationResult;

    if (ENVIRONMENT_CLASSIFICATIONS.has(verificationResult.classification)) {
      this.transitionSafely(state, "failed");
      this.traceStore.append({
        runId: state.runId,
        type: "run_failed",
        payloadSummary: `failed_environment: ${verificationResult.classification}`,
      });
      return this.buildResult(state, "failed_environment", verificationResult.classification);
    }

    if (verificationResult.classification === "cancelled") {
      this.transitionSafely(state, "cancelled");
      this.traceStore.append({
        runId: state.runId,
        type: "run_cancelled",
        payloadSummary: "verification cancelled",
      });
      return this.buildResult(state, "cancelled", "cancelled");
    }

    if (REPAIRABLE_CLASSIFICATIONS.has(verificationResult.classification)) {
      if (state.repairAttempts >= 3) {
        this.transitionSafely(state, "failed");
        this.traceStore.append({
          runId: state.runId,
          type: "run_failed",
          payloadSummary: "failed_repair_limit",
        });
        return this.buildResult(state, "failed_repair_limit", "failed_repair_limit");
      }
      state.verificationFeedback = this.verificationRunner!.toFeedback(
        verificationResult,
        state.repairAttempts,
      );
      return undefined;
    }

    if (verificationResult.classification === "passed") {
      state.verificationFeedback = this.verificationRunner!.toFeedback(
        verificationResult,
        state.repairAttempts,
      );
      return undefined;
    }

    return undefined;
  }

  private async dispatchSafely(
    action: Action,
    runId: string,
    actionId: string,
    projectId: string,
  ): Promise<ToolResult> {
    try {
      return await this.dispatcher.dispatch(action, { runId, actionId, projectId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        resultId: `${actionId}-result`,
        actionId,
        status: "failed",
        summary: `dispatcher error: ${message}`,
      };
    }
  }

  private findPendingRun(approvalId: string): RunState | undefined {
    for (const state of this.runStates.values()) {
      if (state.pendingAction?.approval.approvalId === approvalId) {
        return state;
      }
    }
    return undefined;
  }

  private transitionSafely(state: RunState, to: "running" | "dispatching" | "awaiting_approval" | "completed" | "completed_unverified" | "failed" | "cancelled"): void {
    if (state.stateMachine.getCurrentState() === to) {
      return;
    }
    state.stateMachine.transition(to);
  }

  private buildResult(
    state: RunState,
    status: RunStatus,
    stopReason: string,
    pendingApproval?: ApprovalRequest,
  ): RunResult {
    return {
      status,
      stopReason,
      trace: this.traceStore.list(state.runId),
      results: [...state.results],
      pendingApproval,
    };
  }
}

export function createRunner(options: RunnerOptions): AgentRunner {
  return new AgentRunner(options);
}
