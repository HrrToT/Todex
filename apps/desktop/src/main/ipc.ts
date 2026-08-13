import { memoryEntrySchema, type ApprovalScope, type RunSession, type ToolResult, type TraceEvent } from "@todex/contracts";
import { z } from "zod";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ProjectDetector, type DetectedProjectProfile } from "@todex/harness-core";

import type { WorkspaceHost } from "./workspace-host.js";
import type { WorkspaceSelector } from "./workspace-selector.js";
import type { DesktopRunService } from "./desktop-run-service.js";

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown): void;
}

interface IpcEventLike {
  readonly sender?: { send(channel: "run.update", payload: unknown): void };
}

export const TODexIpcChannels = [
  "workspace.choose",
  "project.importSelectedWorkspace",
  "project.list",
  "project.get",
  "project.delete",
  "model.list",
  "model.save",
  "command.list",
  "command.confirm",
  "command.remove",
  "run.list",
  "run.start",
  "run.get",
  "run.snapshot",
  "run.cancel",
  "run.subscribe",
  "run.unsubscribe",
  "approval.listPending",
  "approval.decide",
  "memory.list",
  "memory.save",
  "memory.delete",
  "credential.status",
  "credential.save",
  "credential.clear",
  "settings.getLocale",
  "settings.setLocale",
] as const;

const emptySchema = z.object({}).strict();
const projectIdSchema = z.object({ projectId: z.string().min(1) }).strict();
const commandIdSchema = z.object({ commandId: z.string().min(1) }).strict();
const commandCandidateSchema = z.object({ projectId: z.string().min(1), candidateId: z.string().min(1) }).strict();
const modelConfigSchema = z.object({ configId: z.string().min(1).optional(), projectId: z.string().min(1), baseUrl: z.string().url(), model: z.string().min(1) }).strict();
const runIdSchema = z.object({ runId: z.string().min(1) }).strict();
const runStartSchema = z.object({
  projectId: z.string().min(1),
  task: z.string().min(1),
  modelConfigId: z.string().min(1),
  verificationCommandId: z.string().min(1).optional(),
}).strict();
const runApprovalSchema = z.object({ runId: z.string().min(1).optional(), approvalId: z.string().min(1), decision: z.enum(["once", "run", "command_prefix", "deny"]) }).strict();
const memoryIdSchema = z.object({ memoryId: z.string().min(1) }).strict();
const credentialConfigSchema = z.object({ configId: z.string().min(1) }).strict();
const credentialSaveSchema = z
  .object({ configId: z.string().min(1), apiKey: z.string().min(1) })
  .strict();
const localeSchema = z.object({ locale: z.enum(["zh-CN", "en-US"]) }).strict();

