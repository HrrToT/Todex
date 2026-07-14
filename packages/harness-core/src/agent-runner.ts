import type { Action, RunStatus, ToolResult } from "@todex/contracts";
import { parseAction } from "@todex/contracts";
import type { LlmClient, LlmTurnContext, RunInput, RunResult, ToolDispatcher } from "./llm.js";
import type { TraceStore } from "./trace-store.js";
import { InMemoryTraceStore } from "./trace-store.js";

const DEFAULT_MAX_STEPS = 50;

export interface RunnerOptions {
  readonly llm: LlmClient;
  readonly dispatcher: ToolDispatcher;
  readonly traceStore?: TraceStore;
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
  private readonly traceStore: TraceStore;
  private readonly cancelledRuns = new Set<string>();

  constructor(options: RunnerOptions) {
    this.llm = options.llm;
    this.dispatcher = options.dispatcher;
    this.traceStore = options.traceStore ?? new InMemoryTraceStore();
  }

  cancel(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  async run(input: RunInput): Promise<RunResult> {
    const { runId, projectId, task, maxSteps } = input;
    const limit = maxSteps ?? DEFAULT_MAX_STEPS;
    const results: ToolResult[] = [];
    let step = 0;

    while (true) {
      if (this.cancelledRuns.has(runId)) {
        this.traceStore.append({
          runId,
          type: "run_cancelled",
          payloadSummary: "cancelled before next LLM call",
        });
        return this.buildResult(runId, "cancelled", "cancelled", results);
      }

      if (step >= limit) {
        this.traceStore.append({
          runId,
          type: "run_failed",
          payloadSummary: "max_steps_exceeded",
        });
        return this.buildResult(runId, "failed", "max_steps_exceeded", results);
      }

      const context: LlmTurnContext = {
        runId,
        projectId,
        task,
        previousResults: [...results],
        trace: this.traceStore.list(runId),
      };

      let raw: unknown;
      try {
        raw = await this.llm.nextAction(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.traceStore.append({
          runId,
          type: "run_failed",
          payloadSummary: message,
        });
        return this.buildResult(runId, "failed", message, results);
      }

      let action: Action;
      try {
        action = parseAction(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.traceStore.append({
          runId,
          type: "action_rejected",
          payloadSummary: message,
        });
        this.traceStore.append({
          runId,
          type: "run_failed",
          payloadSummary: `invalid_action: ${message}`,
        });
        return this.buildResult(runId, "failed", `invalid_action: ${message}`, results);
      }

      this.traceStore.append({
        runId,
        type: "action_requested",
        payloadSummary: summarizeAction(action),
      });

      if (action.tool === "finish") {
        const status: RunStatus =
          action.completion === "verified" ? "completed" : "completed_unverified";
        this.traceStore.append({
          runId,
          type: "run_completed",
          payloadSummary: action.summary,
        });
        return this.buildResult(runId, status, "finish", results);
      }

      const actionId = `${runId}-step-${step}`;
      let result: ToolResult;
      try {
        result = await this.dispatcher.dispatch(action, { runId, actionId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          resultId: `${actionId}-result`,
          actionId,
          status: "failed",
          summary: `dispatcher error: ${message}`,
        };
      }
      results.push(result);
      this.traceStore.append({
        runId,
        type: "tool_completed",
        payloadSummary: `${result.status}: ${result.summary}`,
      });

      step += 1;
    }
  }

  private buildResult(
    runId: string,
    status: RunStatus,
    stopReason: string,
    results: readonly ToolResult[],
  ): RunResult {
    return {
      status,
      stopReason,
      trace: this.traceStore.list(runId),
      results,
    };
  }
}

export function createRunner(options: RunnerOptions): AgentRunner {
  return new AgentRunner(options);
}
