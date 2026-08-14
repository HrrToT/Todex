import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
        credential: { status: async () => ({ configured: false, availability: "available" }) },
      },
    });

    render(<WorkbenchApp locale="en-US" />);

    expect(screen.getByText("Base URL")).toBeVisible();
    expect(screen.getByPlaceholderText("https://api.example.com/v1")).toBeVisible();
    expect(screen.getByPlaceholderText("model-name")).toBeVisible();
    expect(screen.getByText("Save credentials in Credential Manager first")).toBeVisible();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for a task")).not.toBeInTheDocument();
    Object.defineProperty(window, "todex", { configurable: true, value: undefined });
  });

  it("uses a transient password field for credential save, update, and clear", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ configured: true });
    const clear = vi.fn().mockResolvedValue({ configured: false });
    let configured = false;
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        model: { list: async () => [{ configId: "m1", baseUrl: "https://example.invalid/v1", model: "test-model" }], save: async () => ({ configId: "m1", baseUrl: "https://example.invalid/v1", model: "test-model" }) },
        credential: {
          status: async () => ({ configured, availability: "available" as const }),
          save: async (configId: string, apiKey: string) => { await save(configId, apiKey); configured = true; return { configured: true as const }; },
          clear: async (configId: string) => { await clear(configId); configured = false; return { configured: false as const }; },
        },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      const apiKey = await screen.findByLabelText("API Key");
      expect(apiKey).toHaveAttribute("type", "password");
      expect(apiKey).toHaveAttribute("autocomplete", "off");
      await user.type(apiKey, "secret-value");
      await user.click(screen.getByRole("button", { name: "Save API Key" }));

      expect(save).toHaveBeenCalledWith("m1", "secret-value");
      expect(apiKey).toHaveValue("");
      expect(document.body.textContent).not.toContain("secret-value");
      expect(await screen.findByText("Credential configured")).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Update API Key" }));
      const updatedApiKey = screen.getByLabelText("API Key");
      expect(updatedApiKey).toHaveValue("");
      await user.type(updatedApiKey, "replacement-value");
      await user.click(screen.getByRole("button", { name: "Save API Key" }));
      expect(save).toHaveBeenLastCalledWith("m1", "replacement-value");

      await user.click(screen.getByRole("button", { name: "Clear API Key" }));
      expect(clear).toHaveBeenCalledWith("m1");
      expect(await screen.findByLabelText("API Key")).toHaveValue("");
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("keeps credential state and shows a redacted notice when clear fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        model: { list: async () => [{ configId: "m1", baseUrl: "https://example.invalid/v1", model: "test-model" }], save: async () => ({ configId: "m1", baseUrl: "https://example.invalid/v1", model: "test-model" }) },
        credential: {
          status: async () => ({ configured: true, availability: "available" as const }),
          clear: async () => { throw new Error("secret-value credentialRef=private-ref"); },
        },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.click(await screen.findByRole("button", { name: "Clear API Key" }));

      expect(await screen.findByText("Credential clear failed; try again")).toBeVisible();
      expect(screen.getByText("Credential configured")).toBeVisible();
      expect(document.body.textContent).not.toContain("secret-value");
      expect(document.body.textContent).not.toContain("private-ref");
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("switches the live workbench copy without changing the governed bridge", async () => {
    const user = userEvent.setup();
    const setLocale = vi.fn().mockResolvedValue({ locale: "en-US" });
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [] },
        model: { list: async () => [], save: async () => ({ configId: "m1", baseUrl: "https://example.invalid/v1", model: "test-model" }) },
        credential: { status: async () => ({ configured: false, availability: "available" }) },
        settings: { getLocale: async () => ({ locale: "zh-CN" as const }), setLocale },
      },
    });

    try {
      render(<WorkbenchApp />);
      await user.click(screen.getByRole("button", { name: "English" }));

      expect(screen.getByRole("button", { name: "Chinese" })).toBeVisible();
      expect(screen.getByRole("textbox", { name: "Task or continuation" })).toBeVisible();
      expect(screen.getByText("Select a workspace and configure a model")).toBeVisible();
      expect(setLocale).toHaveBeenCalledWith("en-US");
      expect(window.todex?.run).toBeDefined();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("imports a workspace, saves a model configuration, starts a run, and decides the current approval", async () => {
    const user = userEvent.setup();
    const savedModels: Array<{ configId: string; baseUrl: string; model: string }> = [];
    const calls: { start: unknown[]; approval: unknown[] } = { start: [], approval: [] };
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        project: {
          importSelectedWorkspace: async () => ({ projectId: "p-live", displayName: "node-fixture" }),
          list: async () => [{ projectId: "p-live", displayName: "node-fixture" }],
        },
        model: {
          list: async () => savedModels,
          save: async (input: { baseUrl: string; model: string }) => {
            const saved = { configId: "m-live", baseUrl: input.baseUrl, model: input.model };
            savedModels.splice(0, savedModels.length, saved);
            return saved;
          },
        },
        command: {
          list: async () => [{ commandId: "cmd-live", purpose: "test", confirmedByUser: true }],
          confirm: async () => undefined,
          remove: async () => undefined,
        },
        credential: { status: async () => ({ configured: true, availability: "available" }) },
        run: {
          start: async (input: unknown) => {
            calls.start.push(input);
            return { run: { runId: "run-live", status: "awaiting_approval" }, trace: [{ eventId: "e1", type: "approval_requested", payloadSummary: "configured_command" }], pendingApproval: { approvalId: "approval-live" } };
          },
          snapshot: async () => undefined,
          cancel: async () => undefined,
        },
        approval: {
          decide: async (input: unknown) => {
            calls.approval.push(input);
            return { run: { runId: "run-live", status: "completed" }, trace: [] };
          },
        },
      },
    });

    render(<WorkbenchApp locale="en-US" />);
    await user.click(screen.getByRole("button", { name: "Select workspace" }));
    await user.type(screen.getByPlaceholderText("https://api.example.com/v1"), "https://example.invalid/v1");
    await user.type(screen.getByPlaceholderText("model-name"), "mock-model");
    await user.click(screen.getByRole("button", { name: "Save model configuration" }));

    await user.type(screen.getByRole("textbox", { name: "Task or continuation" }), "Repair the fixture");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(calls.start).toEqual([{
      projectId: "p-live",
      modelConfigId: "m-live",
      task: "Repair the fixture",
      verificationCommandId: "cmd-live",
    }]);
    expect(screen.getByText("approval_requested")).toBeVisible();
    expect(screen.queryByDisplayValue("secret-value")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Allow once" }));
    expect(calls.approval).toEqual([{ runId: "run-live", approvalId: "approval-live", decision: "once" }]);
    Object.defineProperty(window, "todex", { configurable: true, value: undefined });
  });

  it("offers a localized stop control only while a live run is active", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: {
          start: async () => ({ run: { runId: "run-active", status: "running" }, trace: [] }),
          snapshot: async () => undefined,
          cancel,
          subscribe: () => () => undefined,
        },
        project: {
          importSelectedWorkspace: async () => undefined,
          list: async () => [{ projectId: "p-live", displayName: "node-fixture", profile: { kinds: [], candidates: [], notices: [] } }],
        },
        model: {
          list: async () => [{ configId: "m-live", baseUrl: "https://example.invalid/v1", model: "mock-model" }],
          save: async () => ({ configId: "m-live", baseUrl: "https://example.invalid/v1", model: "mock-model" }),
        },
        credential: { status: async () => ({ configured: true, availability: "available" }), save: async () => ({ configured: true }) },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.type(screen.getByRole("textbox", { name: "Task or continuation" }), "Inspect the fixture");
      await user.click(screen.getByRole("button", { name: "Run" }));

      await user.click(screen.getByRole("button", { name: "Stop run" }));
      expect(cancel).toHaveBeenCalledWith("run-active");
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("renders terminal live run status with localized text and its real visual phase", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => ({ run: { runId: "run-complete", status: "completed" }, trace: [] }), snapshot: async () => undefined, cancel: async () => undefined, subscribe: () => () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p-live", displayName: "node-fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        model: { list: async () => [{ configId: "m-live", baseUrl: "https://example.invalid/v1", model: "mock-model" }], save: async () => ({ configId: "m-live", baseUrl: "https://example.invalid/v1", model: "mock-model" }) },
        credential: { status: async () => ({ configured: true, availability: "available" }), save: async () => ({ configured: true }) },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.type(screen.getByRole("textbox", { name: "Task or continuation" }), "Inspect the fixture");
      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(screen.getByText("Completed")).toBeVisible();
      expect(document.querySelector(".phase-completed")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Stop run" })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("confirms a detector candidate by id without exposing a working directory", async () => {
    const user = userEvent.setup();
    const confirmations: Array<[string, string]> = [];
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        project: {
          importSelectedWorkspace: async () => ({
            projectId: "p-candidate",
            displayName: "node-fixture",
            profile: { kinds: ["node"], candidates: [{ candidateId: "node.test", purpose: "test", argv: ["pnpm", "test"], workingDirectory: ".", timeoutMs: 120000, confirmedByUser: false, reason: "package.json script: test" }], notices: [] },
          }),
          list: async () => [],
        },
        model: { list: async () => [], save: async () => undefined },
        credential: { status: async () => ({ configured: false, availability: "available" }), save: async () => ({ configured: true }) },
        command: {
          list: async () => [],
          confirm: async (projectId: string, candidateId: string) => { confirmations.push([projectId, candidateId]); return undefined; },
          remove: async () => undefined,
        },
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.click(screen.getByRole("button", { name: "Select workspace" }));
      await user.click(screen.getByRole("button", { name: "Confirm candidate command" }));

      expect(confirmations).toEqual([["p-candidate", "node.test"]]);
      expect(screen.queryByText(/C:\\|Users|workspaceRoot/i)).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
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
