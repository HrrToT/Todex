import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ipcMain } from "electron";

async function smoke(): Promise<void> {
  process.env.TODEX_START_MAIN = "0";
  const { KeytarCredentialAdapter } = await import("./credential-store.js");
  const { registerTodexIpc } = await import("./ipc.js");
  const { WorkspaceHost } = await import("./workspace-host.js");
  const userDataPath = mkdtempSync(join(tmpdir(), "todex-electron-smoke-"));

  try {
    const host = await WorkspaceHost.open({
      userDataPath,
      credentialAdapter: new KeytarCredentialAdapter(),
    });
    registerTodexIpc(ipcMain, host);
    host.close();
  } finally {
    rmSync(userDataPath, { force: true, recursive: true });
  }
}

void smoke().catch(() => {
  process.exitCode = 1;
});
