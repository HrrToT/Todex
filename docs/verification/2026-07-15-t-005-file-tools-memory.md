# T-005 File Tools and Project Memory Verification

Status: verified
Verification date: 2026-07-15
Verification branch: `feat/t-005-file-tools-memory`
Base: `main` at `f747692`

## Scope

This record verifies bounded file tools, strict unified-diff patch application, project-scoped memory selection, and live memory context integration in the `AgentRunner`. It covers sensitive-path rejection, output caps, atomic multi-file patches, HITL patch thresholds, memory trust validation, sensitive-content rejection, project isolation, deletion, immutability, context budgets, and per-turn memory snapshots. It does not claim real filesystem, SQLite persistence, Electron, network, or verification feedback coverage; those are T-009 and T-006 work.

## Implementation and review chain

| Commit | Purpose |
| --- | --- |
| `d256648` | Bounded workspace file tools: list/read/search with caps, sensitive-path rejection, unsupported-tool skip |
| `4f64d43` | Strict unified-diff parser, atomic preflight/commit, `patch_invalid`/`patch_conflict`, Guardrail patch metadata thresholds (8192 bytes / 10 files) |
| `e17a23d` | Project memory: `MemoryRepository` seam, `MemoryStore` with sensitive-content rejection, `ContextBuilder` with 12-entry/4096-char budgets |
| `ec7267c` | Live memory context: `LlmTurnContext.memory`, `RunnerOptions.contextBuilder`, per-turn snapshot |
| `821a6e4` | Codex P1/P2 review repairs: default patch inspection, strict multi-hunk application, concrete remember dispatcher, adapter error sanitization, and context budget continuation |
| `660546e` | Validate remember evidence belongs to the current Run and make context containers runtime-immutable |
| `9421249` | Restrict remember evidence to `tool_completed` and `verification_completed` traces only |
| `212a331` | Reject all unrecognized unified-diff content instead of silently ignoring it |

## Red-green evidence

| Stage | Command | Result |
| --- | --- | --- |
| Task 1 RED | `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts` | 0 tests collected; `Failed to load url ../src/file-tools.js` |
| Task 1 GREEN | Same | 26/26 passed |
| Task 2 RED | `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts guardrail.test.ts agent-runner.test.ts` | 16 failed / 103 passed (119 total) |
| Task 2 GREEN | Same | 119/119 passed (36 file-tools + 69 guardrail + 14 agent-runner) |
| Task 3 RED | `pnpm.cmd --filter @todex/harness-core test --run memory-store.test.ts` | 0 tests collected; `Failed to load url ../src/memory-store.js` |
| Task 3 GREEN | Same | 20/20 passed |
| Task 4 RED | `pnpm.cmd --filter @todex/harness-core test --run agent-runner.test.ts` | 4 failed / 14 passed (18 total) |
| Task 4 GREEN | Same | 18/18 passed |
| Codex final full suite | `pnpm.cmd test --run` | 269/269 passed across 8 test files |
| Type safety | `pnpm.cmd typecheck` | Exit code 0 |
| Lint | `pnpm.cmd lint` | Exit code 0 |
| Build | `pnpm.cmd build` | Exit code 0; contracts TypeScript build executed |

## Zero-dispatch approval evidence

The test `AgentRunner patch approval > pauses an 8193-byte patch before dispatch` proves that a patch exceeding the 8192-byte threshold enters `awaiting_approval` with zero Dispatcher calls:

- `expect(result.status).toBe("awaiting_approval")` — the run pauses.
- `expect(calls).toHaveLength(0)` — the Dispatcher was never invoked.

The Guardrail inspects the patch via `inspectUnifiedDiff`, classifies it as `require_approval` with risk reason `large_patch`, and the `AgentRunner` suspends before dispatch. A 8192-byte patch at the exact threshold dispatches normally (`calls.toHaveLength(1)`).

## Atomic no-op proof

The test `FileTools unified diff patches > does not partially apply a conflicting multi-file patch` proves that a multi-file patch with one conflicting hunk leaves every target unchanged:

- File `a.ts` hunk matches and would change `before-a` to `after-a`.
- File `b.ts` hunk expects `wrong-content` but the file contains `before-b`.
- Result: `summary` is `patch_conflict`.
- `fs.getFile("a.ts")` is still `before-a\n` (unchanged).
- `fs.getFile("b.ts")` is still `before-b\n` (unchanged).

The `FileTools.handleApplyPatch` method preflights all hunks in memory via `snapshot` before issuing a single `commit`. If any hunk fails context matching, no `commit` call is made.

