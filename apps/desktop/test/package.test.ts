import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop package scripts", () => {
  it("keeps the Electron rebuild flow explicit and separate from the low-level smoke command", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts.smoke).not.toContain("rebuild:native");
    expect(manifest.scripts["smoke:electron"]).toBe("pnpm run rebuild:native && pnpm run smoke");
  });

  it("declares Electron as a build-time dependency for electron-builder", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.dependencies.electron).toBeUndefined();
    expect(manifest.devDependencies.electron).toBeDefined();
  });

  it("uses a lockfile-managed electron-builder package for Windows installers", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.scripts["package:win"]).not.toContain("pnpm dlx electron-builder");
    expect(manifest.scripts["package:win"]).toContain("electron-builder");
    expect(manifest.devDependencies["electron-builder"]).toBeDefined();
  });

  it("configures release metadata for the GitHub-hosted Windows installer", () => {
    const config = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");

    expect(config).toContain("publish:");
    expect(config).toContain("provider: generic");
    expect(config).toContain("url: https://github.com/HrrToT/Todex/releases/download/v${version}");
  });

  it("builds renderer assets with relative URLs for the packaged file document", () => {
    const config = readFileSync(new URL("../vite.renderer.config.ts", import.meta.url), "utf8");

    expect(config).toContain('base: "./"');
  });
});
