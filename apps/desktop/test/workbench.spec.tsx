import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkbenchApp } from "../src/renderer/App.js";
import { preloadApprovalBridge } from "../src/renderer/bridge.js";

describe("Codex-style workbench", () => {
  it("adapts the T-009 lowercase preload approval surface", () => {
    const approval = { decide: async () => undefined };
    Object.defineProperty(window, "todex", { configurable: true, value: { approval } });

    expect(preloadApprovalBridge()).toBe(approval);
  });

  it("uses the Electron-only live workbench for governed workspace and model setup", () => {
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [] },
        model: { list: async () => [], save: async () => ({ configId: "m1", baseUrl: "https://example.invalid/v1", model: "test-model" }) },
        credential: { status: async () => ({ configured: false, availability: "available" }), save: async () => ({ configured: true }) },
      },
    });

    render(<WorkbenchApp locale="en-US" />);

    expect(screen.getByText("Base URL")).toBeVisible();
    expect(screen.getByPlaceholderText("https://api.example.com/v1")).toBeVisible();
    expect(screen.getByPlaceholderText("model-name")).toBeVisible();
    expect(screen.getByPlaceholderText("仅保存到 Credential Manager")).toBeVisible();
    expect(screen.queryByText("Ready for a task")).not.toBeInTheDocument();
    Object.defineProperty(window, "todex", { configurable: true, value: undefined });
  });

  it("renders a workspace rail, collapsed Inspector, bottom composer, and idle state", () => {
    render(<WorkbenchApp />);

    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开检查器" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "任务或继续说明" })).toBeVisible();
    expect(screen.getByText("空闲")).toBeVisible();
    expect(screen.getByRole("button", { name: "开始运行" })).toBeVisible();
  });

  it("opens the Diff Inspector for deterministic verification feedback", async () => {
    const user = userEvent.setup();
    render(<WorkbenchApp locale="en-US" />);

    await user.type(screen.getByRole("textbox", { name: "Task or continuation" }), "Repair calculation");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Verification failed")).toBeVisible();
  });

  it("sends only the typed approval id and decision, then returns focus to the composer", async () => {
    const user = userEvent.setup();
    const decisions: Array<{ approvalId: string; decision: string }> = [];
    render(<WorkbenchApp locale="en-US" onApprovalDecision={(input) => decisions.push(input)} />);

    const composer = screen.getByRole("textbox", { name: "Task or continuation" });
    await user.type(composer, "Install a package");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(screen.getByRole("button", { name: "Allow once" }));

    expect(decisions).toEqual([{ approvalId: "approval-demo-1", decision: "once" }]);
    expect(composer).toHaveFocus();
    expect(screen.queryByText("npm install")).not.toBeInTheDocument();
  });

  it("uses the typed approval bridge and exposes a pin control without opening privileged APIs", async () => {
    const user = userEvent.setup();
    const decisions: Array<{ approvalId: string; decision: string }> = [];
    const bridge = {
      decide: async (input: { approvalId: string; decision: "once" | "run" | "command_prefix" | "deny" }) => {
        decisions.push(input);
      },
    };
    render(<WorkbenchApp locale="en-US" approvalBridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Open Inspector" }));
    await user.click(screen.getByRole("button", { name: "Pin Inspector" }));
    expect(screen.getByRole("button", { name: "Pin Inspector" })).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByRole("textbox", { name: "Task or continuation" }), "Install a package");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(screen.getByRole("button", { name: "Allow once" }));

    expect(decisions).toEqual([{ approvalId: "approval-demo-1", decision: "once" }]);
  });

  it("does not render likely secret values from task input", async () => {
    const user = userEvent.setup();
    render(<WorkbenchApp locale="en-US" />);

    await user.type(screen.getByRole("textbox", { name: "Task or continuation" }), "Fix it API_KEY=secret-value credentialRef=prod");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(screen.queryByText(/secret-value/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/credentialRef/i)).not.toBeInTheDocument();
  });
});
