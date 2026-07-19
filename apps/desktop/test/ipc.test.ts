import { describe, expect, it } from "vitest";

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
