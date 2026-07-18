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
export { FileTools, HarnessDispatcher } from "./file-tools.js";
export type { WorkspaceFs, SearchMatch, PatchMetadata, FileToolsDeps, HarnessDispatcherDeps } from "./file-tools.js";
export { inspectUnifiedDiff, extractDiffPath } from "./patch-inspector.js";
export {
  normalizePath,
  isWithinWorkspace,
  getRelativePath,
  isSensitivePath,
  checkPath,
} from "./guardrail.js";
export { MemoryStore, InMemoryMemoryRepository, isSensitiveContent } from "./memory-store.js";
export type { MemoryRepository, MemoryStoreDeps } from "./memory-store.js";
export { ContextBuilder, EMPTY_MEMORY_CONTEXT } from "./context-builder.js";
export type { SelectedMemoryContext, ContextBuilderDeps, SelectionReason } from "./context-builder.js";
export { VerificationRunner } from "./verification-runner.js";
export type {
  CommandExecution,
  CommandExecutionCondition,
  CommandRunner,
  ConfiguredCommandRegistry,
  VerificationFeedback,
  VerificationRunnerDeps,
} from "./verification-runner.js";
export { ProjectDetector } from "./project-detector.js";
export type {
  ProjectMetadataReader,
  ProjectKind,
  DetectedCommandCandidate,
  DetectedProjectProfile,
} from "./project-detector.js";
export { runMechanismDemo } from "./mechanism-demo.js";
export type {
  MechanismDemoReport,
  WorkspaceEscapeDemo,
  RepairFeedbackDemo,
  ApprovalIsolationDemo,
} from "./mechanism-demo.js";
