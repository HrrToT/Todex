import { z } from "zod";

const SHELL_CONCAT_PATTERN = /[;&|><`\r\n]|\$\(/;

const listFilesSchema = z
  .object({
    tool: z.literal("list_files"),
    path: z.string().default("."),
    maxDepth: z.number().int().min(0).max(8).optional(),
  })
  .strict();

const readFileSchema = z
  .object({
    tool: z.literal("read_file"),
    path: z.string().min(1),
  })
  .strict();

const searchTextSchema = z
  .object({
    tool: z.literal("search_text"),
    query: z.string().min(1),
    path: z.string().optional(),
    maxResults: z.number().int().min(1).max(100).default(20),
  })
  .strict();

const applyPatchSchema = z
  .object({
    tool: z.literal("apply_patch"),
    patch: z.string().min(1),
  })
  .strict();

const runConfiguredCommandSchema = z
  .object({
    tool: z.literal("run_configured_command"),
    commandId: z.string().min(1),
  })
  .strict();

const runShellCommandSchema = z
  .object({
    tool: z.literal("run_shell_command_with_approval"),
    command: z.string().min(1),
    cwd: z.string().optional(),
  })
  .strict();

const rememberSchema = z
  .object({
    tool: z.literal("remember"),
    kind: z.enum(["project_convention", "failure_resolution"]),
    content: z.string().min(1),
    traceEventIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

const finishSchema = z
  .object({
    tool: z.literal("finish"),
    summary: z.string().min(1),
    completion: z.enum(["verified", "unverified"]).default("verified"),
  })
  .strict();

const ACTION_SCHEMAS = {
  list_files: listFilesSchema,
  read_file: readFileSchema,
  search_text: searchTextSchema,
  apply_patch: applyPatchSchema,
  run_configured_command: runConfiguredCommandSchema,
  run_shell_command_with_approval: runShellCommandSchema,
  remember: rememberSchema,
  finish: finishSchema,
} as const;

export type ListFilesAction = z.infer<typeof listFilesSchema>;
export type ReadFileAction = z.infer<typeof readFileSchema>;
export type SearchTextAction = z.infer<typeof searchTextSchema>;
export type ApplyPatchAction = z.infer<typeof applyPatchSchema>;
export type RunConfiguredCommandAction = z.infer<typeof runConfiguredCommandSchema>;
export type RunShellCommandAction = z.infer<typeof runShellCommandSchema>;
export type RememberAction = z.infer<typeof rememberSchema>;
export type FinishAction = z.infer<typeof finishSchema>;

export type Action =
  | ListFilesAction
  | ReadFileAction
  | SearchTextAction
  | ApplyPatchAction
  | RunConfiguredCommandAction
  | RunShellCommandAction
  | RememberAction
  | FinishAction;

export function parseAction(raw: unknown): Action {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("invalid action");
  }
  const obj = raw as Record<string, unknown>;
  const tool = obj.tool;
  if (typeof tool !== "string") {
    throw new Error("invalid action");
  }
  if (!(tool in ACTION_SCHEMAS)) {
    throw new Error(`unknown tool: ${tool}`);
  }
  const schema = ACTION_SCHEMAS[tool as keyof typeof ACTION_SCHEMAS];
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `invalid action: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.data as Action;
}

export const runStatusSchema = z.enum([
  "created",
  "running",
  "awaiting_approval",
  "dispatching",
  "completed",
  "completed_unverified",
  "failed_repair_limit",
  "failed_environment",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const approvalScopeSchema = z.enum([
  "once",
  "run",
  "command_prefix",
  "deny",
]);
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;

export const verificationClassificationSchema = z.enum([
  "passed",
  "test_failure",
  "quality_failure",
  "build_failure",
  "command_not_found",
  "dependency_missing",
  "timeout",
  "execution_error",
  "cancelled",
]);
export type VerificationClassification = z.infer<typeof verificationClassificationSchema>;

export const configuredCommandSchema = z
  .object({
    commandId: z.string().min(1),
    projectId: z.string().min(1),
    purpose: z.enum(["test", "lint", "typecheck", "build"]),
    argv: z
      .array(
        z
          .string()
          .min(1)
          .refine((value) => !SHELL_CONCAT_PATTERN.test(value), {
            message: "argv must not contain shell concatenation or control characters",
          }),
      )
      .min(1),
    workingDirectory: z.string(),
    timeoutMs: z.number().int().min(0),
    confirmedByUser: z.boolean(),
    lastResult: z.enum(["passed", "failed"]).optional(),
  })
  .strict();
export type ConfiguredCommand = z.infer<typeof configuredCommandSchema>;

export const verificationResultSchema = z
  .object({
    verificationId: z.string().min(1),
    runId: z.string().min(1),
    commandId: z.string().min(1),
    classification: verificationClassificationSchema,
    exitCode: z.number().nullable(),
    durationMs: z.number().int().min(0),
    failureSummary: z.string(),
    relatedPaths: z.array(z.string()),
  })
  .strict();
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const approvalRequestSchema = z
  .object({
    approvalId: z.string().min(1),
    runId: z.string().min(1),
    actionId: z.string().min(1),
    tool: z.string().min(1),
    riskReasons: z.array(z.string()),
    fingerprint: z.string().min(1),
    state: z.enum(["pending", "approved", "denied", "expired", "cancelled"]),
    decision: approvalScopeSchema.optional(),
    createdAt: z.string().min(1),
    decidedAt: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .strict();
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const memoryEntrySchema = z
  .object({
    memoryId: z.string().min(1),
    projectId: z.string().min(1),
    kind: z.enum([
      "project_profile",
      "verified_command",
      "project_convention",
      "approval_preference",
      "failure_resolution",
      "successful_run_summary",
    ]),
    trustLevel: z.enum(["verified", "agent_observed"]),
    content: z.string().min(1),
    sourceTraceIds: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    deletedAt: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.trustLevel === "agent_observed" && value.sourceTraceIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agent_observed memory requires at least one source trace id",
        path: ["sourceTraceIds"],
      });
    }
  });
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const traceEventSchema = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().min(0),
    type: z.enum([
      "action_requested",
      "action_rejected",
      "approval_requested",
      "approval_decided",
      "tool_completed",
      "verification_completed",
      "run_completed",
      "run_failed",
      "run_cancelled",
    ]),
    timestamp: z.string().min(1),
    payloadSummary: z.string(),
  })
  .strict();
export type TraceEvent = z.infer<typeof traceEventSchema>;

export const runSessionSchema = z
  .object({
    runId: z.string().min(1),
    projectId: z.string().min(1),
    taskText: z.string().min(1),
    status: runStatusSchema,
    startedAt: z.string().min(1),
    endedAt: z.string().optional(),
    repairAttempts: z.number().int().min(0),
    stopReason: z.string().optional(),
  })
  .strict();
export type RunSession = z.infer<typeof runSessionSchema>;

export const toolResultSchema = z
  .object({
    resultId: z.string().min(1),
    actionId: z.string().min(1),
    status: z.enum(["succeeded", "rejected", "failed", "skipped"]),
    summary: z.string(),
    truncatedOutput: z.string().optional(),
    diffRef: z.string().optional(),
  })
  .strict();
export type ToolResult = z.infer<typeof toolResultSchema>;
