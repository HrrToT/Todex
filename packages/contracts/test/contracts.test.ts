import { describe, expect, it } from "vitest";
import {
  parseAction,
  configuredCommandSchema,
  verificationResultSchema,
  approvalRequestSchema,
  memoryEntrySchema,
  traceEventSchema,
  runSessionSchema,
  toolResultSchema,
} from "../src/index.js";

describe("parseAction", () => {
  it("accepts a read_file action", () => {
    expect(parseAction({ tool: "read_file", path: "src/app.ts" })).toEqual({
      tool: "read_file",
      path: "src/app.ts",
    });
  });

  it("rejects an unknown tool", () => {
    expect(() => parseAction({ tool: "launch_missiles" })).toThrow("unknown tool");
  });

  it("rejects a missing tool field as invalid action", () => {
    expect(() => parseAction({ path: "src/app.ts" })).toThrow("invalid action");
  });

  it("rejects non-object input", () => {
    expect(() => parseAction(null)).toThrow("invalid action");
    expect(() => parseAction(undefined)).toThrow("invalid action");
    expect(() => parseAction("read_file")).toThrow("invalid action");
    expect(() => parseAction([])).toThrow("invalid action");
  });

  it("list_files applies path default and leaves maxDepth optional", () => {
    expect(parseAction({ tool: "list_files" })).toEqual({
      tool: "list_files",
      path: ".",
    });
  });

  it("list_files accepts explicit path and maxDepth", () => {
    expect(parseAction({ tool: "list_files", path: "src", maxDepth: 3 })).toEqual({
      tool: "list_files",
      path: "src",
      maxDepth: 3,
    });
  });

  it("list_files rejects maxDepth out of range", () => {
    expect(() => parseAction({ tool: "list_files", maxDepth: 9 })).toThrow("invalid action");
    expect(() => parseAction({ tool: "list_files", maxDepth: -1 })).toThrow("invalid action");
  });

  it("read_file rejects missing path", () => {
    expect(() => parseAction({ tool: "read_file" })).toThrow("invalid action");
  });

  it("read_file rejects extra fields (strict)", () => {
    expect(() =>
      parseAction({ tool: "read_file", path: "a.ts", extra: 1 }),
    ).toThrow("invalid action");
  });

  it("search_text applies default maxResults", () => {
    expect(parseAction({ tool: "search_text", query: "foo" })).toEqual({
      tool: "search_text",
      query: "foo",
      maxResults: 20,
    });
  });

  it("search_text rejects empty query", () => {
    expect(() => parseAction({ tool: "search_text", query: "" })).toThrow("invalid action");
  });

  it("search_text rejects maxResults out of range", () => {
    expect(() =>
      parseAction({ tool: "search_text", query: "foo", maxResults: 0 }),
    ).toThrow("invalid action");
    expect(() =>
      parseAction({ tool: "search_text", query: "foo", maxResults: 101 }),
    ).toThrow("invalid action");
  });

  it("apply_patch accepts a non-empty unified diff", () => {
    const patch = "--- a/x\n+++ b/x\n@@\n-a\n+b\n";
    expect(parseAction({ tool: "apply_patch", patch })).toEqual({
      tool: "apply_patch",
      patch,
    });
  });

  it("apply_patch rejects an empty patch", () => {
    expect(() => parseAction({ tool: "apply_patch", patch: "" })).toThrow("invalid action");
  });

  it("run_configured_command accepts a commandId", () => {
    expect(
      parseAction({ tool: "run_configured_command", commandId: "node.test" }),
    ).toEqual({ tool: "run_configured_command", commandId: "node.test" });
  });

  it("run_shell_command_with_approval accepts command and optional cwd", () => {
    expect(
      parseAction({
        tool: "run_shell_command_with_approval",
        command: "npm test",
        cwd: ".",
      }),
    ).toEqual({
      tool: "run_shell_command_with_approval",
      command: "npm test",
      cwd: ".",
    });
  });

  it("run_shell_command_with_approval rejects an empty command", () => {
    expect(() =>
      parseAction({ tool: "run_shell_command_with_approval", command: "" }),
    ).toThrow("invalid action");
  });

  it("remember accepts a valid project_convention with trace evidence", () => {
    expect(
      parseAction({
        tool: "remember",
        kind: "project_convention",
        content: "use tabs",
        traceEventIds: ["e1"],
      }),
    ).toEqual({
      tool: "remember",
      kind: "project_convention",
      content: "use tabs",
      traceEventIds: ["e1"],
    });
  });

  it("remember rejects an invalid kind", () => {
    expect(() =>
      parseAction({
        tool: "remember",
        kind: "bogus",
        content: "x",
        traceEventIds: ["e1"],
      }),
    ).toThrow("invalid action");
  });

  it("remember rejects an empty traceEventIds list", () => {
    expect(() =>
      parseAction({
        tool: "remember",
        kind: "failure_resolution",
        content: "x",
        traceEventIds: [],
      }),
    ).toThrow("invalid action");
  });

  it("finish applies default completion=verified", () => {
    expect(parseAction({ tool: "finish", summary: "done" })).toEqual({
      tool: "finish",
      summary: "done",
      completion: "verified",
    });
  });

  it("finish accepts explicit unverified completion", () => {
    expect(
      parseAction({ tool: "finish", summary: "done", completion: "unverified" }),
    ).toEqual({
      tool: "finish",
      summary: "done",
      completion: "unverified",
    });
  });

  it("finish rejects an empty summary", () => {
    expect(() => parseAction({ tool: "finish", summary: "" })).toThrow("invalid action");
  });

  it("finish rejects an invalid completion value", () => {
    expect(() =>
      parseAction({ tool: "finish", summary: "x", completion: "maybe" }),
    ).toThrow("invalid action");
  });
});

