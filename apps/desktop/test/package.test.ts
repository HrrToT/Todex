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
});
