import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NodeWorkspaceFs } from "../src/main/node-workspace-fs.js";

const TEMP_DIRECTORIES: string[] = [];

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "todex-workspace-fs-"));
  TEMP_DIRECTORIES.push(root);
  writeFileSync(join(root, "safe.ts"), "export const answer = 42;\n");
  writeFileSync(join(root, ".env"), "API_KEY=secret-value\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "find-me.ts"), "const needle = true;\n");
  return root;
}

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("NodeWorkspaceFs", () => {
  it("reads a regular workspace file while denying sensitive and escaping paths", async () => {
    const workspaceRoot = createWorkspace();
    const fs = new NodeWorkspaceFs({ workspaceRoot });

    await expect(fs.readText("safe.ts")).resolves.toContain("answer = 42");
    await expect(fs.readText(".env")).rejects.toThrow("sensitive_path");
    await expect(fs.readText("../outside.txt")).rejects.toThrow("workspace_escape");
  });

  it("resolves symlinks before enforcing workspace containment", async () => {
    const workspaceRoot = createWorkspace();
    const outside = mkdtempSync(join(tmpdir(), "todex-workspace-outside-"));
    TEMP_DIRECTORIES.push(outside);
    writeFileSync(join(outside, "private.txt"), "outside");
    symlinkSync(outside, join(workspaceRoot, "linked-outside"), "junction");
    const fs = new NodeWorkspaceFs({ workspaceRoot });

    await expect(fs.readText("linked-outside/private.txt")).rejects.toThrow("workspace_escape");
  });

  it("searches and commits only contained non-sensitive paths", async () => {
    const workspaceRoot = createWorkspace();
    const fs = new NodeWorkspaceFs({ workspaceRoot });

    await expect(fs.searchText("src", "needle")).resolves.toEqual([
      { path: "src/find-me.ts", line: 1, context: "const needle = true;" },
    ]);
    await fs.commit(new Map([["created.ts", "export {};\n"], ["safe.ts", undefined]]));
    await expect(fs.readText("created.ts")).resolves.toBe("export {};\n");
    await expect(fs.readText("safe.ts")).rejects.toThrow();
    await expect(fs.commit(new Map([[".env", "leak"]]))).rejects.toThrow("sensitive_path");
  });
});
