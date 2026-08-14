import type { ApprovalDecision } from "./run-controller.js";
import type { LiveRunBridge } from "./run-controller.js";
import type { Locale } from "./i18n.js";

export interface ApprovalBridge {
  decide(input: { approvalId: string; decision: ApprovalDecision; runId?: string }): Promise<unknown>;
}

export interface WorkspaceSelectionBridge {
  choose(): Promise<{ displayName: string } | undefined>;
}

export interface TodexPreloadSurface {
  approval?: ApprovalBridge;
  workspace?: WorkspaceSelectionBridge;
  run?: {
    start(input: { projectId: string; task: string; modelConfigId: string; verificationCommandId?: string }): Promise<unknown>;
    snapshot(runId: string): Promise<unknown>;
    cancel(runId: string): Promise<unknown>;
    subscribe(runId: string, listener: (snapshot: unknown) => void): () => void;
  };
  project?: {
    importSelectedWorkspace(): Promise<DesktopProjectProjection | undefined>;
    list(): Promise<readonly DesktopProjectProjection[]>;
  };
  command?: {
    list(projectId: string): Promise<readonly DesktopConfiguredCommand[]>;
    confirm(projectId: string, candidateId: string): Promise<unknown>;
    remove(commandId: string): Promise<unknown>;
  };
  model?: {
    list(projectId: string): Promise<readonly { configId: string; baseUrl: string; model: string }[]>;
    save(input: { projectId: string; baseUrl: string; model: string }): Promise<{ configId: string; baseUrl: string; model: string }>;
  };
  credential?: {
    status(configId: string): Promise<{ configured: boolean; availability: "available" | "unavailable" }>;
    save(configId: string, apiKey: string): Promise<{ configured: true }>;
    clear(configId: string): Promise<{ configured: false }>;
  };
  settings?: {
    getLocale(): Promise<{ locale: Locale }>;
    setLocale(locale: Locale): Promise<{ locale: Locale }>;
  };
}

export interface DesktopCommandCandidate {
  readonly candidateId: string;
  readonly purpose: "test" | "lint" | "typecheck" | "build";
  readonly argv: readonly string[];
  readonly reason: string;
}

export interface DesktopConfiguredCommand {
  readonly commandId: string;
  readonly purpose: "test" | "lint" | "typecheck" | "build";
  readonly confirmedByUser: boolean;
}

export interface DesktopProjectProjection {
  readonly projectId: string;
  readonly displayName: string;
  readonly profile: {
    readonly kinds: readonly ("node" | "python")[];
    readonly candidates: readonly DesktopCommandCandidate[];
    readonly notices: readonly string[];
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
