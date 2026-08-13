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
  "project.importSelectedWorkspace",
  "project.list",
  "project.get",
  "project.delete",
  "model.list",
  "model.save",
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
  "settings.getLocale",
  "settings.setLocale",
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
    expect(ipcMain.handlers.has("project.save")).toBe(false);
  });

  it("exposes workspace selection but no renderer-supplied filesystem operation", () => {
    const ipcMain = new FakeIpcMain();
    const selector = { choose: vi.fn().mockResolvedValue({ workspaceRoot: "C:\\fixtures\\node", displayName: "node" }) };

    registerTodexIpc(ipcMain, {} as never, selector);

    expect(ipcMain.handlers.has("workspace.choose")).toBe(true);
    expect(ipcMain.handlers.has("filesystem.read")).toBe(false);
    expect(ipcMain.handlers.has("filesystem.write")).toBe(false);
  });

  it("projects native workspace selection without returning its absolute path", async () => {
    const ipcMain = new FakeIpcMain();
    const selector = { choose: vi.fn().mockResolvedValue({ workspaceRoot: "C:\\Users\\Lenovo\\private-repo", displayName: "private-repo" }) };
    registerTodexIpc(ipcMain, {} as never, selector);

    const selected = await ipcMain.handlers.get("workspace.choose")?.({}, {});

    expect(selected).toEqual({ displayName: "private-repo" });
    expect(JSON.stringify(selected)).not.toContain("C:\\Users\\Lenovo");
  });

  it("projects imported projects without a local workspace path while retaining command candidates", async () => {
    const ipcMain = new FakeIpcMain();
    const host = {
      store: {
        saveProject: vi.fn((project) => project),
        listProjects: vi.fn(() => [{
          projectId: "p1",
          workspaceRoot: "C:\\Users\\Lenovo\\private-repo",
          displayName: "private-repo",
          profileJson: JSON.stringify({
            kinds: ["node"],
            candidates: [{ candidateId: "node.test", purpose: "test", argv: ["pnpm", "test"], workingDirectory: ".", timeoutMs: 120000, confirmedByUser: false, reason: "package.json script: test" }],
            notices: [],
          }),
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
        }]),
        getProject: vi.fn(),
      },
    };
    registerTodexIpc(ipcMain, host as never);

    const projects = await ipcMain.handlers.get("project.list")?.({}, {});
    expect(projects).toEqual([{
      projectId: "p1",
      displayName: "private-repo",
      profile: expect.objectContaining({ candidates: [expect.objectContaining({ candidateId: "node.test", argv: ["pnpm", "test"] })] }),
    }]);
    expect(JSON.stringify(projects)).not.toContain("C:\\Users\\Lenovo");
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

  it("persists only the supported locale through intention-level settings IPC", async () => {
    const ipcMain = new FakeIpcMain();
    const host = {
      store: {
        getLocale: vi.fn(() => "zh-CN"),
        setLocale: vi.fn((locale: string) => locale),
      },
    };
    registerTodexIpc(ipcMain, host as never);

    await expect(ipcMain.handlers.get("settings.getLocale")?.({}, {})).resolves.toEqual({ locale: "zh-CN" });
    await expect(ipcMain.handlers.get("settings.setLocale")?.({}, { locale: "en-US" })).resolves.toEqual({ locale: "en-US" });
    await expect(ipcMain.handlers.get("settings.setLocale")?.({}, { locale: "fr-FR" })).rejects.toThrow("invalid_ipc_input");
    await expect(ipcMain.handlers.get("settings.setLocale")?.({}, { locale: "zh-CN", key: "arbitrary" })).rejects.toThrow("invalid_ipc_input");

    expect(host.store.setLocale).toHaveBeenCalledWith("en-US");
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

  it("returns a redacted run projection instead of the original task text", async () => {
    const ipcMain = new FakeIpcMain();
    const service = {
      start: vi.fn().mockResolvedValue({
        run: { runId: "run-1", projectId: "p1", taskText: "API_KEY=secret-value", status: "running", startedAt: "2026-08-13T00:00:00.000Z", repairAttempts: 0 },
        trace: [], results: [],
      }),
      snapshot: vi.fn(), cancel: vi.fn(), decideApproval: vi.fn(),
    } as unknown as DesktopRunService;
    const host = { store: { listProjects: vi.fn(), getProject: vi.fn(), listCommands: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(), listPendingApprovals: vi.fn(), listMemories: vi.fn() } };
    registerTodexIpc(ipcMain, host as never, undefined, service);

    const snapshot = await ipcMain.handlers.get("run.start")?.({}, { projectId: "p1", task: "API_KEY=secret-value", modelConfigId: "m1" });

    expect(snapshot).toMatchObject({ run: { runId: "run-1", status: "running" }, trace: [], results: [] });
    expect(JSON.stringify(snapshot)).not.toContain("secret-value");
    expect(JSON.stringify(snapshot)).not.toContain("taskText");
  });

  it("keeps task text and credential references out of all renderer query projections", async () => {
    const ipcMain = new FakeIpcMain();
    const rawRun = { runId: "run-1", projectId: "p1", taskText: "API_KEY=secret-value", status: "completed", startedAt: "2026-08-13T00:00:00.000Z", repairAttempts: 0 };
    const rawModel = { configId: "m1", projectId: "p1", baseUrl: "https://models.example.invalid/v1", model: "model", parametersJson: "{}", credentialRef: "credential-private-ref", createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" };
    const host = {
      store: {
        listRuns: vi.fn(() => [rawRun]), getRun: vi.fn(() => rawRun),
        listModelConfigs: vi.fn(() => [rawModel]), saveModelConfig: vi.fn(() => rawModel),
      },
    };
    registerTodexIpc(ipcMain, host as never);

    const values = await Promise.all([
      ipcMain.handlers.get("run.list")?.({}, { projectId: "p1" }),
      ipcMain.handlers.get("run.get")?.({}, { runId: "run-1" }),
      ipcMain.handlers.get("model.list")?.({}, { projectId: "p1" }),
    ]);

    expect(JSON.stringify(values)).not.toContain("secret-value");
    expect(JSON.stringify(values)).not.toContain("taskText");
    expect(JSON.stringify(values)).not.toContain("credential-private-ref");
    expect(JSON.stringify(values)).not.toContain("credentialRef");
  });

  it("confirms only a persisted detector candidate instead of renderer-supplied argv", async () => {
    const ipcMain = new FakeIpcMain();
    const savedCommands: unknown[] = [];
    const host = {
      store: {
        getProject: vi.fn().mockReturnValue({
          projectId: "p1",
          workspaceRoot: "C:\\fixtures\\node",
          profileJson: JSON.stringify({
            kinds: ["node"],
            candidates: [{
              candidateId: "node.test",
              purpose: "test",
              argv: ["pnpm", "test"],
              workingDirectory: ".",
              timeoutMs: 120000,
              confirmedByUser: false,
              reason: "package.json script: test",
            }],
            notices: [],
          }),
        }),
        saveCommand: vi.fn((command) => { savedCommands.push(command); return command; }),
      },
    };
    registerTodexIpc(ipcMain, host as never);

    await expect(
      ipcMain.handlers.get("command.confirm")?.({}, { projectId: "p1", candidateId: "node.test" }),
    ).resolves.toMatchObject({
      projectId: "p1",
      purpose: "test",
      argv: ["pnpm", "test"],
      workingDirectory: "C:\\fixtures\\node",
      confirmedByUser: true,
    });
    await expect(
      ipcMain.handlers.get("command.confirm")?.({}, {
        projectId: "p1",
        commandId: "evil",
        purpose: "test",
        argv: ["powershell", "-Command", "Remove-Item", "C:\\"],
        workingDirectory: "C:\\",
        timeoutMs: 1,
        confirmedByUser: false,
      }),
    ).rejects.toThrow("invalid_ipc_input");

    expect(savedCommands).toEqual([expect.objectContaining({
      commandId: "p1:node.test",
      argv: ["pnpm", "test"],
      workingDirectory: "C:\\fixtures\\node",
    })]);
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
