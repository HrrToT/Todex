import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_RELEASE_ARTIFACTS, verifyRelease } from "../verify-release.js";

async function makeArtifacts(files: Record<string, string> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "todex-release-"));
  await mkdir(join(directory, "win-unpacked"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content);
  }
  return directory;
}

describe("verifyRelease", () => {
  it("requires a Windows x64 NSIS artifact and an HTTPS Demo URL", async () => {
    const artifactsDir = await makeArtifacts({
      "Todex-0.1.0-win-x64.exe": "installer",
      "latest.yml": "path: Todex-0.1.0-win-x64.exe\nsha512: fixture-sha512\n",
    });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
    });

    expect(result.allPassed).toBe(true);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: true });
    expect(result.checks).toContainEqual({ name: "demo-url", passed: true });
  });

  it("fails when the artifact directory is missing", async () => {
    const result = await verifyRelease({
      artifactsDir: join(tmpdir(), "todex-release-does-not-exist"),
      demoUrl: "https://todex-demo.example.com",
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
  });

  it("rejects non-HTTPS or malformed Demo URLs", async () => {
    const artifactsDir = await makeArtifacts({ "Todex-0.1.0-win-x64.exe": "installer" });

    for (const demoUrl of ["http://todex-demo.example.com", "javascript:alert(1)", "not-a-url"]) {
      const result = await verifyRelease({ artifactsDir, demoUrl });
      expect(result.allPassed).toBe(false);
      expect(result.checks).toContainEqual({ name: "demo-url", passed: false });
    }
  });

  it("rejects an executable that is not the configured Windows x64 artifact", async () => {
    const artifactsDir = await makeArtifacts({ "Todex-0.1.0-linux-x64.AppImage": "not-windows" });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
    });

    expect(result.allPassed).toBe(false);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
  });

  it("rejects a named installer when electron-builder metadata is absent or does not match", async () => {
    const missingMetadata = await makeArtifacts({ "Todex-0.1.0-win-x64.exe": "installer" });
    const mismatchedMetadata = await makeArtifacts({
      "Todex-0.1.0-win-x64.exe": "installer",
      "latest.yml": "path: another-installer.exe\nsha512: fixture-sha512\n",
    });

    for (const artifactsDir of [missingMetadata, mismatchedMetadata]) {
      const result = await verifyRelease({ artifactsDir, demoUrl: "https://todex-demo.example.com" });
      expect(result.checks).toContainEqual({ name: "windows-nsis", passed: false });
    }
  });

  it("accepts the installer named by latest metadata when an older installer remains in the directory", async () => {
    const artifactsDir = await makeArtifacts({
      "Todex-0.1.2-win-x64.exe": "older-installer",
      "Todex-0.1.3-win-x64.exe": "current-installer",
      "latest.yml": "path: Todex-0.1.3-win-x64.exe\nsha512: fixture-sha512\n",
    });

    const result = await verifyRelease({
      artifactsDir,
      demoUrl: "https://todex-demo.example.com",
    });

    expect(result.allPassed).toBe(true);
    expect(result.checks).toContainEqual({ name: "windows-nsis", passed: true });
  });

  it("keeps the CLI default artifact directory aligned with electron-builder output", async () => {
    expect(DEFAULT_RELEASE_ARTIFACTS).toBe("apps/desktop/release");
  });
});
