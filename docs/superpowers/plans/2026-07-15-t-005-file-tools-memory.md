# T-005 File Tools and Project Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox syntax.

**Goal:** Implement bounded injected file tools, strict atomic unified-diff application, project-scoped memory selection, and the minimum Runner/Guardrail integration to make both live in Mock LLM runs.

**Architecture:** `FileTools` implements the existing `ToolDispatcher` through `WorkspaceFs`; `MemoryStore` uses an injected `MemoryRepository`; `ContextBuilder` makes immutable selections before every LLM turn. Guardrail reads patch metadata before Dispatcher and requires HITL for patches larger than 8192 UTF-8 bytes or touching more than 10 files.

**Tech Stack:** TypeScript strict, Vitest, existing Zod contracts and T-004 governance. No `better-sqlite3`, real filesystem, Electron, migrations, or network dependency. T-009 owns durable SQLite.

---

## Frozen Constraints

- Base is `main` at `f747692`; implementation branch is `feat/t-005-file-tools-memory` in a fresh worktree.
- T-004 workspace/sensitive-path hard denial applies to every tool and patch target.
- Unified diff supports textual add/modify/delete only. It exact-matches every hunk. Malformed input returns `patch_invalid`; mismatched context returns `patch_conflict`; both are all-file atomic no-ops.
- Valid patches at 8192 bytes/10 paths remain automatic. Only greater values require approval; hard denials take precedence.
- File output caps are 100 entries, 64 KiB read text, 20 search matches, and 240 context characters per match.
- Memory is project-scoped, immutable to callers, and sensitive content returns `sensitive_content` before repository insertion. Context contains at most 12 whole entries and 4096 content characters.
- T-005 defines `MemoryRepository` plus fakes only. `better-sqlite3`, app-data paths, migrations, and Electron rebuild remain prohibited T-009 scope.

## File Map

| File | Responsibility |
| --- | --- |
| `packages/harness-core/src/file-tools.ts` | `WorkspaceFs`, bounded list/read/search, diff inspection, preflight, atomic patch. |
| `packages/harness-core/src/memory-store.ts` | Repository seam and memory validation/CRUD. |
| `packages/harness-core/src/context-builder.ts` | Stable priority and budgeted selection. |
| `packages/harness-core/src/guardrail.ts` | Patch target hard-denial and metadata threshold classification. |
| `packages/harness-core/src/llm.ts`, `agent-runner.ts` | Per-turn memory selection snapshot. |
| `packages/harness-core/src/index.ts` | New exports. |
| `packages/harness-core/test/file-tools.test.ts` | Tool limits, patch, redaction, atomicity. |
| `packages/harness-core/test/memory-store.test.ts` | Trust, isolation, deletion, immutability, budgets. |
| Existing guardrail/runner tests | Dispatch-before-approval and live-context proof. |

### Task 1: Bounded File Tools

**Files:** Create `src/file-tools.ts`, `test/file-tools.test.ts`; modify `src/index.ts`.

- [ ] **Step 1: Write failing read/list/search tests**

```ts
it("rejects .env and truncates a large normal read", async () => {
  await expect(tools.dispatch({ tool: "read_file", path: ".env" }, ctx)).resolves.toMatchObject({ status: "rejected", summary: "denied: sensitive_path" });
  await expect(tools.dispatch({ tool: "read_file", path: "src/a.ts" }, ctx)).resolves.toMatchObject({ status: "succeeded", truncatedOutput: expect.stringContaining("[truncated]") });
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts`

Expected: FAIL because `FileTools` does not exist.

- [ ] **Step 3: Implement minimal fake-friendly interface**

```ts
export interface WorkspaceFs { list(path: string, maxDepth: number): Promise<readonly string[]>; readText(path: string): Promise<string>; searchText(path: string, query: string): Promise<readonly SearchMatch[]>; snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string | undefined>>; commit(next: ReadonlyMap<string, string | undefined>): Promise<void>; }
export class FileTools implements ToolDispatcher { async dispatch(action: Action, context: DispatchContext): Promise<ToolResult> { /* switch */ } }
```

Handle only list/read/search/patch; return `skipped / unsupported_file_tool` otherwise. Enforce all output caps and never import `node:fs`.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts`

Expected: PASS for caps and sensitive-path rejection.

Commit: `git add packages/harness-core/src/file-tools.ts packages/harness-core/src/index.ts packages/harness-core/test/file-tools.test.ts; git commit -m "feat: add bounded workspace file tools"`

### Task 2: Strict Patch and HITL Metadata

**Files:** Modify `src/file-tools.ts`, `src/guardrail.ts`, `test/file-tools.test.ts`, `test/guardrail.test.ts`, `test/agent-runner.test.ts`.

- [ ] **Step 1: Write failing atomicity and threshold tests**

```ts
it("does not partially apply a conflicting multi-file patch", async () => { expect((await tools.dispatch(conflictingPatch, ctx)).summary).toBe("patch_conflict"); expect(await fs.readText("a.ts")).toBe("before-a"); });
it("pauses an 8193-byte patch before dispatch", async () => { expect((await runner.run(runWithPatch("x".repeat(8193)))).status).toBe("awaiting_approval"); expect(dispatcher.calls).toHaveLength(0); });
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts guardrail.test.ts agent-runner.test.ts`

Expected: FAIL because parsing/preflight/threshold governance are absent.

- [ ] **Step 3: Implement parser and atomic preflight**

```ts
export interface PatchMetadata { readonly byteLength: number; readonly affectedPaths: readonly string[]; }
export function inspectUnifiedDiff(patch: string): PatchMetadata | undefined { /* undefined is malformed only */ }
```

Parse `---`, `+++`, and `@@` sections; reject absolute paths, traversal, binary data, and malformed hunks. Use `Buffer.byteLength(patch, "utf8")`, preflight every hunk in memory, then issue exactly one commit after all targets succeed. No invalid/conflicting branch may commit.

- [ ] **Step 4: Connect T-004 classification**

Valid diff targets undergo canonical/sensitive checks. A hard-denied target remains denied. A valid metadata value greater than either threshold returns `require_approval`; at/below both returns `allow`. Malformed diff reaches FileTools only to return `patch_invalid`.

- [ ] **Step 5: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts guardrail.test.ts agent-runner.test.ts`

