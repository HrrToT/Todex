import type {
  Action,
  ApprovalRequest,
  ApprovalScope,
  RunStatus,
  ToolResult,
  TraceEvent,
} from "@todex/contracts";
import type { SelectedMemoryContext } from "./context-builder.js";

export interface LlmTurnContext {
  readonly runId: string;
  readonly projectId: string;
  readonly task: string;
  readonly workspaceRoot: string;
  readonly previousResults: readonly ToolResult[];
  readonly trace: readonly TraceEvent[];
  readonly memory?: SelectedMemoryContext;
}

export interface LlmClient {
  nextAction(context: LlmTurnContext): Promise<unknown>;
}

export interface ToolDispatcher {
  dispatch(
    action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult>;
}

export interface RunInput {
  readonly runId: string;
  readonly projectId: string;
  readonly task: string;
  readonly workspaceRoot: string;
  readonly maxSteps?: number;
}

export interface RunResult {
  readonly status: RunStatus;
  readonly stopReason?: string;
  readonly trace: readonly TraceEvent[];
  readonly results: readonly ToolResult[];
  readonly pendingApproval?: ApprovalRequest;
}

export interface Clock {
  now(): Date;
}

export interface GovernanceContext {
  readonly runId: string;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly actionId: string;
}

export type GovernanceDecision =
  | { readonly decision: "allow"; readonly reason: "safe_action" | "approved_scope" }
  | { readonly decision: "require_approval"; readonly request: ApprovalRequest }
  | { readonly decision: "deny"; readonly reason: string };

export interface GovernanceController {
  evaluate(action: Action, context: GovernanceContext): GovernanceDecision;
}

export interface ApprovalStore {
  create(request: ApprovalRequest): ApprovalRequest;
  get(approvalId: string): ApprovalRequest | undefined;
  decide(approvalId: string, decision: ApprovalScope, now: Date): ApprovalRequest;
  matchesGrant(context: GovernanceContext, action: Action, now: Date): boolean;
}

export interface ApprovalDecisionInput {
  readonly approvalId: string;
  readonly decision: ApprovalScope;
}

export interface GovernanceRunner {
  decideApproval(input: ApprovalDecisionInput): Promise<RunResult>;
  cancel(runId: string): void;
}
