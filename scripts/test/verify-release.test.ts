import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_RELEASE_ARTIFACTS, verifyRelease } from "../verify-release.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = join(import.meta.dirname, "..", "..");

async function makeArtifacts(files: Record<string, string> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "todex-release-"));
  await mkdir(join(directory, "win-unpacked"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content);
  }
  return directory;
}

function sha512(value: string): string {
  return createHash("sha512").update(value).digest("base64");
}

describe("verifyRelease", () => {
  it("requires a Windows x64 NSIS artifact and an HTTPS Demo URL", async () => {
    const installerContents = "installer";
    const artifactsDir = await makeArtifacts({
      "Todex-0.1.0-win-x64.exe": installerContents,
      "latest.yml": `version: 0.1.0\npath: Todex-0.1.0-win-x64.exe\nsha512: ${sha512(installerContents)}\n`,
    });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
      expectedVersion: "0.1.0",
    });

    expect(result.allPassed).toBe(true);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: true });
    expect(result.checks).toContainEqual({ name: "demo-url", passed: true });
  });

  it("fails when the artifact directory is missing", async () => {
    const result = await verifyRelease({
      artifactsDir: join(tmpdir(), "todex-release-does-not-exist"),
      demoUrl: "https://todex-demo.example.com",
      expectedVersion: "0.1.0",
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
  });

  it("rejects non-HTTPS or malformed Demo URLs", async () => {
    const artifactsDir = await makeArtifacts({ "Todex-0.1.0-win-x64.exe": "installer" });

    for (const demoUrl of ["http://todex-demo.example.com", "javascript:alert(1)", "not-a-url"]) {
      const result = await verifyRelease({ artifactsDir, demoUrl, expectedVersion: "0.1.0" });
      expect(result.allPassed).toBe(false);
      expect(result.checks).toContainEqual({ name: "demo-url", passed: false });
    }
  });

  it("rejects an executable that is not the configured Windows x64 artifact", async () => {
    const artifactsDir = await makeArtifacts({ "Todex-0.1.0-linux-x64.AppImage": "not-windows" });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
      expectedVersion: "0.1.0",
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
  });

  it("rejects a named installer when electron-builder metadata is absent or does not match", async () => {
    const installerContents = "installer";
    const missingMetadata = await makeArtifacts({ "Todex-0.1.0-win-x64.exe": installerContents });
    const mismatchedMetadata = await makeArtifacts({
      "Todex-0.1.0-win-x64.exe": installerContents,
      "latest.yml": "path: another-installer.exe\nsha512: fixture-sha512\n",
    });

    for (const artifactsDir of [missingMetadata, mismatchedMetadata]) {
      const result = await verifyRelease({ artifactsDir, demoUrl: "https://todex-demo.example.com", expectedVersion: "0.1.0" });
      expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
    }
  });

  it("accepts the installer named by latest metadata when an older installer remains in the directory", async () => {
    const installerContents = "current-installer";
    const artifactsDir = await makeArtifacts({
      "Todex-0.1.2-win-x64.exe": "older-installer",
      "Todex-0.1.3-win-x64.exe": installerContents,
      "latest.yml": `version: 0.1.3\npath: Todex-0.1.3-win-x64.exe\nsha512: ${sha512(installerContents)}\n`,
    });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
      expectedVersion: "0.1.3",
    });

    expect(result.allPassed).toBe(true);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: true });
  });

  it("rejects release metadata whose SHA-512 does not match the named installer", async () => {
    const artifactsDir = await makeArtifacts({
      "Todex-0.1.3-win-x64.exe": "current-installer",
      "latest.yml": "version: 0.1.3\npath: Todex-0.1.3-win-x64.exe\nsha512: wrong-hash\n",
    });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
      expectedVersion: "0.1.3",
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
  });

  it("rejects release metadata whose version disagrees with its named installer", async () => {
    const artifactsDir = await makeArtifacts({
      "Todex-0.1.3-win-x64.exe": "current-installer",
      "latest.yml": "version: 0.1.2\npath: Todex-0.1.3-win-x64.exe\nsha512: fixture-sha512\n",
    });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
      expectedVersion: "0.1.3",
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
  });

  it("keeps the CLI default artifact directory aligned with electron-builder output", async () => {
    expect(DEFAULT_RELEASE_ARTIFACTS).toBe("apps/desktop/release");
  });

  it("uses the root manifest version when the CLI release version is not overridden", async () => {
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")) as { version: string };
    const version = manifest.version;
    const installerContents = "candidate-installer";
    const artifactsDir = await makeArtifacts({
      [`Todex-${version}-win-x64.exe`]: installerContents,
      "latest.yml": `version: ${version}\npath: Todex-${version}-win-x64.exe\nsha512: ${sha512(installerContents)}\n`,
    });

    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "scripts/verify-release.ts"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TODEX_DEMO_URL: "https://todex-demo.example.com",
        TODEX_RELEASE_ARTIFACTS: artifactsDir,
        TODEX_RELEASE_VERSION: "",
      },
    });

    expect(JSON.parse(stdout) as { allPassed: boolean }).toEqual(expect.objectContaining({ allPassed: true }));
  });
});
