import { describe, expect, it } from "vitest";

import { DESKTOP_HOST_VERSION } from "../src/main/index.js";

describe("desktop host", () => {
  it("exports the T-009 host version", () => {
    expect(DESKTOP_HOST_VERSION).toBe("0.1.0");
  });
});