Expected: PASS for 8192/8193, 10/11, zero dispatch pre-approval, sensitive target, and atomic no-op.

Commit: `git add packages/harness-core/src/file-tools.ts packages/harness-core/src/guardrail.ts packages/harness-core/test/file-tools.test.ts packages/harness-core/test/guardrail.test.ts packages/harness-core/test/agent-runner.test.ts; git commit -m "feat: add strict patch application and approval thresholds"`

### Task 3: Memory Store and Context Builder

**Files:** Create `src/memory-store.ts`, `src/context-builder.ts`, `test/memory-store.test.ts`; modify `src/index.ts`.

- [ ] **Step 1: Write failing memory tests**

```ts
it("rejects sensitive content before repository insertion", () => { expect(() => memory.remember(agentObserved({ content: "TOKEN=secret-value" }))).toThrow("sensitive_content"); expect(repository.entries()).toEqual([]); });
it("omits deleted and cross-project entries within budgets", () => { const selected = builder.build({ projectId: "p1" }); expect(selected.entries).toHaveLength(12); expect(selected.totalCharacters).toBeLessThanOrEqual(4096); });
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run memory-store.test.ts`

Expected: FAIL because MemoryStore/MemoryRepository/ContextBuilder do not exist.

- [ ] **Step 3: Implement store and selection**

```ts
export interface MemoryRepository { insert(entry: MemoryEntry): void; listActive(projectId: string): readonly MemoryEntry[]; delete(projectId: string, memoryId: string, deletedAt: string): boolean; }
export interface SelectedMemoryContext { readonly entries: readonly MemoryEntry[]; readonly reasons: ReadonlyMap<string, "verified_fact" | "verification_context" | "agent_observed">; readonly totalCharacters: number; }
```

Validate through existing `memoryEntrySchema`; reject no-trace agent observations and sensitive content before repository access. Filter active project records and sort verified profile/command, failure resolution, remaining verified, then agent observations; tie-break by `updatedAt` descending then ID ascending. Add whole immutable entries only within both budgets.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run memory-store.test.ts`

Expected: PASS for trust, sensitivity, project isolation, deletion, immutable returns, deterministic order, and both budgets.

Commit: `git add packages/harness-core/src/memory-store.ts packages/harness-core/src/context-builder.ts packages/harness-core/src/index.ts packages/harness-core/test/memory-store.test.ts; git commit -m "feat: add project memory selection"`

### Task 4: Live Runner Integration and Evidence

**Files:** Modify `src/llm.ts`, `src/agent-runner.ts`, `src/index.ts`, `test/agent-runner.test.ts`, `docs/PLAN.md`, `docs/AGENT_LOG.md`, `docs/task-cards/T-005-file-tools-and-memory.md`; create `docs/verification/2026-07-15-t-005-file-tools-memory.md`.

- [ ] **Step 1: Write failing context snapshot test**

```ts
it("passes project-scoped memory to the LLM", async () => { await runner.run({ ...input, projectId: "p1" }); expect(llm.contexts[0].memory?.entries.map((entry) => entry.memoryId)).toEqual(["p1-profile"]); });
```

- [ ] **Step 2: Verify red and minimally connect Runner**

Run: `pnpm.cmd --filter @todex/harness-core test --run agent-runner.test.ts`

Expected: FAIL because LLM context has no memory snapshot and Runner has no builder.

Add optional `contextBuilder?: ContextBuilder` to Runner options and `memory?: SelectedMemoryContext` to LLM context. Build a fresh snapshot before every `nextAction`; no-builder remains an empty immutable context. ContextBuilder cannot dispatch, persist, or call the model.

- [ ] **Step 3: Verify task and write evidence**

Run: `pnpm.cmd --filter @todex/harness-core test --run agent-runner.test.ts file-tools.test.ts memory-store.test.ts`

Expected: PASS with immutable historic LLM contexts after later memory mutation.

Run: `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, `git diff --check`.

Expected: all pass; no secret, database, or build artifact is untracked.

Commit implementation: `git add packages/harness-core/src packages/harness-core/test; git commit -m "feat: add bounded file tools and project memory"`

Commit evidence: `git add docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-005-file-tools-and-memory.md docs/verification/2026-07-15-t-005-file-tools-memory.md; git commit -m "docs: record T-005 verification"`

Evidence must include red/green counts, changed files, Qwen commits, zero-dispatch approval evidence, atomic no-op proof, seeded-secret absence proof, Codex two-stage review, and explicit T-009 deferral.

## Plan Self-Review

Tasks 1-2 cover bounded tools, strict diffs, boundary checks, and approval. Task 3 covers trust, deletion, isolation, and selection. Task 4 proves the live Runner and course evidence. Every task names files, commands, thresholds, stable outcomes, and commits. T-002 types remain authoritative; SQLite stays T-009 scope.
