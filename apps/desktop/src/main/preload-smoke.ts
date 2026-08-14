import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";

app.disableHardwareAcceleration();

async function smoke(): Promise<void> {
  await app.whenReady();
  ipcMain.handle("project.list", () => []);
  ipcMain.handle("settings.getLocale", () => ({ locale: "zh-CN" }));
  const preloadPath = process.env.TODEX_PRELOAD_PATH
    ?? fileURLToPath(new URL("./preload.cjs", import.meta.url));
  const rendererUrl = process.env.TODEX_RENDERER_URL
    ?? new URL("../renderer/index.html", import.meta.url).href;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  try {
    await window.loadURL(rendererUrl);
    const exposed = await window.webContents.executeJavaScript(
      "typeof window.todex?.run?.start === 'function'",
    );
    if (exposed !== true) throw new Error("desktop preload bridge not exposed");
  } finally {
    window.destroy();
    ipcMain.removeHandler("project.list");
    ipcMain.removeHandler("settings.getLocale");
    app.quit();
  }
}

void smoke().catch(() => {
  process.exitCode = 1;
  app.quit();
});
