import { describe, expect, it, vi } from "vitest";

import { TODexIpcChannels, registerTodexIpc } from "../src/main/ipc.js";
import { createDesktopWindow } from "../src/main/index.js";
import type { DesktopRunService } from "../src/main/desktop-run-service.js";

type Handler = (event: unknown, input: unknown) => unknown;

class FakeIpcMain {
  readonly handlers = new Map<string, Handler>();

  handle(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }
}

class FakeBrowserWindow {
  static latestOptions: Record<string, unknown> | undefined;
  readonly loadURL = vi.fn(() => Promise.resolve());
  readonly webContents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  constructor(options: Record<string, unknown>) {
    FakeBrowserWindow.latestOptions = options;
  }

}

const EXPECTED_CHANNELS = [
  "workspace.choose",
  "project.list",
  "project.get",
  "project.save",
  "project.delete",
  "command.list",
  "command.confirm",
  "command.remove",
  "run.list",
  "run.start",
  "run.get",
  "run.snapshot",
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
    expect(ipcMain.handlers.has("project.selectWorkspace")).toBe(false);
  });

  it("exposes workspace selection but no renderer-supplied filesystem operation", () => {
    const ipcMain = new FakeIpcMain();
    const selector = { choose: vi.fn().mockResolvedValue({ workspaceRoot: "C:\\fixtures\\node", displayName: "node" }) };

    registerTodexIpc(ipcMain, {} as never, selector);

    expect(ipcMain.handlers.has("workspace.choose")).toBe(true);
    expect(ipcMain.handlers.has("filesystem.read")).toBe(false);
    expect(ipcMain.handlers.has("filesystem.write")).toBe(false);
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

  it("exposes only high-level run intent to the main-process service", async () => {
    const ipcMain = new FakeIpcMain();
    const service = {
      start: vi.fn().mockResolvedValue({ run: { runId: "run-1" }, trace: [], results: [] }),
      snapshot: vi.fn().mockReturnValue(undefined),
      cancel: vi.fn(),
      decideApproval: vi.fn(),
    } as unknown as DesktopRunService;
    const host = { store: { listProjects: vi.fn(), getProject: vi.fn(), listCommands: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(), listPendingApprovals: vi.fn(), listMemories: vi.fn() } };
    registerTodexIpc(ipcMain, host as never, undefined, service);

    await expect(
      ipcMain.handlers.get("run.start")?.({}, { projectId: "p1", task: "修复测试", modelConfigId: "m1" }),
    ).resolves.toMatchObject({ run: { runId: "run-1" } });
    expect(service.start).toHaveBeenCalledWith({ projectId: "p1", task: "修复测试", modelConfigId: "m1" });
    await expect(
      ipcMain.handlers.get("run.start")?.({}, { projectId: "p1", task: "x", modelConfigId: "m1", workspaceRoot: "C:\\outside" }),
    ).rejects.toThrow("invalid_ipc_input");
  });

  it("creates a sandboxed browser window that denies navigation and new windows", () => {
    const window = createDesktopWindow(FakeBrowserWindow);
    const fakeWindow = window as FakeBrowserWindow;

    expect(FakeBrowserWindow.latestOptions).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    expect(fakeWindow.webContents.setWindowOpenHandler).toHaveBeenCalledOnce();
    const openHandler = fakeWindow.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as () => unknown;
    expect(openHandler()).toEqual({ action: "deny" });
    expect(fakeWindow.webContents.on).toHaveBeenCalledWith("will-navigate", expect.any(Function));
    const navigationHandler = fakeWindow.webContents.on.mock.calls[0]?.[1] as (event: { preventDefault(): void }) => void;
    const event = { preventDefault: vi.fn() };
    navigationHandler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("loads the packaged renderer document instead of an empty data page", () => {
    const window = createDesktopWindow(FakeBrowserWindow);
    const fakeWindow = window as FakeBrowserWindow;

    expect(fakeWindow.loadURL).toHaveBeenCalledWith(
      expect.stringMatching(/^file:.*renderer[\\/]index\.html$/),
    );
    expect(fakeWindow.loadURL).not.toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/));
  });
});
