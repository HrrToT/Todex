import { describe, expect, it } from "vitest";
import { FileTools, type WorkspaceFs, type SearchMatch } from "../src/file-tools.js";
import type { PathResolver } from "../src/guardrail.js";

class InMemoryWorkspaceFs implements WorkspaceFs {
  private files = new Map<string, string>();

  setFile(path: string, content: string): void {
    this.files.set(this.normalize(path), content);
  }

  getFile(path: string): string | undefined {
    return this.files.get(this.normalize(path));
  }

  async list(path: string, maxDepth: number): Promise<readonly string[]> {
    const prefix = this.normalize(path);
    const result: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath === prefix) continue;
      let relative: string;
      if (prefix === ".") {
        relative = filePath;
      } else if (filePath.startsWith(prefix + "/")) {
        relative = filePath.slice(prefix.length + 1);
      } else {
        continue;
      }
      const depth = relative.includes("/") ? relative.split("/").length - 1 : 0;
      if (depth <= maxDepth) {
        result.push(filePath);
      }
    }
    result.sort();
    return result;
  }

  async readText(path: string): Promise<string> {
    const content = this.files.get(this.normalize(path));
    if (content === undefined) {
      throw new Error(`file not found: ${path}`);
    }
    return content;
  }

  async searchText(path: string, query: string): Promise<readonly SearchMatch[]> {
    const prefix = this.normalize(path);
    const matches: SearchMatch[] = [];
    for (const [filePath, content] of this.files) {
      if (prefix === "." || filePath === prefix || filePath.startsWith(prefix + "/")) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({ path: filePath, line: i + 1, context: lines[i] });
          }
        }
      }
    }
    return matches;
  }

  async snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    for (const p of paths) {
      result.set(p, this.files.get(this.normalize(p)));
    }
    return result;
  }

  async commit(next: ReadonlyMap<string, string | undefined>): Promise<void> {
    for (const [path, content] of next) {
      if (content === undefined) {
        this.files.delete(this.normalize(path));
      } else {
        this.files.set(this.normalize(path), content);
      }
    }
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  }
}

class FakePathResolver implements PathResolver {
  private symlinks = new Map<string, string>();

  setSymlink(linkPath: string, targetPath: string): void {
    this.symlinks.set(this.normalize(linkPath), this.normalize(targetPath));
  }

  resolveCanonical(workspaceRoot: string, path: string): string {
    const root = this.normalize(workspaceRoot);
    const isAbsolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
    const joined = isAbsolute ? path : `${root}/${path}`;
    let resolved = this.normalize(joined);

    for (const [link, target] of this.symlinks) {
      if (resolved === link) {
        resolved = this.normalize(target);
      } else if (resolved.startsWith(link + "/")) {
        resolved = this.normalize(target + resolved.slice(link.length));
      }
    }

    return resolved;
  }

  normalize(p: string): string {
    p = p.replace(/\\/g, "/");
    const isAbsolute = p.startsWith("/") || /^[A-Za-z]:/.test(p);
    const parts = p.split("/");
    const result: string[] = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (result.length > 0 && result[result.length - 1] !== "..") {
          result.pop();
        } else {
          result.push("..");
        }
      } else {
        result.push(part);
      }
    }
    const body = result.join("/");
    if (isAbsolute && !/^[A-Za-z]:/.test(body)) {
      return "/" + body;
    }
    return body;
  }
}

function makeTools(files: Record<string, string> = {}, workspaceRoot = "/workspace") {
  const fs = new InMemoryWorkspaceFs();
  for (const [path, content] of Object.entries(files)) {
    fs.setFile(path, content);
  }
  const pathResolver = new FakePathResolver();
  const tools = new FileTools({
    workspaceRoot,
    fs,
    pathResolver,
  });
  return { tools, fs, pathResolver };
}

const ctx = { runId: "r1", actionId: "a1" };

