import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export type ReleaseCheck = {
  readonly name: "windows-nsis" | "demo-url";
  readonly passed: boolean;
};

export type ReleaseVerification = {
  readonly allPassed: boolean;
  readonly checks: readonly ReleaseCheck[];
};

export type VerifyReleaseOptions = {
  readonly artifactsDir: string;
  readonly demoUrl?: string;
};

export const DEFAULT_RELEASE_ARTIFACTS = "apps/desktop/release";

const WINDOWS_NSIS_NAME = /^Todex-[0-9A-Za-z.+-]+-win-x64\.exe$/i;

async function hasWindowsNsisArtifact(artifactsDir: string): Promise<boolean> {
  try {
    const entries = await readdir(resolve(artifactsDir), { withFileTypes: true });
    const metadata = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === "latest.yml");
    if (metadata === undefined) return false;

    const metadataText = await readFile(resolve(artifactsDir, metadata.name), "utf8");
    const installerName = /(?:^|\n)path:\s*(\S+)/.exec(metadataText)?.[1];
    if (installerName === undefined || !WINDOWS_NSIS_NAME.test(installerName)) return false;

    const installer = entries.find((entry) => entry.isFile() && entry.name === installerName);
    return installer !== undefined && /(?:^|\n)sha512:\s*\S+/.test(metadataText);
  } catch {
    return false;
  }
}

function isHttpsDemoUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export async function verifyRelease(options: VerifyReleaseOptions): Promise<ReleaseVerification> {
  const checks: ReleaseCheck[] = [
    { name: "windows-nsis", passed: await hasWindowsNsisArtifact(options.artifactsDir) },
    { name: "demo-url", passed: isHttpsDemoUrl(options.demoUrl) },
  ];

  return Object.freeze({
    allPassed: checks.every((check) => check.passed),
    checks: Object.freeze(checks),
  });
}

if (import.meta.url === new URL(`file://${process.argv[1]?.replaceAll("\\", "/")}`).href) {
  const artifactsDir = process.env.TODEX_RELEASE_ARTIFACTS ?? DEFAULT_RELEASE_ARTIFACTS;
  const result = await verifyRelease({
    artifactsDir,
    demoUrl: process.env.TODEX_DEMO_URL,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) process.exitCode = 1;
}
