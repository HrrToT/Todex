import type { ApprovalDecision } from "./run-controller.js";

export interface ApprovalBridge {
  decide(input: { approvalId: string; decision: ApprovalDecision }): Promise<unknown>;
}

export interface TodexPreloadSurface {
  approval?: ApprovalBridge;
}

declare global {
  interface Window {
    todex?: TodexPreloadSurface;
  }
}

export function preloadApprovalBridge(surface: TodexPreloadSurface | undefined = window.todex): ApprovalBridge | undefined {
  return surface?.approval;
}
