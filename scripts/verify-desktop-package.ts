import { extractFile, listPackage } from "@electron/asar";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

export type DesktopPackageCheckName =
  | "main-preload"
  | "main-run-service"
  | "renderer-document"
  | "renderer-live-workbench"
  | "preload-run-bridge";

export type DesktopPackageCheck = Readonly<{
  name: DesktopPackageCheckName;
  passed: boolean;
}>;

export type DesktopPackageVerification = Readonly<{
  allPassed: boolean;
  checks: readonly DesktopPackageCheck[];
}>;

export type VerifyDesktopPackageOptions = Readonly<{
  archivePath: string;
}>;

export const DEFAULT_DESKTOP_PACKAGE_ARCHIVE = "apps/desktop/release/win-unpacked/resources/app.asar";

const PRELOAD_PATH = "dist/main/preload.js";
const RUN_SERVICE_PATH = "dist/main/desktop-run-service.js";
const RENDERER_DOCUMENT_PATH = "dist/renderer/index.html";
const RENDERER_ASSET_PATH = "dist/renderer/assets/";

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function archiveReadPath(value: string): string {
  return value.replace(/^[\\/]+/, "");
}

function rendererBundlePath(document: string, entries: ReadonlyMap<string, string>): string | undefined {
  const source = /<script[^>]+src=["']([^"']+\.js)["']/i.exec(document)?.[1];
  if (!source) return undefined;
  const assetPrefix = source.startsWith("./assets/")
    ? "./assets/"
    : source.startsWith("/assets/")
      ? "/assets/"
      : undefined;
  if (!assetPrefix) return undefined;

  const relativeSource = posix.normalize(source.slice(assetPrefix.length));
  if (relativeSource === "." || relativeSource === ".." || relativeSource.startsWith("../")) return undefined;

  const candidate = `${RENDERER_ASSET_PATH}${relativeSource}`;
  return entries.get(candidate);
}

function readArchiveText(archivePath: string, entryPath: string | undefined): string | undefined {
  if (!entryPath) return undefined;
  try {
    return extractFile(archivePath, entryPath).toString("utf8");
  } catch {
    return undefined;
  }
}

function hasPreloadRunBridge(preload: string | undefined): boolean {
  if (!preload) return false;
  return /\bcontextBridge\.exposeInMainWorld\s*\(/.test(preload)
    && /\brun\s*:\s*\{/.test(preload)
    && /\binvoke\s*\(\s*["']run\.start["']/.test(preload)
    && /\binvoke\s*\(\s*["']run\.cancel["']/.test(preload)
    && /\binvoke\s*\(\s*["']run\.subscribe["']/.test(preload);
}

export async function verifyDesktopPackage(options: VerifyDesktopPackageOptions): Promise<DesktopPackageVerification> {
  let entries: ReadonlyMap<string, string> = new Map();
  try {
    entries = new Map(listPackage(options.archivePath, { isPack: false }).map((entry) => [normalizeArchivePath(entry), archiveReadPath(entry)]));
  } catch {
    // A missing or malformed archive produces fixed failed checks only.
  }

  const preloadEntry = entries.get(PRELOAD_PATH);
  const hasPreload = preloadEntry !== undefined;
  const hasRunService = entries.has(RUN_SERVICE_PATH);
  const rendererDocumentEntry = entries.get(RENDERER_DOCUMENT_PATH);
  const hasRendererDocument = rendererDocumentEntry !== undefined;
  const rendererDocument = readArchiveText(options.archivePath, rendererDocumentEntry);
  const rendererBundle = readArchiveText(options.archivePath, rendererBundlePath(rendererDocument ?? "", entries));
  const preload = readArchiveText(options.archivePath, preloadEntry);

  const checks: readonly DesktopPackageCheck[] = Object.freeze([
    Object.freeze({ name: "main-preload", passed: hasPreload }),
    Object.freeze({ name: "main-run-service", passed: hasRunService }),
    Object.freeze({ name: "renderer-document", passed: hasRendererDocument }),
    Object.freeze({ name: "renderer-live-workbench", passed: rendererBundle?.includes("data-todex-surface") === true && rendererBundle.includes("live-workbench") }),
    Object.freeze({ name: "preload-run-bridge", passed: hasPreloadRunBridge(preload) }),
  ]);

  return Object.freeze({
    allPassed: checks.every((check) => check.passed),
    checks,
  });
}

const isMain =
  typeof process !== "undefined"
  && import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const archivePath = process.env.TODEX_DESKTOP_ARCHIVE ?? DEFAULT_DESKTOP_PACKAGE_ARCHIVE;
  const result = await verifyDesktopPackage({ archivePath });
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) process.exitCode = 1;
}
