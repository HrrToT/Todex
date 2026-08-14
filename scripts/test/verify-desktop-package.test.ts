import { createPackage } from "@electron/asar";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyDesktopPackage } from "../verify-desktop-package.js";

async function makeArchive(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "todex-desktop-package-"));
  const source = join(directory, "source");
  const archivePath = join(directory, "app.asar");

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(source, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }

  await createPackage(source, archivePath);
  return archivePath;
}

const rendererDocument = '<!doctype html><script type="module" src="/assets/index-live.js"></script>';
const liveRendererBundle = '<main data-todex-surface="live-workbench"></main>';
const livePreloadBundle = [
  "const { contextBridge, ipcRenderer } = require('electron');",
  "const invoke = (channel, input) => ipcRenderer.invoke(channel, input);",
  "contextBridge.exposeInMainWorld('todex', {",
  "  run: {",
  "    start: (input) => invoke('run.start', input),",
  "    snapshot: (runId) => invoke('run.snapshot', { runId }),",
  "    cancel: (runId) => invoke('run.cancel', { runId }),",
  "    subscribe: (runId) => invoke('run.subscribe', { runId }),",
  "  },",
  "});",
].join("\n");

function completeArchiveFiles(): Record<string, string> {
  return {
    "dist/main/preload.cjs": livePreloadBundle,
    "dist/main/desktop-run-service.js": "export class DesktopRunService {}",
    "dist/renderer/index.html": rendererDocument,
    "dist/renderer/assets/index-live.js": liveRendererBundle,
  };
}

describe("verifyDesktopPackage", () => {
  it("reports fixed failed checks for an incomplete archive fixture", async () => {
    const files = completeArchiveFiles();
    delete files["dist/main/preload.cjs"];
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "main-preload", passed: false });
    expect(result.checks).toContainEqual({ name: "preload-run-bridge", passed: false });
  });

  it("accepts an archive containing the bounded live desktop surface", async () => {
    const archivePath = await makeArchive(completeArchiveFiles());

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(true);
    expect(result.checks).toEqual([
      { name: "main-preload", passed: true },
      { name: "main-run-service", passed: true },
      { name: "renderer-document", passed: true },
      { name: "renderer-live-workbench", passed: true },
      { name: "preload-run-bridge", passed: true },
    ]);
  });

  it("rejects a renderer archive without the live workbench marker", async () => {
    const files = completeArchiveFiles();
    files["dist/renderer/assets/index-live.js"] = "demo-only-renderer";
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "renderer-live-workbench", passed: false });
  });

  it("does not inspect renderer script paths outside the packaged renderer assets directory", async () => {
    const files = completeArchiveFiles();
    files["dist/renderer/index.html"] = '<!doctype html><script type="module" src="../main/desktop-run-service.js"></script>';
    files["dist/main/desktop-run-service.js"] = '<main data-todex-surface="live-workbench"></main>';
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "renderer-live-workbench", passed: false });
  });

  it("rejects a lookalike preload whose run bridge is exposed under another global", async () => {
    const files = completeArchiveFiles();
    files["dist/main/preload.cjs"] = [
      "contextBridge.exposeInMainWorld('other', {",
      "  run: {",
      "    start: () => invoke('run.start', {}),",
      "    cancel: () => invoke('run.cancel', {}),",
      "    subscribe: () => invoke('run.subscribe', {}),",
      "  },",
      "});",
    ].join("\n");
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "preload-run-bridge", passed: false });
  });

  it("rejects a todex run object when matching IPC strings are not invoked by its methods", async () => {
    const files = completeArchiveFiles();
    files["dist/main/preload.cjs"] = [
      "const note = \"invoke('run.start') invoke('run.cancel') invoke('run.subscribe')\";",
      "contextBridge.exposeInMainWorld('todex', {",
      "  run: {",
      "    start: () => undefined,",
      "    cancel: () => undefined,",
      "    subscribe: () => undefined,",
      "  },",
      "});",
    ].join("\n");
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "preload-run-bridge", passed: false });
  });

  it("rejects a bridge when invoke is not the helper bound to ipcRenderer.invoke", async () => {
    const files = completeArchiveFiles();
    files["dist/main/preload.cjs"] = [
      "const other = () => ipcRenderer.invoke('run.start', {});",
      "contextBridge.exposeInMainWorld('todex', {",
      "  run: {",
      "    start: () => invoke('run.start', {}),",
      "    cancel: () => invoke('run.cancel', {}),",
      "    subscribe: () => invoke('run.subscribe', {}),",
      "  },",
      "});",
    ].join("\n");
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "preload-run-bridge", passed: false });
  });

  it("rejects a renderer bundle with separated live workbench marker words", async () => {
    const files = completeArchiveFiles();
    files["dist/renderer/assets/index-live.js"] = 'const label = "data-todex-surface"; const note = "live-workbench";';
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "renderer-live-workbench", passed: false });
  });

  it("requires fixed run IPC channels instead of accepting lookalike method names", async () => {
    const files = completeArchiveFiles();
    files["dist/main/preload.cjs"] = "contextBridge.exposeInMainWorld('todex', { run: { start: () => undefined, cancel: () => undefined, subscribe: () => undefined } });";
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "preload-run-bridge", passed: false });
  });

  it("rejects an ESM preload even when it exposes the required bridge", async () => {
    const files = completeArchiveFiles();
    files["dist/main/preload.cjs"] = [
      "import { contextBridge, ipcRenderer } from 'electron';",
      livePreloadBundle,
    ].join("\n");
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "preload-run-bridge", passed: false });
  });

  it("rejects an archive that retains the legacy ESM preload artifact", async () => {
    const files = completeArchiveFiles();
    files["dist/main/preload.js"] = "import { contextBridge } from 'electron';";
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "main-preload", passed: false });
  });

  it("returns only fixed identifiers and booleans when a packaged file contains sensitive-looking text", async () => {
    const files = completeArchiveFiles();
    files["dist/main/desktop-run-service.js"] = "const token = 'secret-value'; const path = 'C:\\\\Users\\\\Lenovo';";
    const archivePath = await makeArchive(files);

    const result = await verifyDesktopPackage({ archivePath });

    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("Users\\\\Lenovo");
  });
});
