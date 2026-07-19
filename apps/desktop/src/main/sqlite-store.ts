import Database from "better-sqlite3";
import {
  approvalRequestSchema,
  configuredCommandSchema,
  memoryEntrySchema,
  runSessionSchema,
  traceEventSchema,
  verificationResultSchema,
  type ApprovalRequest,
  type ConfiguredCommand,
  type MemoryEntry,
  type RunSession,
  type TraceEvent,
  type VerificationResult,
} from "@todex/contracts";
import { z } from "zod";

const LATEST_SCHEMA_VERSION = 1;

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

const modelConfigSchema = z
  .object({
    configId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    parametersJson: z.string(),
    credentialRef: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export type DesktopProject = z.infer<typeof projectSchema>;
export type ModelConfigReference = z.infer<typeof modelConfigSchema>;

export interface SQLiteStoreOptions {
  readonly databasePath: string;
}

export interface RunStatusUpdate {
  readonly runId: string;
  readonly status: RunSession["status"];
  readonly endedAt?: string;
  readonly stopReason?: string;
}

export interface ProjectExport {
  readonly project: DesktopProject | undefined;
  readonly commands: readonly ConfiguredCommand[];
  readonly modelConfigs: readonly ModelConfigReference[];
  readonly runs: readonly RunSession[];
  readonly traces: readonly TraceEvent[];
  readonly verifications: readonly VerificationResult[];
  readonly approvals: readonly ApprovalRequest[];
  readonly memories: readonly MemoryEntry[];
}

type Row = Record<string, unknown>;

export class SQLiteStore {
  private constructor(private readonly database: Database.Database) {}

  static open(options: SQLiteStoreOptions): SQLiteStore {
    const database = new Database(options.databasePath);
    database.pragma("foreign_keys = ON");

    try {
      SQLiteStore.migrate(database);
      return new SQLiteStore(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  getMigrationVersion(): number {
    const row = this.database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    return row.version;
  }

  listColumns(tableName: string): readonly string[] {
    const allowedTables = new Set([
      "projects",
      "model_configs",
      "configured_commands",
      "runs",
      "trace_events",
      "verification_results",
      "approval_requests",
      "memory_entries",
    ]);
    if (!allowedTables.has(tableName)) {
      throw new Error("unknown_table");
    }
    return (this.database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
  }

  saveProject(project: DesktopProject): DesktopProject {
    const parsed = projectSchema.parse(project);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO projects (
             project_id, workspace_root, display_name, profile_json, created_at, updated_at
           ) VALUES (
             @projectId, @workspaceRoot, @displayName, @profileJson, @createdAt, @updatedAt
           ) ON CONFLICT(project_id) DO UPDATE SET
             workspace_root = excluded.workspace_root,
             display_name = excluded.display_name,
             profile_json = excluded.profile_json,
             updated_at = excluded.updated_at`,
        )
        .run(parsed);
    });
    return parsed;
  }

  listProjects(): readonly DesktopProject[] {
    return (this.database
      .prepare(
        "SELECT project_id, workspace_root, display_name, profile_json, created_at, updated_at FROM projects ORDER BY updated_at DESC, project_id ASC",
      )
      .all() as Row[]).map((row) => this.toProject(row));
  }

  getProject(projectId: string): DesktopProject | undefined {
    const row = this.database
      .prepare(
        "SELECT project_id, workspace_root, display_name, profile_json, created_at, updated_at FROM projects WHERE project_id = ?",
      )
      .get(projectId) as Row | undefined;
    return row ? this.toProject(row) : undefined;
  }

  deleteProject(projectId: string): void {
    this.inTransaction(() => {
      this.database.prepare("DELETE FROM projects WHERE project_id = ?").run(projectId);
    });
  }

  saveModelConfig(modelConfig: ModelConfigReference): ModelConfigReference {
    const parsed = modelConfigSchema.parse(modelConfig);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO model_configs (
             config_id, project_id, base_url, model, parameters_json, credential_ref, created_at, updated_at
           ) VALUES (
             @configId, @projectId, @baseUrl, @model, @parametersJson, @credentialRef, @createdAt, @updatedAt
           ) ON CONFLICT(config_id) DO UPDATE SET
             project_id = excluded.project_id,
             base_url = excluded.base_url,
             model = excluded.model,
             parameters_json = excluded.parameters_json,
             credential_ref = excluded.credential_ref,
             updated_at = excluded.updated_at`,
        )
        .run({ ...parsed, projectId: parsed.projectId ?? null, credentialRef: parsed.credentialRef ?? null });
    });
    return parsed;
  }

  listModelConfigs(projectId?: string): readonly ModelConfigReference[] {
    const rows = projectId
      ? (this.database
          .prepare(
            "SELECT config_id, project_id, base_url, model, parameters_json, credential_ref, created_at, updated_at FROM model_configs WHERE project_id = ? ORDER BY updated_at DESC, config_id ASC",
          )
          .all(projectId) as Row[])
      : (this.database
          .prepare(
            "SELECT config_id, project_id, base_url, model, parameters_json, credential_ref, created_at, updated_at FROM model_configs ORDER BY updated_at DESC, config_id ASC",
          )
          .all() as Row[]);
    return rows.map((row) => this.toModelConfig(row));
  }

  saveCommand(command: ConfiguredCommand): ConfiguredCommand {
    const parsed = configuredCommandSchema.parse(command);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO configured_commands (
             command_id, project_id, purpose, argv_json, working_directory, timeout_ms, confirmed_by_user, last_result
           ) VALUES (
             @commandId, @projectId, @purpose, @argvJson, @workingDirectory, @timeoutMs, @confirmedByUser, @lastResult
           ) ON CONFLICT(command_id) DO UPDATE SET
             project_id = excluded.project_id,
             purpose = excluded.purpose,
             argv_json = excluded.argv_json,
             working_directory = excluded.working_directory,
             timeout_ms = excluded.timeout_ms,
             confirmed_by_user = excluded.confirmed_by_user,
             last_result = excluded.last_result`,
        )
        .run({
          ...parsed,
          argvJson: JSON.stringify(parsed.argv),
          confirmedByUser: parsed.confirmedByUser ? 1 : 0,
          lastResult: parsed.lastResult ?? null,
        });
    });
    return parsed;
  }

  listCommands(projectId: string): readonly ConfiguredCommand[] {
    return (this.database
      .prepare(
        "SELECT command_id, project_id, purpose, argv_json, working_directory, timeout_ms, confirmed_by_user, last_result FROM configured_commands WHERE project_id = ? ORDER BY command_id ASC",
      )
      .all(projectId) as Row[]).map((row) => this.toCommand(row));
  }

  removeCommand(commandId: string): void {
    this.inTransaction(() => {
      this.database.prepare("DELETE FROM configured_commands WHERE command_id = ?").run(commandId);
    });
  }

  saveRun(run: RunSession): RunSession {
    const parsed = runSessionSchema.parse(run);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs (
             run_id, project_id, task_text, status, started_at, ended_at, repair_attempts, stop_reason
           ) VALUES (
             @runId, @projectId, @taskText, @status, @startedAt, @endedAt, @repairAttempts, @stopReason
           ) ON CONFLICT(run_id) DO UPDATE SET
             project_id = excluded.project_id,
             task_text = excluded.task_text,
             status = excluded.status,
             started_at = excluded.started_at,
             ended_at = excluded.ended_at,
             repair_attempts = excluded.repair_attempts,
             stop_reason = excluded.stop_reason`,
        )
        .run({ ...parsed, endedAt: parsed.endedAt ?? null, stopReason: parsed.stopReason ?? null });
    });
    return parsed;
  }

  updateRunStatus(update: RunStatusUpdate): RunSession {
    const current = this.getRun(update.runId);
    if (!current) {
      throw new Error("run_not_found");
    }
    return this.saveRun({
      ...current,
      status: update.status,
      endedAt: update.endedAt,
      stopReason: update.stopReason,
    });
  }

  listRuns(projectId: string): readonly RunSession[] {
    return (this.database
      .prepare(
        "SELECT run_id, project_id, task_text, status, started_at, ended_at, repair_attempts, stop_reason FROM runs WHERE project_id = ? ORDER BY started_at DESC, run_id ASC",
      )
      .all(projectId) as Row[]).map((row) => this.toRun(row));
  }

  getRun(runId: string): RunSession | undefined {
    const row = this.database
      .prepare(
        "SELECT run_id, project_id, task_text, status, started_at, ended_at, repair_attempts, stop_reason FROM runs WHERE run_id = ?",
      )
      .get(runId) as Row | undefined;
    return row ? this.toRun(row) : undefined;
  }

  appendTrace(trace: TraceEvent): TraceEvent {
    const parsed = traceEventSchema.parse(trace);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO trace_events (
             event_id, run_id, sequence, type, timestamp, payload_summary
           ) VALUES (
             @eventId, @runId, @sequence, @type, @timestamp, @payloadSummary
           )`,
        )
        .run(parsed);
    });
    return parsed;
  }

  listTraces(runId: string): readonly TraceEvent[] {
    return (this.database
      .prepare(
        "SELECT event_id, run_id, sequence, type, timestamp, payload_summary FROM trace_events WHERE run_id = ? ORDER BY sequence ASC",
      )
      .all(runId) as Row[]).map((row) => this.toTrace(row));
  }

  saveVerification(result: VerificationResult): VerificationResult {
    const parsed = verificationResultSchema.parse(result);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO verification_results (
             verification_id, run_id, command_id, classification, exit_code, duration_ms, failure_summary, related_paths_json
           ) VALUES (
             @verificationId, @runId, @commandId, @classification, @exitCode, @durationMs, @failureSummary, @relatedPathsJson
           ) ON CONFLICT(verification_id) DO UPDATE SET
             run_id = excluded.run_id,
             command_id = excluded.command_id,
             classification = excluded.classification,
             exit_code = excluded.exit_code,
             duration_ms = excluded.duration_ms,
             failure_summary = excluded.failure_summary,
             related_paths_json = excluded.related_paths_json`,
        )
        .run({ ...parsed, relatedPathsJson: JSON.stringify(parsed.relatedPaths) });
    });
    return parsed;
  }

  listVerifications(runId: string): readonly VerificationResult[] {
    return (this.database
      .prepare(
        "SELECT verification_id, run_id, command_id, classification, exit_code, duration_ms, failure_summary, related_paths_json FROM verification_results WHERE run_id = ? ORDER BY verification_id ASC",
      )
      .all(runId) as Row[]).map((row) => this.toVerification(row));
  }

  saveApproval(approval: ApprovalRequest): ApprovalRequest {
    const parsed = approvalRequestSchema.parse(approval);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO approval_requests (
             approval_id, run_id, action_id, tool, risk_reasons_json, fingerprint, state, decision, created_at, decided_at, expires_at
           ) VALUES (
             @approvalId, @runId, @actionId, @tool, @riskReasonsJson, @fingerprint, @state, @decision, @createdAt, @decidedAt, @expiresAt
           ) ON CONFLICT(approval_id) DO UPDATE SET
             run_id = excluded.run_id,
             action_id = excluded.action_id,
             tool = excluded.tool,
             risk_reasons_json = excluded.risk_reasons_json,
             fingerprint = excluded.fingerprint,
             state = excluded.state,
             decision = excluded.decision,
             decided_at = excluded.decided_at,
             expires_at = excluded.expires_at`,
        )
        .run({
          ...parsed,
          riskReasonsJson: JSON.stringify(parsed.riskReasons),
          decision: parsed.decision ?? null,
          decidedAt: parsed.decidedAt ?? null,
          expiresAt: parsed.expiresAt ?? null,
        });
    });
    return parsed;
  }

  listPendingApprovals(projectId?: string): readonly ApprovalRequest[] {
    const rows = projectId
      ? (this.database
          .prepare(
            `SELECT approvals.approval_id, approvals.run_id, approvals.action_id, approvals.tool,
                    approvals.risk_reasons_json, approvals.fingerprint, approvals.state, approvals.decision,
                    approvals.created_at, approvals.decided_at, approvals.expires_at
             FROM approval_requests AS approvals
             JOIN runs ON runs.run_id = approvals.run_id
             WHERE approvals.state = 'pending' AND runs.project_id = ?
             ORDER BY approvals.created_at ASC, approvals.approval_id ASC`,
          )
          .all(projectId) as Row[])
      : (this.database
          .prepare(
            `SELECT approval_id, run_id, action_id, tool, risk_reasons_json, fingerprint, state, decision,
                    created_at, decided_at, expires_at
             FROM approval_requests WHERE state = 'pending' ORDER BY created_at ASC, approval_id ASC`,
          )
          .all() as Row[]);
    return rows.map((row) => this.toApproval(row));
  }

  saveMemory(memory: MemoryEntry): MemoryEntry {
    const parsed = memoryEntrySchema.parse(memory);
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO memory_entries (
             memory_id, project_id, kind, trust_level, content, source_trace_ids_json, created_at, updated_at, deleted_at
           ) VALUES (
             @memoryId, @projectId, @kind, @trustLevel, @content, @sourceTraceIdsJson, @createdAt, @updatedAt, @deletedAt
           ) ON CONFLICT(memory_id) DO UPDATE SET
             project_id = excluded.project_id,
             kind = excluded.kind,
             trust_level = excluded.trust_level,
             content = excluded.content,
             source_trace_ids_json = excluded.source_trace_ids_json,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
        )
        .run({ ...parsed, sourceTraceIdsJson: JSON.stringify(parsed.sourceTraceIds), deletedAt: parsed.deletedAt ?? null });
    });
    return parsed;
  }

  listMemories(projectId: string): readonly MemoryEntry[] {
    return (this.database
      .prepare(
        `SELECT memory_id, project_id, kind, trust_level, content, source_trace_ids_json, created_at, updated_at, deleted_at
         FROM memory_entries WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, memory_id ASC`,
      )
      .all(projectId) as Row[]).map((row) => this.toMemory(row));
  }

  deleteMemory(memoryId: string, deletedAt: string): void {
    this.inTransaction(() => {
      this.database
        .prepare("UPDATE memory_entries SET deleted_at = ?, updated_at = ? WHERE memory_id = ?")
        .run(deletedAt, deletedAt, memoryId);
    });
  }

  exportProject(projectId: string): ProjectExport {
    const runs = this.listRuns(projectId);
    const runIds = runs.map((run) => run.runId);
    const traces = runIds.flatMap((runId) => this.listTraces(runId));
    const verifications = runIds.flatMap((runId) => this.listVerifications(runId));
    const approvals = this.listPendingApprovals(projectId);
    return {
      project: this.getProject(projectId),
      commands: this.listCommands(projectId),
      modelConfigs: this.listModelConfigs(projectId),
      runs,
      traces,
      verifications,
      approvals,
      memories: this.listMemories(projectId),
    };
  }

  private static migrate(database: Database.Database): void {
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("schema_migrations") as { name: string } | undefined;
    if (!table) {
      database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    }

    const version = (database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number }).version;
    if (version > LATEST_SCHEMA_VERSION) {
      throw new Error("unsupported_schema_version");
    }
    if (version === LATEST_SCHEMA_VERSION) {
      return;
    }

    database.transaction(() => {
      database.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          workspace_root TEXT NOT NULL,
          display_name TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE model_configs (
          config_id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          parameters_json TEXT NOT NULL,
          credential_ref TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE configured_commands (
          command_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          purpose TEXT NOT NULL,
          argv_json TEXT NOT NULL,
          working_directory TEXT NOT NULL,
          timeout_ms INTEGER NOT NULL,
          confirmed_by_user INTEGER NOT NULL,
          last_result TEXT
        );
        CREATE TABLE runs (
          run_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          task_text TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          repair_attempts INTEGER NOT NULL,
          stop_reason TEXT
        );
        CREATE TABLE trace_events (
          event_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          payload_summary TEXT NOT NULL,
          UNIQUE(run_id, sequence)
        );
        CREATE TABLE verification_results (
          verification_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
          command_id TEXT NOT NULL REFERENCES configured_commands(command_id) ON DELETE RESTRICT,
          classification TEXT NOT NULL,
          exit_code INTEGER,
          duration_ms INTEGER NOT NULL,
          failure_summary TEXT NOT NULL,
          related_paths_json TEXT NOT NULL
        );
        CREATE TABLE approval_requests (
          approval_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
          action_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          risk_reasons_json TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          state TEXT NOT NULL,
          decision TEXT,
          created_at TEXT NOT NULL,
          decided_at TEXT,
          expires_at TEXT
        );
        CREATE TABLE memory_entries (
          memory_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          content TEXT NOT NULL,
          source_trace_ids_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE INDEX idx_commands_project ON configured_commands(project_id, command_id);
        CREATE INDEX idx_runs_project ON runs(project_id, started_at DESC);
        CREATE INDEX idx_traces_run_sequence ON trace_events(run_id, sequence);
        CREATE INDEX idx_verifications_run ON verification_results(run_id, verification_id);
        CREATE INDEX idx_approvals_run ON approval_requests(run_id, created_at);
        CREATE INDEX idx_memory_project_active ON memory_entries(project_id, deleted_at, updated_at DESC);
      `);
      database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(LATEST_SCHEMA_VERSION, new Date().toISOString());
    })();
  }

  private inTransaction(operation: () => void): void {
    this.database.transaction(operation)();
  }

  private toProject(row: Row): DesktopProject {
    return projectSchema.parse({
      projectId: row.project_id,
      workspaceRoot: row.workspace_root,
      displayName: row.display_name,
      profileJson: row.profile_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toModelConfig(row: Row): ModelConfigReference {
    return modelConfigSchema.parse({
      configId: row.config_id,
      projectId: row.project_id ?? undefined,
      baseUrl: row.base_url,
      model: row.model,
      parametersJson: row.parameters_json,
      credentialRef: row.credential_ref ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toCommand(row: Row): ConfiguredCommand {
    return configuredCommandSchema.parse({
      commandId: row.command_id,
      projectId: row.project_id,
      purpose: row.purpose,
      argv: JSON.parse(String(row.argv_json)),
      workingDirectory: row.working_directory,
      timeoutMs: row.timeout_ms,
      confirmedByUser: Boolean(row.confirmed_by_user),
      lastResult: row.last_result ?? undefined,
    });
  }

  private toRun(row: Row): RunSession {
    return runSessionSchema.parse({
      runId: row.run_id,
      projectId: row.project_id,
      taskText: row.task_text,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      repairAttempts: row.repair_attempts,
      stopReason: row.stop_reason ?? undefined,
    });
  }

  private toTrace(row: Row): TraceEvent {
    return traceEventSchema.parse({
      eventId: row.event_id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      timestamp: row.timestamp,
      payloadSummary: row.payload_summary,
    });
  }

  private toVerification(row: Row): VerificationResult {
    return verificationResultSchema.parse({
      verificationId: row.verification_id,
      runId: row.run_id,
      commandId: row.command_id,
      classification: row.classification,
      exitCode: row.exit_code,
      durationMs: row.duration_ms,
      failureSummary: row.failure_summary,
      relatedPaths: JSON.parse(String(row.related_paths_json)),
    });
  }

  private toApproval(row: Row): ApprovalRequest {
    return approvalRequestSchema.parse({
      approvalId: row.approval_id,
      runId: row.run_id,
      actionId: row.action_id,
      tool: row.tool,
      riskReasons: JSON.parse(String(row.risk_reasons_json)),
      fingerprint: row.fingerprint,
      state: row.state,
      decision: row.decision ?? undefined,
      createdAt: row.created_at,
      decidedAt: row.decided_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
    });
  }

  private toMemory(row: Row): MemoryEntry {
    return memoryEntrySchema.parse({
      memoryId: row.memory_id,
      projectId: row.project_id,
      kind: row.kind,
      trustLevel: row.trust_level,
      content: row.content,
      sourceTraceIds: JSON.parse(String(row.source_trace_ids_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at ?? undefined,
    });
  }
}
