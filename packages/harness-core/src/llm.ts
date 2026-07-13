import type { Action, RunStatus, ToolResult, TraceEvent } from "@todex/contracts";

export interface LlmTurnContext {
  readonly runId: string;
  readonly projectId: string;
  readonly task: string;
  readonly previousResults: readonly ToolResult[];
  readonly trace: readonly TraceEvent[];
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
  readonly maxSteps?: number;
}

export interface RunResult {
  readonly status: RunStatus;
  readonly stopReason?: string;
  readonly trace: readonly TraceEvent[];
  readonly results: readonly ToolResult[];
}
