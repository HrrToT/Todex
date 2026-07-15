export const HARNESS_VERSION = "0.1.0";

export type {
  LlmTurnContext,
  LlmClient,
  ToolDispatcher,
  RunInput,
  RunResult,
  Clock,
  GovernanceContext,
  GovernanceDecision,
  GovernanceController,
  ApprovalStore,
  ApprovalDecisionInput,
  GovernanceRunner,
} from "./llm.js";
export type { TraceStore, TraceEventType } from "./trace-store.js";
export { InMemoryTraceStore } from "./trace-store.js";
export { ScriptedMockLlm } from "./mock-llm.js";
export type { ScriptedMockLlmOptions } from "./mock-llm.js";
export { AgentRunner, createRunner } from "./agent-runner.js";
export type { RunnerOptions } from "./agent-runner.js";
export { Guardrail } from "./guardrail.js";
export type { PathResolver, GuardrailDeps } from "./guardrail.js";
export { computeActionFingerprint } from "./guardrail.js";
export { InMemoryApprovalStore } from "./approval-store.js";
export type { InMemoryApprovalStoreOptions } from "./approval-store.js";
export { RunStateMachine } from "./run-state-machine.js";
export type { RunState, RunTransition } from "./run-state-machine.js";
export { FileTools, inspectUnifiedDiff } from "./file-tools.js";
export type { WorkspaceFs, SearchMatch, PatchMetadata, FileToolsDeps } from "./file-tools.js";
export {
  normalizePath,
  isWithinWorkspace,
  getRelativePath,
  isSensitivePath,
  checkPath,
} from "./guardrail.js";
