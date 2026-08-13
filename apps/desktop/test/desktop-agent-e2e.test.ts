import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ApprovalRequest,
  ConfiguredCommand,
  MemoryEntry,
  RunSession,
  TraceEvent,
} from "@todex/contracts";
import type { CommandExecution, CommandRunner } from "@todex/harness-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopRunService,
  type CompletionClient,
} from "../src/main/desktop-run-service.js";
import { OpenAiCompatibleClient } from "../src/main/openai-compatible-client.js";
import type { WorkspaceHost } from "../src/main/workspace-host.js";

const API_KEY = "desktop-e2e-secret";

class FakeStore {
  readonly traces: TraceEvent[] = [];
  readonly approvals: ApprovalRequest[] = [];
  readonly runs = new Map<string, RunSession>();
  readonly commands: ConfiguredCommand[];

  constructor(
    readonly project: { projectId: string; workspaceRoot: string; displayName: string; profileJson: string; createdAt: string; updatedAt: string },
    readonly config: { configId: string; projectId: string; baseUrl: string; model: string; parametersJson: string; credentialRef?: string; createdAt: string; updatedAt: string },
    command: ConfiguredCommand,
  ) {
    this.commands = [command];
  }

  getProject(projectId: string) { return projectId === this.project.projectId ? this.project : undefined; }
  getModelConfig(configId: string) { return configId === this.config.configId ? this.config : undefined; }
  saveRun(run: RunSession) { this.runs.set(run.runId, run); return run; }
  getRun(runId: string) { return this.runs.get(runId); }
  updateRunStatus(update: { runId: string; status: RunSession["status"]; endedAt?: string; stopReason?: string }) {
    const current = this.runs.get(update.runId);
    if (!current) throw new Error("run_not_found");
    const next = { ...current, status: update.status, ...(update.endedAt ? { endedAt: update.endedAt } : {}), ...(update.stopReason ? { stopReason: update.stopReason } : {}) };
    this.runs.set(update.runId, next);
    return next;
  }
  appendTrace(trace: TraceEvent) { this.traces.push(trace); return trace; }
  listTraces(runId: string) { return this.traces.filter((trace) => trace.runId === runId); }
  saveApproval(approval: ApprovalRequest) { this.approvals.push(approval); return approval; }
  listCommands(projectId: string) { return this.commands.filter((command) => command.projectId === projectId); }
  saveMemory() { throw new Error("not used"); }
  listMemories(): readonly MemoryEntry[] { return []; }
  deleteMemory() { return undefined; }
}

class ScriptedCompletionClient implements CompletionClient {
  readonly calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
  constructor(private readonly responses: string[]) {}
  async complete(request: { systemPrompt: string; userPrompt: string }): Promise<string> {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("script_exhausted");
    return response;
  }
}

