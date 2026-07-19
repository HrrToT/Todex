import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteStore } from "../src/main/sqlite-store.js";

const TEMP_DIRECTORIES: string[] = [];
const PROJECT = {
  projectId: "project-1",
  workspaceRoot: "C:\\workspace\\one",
  displayName: "Workspace One",
  profileJson: "{}",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "todex-sqlite-test-"));
  TEMP_DIRECTORIES.push(directory);
  return join(directory, "todex.sqlite");
}

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLiteStore", () => {
  it("migrates a fresh database to version 1 and reopens idempotently", () => {
    const databasePath = createDatabasePath();
    const first = SQLiteStore.open({ databasePath });

    expect(first.getMigrationVersion()).toBe(1);
    first.close();

    const reopened = SQLiteStore.open({ databasePath });
    expect(reopened.getMigrationVersion()).toBe(1);
    reopened.close();
  });

  it("fails closed for a database newer than this host supports", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations (version, applied_at) VALUES (999, '2026-07-18T00:00:00.000Z');",
    );
    database.close();

    expect(() => SQLiteStore.open({ databasePath })).toThrow("unsupported_schema_version");
  });

  it("persists projects across store instances", () => {
    const databasePath = createDatabasePath();
    const first = SQLiteStore.open({ databasePath });
    first.saveProject(PROJECT);
    first.close();

    const reopened = SQLiteStore.open({ databasePath });
    expect(reopened.getProject(PROJECT.projectId)).toEqual(PROJECT);
    reopened.close();
  });

  it("never creates an api_key column for model configurations", () => {
    const store = SQLiteStore.open({ databasePath: createDatabasePath() });

    expect(store.listColumns("model_configs")).not.toContain("api_key");
    store.close();
  });

  it("commits appended traces in sequence before a later reopen", () => {
    const databasePath = createDatabasePath();
    const first = SQLiteStore.open({ databasePath });
    first.saveProject(PROJECT);
    first.saveRun({
      runId: "run-1",
      projectId: PROJECT.projectId,
      taskText: "Inspect the project",
      status: "running",
      startedAt: "2026-07-18T00:00:00.000Z",
      repairAttempts: 0,
    });
    first.appendTrace({
      eventId: "trace-2",
      runId: "run-1",
      sequence: 2,
      type: "tool_completed",
      timestamp: "2026-07-18T00:00:02.000Z",
      payloadSummary: "second event",
    });
    first.appendTrace({
      eventId: "trace-1",
      runId: "run-1",
      sequence: 1,
      type: "action_requested",
      timestamp: "2026-07-18T00:00:01.000Z",
      payloadSummary: "first event",
    });
    first.close();

    const reopened = SQLiteStore.open({ databasePath });
    expect(reopened.listTraces("run-1").map((trace) => trace.sequence)).toEqual([1, 2]);
    reopened.close();
  });

  it("rejects duplicate trace sequences for the same run", () => {
    const store = SQLiteStore.open({ databasePath: createDatabasePath() });
    store.saveProject(PROJECT);
    store.saveRun({
      runId: "run-1",
      projectId: PROJECT.projectId,
      taskText: "Inspect the project",
      status: "running",
      startedAt: "2026-07-18T00:00:00.000Z",
      repairAttempts: 0,
    });
    const trace = {
      eventId: "trace-1",
      runId: "run-1",
      sequence: 1,
      type: "action_requested" as const,
      timestamp: "2026-07-18T00:00:01.000Z",
      payloadSummary: "event",
    };
    store.appendTrace(trace);

    expect(() => store.appendTrace({ ...trace, eventId: "trace-2" })).toThrow();
    store.close();
  });

  it("soft deletes memories from normal project lists", () => {
    const store = SQLiteStore.open({ databasePath: createDatabasePath() });
    store.saveProject(PROJECT);
    store.saveMemory({
      memoryId: "memory-1",
      projectId: PROJECT.projectId,
      kind: "project_convention",
      trustLevel: "verified",
      content: "Use strict TypeScript.",
      sourceTraceIds: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    });
    store.deleteMemory("memory-1", "2026-07-18T00:01:00.000Z");

    expect(store.listMemories(PROJECT.projectId)).toEqual([]);
    store.close();
  });

  it("keeps in-memory API key seed out of exported project data", () => {
    const store = SQLiteStore.open({ databasePath: createDatabasePath() });
    store.saveProject(PROJECT);
    const apiKeySeed = "API_KEY=secret-value";

    const exported = store.exportProject(PROJECT.projectId);

    expect(JSON.stringify(exported)).not.toContain(apiKeySeed);
    expect(JSON.stringify(exported)).not.toContain("secret-value");
    store.close();
  });
});