describe("FileTools sensitive path rejection", () => {
  it("rejects reading .env with sensitive_path", async () => {
    const { tools } = makeTools({ ".env": "TOKEN=secret-value" });
    const result = await tools.dispatch({ tool: "read_file", path: ".env" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects reading .ENV (case-insensitive)", async () => {
    const { tools } = makeTools({ ".ENV": "SECRET=abc" });
    const result = await tools.dispatch({ tool: "read_file", path: ".ENV" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects reading .git/config", async () => {
    const { tools } = makeTools({ ".git/config": "token = abc" });
    const result = await tools.dispatch({ tool: "read_file", path: ".git/config" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects reading .npmrc", async () => {
    const { tools } = makeTools({ ".npmrc": "//registry:token=abc" });
    const result = await tools.dispatch({ tool: "read_file", path: ".npmrc" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects reading a .pem file", async () => {
    const { tools } = makeTools({ "certs/server.pem": "-----BEGIN PRIVATE KEY-----" });
    const result = await tools.dispatch({ tool: "read_file", path: "certs/server.pem" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects reading a .key file", async () => {
    const { tools } = makeTools({ "certs/server.key": "-----BEGIN PRIVATE KEY-----" });
    const result = await tools.dispatch({ tool: "read_file", path: "certs/server.key" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects reading credentials.json", async () => {
    const { tools } = makeTools({ "config/credentials.json": '{"token":"abc"}' });
    const result = await tools.dispatch({ tool: "read_file", path: "config/credentials.json" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects a path escaping the workspace via ..", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch({ tool: "read_file", path: "../.ssh/id_rsa" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: workspace_escape" });
  });

  it("rejects an absolute path outside the workspace", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch({ tool: "read_file", path: "/etc/passwd" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: workspace_escape" });
  });

  it("rejects a symlink escaping the workspace", async () => {
    const { tools, pathResolver } = makeTools();
    pathResolver.setSymlink("/workspace/escape-link", "/outside/workspace");
    const result = await tools.dispatch({ tool: "read_file", path: "escape-link" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: workspace_escape" });
  });

  it("rejects listing a sensitive path", async () => {
    const { tools } = makeTools({ ".env": "TOKEN=secret-value" });
    const result = await tools.dispatch({ tool: "list_files", path: ".env" }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects searching in a sensitive path", async () => {
    const { tools } = makeTools({ ".env": "TOKEN=secret-value" });
    const result = await tools.dispatch({ tool: "search_text", query: "TOKEN", path: ".env", maxResults: 20 }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });
});

describe("FileTools bounded reads", () => {
  it("reads a normal file successfully", async () => {
    const { tools } = makeTools({ "src/app.ts": "console.log('hello');" });
    const result = await tools.dispatch({ tool: "read_file", path: "src/app.ts" }, ctx);
    expect(result).toMatchObject({ status: "succeeded" });
    expect(result.summary).toContain("console.log('hello');");
    expect(result.truncatedOutput).toBeUndefined();
  });

  it("truncates a read exceeding 64 KiB", async () => {
    const { tools } = makeTools({ "src/big.ts": "x".repeat(65537) });
    const result = await tools.dispatch({ tool: "read_file", path: "src/big.ts" }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.truncatedOutput).toContain("[truncated]");
  });

  it("lists files successfully", async () => {
    const { tools } = makeTools({ "src/a.ts": "a", "src/b.ts": "b" });
    const result = await tools.dispatch({ tool: "list_files", path: "src" }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("src/a.ts");
    expect(result.summary).toContain("src/b.ts");
    expect(result.truncatedOutput).toBeUndefined();
  });

  it("truncates a list exceeding 100 entries", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 101; i++) {
      files[`file${i}.ts`] = "x";
    }
    const { tools } = makeTools(files);
    const result = await tools.dispatch({ tool: "list_files", path: "." }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.truncatedOutput).toContain("[truncated]");
  });

  it("searches text successfully", async () => {
    const { tools } = makeTools({ "src/app.ts": "console.log('TODO: fix this');" });
    const result = await tools.dispatch({ tool: "search_text", query: "TODO", maxResults: 20 }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("src/app.ts");
    expect(result.truncatedOutput).toBeUndefined();
  });

  it("truncates search results exceeding 20 matches", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 21; i++) {
      lines.push(`TODO line ${i}`);
    }
    const { tools } = makeTools({ "src/app.ts": lines.join("\n") });
    const result = await tools.dispatch({ tool: "search_text", query: "TODO", maxResults: 20 }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.truncatedOutput).toContain("[truncated]");
  });

  it("truncates search context to 240 characters", async () => {
    const longLine = "A".repeat(300);
    const { tools } = makeTools({ "src/app.ts": longLine });
    const result = await tools.dispatch({ tool: "search_text", query: "A", maxResults: 20 }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.summary).not.toContain("A".repeat(300));
  });

  it("returns failed when reading a non-existent file", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch({ tool: "read_file", path: "src/missing.ts" }, ctx);
    expect(result.status).toBe("failed");
  });
});

describe("FileTools seeded secret redaction", () => {
  it("does not expose .env content in read ToolResult", async () => {
    const { tools } = makeTools({ ".env": "TOKEN=secret-value" });
    const result = await tools.dispatch({ tool: "read_file", path: ".env" }, ctx);
    expect(result.status).toBe("rejected");
    expect(result.summary).not.toContain("secret-value");
    expect(result.truncatedOutput).toBeUndefined();
  });

  it("does not expose sensitive file content in search results", async () => {
    const { tools } = makeTools({
      ".env": "TOKEN=secret-value",
      "src/app.ts": "const x = 1;",
    });
    const result = await tools.dispatch({ tool: "search_text", query: "TOKEN", maxResults: 20 }, ctx);
    expect(result.status).toBe("succeeded");
    expect(result.summary).not.toContain("secret-value");
    expect(result.summary).not.toContain(".env");
  });
});

describe("FileTools unsupported tools", () => {
  it("returns skipped for remember", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch(
      { tool: "remember", kind: "project_convention", content: "use tabs", traceEventIds: ["e1"] },
      ctx,
    );
    expect(result).toMatchObject({ status: "skipped", summary: "unsupported_file_tool" });
  });

  it("returns skipped for finish", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch(
      { tool: "finish", summary: "done", completion: "verified" },
      ctx,
    );
    expect(result).toMatchObject({ status: "skipped", summary: "unsupported_file_tool" });
  });

  it("returns skipped for run_configured_command", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch(
      { tool: "run_configured_command", commandId: "test" },
      ctx,
    );
    expect(result).toMatchObject({ status: "skipped", summary: "unsupported_file_tool" });
  });

  it("returns skipped for run_shell_command_with_approval", async () => {
    const { tools } = makeTools();
    const result = await tools.dispatch(
      { tool: "run_shell_command_with_approval", command: "npm test" },
      ctx,
    );
    expect(result).toMatchObject({ status: "skipped", summary: "unsupported_file_tool" });
  });
});

describe("FileTools unified diff patches", () => {
  it("applies a valid single-file diff", async () => {
    const { tools, fs } = makeTools({ "src/a.ts": "line1\nline2\nline3\n" });
    const patch = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2modified\n line3\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result.status).toBe("succeeded");
    expect(fs.getFile("src/a.ts")).toBe("line1\nline2modified\nline3\n");
  });

  it("returns patch_invalid for malformed diff", async () => {
    const { tools } = makeTools({ "src/a.ts": "line1\n" });
    const result = await tools.dispatch({ tool: "apply_patch", patch: "not a diff" }, ctx);
    expect(result).toMatchObject({ status: "failed", summary: "patch_invalid" });
  });

  it("returns patch_invalid for diff without hunk headers", async () => {
    const { tools } = makeTools({ "src/a.ts": "line1\n" });
    const result = await tools.dispatch(
      { tool: "apply_patch", patch: "--- a/src/a.ts\n+++ b/src/a.ts\n" },
      ctx,
    );
    expect(result).toMatchObject({ status: "failed", summary: "patch_invalid" });
  });

  it("applies a multi-file patch atomically", async () => {
    const { tools, fs } = makeTools({ "a.ts": "before-a\n", "b.ts": "before-b\n" });
    const patch =
      "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-before-a\n+after-a\n" +
      "--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-before-b\n+after-b\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result.status).toBe("succeeded");
    expect(fs.getFile("a.ts")).toBe("after-a\n");
    expect(fs.getFile("b.ts")).toBe("after-b\n");
  });

  it("does not partially apply a conflicting multi-file patch", async () => {
    const { tools, fs } = makeTools({ "a.ts": "before-a\n", "b.ts": "before-b\n" });
    const patch =
      "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-before-a\n+after-a\n" +
      "--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-wrong-content\n+after-b\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result.summary).toBe("patch_conflict");
    expect(fs.getFile("a.ts")).toBe("before-a\n");
    expect(fs.getFile("b.ts")).toBe("before-b\n");
  });

  it("returns patch_conflict for a single-file context mismatch", async () => {
    const { tools, fs } = makeTools({ "src/a.ts": "line1\nline2\nline3\n" });
    const patch =
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n line1\n-wrong\n+line2modified\n line3\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result).toMatchObject({ status: "failed", summary: "patch_conflict" });
    expect(fs.getFile("src/a.ts")).toBe("line1\nline2\nline3\n");
  });

  it("rejects a patch targeting a sensitive file", async () => {
    const { tools } = makeTools({ ".env": "TOKEN=abc\n" });
    const patch = "--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-TOKEN=abc\n+TOKEN=xyz\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  });

  it("rejects a patch with workspace-escaping target", async () => {
    const { tools } = makeTools();
    const patch = "--- a/../outside\n+++ b/../outside\n@@ -1 +1 @@\n-old\n+new\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result).toMatchObject({ status: "rejected", summary: "denied: workspace_escape" });
  });

  it("does not expose seeded secret in patch rejection", async () => {
    const { tools } = makeTools({ ".env": "TOKEN=secret-value\n" });
    const patch = "--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-TOKEN=secret-value\n+TOKEN=new\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result.status).toBe("rejected");
    expect(result.summary).not.toContain("secret-value");
  });

  it("creates a new file from /dev/null old path", async () => {
    const { tools, fs } = makeTools();
    const patch = "--- /dev/null\n+++ b/new-file.ts\n@@ -0,0 +1 @@\n+new content\n";
    const result = await tools.dispatch({ tool: "apply_patch", patch }, ctx);
    expect(result.status).toBe("succeeded");
    expect(fs.getFile("new-file.ts")).toBe("new content\n");
  });
});
