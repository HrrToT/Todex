import type { ApprovalDecision } from "./run-controller.js";

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
}

declare global {
  interface Window {
    todex?: TodexPreloadSurface;
  }
}

export function preloadApprovalBridge(surface: TodexPreloadSurface | undefined = window.todex): ApprovalBridge | undefined {
  return surface?.approval;
}
