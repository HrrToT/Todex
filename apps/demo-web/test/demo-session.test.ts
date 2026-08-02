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
