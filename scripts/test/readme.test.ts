import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

describe("repository README", () => {
  it("is a readable UTF-8 user entry point instead of replacement-question text", () => {
    expect(README).not.toMatch(/\?{3,}/);
    expect(README).toContain("Todex 是一个面向小型 Node.js 与 Python 代码仓库");
  });

  it("states the real Demo, installation and white-screen release boundary", () => {
    expect(README).toContain("https://todex-mock-demo.onrender.com");
    expect(README).toContain("Windows SmartScreen");
    expect(README).toContain("v0.1.0");
    expect(README).toContain("Renderer 白屏问题");
    expect(README).toContain("v0.1.1");
  });
});
