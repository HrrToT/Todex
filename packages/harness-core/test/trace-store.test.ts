import { describe, expect, it } from "vitest";
import { InMemoryTraceStore } from "../src/index.js";

describe("InMemoryTraceStore", () => {
  it("generates sequential sequence numbers starting from 0 per run", () => {
    const store = new InMemoryTraceStore();
    const e1 = store.append({
      runId: "r1",
      type: "action_requested",
      payloadSummary: "a",
    });
    const e2 = store.append({
      runId: "r1",
      type: "tool_completed",
      payloadSummary: "b",
    });
    const e3 = store.append({
      runId: "r1",
      type: "run_completed",
      payloadSummary: "c",
    });

    expect(e1.sequence).toBe(0);
    expect(e2.sequence).toBe(1);
    expect(e3.sequence).toBe(2);
  });

  it("resets sequence for each run", () => {
    const store = new InMemoryTraceStore();
    store.append({
      runId: "r1",
      type: "action_requested",
      payloadSummary: "a",
    });
    const e2 = store.append({
      runId: "r2",
      type: "action_requested",
      payloadSummary: "b",
    });

    expect(e2.sequence).toBe(0);
  });

  it("lists events for a specific run in order", () => {
    const store = new InMemoryTraceStore();
    store.append({
      runId: "r1",
      type: "action_requested",
      payloadSummary: "a",
    });
    store.append({
      runId: "r2",
      type: "action_requested",
      payloadSummary: "b",
    });
    store.append({
      runId: "r1",
      type: "tool_completed",
      payloadSummary: "c",
    });

    const r1Events = store.list("r1");
    expect(r1Events).toHaveLength(2);
    expect(r1Events[0].type).toBe("action_requested");
    expect(r1Events[1].type).toBe("tool_completed");
  });

  it("generates unique eventIds and valid timestamps", () => {
    const store = new InMemoryTraceStore();
    const e1 = store.append({
      runId: "r1",
      type: "action_requested",
      payloadSummary: "a",
    });
    const e2 = store.append({
      runId: "r1",
      type: "tool_completed",
      payloadSummary: "b",
    });

    expect(e1.eventId).not.toBe(e2.eventId);
    expect(e1.timestamp.length).toBeGreaterThan(0);
    expect(e2.timestamp.length).toBeGreaterThan(0);
  });
});
