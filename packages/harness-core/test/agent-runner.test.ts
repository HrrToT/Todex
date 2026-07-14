import { describe, expect, it } from "vitest";
import {
  createRunner,
  ScriptedMockLlm,
  type AgentRunner,
  type LlmTurnContext,
  type ToolDispatcher,
} from "../src/index.js";
import type { Action } from "@todex/contracts";

interface TrackingDispatcher extends ToolDispatcher {
  readonly calls: ReadonlyArray<{ action: Action; actionId: string }>;
}

function fakeDispatcher(): TrackingDispatcher {
  const calls: { action: Action; actionId: string }[] = [];
  return {
    calls,
    dispatch: async (action, ctx) => {
      calls.push({ action, actionId: ctx.actionId });
      return {
        resultId: `${ctx.actionId}-result`,
        actionId: ctx.actionId,
        status: "succeeded" as const,
        summary: `${action.tool} ok`,
      };
    },
  };
}

describe("AgentRunner scripted loop", () => {
  it("records read_file then finish from a scripted LLM", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/app.ts" },
      { tool: "finish", summary: "inspected source" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r1",
      projectId: "p1",
      task: "inspect app",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0].action.tool).toBe("read_file");
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "action_requested",
      "run_completed",
    ]);
  });

  it("does not dispatch finish and completes with verified status", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done", completion: "verified" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-finish-only",
      projectId: "p1",
      task: "do nothing",
    });

    expect(result.status).toBe("completed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "run_completed",
    ]);
  });

  it("completes as completed_unverified when finish has unverified completion", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "finish", summary: "done", completion: "unverified" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-unverified",
      projectId: "p1",
      task: "unverified task",
    });

    expect(result.status).toBe("completed_unverified");
  });

  it("feeds ToolResult into the next LlmTurnContext.previousResults", async () => {
    let captured: LlmTurnContext | null = null;
    const llm = new ScriptedMockLlm(
      [
        { tool: "read_file", path: "src/a.ts" },
        { tool: "finish", summary: "done" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.previousResults.length >= 1) {
            captured = ctx;
          }
        },
      },
    );
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    await runner.run({ runId: "r-feed", projectId: "p1", task: "feed test" });

    expect(captured).not.toBeNull();
    expect(captured!.previousResults).toHaveLength(1);
    expect(captured!.previousResults[0].status).toBe("succeeded");
  });

  it("snapshots previousResults per turn so later mutations do not leak back", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/app.ts" },
      { tool: "finish", summary: "done" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    await runner.run({ runId: "r-snapshot", projectId: "p1", task: "snapshot test" });

    expect(llm.contexts).toHaveLength(2);
    expect(llm.contexts[0].previousResults).toHaveLength(0);
    expect(llm.contexts[1].previousResults).toHaveLength(1);
    expect(llm.contexts[1].previousResults[0].status).toBe("succeeded");
  });
});

describe("AgentRunner malformed actions", () => {
  it("rejects unknown tool with action_rejected and run_failed, never dispatches", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "launch_missiles", target: "moon" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-unknown",
      projectId: "p1",
      task: "bad tool",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_rejected",
      "run_failed",
    ]);
  });

  it("rejects missing tool field with action_rejected and run_failed", async () => {
    const llm = new ScriptedMockLlm([{ path: "src/a.ts" }]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-missing",
      projectId: "p1",
      task: "missing tool",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((event) => event.type === "action_rejected")).toBe(true);
    expect(result.trace.some((event) => event.type === "run_failed")).toBe(true);
  });

  it("rejects non-object action with action_rejected and run_failed", async () => {
    const llm = new ScriptedMockLlm(["not-an-object"]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-nonobj",
      projectId: "p1",
      task: "non-object",
    });

    expect(result.status).toBe("failed");
    expect(dispatcher.calls).toHaveLength(0);
    expect(result.trace.some((event) => event.type === "action_rejected")).toBe(true);
    expect(result.trace.some((event) => event.type === "run_failed")).toBe(true);
  });
});

describe("AgentRunner max steps", () => {
  it("fails with max_steps_exceeded when maxSteps is reached", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
      { tool: "read_file", path: "src/b.ts" },
      { tool: "read_file", path: "src/c.ts" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-max",
      projectId: "p1",
      task: "max steps",
      maxSteps: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("max_steps_exceeded");
    expect(dispatcher.calls).toHaveLength(1);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "run_failed",
    ]);
  });
});

describe("AgentRunner mock script exhausted", () => {
  it("fails when the mock script is exhausted before finish", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/a.ts" },
    ]);
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-exhausted",
      projectId: "p1",
      task: "exhaust script",
    });

    expect(result.status).toBe("failed");
    expect(result.stopReason).toContain("mock script exhausted");
    expect(dispatcher.calls).toHaveLength(1);
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "run_failed",
    ]);
  });
});

describe("AgentRunner cancellation", () => {
  it("stops with run_cancelled when cancellation is requested before next LLM call", async () => {
    const holder: { runner?: AgentRunner } = {};
    const llm = new ScriptedMockLlm(
      [
        { tool: "read_file", path: "src/app.ts" },
        { tool: "read_file", path: "src/other.ts" },
        { tool: "finish", summary: "done" },
      ],
      {
        onTurn: (ctx) => {
          if (ctx.trace.length >= 2 && holder.runner) {
            holder.runner.cancel(ctx.runId);
          }
        },
      },
    );
    const dispatcher = fakeDispatcher();
    const runner = createRunner({ llm, dispatcher });
    holder.runner = runner;

    const result = await runner.run({
      runId: "r-cancel",
      projectId: "p1",
      task: "cancel test",
    });

    expect(result.status).toBe("cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(result.trace.some((event) => event.type === "run_cancelled")).toBe(true);
    const actionRequests = result.trace.filter(
      (event) => event.type === "action_requested",
    );
    expect(actionRequests).toHaveLength(2);
  });
});

describe("AgentRunner dispatcher errors", () => {
  it("records a failed ToolResult when dispatch throws and continues to finish", async () => {
    const llm = new ScriptedMockLlm([
      { tool: "read_file", path: "src/app.ts" },
      { tool: "finish", summary: "done" },
    ]);
    const dispatcher: ToolDispatcher = {
      dispatch: async () => {
        throw new Error("disk unavailable");
      },
    };
    const runner = createRunner({ llm, dispatcher });

    const result = await runner.run({
      runId: "r-dispatch-err",
      projectId: "p1",
      task: "dispatch error test",
    });

    expect(result.status).toBe("completed");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].summary).toContain("dispatcher error: disk unavailable");
    expect(llm.contexts).toHaveLength(2);
    expect(llm.contexts[1].previousResults).toHaveLength(1);
    expect(llm.contexts[1].previousResults[0].status).toBe("failed");
    expect(llm.contexts[1].previousResults[0].summary).toContain("disk unavailable");
    expect(result.trace.map((event) => event.type)).toEqual([
      "action_requested",
      "tool_completed",
      "action_requested",
      "run_completed",
    ]);
  });
});
