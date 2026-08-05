import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App, type DemoClient } from "../src/App.js";
import { createDemoSession, type DemoSnapshot } from "../src/demo-session.js";

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

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  it("preserves a selected scenario when an older session read resolves later", async () => {
    const user = userEvent.setup();
    const initialRead = deferred<DemoSnapshot>();
    const selected = snapshot({ selectedScenario: "repair-feedback" });
    const client: DemoClient = {
      readSession: () => initialRead.promise,
      selectScenario: async () => selected,
      run: async () => selected,
      decideApproval: async () => selected,
      reset: async () => snapshot(),
    };

    render(<App client={client} />);
    await user.click(screen.getByRole("button", { name: "Repair feedback" }));

    expect(screen.getByRole("button", { name: "Repair feedback" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Run scenario" })).toBeEnabled();

    await act(async () => {
      initialRead.resolve(snapshot());
    });

    expect(screen.getByRole("button", { name: "Repair feedback" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Run scenario" })).toBeEnabled();
  });

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

  it("explains an approval request and supports the full keyboard-only approval flow", async () => {
    const user = userEvent.setup();
    const session = createDemoSession();
    let current = await session.reset();
    const calls = { selectScenario: 0, run: 0, decideApproval: 0, reset: 0 };
    const client: DemoClient = {
      readSession: async () => current,
      selectScenario: async (scenarioId) => {
        calls.selectScenario += 1;
        current = await session.selectScenario(scenarioId);
        return current;
      },
      run: async () => {
        calls.run += 1;
        current = await session.run();
        return current;
      },
      decideApproval: async (input) => {
        calls.decideApproval += 1;
        current = await session.decideApproval(input);
        return current;
      },
      reset: async () => {
        calls.reset += 1;
        current = await session.reset();
        return current;
      },
    };

    render(<App client={client} />);
    const workspaceEscape = screen.getByRole("button", { name: "Workspace escape" });
    const repairFeedback = screen.getByRole("button", { name: "Repair feedback" });
    const approvalIsolation = screen.getByRole("button", { name: "Approval isolation" });
    const reset = screen.getByRole("button", { name: "Reset demo" });
    const run = screen.getByRole("button", { name: "Run scenario" });

    await user.tab();
    expect(workspaceEscape).toHaveFocus();
    await user.tab();
    expect(repairFeedback).toHaveFocus();
    await user.tab();
    expect(approvalIsolation).toHaveFocus();
    await user.keyboard(" ");
    expect(calls.selectScenario).toBe(1);
    expect(approvalIsolation).toHaveAttribute("aria-pressed", "true");

    await user.tab();
    expect(reset).toHaveFocus();
    await user.tab();
    expect(run).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(calls.run).toBe(1);

    expect(current.pendingApproval).toMatchObject({
      reason: "approval_isolation",
      runId: "run-1",
    });
    expect(await screen.findByText("Approval isolation keeps this once-only decision bound to its affected run.")).toBeVisible();
    expect(screen.getByText("Affected run: run-1")).toBeVisible();

    const allow = screen.getByRole("button", { name: "Allow once" });
    await user.tab();
    expect(workspaceEscape).toHaveFocus();
    await user.tab();
    expect(repairFeedback).toHaveFocus();
    await user.tab();
    expect(approvalIsolation).toHaveFocus();
    await user.tab();
    expect(reset).toHaveFocus();
    await user.tab();
    expect(allow).toHaveFocus();
    await user.keyboard(" ");
    expect(calls.decideApproval).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("Approval recorded");

    await user.tab();
    expect(workspaceEscape).toHaveFocus();
    await user.tab();
    expect(repairFeedback).toHaveFocus();
    await user.tab();
    expect(approvalIsolation).toHaveFocus();
    await user.tab();
    expect(reset).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(calls.reset).toBe(1);
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
