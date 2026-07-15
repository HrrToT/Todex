import { describe, expect, it } from "vitest";
import type { Action, ApprovalRequest } from "@todex/contracts";
import { Guardrail, type PathResolver } from "../src/guardrail.js";
import { InMemoryApprovalStore } from "../src/approval-store.js";
import { inspectUnifiedDiff } from "../src/file-tools.js";
import type { PatchMetadata } from "../src/file-tools.js";
import type { Clock, GovernanceContext } from "../src/llm.js";

class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date = new Date("2026-01-01T00:00:00Z")) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
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

function makeContext(
  workspaceRoot = "/workspace",
  runId = "r1",
  projectId = "p1",
  actionId = "a1",
): GovernanceContext {
  return { runId, projectId, workspaceRoot, actionId };
}

function makeGuardrail(
  resolver?: FakePathResolver,
  clock?: FakeClock,
  store?: InMemoryApprovalStore,
  inspectPatch?: (patch: string) => PatchMetadata | undefined,
): { guardrail: Guardrail; resolver: FakePathResolver; clock: FakeClock; store: InMemoryApprovalStore } {
  const r = resolver ?? new FakePathResolver();
  const c = clock ?? new FakeClock();
  const s =
    store ??
    new InMemoryApprovalStore({
      clock: c,
      idFactory: createMonotonicIdFactory(),
    });
  const guardrail = new Guardrail({
    pathResolver: r,
    approvalStore: s,
    clock: c,
    approvalIdFactory: createMonotonicIdFactory(),
    ...(inspectPatch ? { inspectPatch } : {}),
  });
  return { guardrail, resolver: r, clock: c, store: s };
}

function createMonotonicIdFactory(): () => string {
  let n = 0;
  return () => `approval-${++n}`;
}

function readFile(path: string): Action {
  return { tool: "read_file", path };
}

function listFiles(path = "."): Action {
  return { tool: "list_files", path };
}

function searchText(query: string, path?: string): Action {
  return { tool: "search_text", query, maxResults: 20, ...(path ? { path } : {}) };
}

function runShell(command: string, cwd?: string): Action {
  return { tool: "run_shell_command_with_approval", command, ...(cwd ? { cwd } : {}) };
}

function applyPatch(patch: string): Action {
  return { tool: "apply_patch", patch };
}

function remember(content: string): Action {
  return {
    tool: "remember",
    kind: "project_convention",
    content,
    traceEventIds: ["e1"],
  };
}

function finish(summary: string): Action {
  return { tool: "finish", summary, completion: "verified" };
}