## Seeded-secret absence proof

Multiple tests prove that a seeded secret (`TOKEN=secret-value` in `.env`) never appears in `ToolResult`, trace, `MemoryRepository`, or `SelectedMemoryContext`:

| Test | Assertion |
| --- | --- |
| `does not expose .env content in read ToolResult` | `result.summary` does not contain `secret-value`; `truncatedOutput` is undefined |
| `does not expose sensitive file content in search results` | `result.summary` does not contain `secret-value` or `.env` |
| `does not expose seeded secret in patch rejection` | `result.summary` does not contain `secret-value` |
| `rejects sensitive content before repository insertion` | `repository.all()` is empty after `sensitive_content` throw |
| `does not store a hash or redacted copy of rejected content` | `JSON.stringify(repository.all())` does not contain `hunter2` |
| `does not include rejected sensitive content in context` | `context.entries` is empty; `JSON.stringify(context)` does not contain `secret-value` |

Sensitive paths (`.env`, `.git/config`, `.npmrc`, `*.pem`, `*.key`, `credentials.*`, `.ssh/`, `.aws/`) are hard-denied before any file content is read. Sensitive memory content is detected by pattern matching and rejected before `MemoryRepository.insert`.

## Verified invariants

- `list_files` returns at most 100 entries with a `[truncated]` marker when more are present.
- `read_file` reads at most 64 KiB of UTF-8 text and reports `[truncated]` when the file is larger.
- `search_text` returns at most 20 results (capped from the action's `maxResults`), each with at most 240 characters of context.
- Sensitive paths, workspace escapes, and symlink escapes return `rejected` with `denied: sensitive_path` or `denied: workspace_escape` and no content.
- `apply_patch` accepts only non-empty unified diff text. Malformed diffs return `failed: patch_invalid`. Hunk context mismatches return `failed: patch_conflict`. Both are atomic no-ops.
- Valid multi-file patches are preflighted in memory and committed through a single `WorkspaceFs.commit` call.
- Patches exceeding 8192 UTF-8 bytes or 10 distinct affected paths require HITL approval before dispatch. Hard-deny path rules take precedence over approval.
- `HarnessDispatcher` validates every `remember` source ID before `MemoryStore` insertion: it must be unique, belong to the current Run, and identify a `tool_completed` or `verification_completed` event. Requested, approval, rejection, and terminal control-flow traces are not memory evidence.
- `MemoryStore` rejects `agent_observed` entries without trace IDs (via Zod schema) and sensitive content (via pattern matching) before repository insertion.
- `MemoryRepository` is project-scoped: `listActive` and `delete` never cross project boundaries.
- `ContextBuilder` selects at most 12 entries and 4096 content characters, prioritizing verified project facts, then failure resolutions, then remaining verified, then agent observations. Tie-break is `updatedAt` descending then `memoryId` ascending.
- `ContextBuilder` returns frozen immutable entry copies and frozen containers; its reason map holds its backing state in an ECMAScript private field, so callers cannot mutate a later context or the shared empty context through aliases.
- `AgentRunner` builds a fresh `SelectedMemoryContext` before every `nextAction` call. No builder yields an empty immutable context. Later memory mutations do not leak back into prior LLM turn contexts.

## T-009 deferral

T-005 defines only the `MemoryRepository` interface and a deterministic in-memory fake (`InMemoryMemoryRepository`). `better-sqlite3`, application-data directory resolution, schema migrations, Electron native-module packaging, and durable persistence for runs, traces, approvals, commands, and memory remain T-009 work. No real Node filesystem API, SQLite dependency, or network call was introduced in T-005.

## Assumptions and controlled exceptions

- The `WorkspaceFs` adapter is an injected interface; production host adapters are deferred. Tests use an in-memory fake that models files, directories, and write failures.
- Sensitive content detection uses conservative pattern matching for credential-like `key=value` pairs and PEM private key blocks. It may produce false positives on non-sensitive text that happens to match; this is safer than false negatives for T-005.
- The unified-diff parser handles standard `---`/`+++`/`@@` format with `a/`/`b/` prefixes and `/dev/null` for additions/deletions. It does not support `diff --git` extended headers beyond skipping them.
- New files created by `/dev/null` patches receive a trailing newline by default, consistent with standard unified-diff semantics when no `\ No newline at end of file` marker is present.
- Codex review found and Qwen repaired four P1 classes after the initial implementation report: optional patch-inspector fail-open, inactive `remember` dispatch, incomplete strict-diff handling, and unverified/non-factual trace evidence. These repairs were independently re-run before this record was updated.
