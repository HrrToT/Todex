import { describe, expect, it, vi } from "vitest";

import { TODexIpcChannels, registerTodexIpc } from "../src/main/ipc.js";
import { createDesktopWindow } from "../src/main/index.js";

type Handler = (event: unknown, input: unknown) => unknown;

class FakeIpcMain {
  readonly handlers = new Map<string, Handler>();

  handle(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }
}

class FakeBrowserWindow {
  static latestOptions: Record<string, unknown> | undefined;

  constructor(options: Record<string, unknown>) {
    FakeBrowserWindow.latestOptions = options;
  }

  loadURL(): Promise<void> {
    return Promise.resolve();
  }
}

const EXPECTED_CHANNELS = [
  "project.selectWorkspace",
  "project.list",
  "project.get",
  "project.save",
  "project.delete",
  "command.list",
  "command.confirm",
  "command.remove",
  "run.list",
  "run.get",
  "run.cancel",
  "approval.listPending",
  "approval.decide",
  "memory.list",
  "memory.save",
  "memory.delete",
  "credential.status",
  "credential.save",
  "credential.clear",
];

describe("desktop IPC", () => {
  it("registers exactly the frozen intention-level channel allowlist", () => {
    const ipcMain = new FakeIpcMain();

    registerTodexIpc(ipcMain, {} as never);

    expect(TODexIpcChannels).toEqual(EXPECTED_CHANNELS);
    expect([...ipcMain.handlers.keys()].sort()).toEqual([...EXPECTED_CHANNELS].sort());
    expect(ipcMain.handlers.has("credential.read")).toBe(false);
    expect(ipcMain.handlers.has("sql.execute")).toBe(false);
    expect(ipcMain.handlers.has("filesystem.read")).toBe(false);
  });

  it("rejects invalid channel input with a stable redacted error", async () => {
    const ipcMain = new FakeIpcMain();
    registerTodexIpc(ipcMain, {} as never);

    await expect(ipcMain.handlers.get("project.get")?.({}, { projectId: 42 })).rejects.toThrow(
      "invalid_ipc_input",
    );
    await expect(ipcMain.handlers.get("credential.status")?.({}, {})).rejects.toThrow(
      "invalid_ipc_input",
    );
  });

  it("scopes credential IPC to a model config and returns redacted lifecycle DTOs", async () => {
    const ipcMain = new FakeIpcMain();
    const host = {
      credentialStatus: vi.fn().mockResolvedValue({ configured: true, availability: "available" }),
      saveCredential: vi.fn().mockResolvedValue({ configured: true }),
      clearCredential: vi.fn().mockResolvedValue({ configured: false }),
    };
    registerTodexIpc(ipcMain, host as never);

    await expect(ipcMain.handlers.get("credential.status")?.({}, { configId: "config-1" })).resolves.toEqual(
      { configured: true, availability: "available" },
    );
    await expect(
      ipcMain.handlers.get("credential.save")?.({}, { configId: "config-1", apiKey: "secret-value" }),
    ).resolves.toEqual({ configured: true });
    await expect(ipcMain.handlers.get("credential.clear")?.({}, { configId: "config-1" })).resolves.toEqual({
      configured: false,
    });

    expect(host.credentialStatus).toHaveBeenCalledWith("config-1");
    expect(host.saveCredential).toHaveBeenCalledWith("config-1", "secret-value");
    expect(host.clearCredential).toHaveBeenCalledWith("config-1");
    expect(
      JSON.stringify(await ipcMain.handlers.get("credential.save")?.({}, { configId: "config-1", apiKey: "secret-value" })),
    ).not.toContain("secret-value");
  });

  it("creates a browser window without renderer Node access", () => {
    createDesktopWindow(FakeBrowserWindow);

    expect(FakeBrowserWindow.latestOptions).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  });
});