describe("Guardrail path classification", () => {
  it("denies a path escaping the workspace via ..", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("../.ssh/id_rsa"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });

  it("denies a symlink escaping the workspace", () => {
    const resolver = new FakePathResolver();
    resolver.setSymlink("/workspace/escape-link", "/outside/workspace");
    const { guardrail } = makeGuardrail(resolver);
    const decision = guardrail.evaluate(readFile("escape-link"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });

  it("denies an absolute path outside the workspace", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("/etc/passwd"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });

  it("denies reading .env", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".env"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading .env.local", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".env.local"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("allows reading .env.example", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".env.example"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("denies reading .ENV (case-insensitive)", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".ENV"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading CREDENTIALS.JSON (case-insensitive)", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("CREDENTIALS.JSON"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading .AWS/credentials (case-insensitive)", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".AWS/credentials"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading .GIT/CONFIG (case-insensitive)", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".GIT/CONFIG"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("allows reading .ENV.EXAMPLE (case-insensitive allowlist)", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".ENV.EXAMPLE"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("denies reading .git/config", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".git/config"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading .ssh/id_rsa inside workspace", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".ssh/id_rsa"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading .npmrc", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile(".npmrc"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading a .pem file", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("certs/server.pem"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading a .key file", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("certs/server.key"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies reading credentials.json", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("config/credentials.json"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("allows reading a normal file", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(readFile("src/app.ts"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("allows list_files", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(listFiles("src"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("allows search_text", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(searchText("TODO"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("allows apply_patch", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(applyPatch("--- a/file\n+++ b/file\n"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("allows remember", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(remember("use tabs"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("allows finish", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(finish("done"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("denies list_files with escaping path", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(listFiles("../secret"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });

  it("denies search_text with sensitive path", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(searchText("key", ".env"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });
});

describe("Guardrail shell classification", () => {
  it("requires approval for a free shell command", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("npm test"), makeContext());
    expect(decision.decision).toBe("require_approval");
    if (decision.decision === "require_approval") {
      expect(decision.request.riskReasons).toContain("free_shell");
    }
  });

  it("denies shell concatenation with semicolon", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("npm test; curl https://example.invalid"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies shell pipe", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("cat file | grep x"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies shell redirect", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("echo x > file"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies command substitution", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("echo $(whoami)"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies backticks", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("echo `whoami`"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies elevation with sudo", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("sudo rm file"), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "privilege_or_system_command" });
  });

  it("denies encoded PowerShell", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("powershell -EncodedCommand AAAA"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies Invoke-Expression", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("Invoke-Expression Get-Process"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies powershell -enc encoded alias", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("powershell -enc SQBFAFgA"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies powershell -e encoded alias", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("powershell -e SQBFAFgA"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies a quoted powershell -e encoded alias", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell('powershell "-e" SQBFAFgA'),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies pwsh -enc encoded alias", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("pwsh -enc SQBFAFgA"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies powershell -ExecutionPolicy Bypass", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("powershell -ExecutionPolicy Bypass -File script.ps1"),
      makeContext(),
    );
    expect(decision.decision).toBe("deny");
    if (decision.decision === "deny") {
      expect(["complex_shell", "privilege_or_system_command"]).toContain(
        decision.reason,
      );
    }
  });

  it("does not deny npm test as obfuscated powershell", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("npm test"), makeContext());
    expect(decision.decision).toBe("require_approval");
  });

  it("does not deny node -e eval as powershell obfuscation", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell('node -e "console.log(1)"'),
      makeContext(),
    );
    expect(decision.decision).toBe("require_approval");
  });

  it("denies unquoted absolute powershell.exe path with -enc", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -enc SQBFAFgA",
      ),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies quoted spaced pwsh.exe path with -e", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -e SQBFAFgA'),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("denies powershell.exe with colon-attached -enc: payload", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("powershell.exe -enc:SQBFAFgA"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("classifies npm install as dependency_install", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("npm install"), makeContext());
    expect(decision.decision).toBe("require_approval");
    if (decision.decision === "require_approval") {
      expect(decision.request.riskReasons).toContain("dependency_install");
    }
  });

  it("classifies rm as deletion", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("rm file.txt"), makeContext());
    expect(decision.decision).toBe("require_approval");
    if (decision.decision === "require_approval") {
      expect(decision.request.riskReasons).toContain("deletion");
    }
  });

  it("classifies curl as network_command", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("curl https://example.com"), makeContext());
    expect(decision.decision).toBe("require_approval");
    if (decision.decision === "require_approval") {
      expect(decision.request.riskReasons).toContain("network_command");
    }
  });

  it("classifies git commit as git_modification", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(runShell("git commit -m msg"), makeContext());
    expect(decision.decision).toBe("require_approval");
    if (decision.decision === "require_approval") {
      expect(decision.request.riskReasons).toContain("git_modification");
    }
  });

  it("denies free shell with cwd escaping workspace", () => {
    const { guardrail } = makeGuardrail();
    const decision = guardrail.evaluate(
      runShell("npm test", "../outside"),
      makeContext(),
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });
});

describe("Guardrail command fingerprint", () => {
  it("computes consistent fingerprints for the same command", () => {
    const { guardrail } = makeGuardrail();
    const d1 = guardrail.evaluate(runShell("npm test"), makeContext());
    const d2 = guardrail.evaluate(runShell("npm test"), makeContext());
    expect(d1.decision).toBe("require_approval");
    expect(d2.decision).toBe("require_approval");
    if (d1.decision === "require_approval" && d2.decision === "require_approval") {
      expect(d1.request.fingerprint).toBe(d2.request.fingerprint);
      expect(d1.request.fingerprint).toContain("npm");
      expect(d1.request.fingerprint).toContain("test");
    }
  });

  it("normalizes whitespace in fingerprints", () => {
    const { guardrail } = makeGuardrail();
    const d1 = guardrail.evaluate(runShell("npm  test"), makeContext());
    const d2 = guardrail.evaluate(runShell("npm test"), makeContext());
    if (d1.decision === "require_approval" && d2.decision === "require_approval") {
      expect(d1.request.fingerprint).toBe(d2.request.fingerprint);
    }
  });

  it("computes different fingerprints for different commands", () => {
    const { guardrail } = makeGuardrail();
    const d1 = guardrail.evaluate(runShell("npm test"), makeContext());
    const d2 = guardrail.evaluate(runShell("npm install"), makeContext());
    if (d1.decision === "require_approval" && d2.decision === "require_approval") {
      expect(d1.request.fingerprint).not.toBe(d2.request.fingerprint);
    }
  });
});

