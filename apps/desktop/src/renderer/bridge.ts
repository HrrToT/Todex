import type { ApprovalDecision } from "./run-controller.js";
import type { LiveRunBridge } from "./run-controller.js";

export interface ApprovalBridge {
  decide(input: { approvalId: string; decision: ApprovalDecision }): Promise<unknown>;
}

export interface WorkspaceSelectionBridge {
  choose(): Promise<{ workspaceRoot: string; displayName: string } | undefined>;
}

export interface TodexPreloadSurface {
  approval?: ApprovalBridge;
  workspace?: WorkspaceSelectionBridge;
  run?: {
    start(input: { projectId: string; task: string; modelConfigId: string; verificationCommandId?: string }): Promise<unknown>;
    snapshot(runId: string): Promise<unknown>;
    cancel(runId: string): Promise<unknown>;
  };
  project?: { importSelectedWorkspace(): Promise<{ projectId: string; displayName: string } | undefined> };
  model?: {
    list(projectId: string): Promise<readonly { configId: string; baseUrl: string; model: string }[]>;
    save(input: { projectId: string; baseUrl: string; model: string }): Promise<{ configId: string; baseUrl: string; model: string }>;
  };
}

export function preloadRunBridge(surface: TodexPreloadSurface | undefined = window.todex): LiveRunBridge | undefined {
  return surface?.run;
}

declare global {
  interface Window {
    todex?: TodexPreloadSurface;
  }
}

export function preloadApprovalBridge(surface: TodexPreloadSurface | undefined = window.todex): ApprovalBridge | undefined {
  return surface?.approval;
}