export function registerTodexIpc(
  ipcMain: IpcMainLike,
  host: WorkspaceHost,
  workspaceSelector?: Pick<WorkspaceSelector, "choose">,
  runService?: DesktopRunService,
): void {
  const runSubscriptions = new Map<string, () => void>();
  register(ipcMain, "workspace.choose", emptySchema, async () => {
    const selected = await workspaceSelector?.choose();
    return selected ? Object.freeze({ displayName: selected.displayName }) : undefined;
  });
  register(ipcMain, "project.importSelectedWorkspace", emptySchema, async () => {
    const selected = await workspaceSelector?.choose();
    if (!selected) return undefined;
    const projectId = randomUUID();
    const profile = new ProjectDetector({
      readText(relativePath) {
        try { return readFileSync(join(selected.workspaceRoot, relativePath), "utf8"); } catch { return undefined; }
      },
    }).detect();
    const now = new Date().toISOString();
    return projectProjection(host.store.saveProject({ projectId, workspaceRoot: selected.workspaceRoot, displayName: selected.displayName, profileJson: JSON.stringify(profile), createdAt: now, updatedAt: now }));
  });
  register(ipcMain, "project.list", emptySchema, () => host.store.listProjects().map(projectProjection));
  register(ipcMain, "project.get", projectIdSchema, (input) => {
    const project = host.store.getProject(input.projectId);
    return project ? projectProjection(project) : undefined;
  });
  register(ipcMain, "project.delete", projectIdSchema, (input) => host.store.deleteProject(input.projectId));
  register(ipcMain, "model.list", projectIdSchema, (input) => host.store.listModelConfigs(input.projectId).map(modelProjection));
  register(ipcMain, "model.save", modelConfigSchema, (input) => {
    const now = new Date().toISOString();
    return modelProjection(host.store.saveModelConfig({ configId: input.configId ?? randomUUID(), projectId: input.projectId, baseUrl: input.baseUrl, model: input.model, parametersJson: "{}", createdAt: now, updatedAt: now }));
  });

  register(ipcMain, "command.list", projectIdSchema, (input) => host.store.listCommands(input.projectId).map(commandProjection));
  register(ipcMain, "command.confirm", commandCandidateSchema, (input) => {
    const project = host.store.getProject(input.projectId);
    if (!project) throw new Error("project_not_found");
    const profile = parseDetectedProfile(project.profileJson);
    const candidate = profile.candidates.find((item) => item.candidateId === input.candidateId);
    if (!candidate) throw new Error("candidate_not_found");
    return host.store.saveCommand({
      commandId: `${project.projectId}:${candidate.candidateId}`,
      projectId: project.projectId,
      purpose: candidate.purpose,
      argv: [...candidate.argv],
      workingDirectory: project.workspaceRoot,
      timeoutMs: candidate.timeoutMs,
      confirmedByUser: true,
    });
  });
  register(ipcMain, "command.remove", commandIdSchema, (input) => host.store.removeCommand(input.commandId));

  register(ipcMain, "run.list", projectIdSchema, (input) => host.store.listRuns(input.projectId).map(runSessionProjection));
  register(ipcMain, "run.start", runStartSchema, async (input) => {
    if (!runService) throw new Error("host_operation_failed");
    return runProjection(await runService.startBackground(input));
  });
  register(ipcMain, "run.snapshot", runIdSchema, (input) => {
    if (!runService) throw new Error("host_operation_failed");
    const snapshot = runService.snapshot(input.runId);
    return snapshot ? runProjection(snapshot) : undefined;
  });
  register(ipcMain, "run.get", runIdSchema, (input) => {
    const run = host.store.getRun(input.runId);
    return run ? runSessionProjection(run) : undefined;
  });
  register(ipcMain, "run.cancel", runIdSchema, (input) =>
    runService ? runService.cancel(input.runId) : host.store.updateRunStatus({
      runId: input.runId, status: "cancelled", endedAt: new Date().toISOString(), stopReason: "cancelled_by_user",
    }),
  );
  register(ipcMain, "run.subscribe", runIdSchema, (input, event) => {
    if (!runService) throw new Error("host_operation_failed");
    const sender = (event as IpcEventLike).sender;
    if (!sender) throw new Error("host_operation_failed");
    runSubscriptions.get(input.runId)?.();
    runSubscriptions.set(input.runId, runService.subscribe((snapshot) => {
      if (snapshot.run.runId === input.runId) sender.send("run.update", runProjection(snapshot));
    }));
    const current = runService.snapshot(input.runId);
    if (current) sender.send("run.update", runProjection(current));
    return { subscribed: true };
  });
  register(ipcMain, "run.unsubscribe", runIdSchema, (input) => {
    runSubscriptions.get(input.runId)?.();
    runSubscriptions.delete(input.runId);
    return { subscribed: false };
  });

  register(ipcMain, "approval.listPending", projectIdSchema, (input) =>
    host.store.listPendingApprovals(input.projectId),
  );
  register(ipcMain, "approval.decide", runApprovalSchema, async (input) => {
    if (runService) {
      if (!input.runId) throw new Error("invalid_ipc_input");
      return runProjection(await runService.decideApproval({ ...input, runId: input.runId }));
    }
    const approval = host.store
      .listPendingApprovals()
      .find((candidate) => candidate.approvalId === input.approvalId);
    if (!approval) {
      throw new Error("host_operation_failed");
    }
    return host.store.saveApproval({
      ...approval,
      decision: input.decision as ApprovalScope,
      state: input.decision === "deny" ? "denied" : "approved",
      decidedAt: new Date().toISOString(),
    });
  });

  register(ipcMain, "memory.list", projectIdSchema, (input) => host.store.listMemories(input.projectId));
  register(ipcMain, "memory.save", memoryEntrySchema, (input) => host.store.saveMemory(input));
  register(ipcMain, "memory.delete", memoryIdSchema, (input) =>
    host.store.deleteMemory(input.memoryId, new Date().toISOString()),
  );

  register(ipcMain, "credential.status", credentialConfigSchema, (input) =>
    host.credentialStatus(input.configId),
  );
  register(ipcMain, "credential.save", credentialSaveSchema, (input) =>
    host.saveCredential(input.configId, input.apiKey),
  );
  register(ipcMain, "credential.clear", credentialConfigSchema, (input) =>
    host.clearCredential(input.configId),
  );
  register(ipcMain, "settings.getLocale", emptySchema, () => ({ locale: host.store.getLocale() }));
  register(ipcMain, "settings.setLocale", localeSchema, (input) => ({ locale: host.store.setLocale(input.locale) }));
}