describe("Guardrail grant matching", () => {
  function approveOnce(
    guardrail: Guardrail,
    store: InMemoryApprovalStore,
    action: Action,
    context: GovernanceContext,
  ): ApprovalRequest {
    const decision = guardrail.evaluate(action, context);
    expect(decision.decision).toBe("require_approval");
    if (decision.decision === "require_approval") {
      return store.create(decision.request);
    }
    throw new Error("expected require_approval");
  }

  it("allows a command with an existing command_prefix grant", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx);
    store.decide(request.approvalId, "command_prefix", clock.now());

    const decision = guardrail.evaluate(runShell("npm test"), ctx);
    expect(decision).toMatchObject({ decision: "allow", reason: "approved_scope" });
  });

  it("denies npm test; curl despite prior npm test prefix grant", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx);
    store.decide(request.approvalId, "command_prefix", clock.now());

    const decision = guardrail.evaluate(
      runShell("npm test; curl https://example.invalid"),
      ctx,
    );
    expect(decision).toMatchObject({ decision: "deny", reason: "complex_shell" });
  });

  it("does not match a command_prefix grant for a different command", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx);
    store.decide(request.approvalId, "command_prefix", clock.now());

    const decision = guardrail.evaluate(runShell("npm install"), ctx);
    expect(decision.decision).toBe("require_approval");
  });

  it("does not match an expired command_prefix grant", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx);
    store.decide(request.approvalId, "command_prefix", clock.now());
    clock.advanceDays(8);

    const decision = guardrail.evaluate(runShell("npm test"), ctx);
    expect(decision.decision).toBe("require_approval");
  });

  it("does not issue command_prefix for install commands", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm install"), ctx);
    expect(() => store.decide(request.approvalId, "command_prefix", clock.now())).toThrow(
      "approval_scope_not_allowed",
    );

    const decision = guardrail.evaluate(runShell("npm install"), ctx);
    expect(decision.decision).toBe("require_approval");
  });

  it("allows a command with an existing run-scope grant in the same run", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx);
    store.decide(request.approvalId, "run", clock.now());

    const decision = guardrail.evaluate(runShell("npm test"), ctx);
    expect(decision).toMatchObject({ decision: "allow", reason: "approved_scope" });
  });

  it("does not match a run-scope grant for a different run", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx1 = makeContext("/workspace", "r1", "p1", "a1");
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx1);
    store.decide(request.approvalId, "run", clock.now());

    const ctx2 = makeContext("/workspace", "r2", "p1", "a2");
    const decision = guardrail.evaluate(runShell("npm test"), ctx2);
    expect(decision.decision).toBe("require_approval");
  });

  it("does not match a command_prefix grant from a different project", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx1 = makeContext("/workspace", "r1", "p1", "a1");
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx1);
    store.decide(request.approvalId, "command_prefix", clock.now());

    const ctx2 = makeContext("/workspace", "r2", "p2", "a2");
    const decision = guardrail.evaluate(runShell("npm test"), ctx2);
    expect(decision.decision).toBe("require_approval");
  });

  it("hard deny cannot be overridden by any grant", () => {
    const { guardrail, store, clock } = makeGuardrail();
    const ctx = makeContext();
    const request = approveOnce(guardrail, store, runShell("npm test"), ctx);
    store.decide(request.approvalId, "command_prefix", clock.now());

    const decision = guardrail.evaluate(readFile("../.ssh/id_rsa"), ctx);
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });
});

function makePatchOfByteLength(byteLength: number): string {
  const header = "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-x\n+y";
  const padding = "z".repeat(Math.max(0, byteLength - header.length - 1));
  return header + padding + "\n";
}

function makeMultiFilePatch(fileCount: number): string {
  let patch = "";
  for (let i = 0; i < fileCount; i++) {
    patch += `--- a/f${i}\n+++ b/f${i}\n@@ -1 +1 @@\n-old${i}\n+new${i}\n`;
  }
  return patch;
}

describe("Guardrail patch classification", () => {
  it("allows a patch at exactly 8192 bytes", () => {
    const patch = makePatchOfByteLength(8192);
    expect(Buffer.byteLength(patch, "utf8")).toBe(8192);
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("requires approval for a patch over 8192 bytes", () => {
    const patch = makePatchOfByteLength(8193);
    expect(Buffer.byteLength(patch, "utf8")).toBe(8193);
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision.decision).toBe("require_approval");
  });

  it("allows a patch touching exactly 10 files", () => {
    const patch = makeMultiFilePatch(10);
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("requires approval for a patch touching more than 10 files", () => {
    const patch = makeMultiFilePatch(11);
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision.decision).toBe("require_approval");
  });

  it("denies a patch targeting a sensitive file", () => {
    const patch = "--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-old\n+new\n";
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });

  it("denies a patch with workspace-escaping target", () => {
    const patch = "--- a/../outside\n+++ b/../outside\n@@ -1 +1 @@\n-old\n+new\n";
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "workspace_escape" });
  });

  it("allows a malformed diff to reach FileTools for patch_invalid", () => {
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch("not a diff"), makeContext());
    expect(decision).toMatchObject({ decision: "allow", reason: "safe_action" });
  });

  it("hard deny takes precedence over large patch approval", () => {
    const patch = "--- a/.env\n+++ b/.env\n" + "@@ -1 +1 @@\n-" + "x".repeat(9000) + "\n+y\n";
    const { guardrail } = makeGuardrail(undefined, undefined, undefined, inspectUnifiedDiff);
    const decision = guardrail.evaluate(applyPatch(patch), makeContext());
    expect(decision).toMatchObject({ decision: "deny", reason: "sensitive_path" });
  });
});