describe("entity schemas", () => {
  const validCommand = {
    commandId: "node.test",
    projectId: "p1",
    purpose: "test",
    argv: ["npm", "test"],
    workingDirectory: ".",
    timeoutMs: 60000,
    confirmedByUser: true,
  };

  it("ConfiguredCommand parses a valid command", () => {
    expect(configuredCommandSchema.parse(validCommand)).toEqual(validCommand);
  });

  it("ConfiguredCommand rejects extra fields (strict)", () => {
    expect(() =>
      configuredCommandSchema.parse({ ...validCommand, extra: 1 }),
    ).toThrow();
  });

  it("ConfiguredCommand rejects an invalid purpose", () => {
    expect(() =>
      configuredCommandSchema.parse({ ...validCommand, purpose: "deploy" }),
    ).toThrow();
  });

  it("ConfiguredCommand rejects shell concatenation in argv", () => {
    expect(() =>
      configuredCommandSchema.parse({
        ...validCommand,
        argv: ["npm", "test && rm -rf /"],
      }),
    ).toThrow();
  });

  it("VerificationResult parses and is strict", () => {
    const valid = {
      verificationId: "v1",
      runId: "r1",
      commandId: "node.test",
      classification: "test_failure",
      exitCode: 1,
      durationMs: 1234,
      failureSummary: "1 failed",
      relatedPaths: ["src/a.ts"],
    };
    expect(verificationResultSchema.parse(valid)).toEqual(valid);
    expect(() => verificationResultSchema.parse({ ...valid, extra: 1 })).toThrow();
  });

  it("ApprovalRequest parses and rejects bad state", () => {
    const valid = {
      approvalId: "a1",
      runId: "r1",
      actionId: "act1",
      tool: "run_shell_command_with_approval",
      riskReasons: ["free shell"],
      fingerprint: "fp1",
      state: "pending",
      createdAt: "2026-07-13T00:00:00Z",
    };
    expect(approvalRequestSchema.parse(valid)).toEqual(valid);
    expect(() =>
      approvalRequestSchema.parse({ ...valid, state: "maybe" }),
    ).toThrow();
  });

  it("MemoryEntry accepts verified project_profile with empty sourceTraceIds", () => {
    const entry = {
      memoryId: "m1",
      projectId: "p1",
      kind: "project_profile",
      trustLevel: "verified",
      content: "node project",
      sourceTraceIds: [],
      createdAt: "2026-07-13T00:00:00Z",
      updatedAt: "2026-07-13T00:00:00Z",
    };
    expect(memoryEntrySchema.parse(entry)).toEqual(entry);
  });

  it("MemoryEntry accepts verified_command with empty sourceTraceIds", () => {
    const entry = {
      memoryId: "m2",
      projectId: "p1",
      kind: "verified_command",
      trustLevel: "verified",
      content: "npm test",
      sourceTraceIds: [],
      createdAt: "2026-07-13T00:00:00Z",
      updatedAt: "2026-07-13T00:00:00Z",
    };
    expect(memoryEntrySchema.parse(entry)).toEqual(entry);
  });

  it("MemoryEntry rejects agent_observed with empty sourceTraceIds", () => {
    const entry = {
      memoryId: "m3",
      projectId: "p1",
      kind: "failure_resolution",
      trustLevel: "agent_observed",
      content: "fix by x",
      sourceTraceIds: [],
      createdAt: "2026-07-13T00:00:00Z",
      updatedAt: "2026-07-13T00:00:00Z",
    };
    expect(() => memoryEntrySchema.parse(entry)).toThrow();
  });

  it("MemoryEntry accepts agent_observed with at least one trace id", () => {
    const entry = {
      memoryId: "m4",
      projectId: "p1",
      kind: "failure_resolution",
      trustLevel: "agent_observed",
      content: "fix by x",
      sourceTraceIds: ["trace-1"],
      createdAt: "2026-07-13T00:00:00Z",
      updatedAt: "2026-07-13T00:00:00Z",
    };
    expect(memoryEntrySchema.parse(entry)).toEqual(entry);
  });

  it("TraceEvent parses and rejects bad type", () => {
    const valid = {
      eventId: "e1",
      runId: "r1",
      sequence: 0,
      type: "action_requested",
      timestamp: "2026-07-13T00:00:00Z",
      payloadSummary: "read_file src/app.ts",
    };
    expect(traceEventSchema.parse(valid)).toEqual(valid);
    expect(() => traceEventSchema.parse({ ...valid, type: "nope" })).toThrow();
  });

  it("RunSession parses and is strict", () => {
    const valid = {
      runId: "r1",
      projectId: "p1",
      taskText: "fix bug",
      status: "running",
      startedAt: "2026-07-13T00:00:00Z",
      repairAttempts: 0,
    };
    expect(runSessionSchema.parse(valid)).toEqual(valid);
    expect(() => runSessionSchema.parse({ ...valid, extra: 1 })).toThrow();
  });

  it("ToolResult parses and rejects bad status", () => {
    const valid = {
      resultId: "res1",
      actionId: "act1",
      status: "succeeded",
      summary: "ok",
    };
    expect(toolResultSchema.parse(valid)).toEqual(valid);
    expect(() => toolResultSchema.parse({ ...valid, status: "maybe" })).toThrow();
  });
});
