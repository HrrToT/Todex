export const HARNESS_VERSION = "0.1.0";

export type {
  LlmTurnContext,
  LlmClient,
  ToolDispatcher,
  RunInput,
  RunResult,
} from "./llm.js";
export type { TraceStore, TraceEventType } from "./trace-store.js";
export { InMemoryTraceStore } from "./trace-store.js";
export { ScriptedMockLlm } from "./mock-llm.js";
export type { ScriptedMockLlmOptions } from "./mock-llm.js";
export { AgentRunner, createRunner } from "./agent-runner.js";
export type { RunnerOptions } from "./agent-runner.js";
