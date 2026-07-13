import { describe, expect, it } from "vitest";
import { HARNESS_VERSION } from "../src/index.js";

describe("harness-core workspace", () => {
  it("exports a semantic version", () => {
    expect(HARNESS_VERSION).toMatch(/^0\.1\.0$/);
  });
});
