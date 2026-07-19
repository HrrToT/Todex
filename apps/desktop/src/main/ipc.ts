import { randomUUID } from "node:crypto";

import {
  approvalRequestSchema,
  configuredCommandSchema,
  memoryEntrySchema,
  type ApprovalScope,
} from "@todex/contracts";
import { z } from "zod";

import type { WorkspaceHost } from "./workspace-host.js";

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown): void;
}

export const TODexIpcChannels = [
  "project.selectWorkspace",
  "project.list",
  "project.get",
  "project.save",
  "project.delete",
  "command.list",
  "command.confirm",
  "command.remove",
  "run.list",
  "run.get",
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
const workspaceSelectionSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    displayName: z.string().min(1).optional(),
  })
  .strict();
const commandIdSchema = z.object({ commandId: z.string().min(1) }).strict();
const runIdSchema = z.object({ runId: z.string().min(1) }).strict();
const approvalDecisionSchema = z
  .object({
    approvalId: z.string().min(1),
    decision: z.enum(["once", "run", "command_prefix", "deny"]),
  })
  .strict();
const memoryIdSchema = z.object({ memoryId: z.string().min(1) }).strict();
const credentialSaveSchema = z.object({ apiKey: z.string().min(1) }).strict();

export function registerTodexIpc(ipcMain: IpcMainLike, host: WorkspaceHost): void {
  register(ipcMain, "project.selectWorkspace", workspaceSelectionSchema, (input) => {
    const timestamp = new Date().toISOString();
    return host.store.saveProject({
      projectId: randomUUID(),
      workspaceRoot: input.workspaceRoot,
      displayName: input.displayName ?? input.workspaceRoot,
      profileJson: "{}",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
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
  register(ipcMain, "run.get", runIdSchema, (input) => host.store.getRun(input.runId));
  register(ipcMain, "run.cancel", runIdSchema, (input) =>
    host.store.updateRunStatus({
      runId: input.runId,
      status: "cancelled",
      endedAt: new Date().toISOString(),
      stopReason: "cancelled_by_user",
    }),
  );

  register(ipcMain, "approval.listPending", projectIdSchema, (input) =>
    host.store.listPendingApprovals(input.projectId),
  );
  register(ipcMain, "approval.decide", approvalDecisionSchema, (input) => {
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

  register(ipcMain, "credential.status", emptySchema, () => host.credentials.status());
  register(ipcMain, "credential.save", credentialSaveSchema, (input) => host.credentials.save(input.apiKey));
  register(ipcMain, "credential.clear", emptySchema, () => host.credentials.clear());
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
