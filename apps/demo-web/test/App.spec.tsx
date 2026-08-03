import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App, type DemoClient } from "../src/App.js";
import type { DemoSnapshot } from "../src/demo-session.js";

function snapshot(overrides: Partial<DemoSnapshot> = {}): DemoSnapshot {
  return {
    status: "idle",
    runs: [],
    trace: [],
    verification: [],
    dispatcherCalls: 0,
    ...overrides,
  };
}

function createClient(initial: DemoSnapshot, afterScenario: DemoSnapshot, afterRun: DemoSnapshot): DemoClient {
  let current = initial;
  return {
    readSession: async () => current,
    selectScenario: async () => {
      current = afterScenario;
      return current;
    },
    run: async () => {
      current = afterRun;
      return current;
    },
    decideApproval: async () => current,
    reset: async () => {
      current = snapshot();
      return current;
    },
  };
}

describe("public mock demo workbench", () => {
  it("labels Mock Demo and renders fixed repair feedback after running a scenario", async () => {
    const user = userEvent.setup();
    const client = createClient(
      snapshot(),
      snapshot({ selectedScenario: "repair-feedback" }),
      snapshot({
        selectedScenario: "repair-feedback",
        status: "completed",
        runs: [{ id: "run-1", scenarioId: "repair-feedback", status: "completed" }],
        trace: [
          { type: "repair_started", runId: "run-1" },
          { type: "verification_completed", runId: "run-1" },
        ],
        verification: ["test_failure", "passed"],
        diff: { summary: "scripted_repair" },
      }),
    );

    render(<App client={client} />);
    await user.click(screen.getByRole("button", { name: "Repair feedback" }));
    await user.click(screen.getByRole("button", { name: "Run scenario" }));

    expect(screen.getByText("Mock Demo")).toBeVisible();
    expect(screen.getByText("test_failure")).toBeVisible();
    expect(screen.getByText("passed")).toBeVisible();
    expect(screen.getByText("scripted_repair")).toBeVisible();

    const trace = screen.getByRole("list", { name: "Execution trace" });
    const traceItems = within(trace).getAllByRole("listitem");
    expect(traceItems[0]).toHaveTextContent("Repair started");
    expect(traceItems[1]).toHaveTextContent("Verification completed");
  });

  it("allows keyboard approval and reset", async () => {
    const user = userEvent.setup();
    const approvalSnapshot = snapshot({ selectedScenario: "approval-isolation" });
    const pendingSnapshot = snapshot({
      selectedScenario: "approval-isolation",
      status: "awaiting_approval",
      runs: [{ id: "run-1", scenarioId: "approval-isolation", status: "awaiting_approval" }],
      trace: [{ type: "approval_requested", runId: "run-1" }],
      pendingApproval: { approvalId: "approval-1", scope: "once" },
    });
    const decidedSnapshot = snapshot({
      selectedScenario: "approval-isolation",
      status: "completed",
      runs: [{ id: "run-1", scenarioId: "approval-isolation", status: "completed" }],
      trace: [
        { type: "approval_requested", runId: "run-1" },
        { type: "approval_decided", runId: "run-1" },
      ],
    });
    const client: DemoClient = {
      readSession: async () => snapshot(),
      selectScenario: async () => approvalSnapshot,
      run: async () => pendingSnapshot,
      decideApproval: async () => decidedSnapshot,
      reset: async () => snapshot(),
    };

    render(<App client={client} />);
    await user.click(screen.getByRole("button", { name: "Approval isolation" }));
    await user.click(screen.getByRole("button", { name: "Run scenario" }));

    const allow = screen.getByRole("button", { name: "Allow once" });
    allow.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Approval recorded");

    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(screen.getByText("Choose a scenario to begin")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
  });

  it("offers only semantic fixed controls and no visitor execution inputs", () => {
    render(<App client={createClient(snapshot(), snapshot(), snapshot())} />);

    expect(screen.getByRole("heading", { name: "Mock Demo" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Scenarios" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Workspace escape" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Repair feedback" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Approval isolation" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run scenario" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset demo" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByText(/api key|model|upload|command input|patch editor|file path/i)).not.toBeInTheDocument();
  });
});
