import { describe, expect, it } from "vitest";
import { runMechanismDemo } from "../src/index.js";

describe("mechanism demo", () => {
  it("returns immutable evidence for all course mechanisms", async () => {
    const report = await runMechanismDemo();

    expect(report.allPassed).toBe(true);
    expect(report.workspaceEscape).toMatchObject({
      passed: true,
      status: "completed",
      denialReason: "workspace_escape",
      dispatcherCalls: 0,
    });
    expect(report.repairFeedback).toMatchObject({
      passed: true,
      status: "completed",
      verificationCalls: 2,
      failedFeedbackObserved: true,
      repairApplied: true,
    });
    expect(report.approvalIsolation).toMatchObject({
      passed: true,
      runAStatus: "completed",
      runBStatus: "awaiting_approval",
      runADispatcherCalls: 1,
      runBDispatcherCalls: 0,
      approvalScope: "run",
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  it("records the exact workspace-escape trace sequence", async () => {
    const report = await runMechanismDemo();

    expect(report.workspaceEscape.traceTypes).toEqual([
      "action_requested",
      "action_rejected",
      "action_requested",
      "run_completed",
    ]);
  });

  it("records two verification events and a verified finish for the repair scenario", async () => {
    const report = await runMechanismDemo();

    expect(
      report.repairFeedback.traceTypes.filter((type) => type === "verification_completed"),
    ).toHaveLength(2);
    expect(report.repairFeedback.traceTypes[report.repairFeedback.traceTypes.length - 1]).toBe(
      "run_completed",
    );
  });

  it("proves Run B pauses for approval without dispatching", async () => {
    const report = await runMechanismDemo();

    expect(report.approvalIsolation.runBTraceTypes).toContain("approval_requested");
    expect(report.approvalIsolation.runBTraceTypes).not.toContain("tool_completed");
  });

  it("redacts shell text, paths, source text, and secrets from the report", async () => {
    const report = await runMechanismDemo();
    const json = JSON.stringify(report);

    expect(json).not.toContain("npm install");
    expect(json).not.toContain("/workspace");
    expect(json).not.toContain("return left");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("left - right");
    expect(json).not.toContain("left + right");
  });

  it("freezes every nested report entry and array", async () => {
    const report = await runMechanismDemo();

    expect(Object.isFrozen(report.workspaceEscape)).toBe(true);
    expect(Object.isFrozen(report.workspaceEscape.traceTypes)).toBe(true);
    expect(Object.isFrozen(report.repairFeedback)).toBe(true);
    expect(Object.isFrozen(report.repairFeedback.traceTypes)).toBe(true);
    expect(Object.isFrozen(report.approvalIsolation)).toBe(true);
    expect(Object.isFrozen(report.approvalIsolation.runBTraceTypes)).toBe(true);
  });
});
