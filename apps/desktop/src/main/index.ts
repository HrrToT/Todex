import { fileURLToPath } from "node:url";

import { KeytarCredentialAdapter } from "./credential-store.js";
import { registerTodexIpc } from "./ipc.js";
import { WorkspaceHost } from "./workspace-host.js";

export const DESKTOP_HOST_VERSION = "0.1.0";

export interface BrowserWindowLike {
  loadURL(url: string): Promise<void> | void;
}

export interface BrowserWindowConstructor {
  new (options: Record<string, unknown>): BrowserWindowLike;
}

export function createDesktopWindow(
  BrowserWindow: BrowserWindowConstructor,
  preloadPath = fileURLToPath(new URL("./preload.js", import.meta.url)),
): BrowserWindowLike {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  void window.loadURL("data:text/html,<main></main>");
  return window;
}

export async function startDesktopHost(): Promise<void> {
  const electron = await import("electron");
  await electron.app.whenReady();
  const host = await WorkspaceHost.open({
    userDataPath: electron.app.getPath("userData"),
    credentialAdapter: new KeytarCredentialAdapter(),
  });
  registerTodexIpc(electron.ipcMain, host);
  createDesktopWindow(electron.BrowserWindow);
}

if (process.versions.electron && process.env.TODEX_START_MAIN !== "0") {
  void startDesktopHost();
}
