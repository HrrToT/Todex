import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitLab CI compatibility", () => {
  it("provides the required unit-test job without replacing GitHub Actions", async () => {
    const config = await readFile(".gitlab-ci.yml", "utf8");

    expect(config).toMatch(/^unit-test:/m);
    expect(config).toContain("pnpm install --frozen-lockfile");
    expect(config).toContain("pnpm test --run");
  });
});