class RecordingCommandRunner implements CommandRunner {
  readonly calls: Array<{ argv: readonly string[]; workingDirectory: string; timeoutMs: number }> = [];
  async run(input: { argv: readonly string[]; workingDirectory: string; timeoutMs: number }): Promise<CommandExecution> {
    this.calls.push(input);
    return { condition: "success", exitCode: 0, durationMs: 1, stdout: "", stderr: "" };
  }
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop governed agent flow", () => {
  it("completes a governed Node fixture loop through a local Chat Completions HTTP boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-http-e2e-"));
    temporaryDirectories.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "answer.ts"), "export const answer = 1;\n", "utf8");
    const now = "2026-08-13T00:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-http", workspaceRoot, displayName: "node-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-http", projectId: "project-http", baseUrl: "http://127.0.0.1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-http", purpose: "test", argv: ["node", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    const actions = [
      JSON.stringify({ tool: "apply_patch", patch: "--- a/answer.ts\n+++ b/answer.ts\n@@ -1 +1 @@\n-export const answer = 1;\n+export const answer = 2;\n" }),
      JSON.stringify({ tool: "run_configured_command", commandId: "test" }),
      JSON.stringify({ tool: "finish", summary: "done", completion: "verified" }),
    ];
    const requests: Array<{ url?: string; authorization?: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({ url: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content: actions.shift() } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_address_missing");
    const host = {
      store,
      readLlmConfiguration: async () => ({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "mock-model", apiKey: API_KEY }),
    } as unknown as WorkspaceHost;
    const commandRunner = new RecordingCommandRunner();
    const service = new DesktopRunService({
      host,
      completionClientFactory: (config) => new OpenAiCompatibleClient(config),
      commandRunner,
      now: () => new Date(now),
      idFactory: (() => { let index = 0; return () => `http-${++index}`; })(),
    });

    try {
      const pending = await service.start({ projectId: "project-http", task: "update answer", modelConfigId: "model-http" });
      const completed = await service.decideApproval({ runId: pending.run.runId, approvalId: pending.pendingApproval!.approvalId, decision: "once" });

      expect(readFileSync(join(workspaceRoot, "answer.ts"), "utf8")).toBe("export const answer = 2;\n");
      expect(completed.run.status).toBe("completed");
      expect(commandRunner.calls).toHaveLength(1);
      expect(requests).toHaveLength(3);
      expect(requests.every((request) => request.url === "/v1/chat/completions")).toBe(true);
      expect(requests.every((request) => request.authorization === `Bearer ${API_KEY}`)).toBe(true);
      expect(JSON.stringify(completed)).not.toContain(API_KEY);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("completes a governed Python fixture loop through a local Chat Completions HTTP boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-python-http-e2e-"));
    temporaryDirectories.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "answer.py"), "answer = 1\n", "utf8");
    const now = "2026-08-13T00:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-python-http", workspaceRoot, displayName: "python-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-python-http", projectId: "project-python-http", baseUrl: "http://127.0.0.1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-python-http", purpose: "test", argv: ["python", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    const actions = [
      JSON.stringify({ tool: "apply_patch", patch: "--- a/answer.py\n+++ b/answer.py\n@@ -1 +1 @@\n-answer = 1\n+answer = 2\n" }),
      JSON.stringify({ tool: "run_configured_command", commandId: "test" }),
      JSON.stringify({ tool: "finish", summary: "done", completion: "verified" }),
    ];
    const endpoints: string[] = [];
    const server = createServer((request, response) => {
      endpoints.push(request.url ?? "");
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content: actions.shift() } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_address_missing");
    const host = {
      store,
      readLlmConfiguration: async () => ({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "mock-model", apiKey: API_KEY }),
    } as unknown as WorkspaceHost;
    const commandRunner = new RecordingCommandRunner();
    const service = new DesktopRunService({
      host,
      completionClientFactory: (config) => new OpenAiCompatibleClient(config),
      commandRunner,
      now: () => new Date(now),
      idFactory: (() => { let index = 0; return () => `python-http-${++index}`; })(),
    });

    try {
      const pending = await service.start({ projectId: "project-python-http", task: "update answer", modelConfigId: "model-python-http" });
      const completed = await service.decideApproval({ runId: pending.run.runId, approvalId: pending.pendingApproval!.approvalId, decision: "once" });

      expect(readFileSync(join(workspaceRoot, "answer.py"), "utf8")).toBe("answer = 2\n");
      expect(completed.run.status).toBe("completed");
      expect(commandRunner.calls).toEqual([{ argv: ["python", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000 }]);
      expect(endpoints).toEqual(["/v1/chat/completions", "/v1/chat/completions", "/v1/chat/completions"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("applies a safe patch, pauses a configured command, and exposes no credential", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-e2e-"));
    temporaryDirectories.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "answer.ts"), "export const answer = 1;\n", "utf8");

    const now = "2026-08-12T12:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-node", workspaceRoot, displayName: "node-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-1", projectId: "project-node", baseUrl: "https://example.invalid/v1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-node", purpose: "test", argv: ["node", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    const host = {
      store,
      readLlmConfiguration: async () => ({ baseUrl: "https://example.invalid/v1", model: "mock-model", apiKey: API_KEY }),
    } as unknown as WorkspaceHost;
    const client = new ScriptedCompletionClient([
      JSON.stringify({ tool: "apply_patch", patch: "--- a/answer.ts\n+++ b/answer.ts\n@@ -1 +1 @@\n-export const answer = 1;\n+export const answer = 2;\n" }),
      JSON.stringify({ tool: "run_configured_command", commandId: "test" }),
      JSON.stringify({ tool: "finish", summary: "done", completion: "verified" }),
    ]);
    const commandRunner = new RecordingCommandRunner();
    const service = new DesktopRunService({
      host,
      completionClientFactory: () => client,
      commandRunner,
      now: () => new Date(now),
      idFactory: (() => { let index = 0; return () => `id-${++index}`; })(),
    });

    const pending = await service.start({ projectId: "project-node", task: "update answer", modelConfigId: "model-1" });

    expect(pending.results[0]).toMatchObject({ status: "succeeded", summary: "patch applied: 1 file(s)" });
    expect(readFileSync(join(workspaceRoot, "answer.ts"), "utf8")).toBe("export const answer = 2;\n");
    expect(pending.run.status).toBe("awaiting_approval");
    expect(pending.pendingApproval).toMatchObject({ tool: "run_configured_command", state: "pending" });
    expect(commandRunner.calls).toHaveLength(0);
    expect(JSON.stringify(pending)).not.toContain(API_KEY);
    expect(JSON.stringify(store.traces)).not.toContain(API_KEY);

    const completed = await service.decideApproval({
      runId: pending.run.runId,
      approvalId: pending.pendingApproval!.approvalId,
      decision: "once",
    });

    expect(commandRunner.calls).toEqual([{ argv: ["node", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000 }]);
    expect(completed.run.status).toBe("completed");
    expect(completed.trace.map((trace) => trace.type)).toEqual([
      "action_requested",
      "tool_completed",
      "action_requested",
      "approval_requested",
      "approval_decided",
      "tool_completed",
      "action_requested",
      "run_completed",
    ]);
    expect(JSON.stringify(client.calls)).not.toContain(API_KEY);
  });

  it("stops after two invalid model actions without persisting the raw responses", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-invalid-"));
    temporaryDirectories.push(workspaceRoot);
    const now = "2026-08-12T12:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-python", workspaceRoot, displayName: "python-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-2", projectId: "project-python", baseUrl: "https://example.invalid/v1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-python", purpose: "test", argv: ["python", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    const host = {
      store,
      readLlmConfiguration: async () => ({ baseUrl: "https://example.invalid/v1", model: "mock-model", apiKey: API_KEY }),
    } as unknown as WorkspaceHost;
    const client = new ScriptedCompletionClient(["API_KEY=desktop-e2e-secret", "not JSON"]);
    const commandRunner = new RecordingCommandRunner();
    const service = new DesktopRunService({
      host,
      completionClientFactory: () => client,
      commandRunner,
      now: () => new Date(now),
      idFactory: () => "run-invalid",
    });

    const result = await service.start({ projectId: "project-python", task: "inspect", modelConfigId: "model-2" });

    expect(result.run).toMatchObject({ status: "failed", stopReason: "model_protocol_invalid" });
    expect(result.trace.map((trace) => trace.type)).toEqual(["run_failed"]);
    expect(client.calls).toHaveLength(2);
    expect(commandRunner.calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(JSON.stringify(result)).not.toContain("not JSON");
  });

  it("rejects a second active run for the same project", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-active-"));
    temporaryDirectories.push(workspaceRoot);
    const now = "2026-08-12T12:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-active", workspaceRoot, displayName: "node-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-active", projectId: "project-active", baseUrl: "https://example.invalid/v1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-active", purpose: "test", argv: ["node", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    let releaseFirst!: () => void;
    const firstResponse = new Promise<string>((resolve) => { releaseFirst = () => resolve('{"tool":"finish","summary":"done"}'); });
    const host = {
      store,
      readLlmConfiguration: async () => ({ baseUrl: "https://example.invalid/v1", model: "mock-model", apiKey: API_KEY }),
    } as unknown as WorkspaceHost;
    const service = new DesktopRunService({
      host,
      completionClientFactory: () => ({ complete: async () => firstResponse }),
      now: () => new Date(now),
      idFactory: (() => { let index = 0; return () => `active-${++index}`; })(),
    });

    const first = service.start({ projectId: "project-active", task: "first", modelConfigId: "model-active" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(service.start({ projectId: "project-active", task: "second", modelConfigId: "model-active" }))
      .rejects.toThrow("project_run_active");
    releaseFirst();
    await expect(first).resolves.toMatchObject({ run: { status: "completed" } });
  });

  it("aborts an in-flight model request when the desktop run is cancelled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-cancel-"));
    temporaryDirectories.push(workspaceRoot);
    const now = "2026-08-12T12:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-cancel", workspaceRoot, displayName: "node-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-cancel", projectId: "project-cancel", baseUrl: "https://example.invalid/v1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-cancel", purpose: "test", argv: ["node", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    let aborted = false;
    const host = {
      store,
      readLlmConfiguration: async () => ({ baseUrl: "https://example.invalid/v1", model: "mock-model", apiKey: API_KEY }),
    } as unknown as WorkspaceHost;
    const service = new DesktopRunService({
      host,
      completionClientFactory: () => ({
        complete: async (_request, signal) => new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
        }),
      }),
      now: () => new Date(now),
      idFactory: () => "run-cancel",
    });

    const running = service.start({ projectId: "project-cancel", task: "wait", modelConfigId: "model-cancel" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.cancel("run-cancel");

    await expect(running).resolves.toMatchObject({ run: { status: "cancelled", stopReason: "cancelled" } });
    expect(aborted).toBe(true);
    expect(store.listTraces("run-cancel").map((trace) => trace.type)).toEqual(["run_cancelled"]);
  });

  it("aborts an approved configured command when the desktop run is cancelled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "todex-desktop-command-cancel-"));
    temporaryDirectories.push(workspaceRoot);
    const now = "2026-08-12T12:00:00.000Z";
    const store = new FakeStore(
      { projectId: "project-command-cancel", workspaceRoot, displayName: "node-fixture", profileJson: "{}", createdAt: now, updatedAt: now },
      { configId: "model-command-cancel", projectId: "project-command-cancel", baseUrl: "https://example.invalid/v1", model: "mock-model", parametersJson: "{}", createdAt: now, updatedAt: now },
      { commandId: "test", projectId: "project-command-cancel", purpose: "test", argv: ["node", "--version"], workingDirectory: workspaceRoot, timeoutMs: 1_000, confirmedByUser: true },
    );
    let aborted = false;
    const host = { store, readLlmConfiguration: async () => ({ baseUrl: "https://example.invalid/v1", model: "mock-model", apiKey: API_KEY }) } as unknown as WorkspaceHost;
    const commandRunner: CommandRunner = {
      run: async (_input, signal) => new Promise<CommandExecution>((_resolve, reject) => {
        signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      }),
    };
    const service = new DesktopRunService({
      host,
      completionClientFactory: () => new ScriptedCompletionClient([JSON.stringify({ tool: "run_configured_command", commandId: "test" })]),
      commandRunner,
      now: () => new Date(now),
      idFactory: (() => { let index = 0; return () => `command-cancel-${++index}`; })(),
    });

    const pending = await service.start({ projectId: "project-command-cancel", task: "run test", modelConfigId: "model-command-cancel" });
    const deciding = service.decideApproval({ runId: pending.run.runId, approvalId: pending.pendingApproval!.approvalId, decision: "once" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.cancel(pending.run.runId);

    await expect(deciding).resolves.toMatchObject({ run: { status: "cancelled", stopReason: "cancelled" } });
    expect(aborted).toBe(true);
  });
});
