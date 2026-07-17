import { describe, expect, it } from "vitest";
import { writeDemoReport, type MechanismDemoReport } from "../run-mechanism-demo.js";

const passingReport: MechanismDemoReport = {
  allPassed: true,
  workspaceEscape: {
    passed: true,
    status: "completed",
    denialReason: "workspace_escape",
    dispatcherCalls: 0,
    traceTypes: ["action_requested", "action_rejected", "action_requested", "run_completed"],
  },
  repairFeedback: {
    passed: true,
    status: "completed",
    verificationCalls: 2,
    failedFeedbackObserved: true,
    repairApplied: true,
    traceTypes: [
      "action_requested",
      "tool_completed",
      "verification_completed",
      "action_requested",
      "tool_completed",
      "verification_completed",
      "action_requested",
      "run_completed",
    ],
  },
  approvalIsolation: {
    passed: true,
    runAStatus: "completed",
    runBStatus: "awaiting_approval",
    runADispatcherCalls: 1,
    runBDispatcherCalls: 0,
    approvalScope: "run",
    runBTraceTypes: ["action_requested", "approval_requested"],
  },
};

const failingReport: MechanismDemoReport = { ...passingReport, allPassed: false };

describe("mechanism-demo CLI writeDemoReport", () => {
  it("writes only the fixed report path and a JSON copy of the immutable report", async () => {
    const writes: Array<{ path: string; text: string }> = [];
    await writeDemoReport(passingReport, {
      mkdir: async () => undefined,
      writeFile: async (path, text) => {
        writes.push({ path, text });
      },
    });

    expect(writes).toEqual([
      {
        path: ".todex/demo/mechanism-report.json",
        text: JSON.stringify(passingReport, null, 2),
      },
    ]);
  });

  it("throws demo_report_failed when allPassed is false and never calls the writer", async () => {
    const calls: string[] = [];
    await expect(
      writeDemoReport(failingReport, {
        mkdir: async () => {
          calls.push("mkdir");
        },
        writeFile: async () => {
          calls.push("writeFile");
        },
      }),
    ).rejects.toThrow("demo_report_failed");
    expect(calls).toEqual([]);
  });

  it("throws demo_report_failed when the writer rejects", async () => {
    await expect(
      writeDemoReport(passingReport, {
        mkdir: async () => undefined,
        writeFile: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("demo_report_failed");
  });
});