const detectedProfileSchema = z.object({
  kinds: z.array(z.enum(["node", "python"])),
  candidates: z.array(z.object({
    candidateId: z.string().min(1),
    purpose: z.enum(["test", "lint", "typecheck", "build"]),
    argv: z.array(z.string().min(1)).min(1),
    workingDirectory: z.literal("."),
    timeoutMs: z.literal(120_000),
    confirmedByUser: z.literal(false),
    reason: z.string(),
  }).strict()),
  notices: z.array(z.string()),
}).strict();

function parseDetectedProfile(raw: string): DetectedProjectProfile {
  try {
    return detectedProfileSchema.parse(JSON.parse(raw)) as DetectedProjectProfile;
  } catch {
    throw new Error("project_profile_invalid");
  }
}

function projectProjection(project: { readonly projectId: string; readonly displayName: string; readonly profileJson: string }) {
  return Object.freeze({
    projectId: project.projectId,
    displayName: project.displayName,
    profile: parseDetectedProfile(project.profileJson),
  });
}

function commandProjection(command: { readonly commandId: string; readonly projectId: string; readonly purpose: string; readonly argv: readonly string[]; readonly timeoutMs: number; readonly confirmedByUser: boolean; readonly lastResult?: "passed" | "failed" }) {
  return Object.freeze({
    commandId: command.commandId,
    projectId: command.projectId,
    purpose: command.purpose,
    argv: Object.freeze([...command.argv]),
    timeoutMs: command.timeoutMs,
    confirmedByUser: command.confirmedByUser,
    ...(command.lastResult ? { lastResult: command.lastResult } : {}),
  });
}

function modelProjection(model: { readonly configId: string; readonly projectId?: string; readonly baseUrl: string; readonly model: string; readonly createdAt: string; readonly updatedAt: string }) {
  return Object.freeze({
    configId: model.configId,
    ...(model.projectId ? { projectId: model.projectId } : {}),
    baseUrl: model.baseUrl,
    model: model.model,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });
}

function runSessionProjection(run: RunSession) {
  return Object.freeze({
    runId: run.runId,
    projectId: run.projectId,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    repairAttempts: run.repairAttempts,
    ...(run.stopReason ? { stopReason: run.stopReason } : {}),
  });
}

function runProjection(snapshot: { readonly run: RunSession; readonly trace: readonly TraceEvent[]; readonly results: readonly ToolResult[]; readonly pendingApproval?: { readonly approvalId: string; readonly actionId: string; readonly tool: string; readonly riskReasons: readonly string[]; readonly state: string; readonly createdAt: string; readonly expiresAt?: string } }) {
  return Object.freeze({
    run: runSessionProjection(snapshot.run),
    trace: Object.freeze(snapshot.trace.map((event) => Object.freeze({ eventId: event.eventId, type: event.type, timestamp: event.timestamp, payloadSummary: event.payloadSummary }))),
    results: Object.freeze(snapshot.results.map((result) => Object.freeze({ resultId: result.resultId, actionId: result.actionId, status: result.status, summary: result.summary }))),
    ...(snapshot.pendingApproval ? { pendingApproval: Object.freeze({
      approvalId: snapshot.pendingApproval.approvalId,
      actionId: snapshot.pendingApproval.actionId,
      tool: snapshot.pendingApproval.tool,
      riskReasons: Object.freeze([...snapshot.pendingApproval.riskReasons]),
      state: snapshot.pendingApproval.state,
      createdAt: snapshot.pendingApproval.createdAt,
      ...(snapshot.pendingApproval.expiresAt ? { expiresAt: snapshot.pendingApproval.expiresAt } : {}),
    }) } : {}),
  });
}

function register<T>(
  ipcMain: IpcMainLike,
  channel: (typeof TODexIpcChannels)[number],
  schema: z.ZodType<T>,
  operation: (input: T, event: unknown) => unknown,
): void {
  ipcMain.handle(channel, async (event, rawInput) => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error("invalid_ipc_input");
    }
    try {
      return await operation(parsed.data, event);
    } catch (error) {
      if (error instanceof Error && error.message === "credential_unavailable") {
        throw new Error("credential_unavailable");
      }
      if (error instanceof Error && error.message === "invalid_ipc_input") {
        throw error;
      }
      throw new Error("host_operation_failed");
    }
  });
}
