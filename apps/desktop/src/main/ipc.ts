import { configuredCommandSchema, memoryEntrySchema, type ApprovalScope } from "@todex/contracts";
import { z } from "zod";

import type { WorkspaceHost } from "./workspace-host.js";
import type { WorkspaceSelector } from "./workspace-selector.js";
import type { DesktopRunService } from "./desktop-run-service.js";

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown): void;
}

export const TODexIpcChannels = [
  "workspace.choose",
  "project.list",
  "project.get",
  "project.save",
  "project.delete",
  "command.list",
  "command.confirm",
  "command.remove",
  "run.list",
  "run.start",
  "run.get",
  "run.snapshot",
  "run.cancel",
  "approval.listPending",
  "approval.decide",
  "memory.list",
  "memory.save",
  "memory.delete",
  "credential.status",
  "credential.save",
  "credential.clear",
] as const;

const emptySchema = z.object({}).strict();
const projectIdSchema = z.object({ projectId: z.string().min(1) }).strict();
const projectSchema = z
  .object({
    projectId: z.string().min(1),
    workspaceRoot: z.string().min(1),
    displayName: z.string().min(1),
    profileJson: z.string(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
const commandIdSchema = z.object({ commandId: z.string().min(1) }).strict();
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

export function registerTodexIpc(
  ipcMain: IpcMainLike,
  host: WorkspaceHost,
  workspaceSelector?: Pick<WorkspaceSelector, "choose">,
  runService?: DesktopRunService,
): void {
  register(ipcMain, "workspace.choose", emptySchema, () => workspaceSelector?.choose());
  register(ipcMain, "project.list", emptySchema, () => host.store.listProjects());
  register(ipcMain, "project.get", projectIdSchema, (input) => host.store.getProject(input.projectId));
  register(ipcMain, "project.save", projectSchema, (input) => host.store.saveProject(input));
  register(ipcMain, "project.delete", projectIdSchema, (input) => host.store.deleteProject(input.projectId));

  register(ipcMain, "command.list", projectIdSchema, (input) => host.store.listCommands(input.projectId));
  register(ipcMain, "command.confirm", configuredCommandSchema, (input) =>
    host.store.saveCommand({ ...input, confirmedByUser: true }),
  );
  register(ipcMain, "command.remove", commandIdSchema, (input) => host.store.removeCommand(input.commandId));

  register(ipcMain, "run.list", projectIdSchema, (input) => host.store.listRuns(input.projectId));
  register(ipcMain, "run.start", runStartSchema, (input) => {
    if (!runService) throw new Error("host_operation_failed");
    return runService.start(input);
  });
  register(ipcMain, "run.snapshot", runIdSchema, (input) => {
    if (!runService) throw new Error("host_operation_failed");
    return runService.snapshot(input.runId);
  });
  register(ipcMain, "run.get", runIdSchema, (input) => host.store.getRun(input.runId));
  register(ipcMain, "run.cancel", runIdSchema, (input) =>
    runService ? runService.cancel(input.runId) : host.store.updateRunStatus({
      runId: input.runId, status: "cancelled", endedAt: new Date().toISOString(), stopReason: "cancelled_by_user",
    }),
  );

  register(ipcMain, "approval.listPending", projectIdSchema, (input) =>
    host.store.listPendingApprovals(input.projectId),
  );
  register(ipcMain, "approval.decide", runApprovalSchema, (input) => {
    if (runService) {
      if (!input.runId) throw new Error("invalid_ipc_input");
      return runService.decideApproval({ ...input, runId: input.runId });
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
}

function register<T>(
  ipcMain: IpcMainLike,
  channel: (typeof TODexIpcChannels)[number],
  schema: z.ZodType<T>,
  operation: (input: T) => unknown,
): void {
  ipcMain.handle(channel, async (_event, rawInput) => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error("invalid_ipc_input");
    }
    try {
      return await operation(parsed.data);
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
