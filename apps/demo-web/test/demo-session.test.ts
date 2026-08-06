import { describe, expect, it } from "vitest";

import { DEMO_SCENARIOS, createDemoSession } from "../src/demo-session.js";

describe("DemoSession", () => {
  it("rejects real-model configuration and arbitrary paths with the fixed error", async () => {
    const session = createDemoSession();

    await expect(session.configureRealModel("not-a-key")).rejects.toThrow(
      new Error("demo_restricted"),
    );
    await expect(session.openWorkspace("C:/Users/private")).rejects.toThrow(
      new Error("demo_restricted"),
    );
  });

  it("rejects free shell, patch submission, and unknown scenarios without retaining input", async () => {
    const session = createDemoSession();
    const rejectedInputs = ["curl secret.invalid", "visitor patch", "visitor-input"];

    await expect(session.runShell(rejectedInputs[0])).rejects.toThrow(new Error("demo_restricted"));
    await expect(session.applyPatch(rejectedInputs[1])).rejects.toThrow(new Error("demo_restricted"));
    await expect(session.selectScenario(rejectedInputs[2])).rejects.toThrow(
      new Error("demo_restricted"),
    );

    const snapshot = await session.reset();
    const serialized = JSON.stringify(snapshot);
    for (const input of rejectedInputs) {
      expect(serialized).not.toContain(input);
    }
  });

  it("does not accept a scenario injected by runtime mutation of the exported collection", async () => {
    const injectedScenario = "runtime-injected";

    try {
      (DEMO_SCENARIOS as unknown as string[]).push(injectedScenario);
    } catch {
      // A frozen public collection is the expected secure implementation.
    }

    const session = createDemoSession();
    await expect(session.selectScenario(injectedScenario)).rejects.toThrow(
      new Error("demo_restricted"),
    );
  });

  it("reports workspace escape as a rejected action before dispatch", async () => {
    const session = createDemoSession();

    await session.selectScenario("workspace-escape");
    const snapshot = await session.run();

    expect(snapshot.trace).toContainEqual({ type: "action_rejected", reason: "workspace_escape" });
    expect(snapshot.dispatcherCalls).toBe(0);
  });

  it("feeds deterministic failure feedback into a completed repair", async () => {
    const session = createDemoSession();

    await session.selectScenario("repair-feedback");
    const snapshot = await session.run();

    expect(snapshot.verification).toEqual(["test_failure", "passed"]);
    expect(snapshot.status).toBe("completed");
  });

  it("requires approval for each run without leaking a grant", async () => {
    const session = createDemoSession();

    await session.selectScenario("approval-isolation");
    const firstRun = await session.run();
    expect(firstRun.status).toBe("awaiting_approval");
    expect(firstRun.pendingApproval).toMatchObject({ scope: "once" });

    const approvedFirstRun = await session.decideApproval({
      approvalId: firstRun.pendingApproval?.approvalId ?? "",
      decision: "allow",
    });
    expect(approvedFirstRun.status).toBe("completed");

    const secondRun = await session.run();
    expect(secondRun.status).toBe("awaiting_approval");
    expect(secondRun.pendingApproval?.approvalId).not.toBe(firstRun.pendingApproval?.approvalId);
  });

  it("records an explicit denial without completing or executing the risky run", async () => {
    const session = createDemoSession();

    await session.selectScenario("approval-isolation");
    const pending = await session.run();
    const denied = await session.decideApproval({
      approvalId: pending.pendingApproval?.approvalId ?? "",
      decision: "deny",
    });

    expect(denied.status).toBe("denied");
    expect(denied.runs).toEqual([
      { id: "run-1", scenarioId: "approval-isolation", status: "denied" },
    ]);
    expect(denied.trace).toContainEqual({ type: "approval_denied", runId: "run-1" });
    expect(denied.pendingApproval).toBeUndefined();
    expect(denied.dispatcherCalls).toBe(0);
  });

  it("rejects scenario switching and repeated runs while approval is pending", async () => {
    const session = createDemoSession();

    await session.selectScenario("approval-isolation");
    const pending = await session.run();
    const approvalId = pending.pendingApproval?.approvalId ?? "";

    await expect(session.selectScenario("workspace-escape")).rejects.toThrow(
      new Error("demo_approval_pending"),
    );
    await expect(session.run()).rejects.toThrow(new Error("demo_approval_pending"));

    const completed = await session.decideApproval({ approvalId, decision: "allow" });
    expect(completed.status).toBe("completed");
    expect(completed.runs).toHaveLength(1);
  });

  it("does not let mutations of returned snapshots change later snapshots", async () => {
    const session = createDemoSession();

    await session.selectScenario("repair-feedback");
    const first = await session.run();
    const expected = structuredClone(first);

    (first.runs as unknown as { id: string }[])[0].id = "mutated-run";
    (first.trace as { type: string }[]).push({ type: "action_rejected" });
    (first.verification as string[]).push("test_failure");
    (first.diff as { summary: string }).summary = "mutated-diff";

    const later = await session.selectScenario("repair-feedback");
    expect(later).toEqual(expected);

    await session.selectScenario("approval-isolation");
    const approvalSnapshot = await session.run();
    const originalApprovalId = approvalSnapshot.pendingApproval?.approvalId ?? "";
    if (approvalSnapshot.pendingApproval !== undefined) {
      (approvalSnapshot.pendingApproval as { approvalId: string }).approvalId = "mutated-approval";
    }

    const completed = await session.decideApproval({ approvalId: originalApprovalId, decision: "allow" });
    expect(completed.status).toBe("completed");
  });

  it("reset removes runs, traces, diffs, and pending approval", async () => {
    const session = createDemoSession();

    await session.selectScenario("approval-isolation");
    await session.run();
    const snapshot = await session.reset();

    expect(snapshot).toMatchObject({
      runs: [],
      trace: [],
      diff: undefined,
      pendingApproval: undefined,
    });
  });
});
