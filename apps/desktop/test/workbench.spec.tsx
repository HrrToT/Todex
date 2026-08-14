import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchApp } from "../src/renderer/App.js";
import { preloadApprovalBridge, resolveWorkbenchMode } from "../src/renderer/bridge.js";

describe("Codex-style workbench", () => {
  it("adapts the T-009 lowercase preload approval surface", () => {
    const approval = { decide: async () => undefined };
    Object.defineProperty(window, "todex", { configurable: true, value: { approval } });

    expect(preloadApprovalBridge()).toBe(approval);
  });

  it("does not silently render the Demo workbench when Electron loses the run bridge", () => {
    const originalUserAgent = window.navigator.userAgent;
    Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: "Electron/36.0 Todex" });

    try {
      expect(resolveWorkbenchMode(undefined, window.navigator.userAgent)).toBe("diagnostic");
      render(<WorkbenchApp locale="en-US" />);

      expect(screen.getByTestId("desktop-bridge-unavailable")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent("Desktop service unavailable");
      expect(screen.queryByText("calculator-lab")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: originalUserAgent });
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
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

  it("ignores a stale credential status after switching models", async () => {
    const user = userEvent.setup();
    let resolveFirstStatus!: (value: { configured: boolean; availability: "available" }) => void;
    const firstStatus = new Promise<{ configured: boolean; availability: "available" }>((resolve) => {
      resolveFirstStatus = resolve;
    });
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        model: {
          list: async () => [
            { configId: "m1", baseUrl: "https://example.invalid/v1", model: "configured-model" },
            { configId: "m2", baseUrl: "https://example.invalid/v1", model: "unconfigured-model" },
          ],
          save: async () => ({ configId: "m1", baseUrl: "https://example.invalid/v1", model: "configured-model" }),
        },
        credential: {
          status: async (configId: string) => configId === "m1"
            ? firstStatus
            : { configured: false, availability: "available" as const },
        },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.click(await screen.findByRole("button", { name: "unconfigured-model" }));
      expect(await screen.findByLabelText("API Key")).toBeVisible();

      resolveFirstStatus({ configured: true, availability: "available" });

      await waitFor(() => expect(screen.getByLabelText("API Key")).toBeVisible());
      expect(screen.queryByText("Credential configured")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("ignores a stale credential save after switching models", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: { configured: true }) => void;
    const saving = new Promise<{ configured: true }>((resolve) => { resolveSave = resolve; });
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        model: {
          list: async () => [
            { configId: "m1", baseUrl: "https://example.invalid/v1", model: "first-model" },
            { configId: "m2", baseUrl: "https://example.invalid/v1", model: "second-model" },
          ],
          save: async () => undefined,
        },
        credential: {
          status: async () => ({ configured: false, availability: "available" as const }),
          save: async () => saving,
        },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.type(await screen.findByLabelText("API Key"), "secret-value");
      await user.click(screen.getByRole("button", { name: "Save API Key" }));
      await user.click(screen.getByRole("button", { name: "second-model" }));
      expect(await screen.findByLabelText("API Key")).toBeVisible();

      await act(async () => {
        resolveSave({ configured: true });
        await saving;
      });

      await waitFor(() => expect(screen.getByLabelText("API Key")).toBeVisible());
      expect(screen.queryByText("Credential configured")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("ignores a stale credential clear after switching models", async () => {
    const user = userEvent.setup();
    let resolveClear!: (value: { configured: false }) => void;
    const clearing = new Promise<{ configured: false }>((resolve) => { resolveClear = resolve; });
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        model: {
          list: async () => [
            { configId: "m1", baseUrl: "https://example.invalid/v1", model: "configured-model" },
            { configId: "m2", baseUrl: "https://example.invalid/v1", model: "second-model" },
          ],
          save: async () => undefined,
        },
        credential: {
          status: async () => ({ configured: true, availability: "available" as const }),
          clear: async () => clearing,
        },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await user.click(await screen.findByRole("button", { name: "Clear API Key" }));
      await user.click(screen.getByRole("button", { name: "second-model" }));
      expect(await screen.findByText("Credential configured")).toBeVisible();

      await act(async () => {
        resolveClear({ configured: false });
        await clearing;
      });

      await waitFor(() => expect(screen.getByText("Credential configured")).toBeVisible());
      expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("ignores a stale project model list after switching projects", async () => {
    const user = userEvent.setup();
    const oldModel = { configId: "old-model", baseUrl: "https://example.invalid/v1", model: "old-configured-model" };
    const currentModel = { configId: "current-model", baseUrl: "https://example.invalid/v1", model: "current-unconfigured-model" };
    let resolveOldModels!: (value: typeof oldModel[]) => void;
    const oldModels = new Promise<typeof oldModel[]>((resolve) => { resolveOldModels = resolve; });
    const listModels = vi.fn(async (projectId: string) => projectId === "project-a" ? oldModels : [currentModel]);
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: {
          importSelectedWorkspace: async () => undefined,
          list: async () => [
            { projectId: "project-a", displayName: "project-a", profile: { kinds: [], candidates: [], notices: [] } },
            { projectId: "project-b", displayName: "project-b", profile: { kinds: [], candidates: [], notices: [] } },
          ],
        },
        command: { list: async () => [] },
        model: { list: listModels, save: async () => currentModel },
        credential: {
          status: async (configId: string) => ({ configured: configId === "old-model", availability: "available" as const }),
        },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await waitFor(() => expect(listModels).toHaveBeenCalledWith("project-a"));
      await user.click(screen.getByRole("button", { name: "project-b" }));
      expect(await screen.findByLabelText("API Key")).toBeVisible();
      expect(screen.getByRole("button", { name: "current-unconfigured-model" })).toBeVisible();

      resolveOldModels([oldModel]);

      await waitFor(() => expect(screen.getByLabelText("API Key")).toBeVisible());
      expect(screen.queryByText("Credential configured")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "old-configured-model" })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("ignores a stale model save after switching projects", async () => {
    const user = userEvent.setup();
    const projectA = { projectId: "project-a", displayName: "project-a", profile: { kinds: [], candidates: [], notices: [] } };
    const projectB = { projectId: "project-b", displayName: "project-b", profile: { kinds: [], candidates: [], notices: [] } };
    let resolveSave!: (value: { configId: string; baseUrl: string; model: string }) => void;
    const saving = new Promise<{ configId: string; baseUrl: string; model: string }>((resolve) => { resolveSave = resolve; });
    const save = vi.fn(() => saving);
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [projectA, projectB] },
        command: { list: async () => [] },
        model: {
          list: async (projectId: string) => projectId === "project-a"
            ? [{ configId: "a-model", baseUrl: "https://a.example.invalid/v1", model: "a-model" }]
            : [{ configId: "b-model", baseUrl: "https://b.example.invalid/v1", model: "b-model" }],
          save,
        },
        credential: { status: async () => ({ configured: false, availability: "available" as const }) },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await screen.findByRole("button", { name: "a-model" });
      await user.click(screen.getByRole("button", { name: "Save model configuration" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole("button", { name: "project-b" }));
      expect(await screen.findByRole("heading", { name: "project-b" })).toBeVisible();

      await act(async () => {
        resolveSave({ configId: "saved-a-model", baseUrl: "https://a.example.invalid/v1", model: "saved-a-model" });
        await saving;
      });

      await waitFor(() => expect(screen.getByRole("heading", { name: "project-b" })).toBeVisible());
      expect(screen.queryByRole("button", { name: "saved-a-model" })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("ignores a stale model save after selecting a different model", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: { configId: string; baseUrl: string; model: string }) => void;
    const saving = new Promise<{ configId: string; baseUrl: string; model: string }>((resolve) => { resolveSave = resolve; });
    const save = vi.fn(() => saving);
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        command: { list: async () => [] },
        model: {
          list: async () => [
            { configId: "m1", baseUrl: "https://example.invalid/v1", model: "first-model" },
            { configId: "m2", baseUrl: "https://example.invalid/v1", model: "second-model" },
          ],
          save,
        },
        credential: { status: async () => ({ configured: false, availability: "available" as const }) },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await screen.findByRole("button", { name: "first-model" });
      await user.click(screen.getByRole("button", { name: "Save model configuration" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole("button", { name: "second-model" }));
      expect(screen.getByLabelText("Model")).toHaveValue("second-model");

      await act(async () => {
        resolveSave({ configId: "saved-first", baseUrl: "https://example.invalid/v1", model: "saved-first" });
        await saving;
      });

      await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("second-model"));
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("absorbs a stale model save rejection after selecting a different model", async () => {
    const user = userEvent.setup();
    let rejectSave!: (reason: Error) => void;
    const saving = new Promise<{ configId: string; baseUrl: string; model: string }>((_resolve, reject) => { rejectSave = reject; });
    const save = vi.fn(() => saving);
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        command: { list: async () => [] },
        model: {
          list: async () => [
            { configId: "m1", baseUrl: "https://example.invalid/v1", model: "first-model" },
            { configId: "m2", baseUrl: "https://example.invalid/v1", model: "second-model" },
          ],
          save,
        },
        credential: { status: async () => ({ configured: false, availability: "available" as const }) },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await screen.findByRole("button", { name: "first-model" });
      await user.click(screen.getByRole("button", { name: "Save model configuration" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole("button", { name: "second-model" }));

      await act(async () => {
        rejectSave(new Error("provider unavailable"));
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("second-model"));
      expect(screen.queryByText("Model configuration save failed; try again")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "todex", { configurable: true, value: undefined });
    }
  });

  it("shows a fixed model-save failure notice without error details", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "todex", {
      configurable: true,
      value: {
        run: { start: async () => undefined, snapshot: async () => undefined, cancel: async () => undefined },
        project: { importSelectedWorkspace: async () => undefined, list: async () => [{ projectId: "p1", displayName: "fixture", profile: { kinds: [], candidates: [], notices: [] } }] },
        command: { list: async () => [] },
        model: {
          list: async () => [{ configId: "m1", baseUrl: "https://example.invalid/v1", model: "first-model" }],
          save: async () => { throw new Error("secret-value provider unavailable"); },
        },
        credential: { status: async () => ({ configured: false, availability: "available" as const }) },
      },
    });

    try {
      render(<WorkbenchApp locale="en-US" />);
      await screen.findByRole("button", { name: "first-model" });
      await user.click(screen.getByRole("button", { name: "Save model configuration" }));
      expect(await screen.findByText("Model configuration save failed; try again")).toBeVisible();
      expect(screen.queryByText("secret-value provider unavailable")).not.toBeInTheDocument();
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
