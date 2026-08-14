import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  readonly expectedVersion: string;
};

export const DEFAULT_RELEASE_ARTIFACTS = "apps/desktop/release";

const WINDOWS_NSIS_NAME = /^Todex-[0-9A-Za-z.+-]+-win-x64\.exe$/i;

async function hasWindowsNsisArtifact(artifactsDir: string, expectedVersion: string): Promise<boolean> {
  try {
    const entries = await readdir(resolve(artifactsDir), { withFileTypes: true });
    const metadata = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === "latest.yml");
    if (metadata === undefined) return false;

    const metadataText = await readFile(resolve(artifactsDir, metadata.name), "utf8");
    const metadataVersion = /(?:^|\n)version:\s*(\S+)/.exec(metadataText)?.[1];
    const installerName = /(?:^|\n)path:\s*(\S+)/.exec(metadataText)?.[1];
    const expectedInstallerName = `Todex-${expectedVersion}-win-x64.exe`;
    if (metadataVersion !== expectedVersion || installerName !== expectedInstallerName || !WINDOWS_NSIS_NAME.test(installerName)) {
      return false;
    }

    const installer = entries.find((entry) => entry.isFile() && entry.name === installerName);
    const expectedSha512 = /(?:^|\n)sha512:\s*(\S+)/.exec(metadataText)?.[1];
    if (installer === undefined || expectedSha512 === undefined) return false;

    const actualSha512 = createHash("sha512")
      .update(await readFile(resolve(artifactsDir, installer.name)))
      .digest("base64");
    return actualSha512 === expectedSha512;
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

async function rootReleaseVersion(): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" && manifest.version.length > 0 ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

export async function verifyRelease(options: VerifyReleaseOptions): Promise<ReleaseVerification> {
  const checks: ReleaseCheck[] = [
    { name: "windows-nsis", passed: await hasWindowsNsisArtifact(options.artifactsDir, options.expectedVersion) },
    { name: "demo-url", passed: isHttpsDemoUrl(options.demoUrl) },
  ];

  return Object.freeze({
    allPassed: checks.every((check) => check.passed),
    checks: Object.freeze(checks),
  });
}

if (import.meta.url === new URL(`file://${process.argv[1]?.replaceAll("\\", "/")}`).href) {
  const artifactsDir = process.env.TODEX_RELEASE_ARTIFACTS ?? DEFAULT_RELEASE_ARTIFACTS;
  const expectedVersion = process.env.TODEX_RELEASE_VERSION || await rootReleaseVersion() || "";
  const result = await verifyRelease({
    artifactsDir,
    demoUrl: process.env.TODEX_DEMO_URL,
    expectedVersion,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) process.exitCode = 1;
}
