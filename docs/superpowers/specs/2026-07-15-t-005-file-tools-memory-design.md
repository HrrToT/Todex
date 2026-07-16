# T-005 File Tools and Project Memory Design

## Status and Authority

Status: approved design, awaiting user review of this written record.

This document freezes the T-005 design approved on 2026-07-15. It refines, but does not replace, [SPEC section 5](../../SPEC.md), [SPEC section 6](../../SPEC.md), [SPEC section 12](../../SPEC.md), and [PLAN T-005](../../PLAN.md). The T-002 contract schemas remain the sole authority for `Action`, `ToolResult`, `MemoryEntry`, and `TraceEvent` fields.

## Goal

Add deterministic, bounded file-tool behavior to the existing `AgentRunner` Dispatcher boundary and add memory-selection semantics that are safe to test before desktop persistence is introduced. The implementation must make a Mock LLM workflow able to inspect, search, patch, remember, and reuse project facts without a real LLM or unrestricted filesystem.

T-005 is owned by Qwen for implementation. Codex prepares the task card, verifies red/green evidence, reviews specification compliance and security properties, and integrates only through an isolated branch and PR.

## Scope

T-005 creates `file-tools.ts`, `memory-store.ts`, `context-builder.ts`, and focused tests. It may make the minimum required `AgentRunner`, dispatcher, and Guardrail integration changes to dispatch these tools and classify patch metadata. It adds no Electron UI, IPC, real LLM client, real shell, project detector, verification runner, Credential Manager, or database migration framework.

SQLite durability is deliberately not implemented in T-005. T-005 exposes a repository seam and tests it with deterministic in-memory or temporary fakes. T-009 owns `better-sqlite3`, application-data directory resolution, schema migrations, Electron native-module packaging, and persistence for runs, traces, approvals, commands, and memory. This preserves the approved task boundary while making the later durable implementation mechanically substitutable.

## File Tool Boundary

`FileTools` depends on an injected `WorkspaceFs` adapter. Production host adapters are deferred; tests use an in-memory workspace that can model files, directories, symlinks, and write failures. Before every path-bearing operation, the tool uses the T-004 canonical path resolver and sensitive-path policy. It never calls an unrestricted Node filesystem API directly from the harness core.

### Bounded Reads and Search

- `list_files` returns at most 100 entries and reports `truncated` when more are present.
- `read_file` reads at most 64 KiB of text and reports a truncation marker rather than returning unbounded content.
- `search_text` returns at most the action's validated result count, capped at 20 by the tool, and each result has at most 240 characters of context.
- Binary files, workspace escape, symlink escape, and sensitive paths return structured failure or rejection summaries without contents.
- Tool-result summaries, trace payloads, and failure text must not expose secrets, credential values, or sensitive-file contents.

### Unified Diff Patches

`apply_patch` accepts only non-empty unified diff text from the existing `Action` contract. The parser supports additions, modifications, and deletions. It rejects malformed diff headers, unsupported paths, sensitive paths, workspace escapes, and binary or oversized target files before writing anything.

Every hunk uses strict context matching. There is no fuzzy placement, offset search, or partial success. If any hunk does not match the current file text, the operation returns a failed `ToolResult` with summary `patch_conflict`; all files remain unchanged. Valid multi-file patches are preflighted first and then committed atomically through the injected adapter. An adapter write failure similarly leaves no partial patch state.

`PatchInspector` derives only metadata needed by governance: UTF-8 patch byte length and distinct affected-file count. A patch whose size exceeds 8 KiB or whose affected-file count exceeds 10 requires the existing HITL path before FileTools executes it. A patch at or below both thresholds remains a normal workspace patch. Hard-deny path and sensitive-file rules always take precedence over approval.

## Memory and Context Boundary

`MemoryStore` is responsible for validating, storing, listing, and deleting `MemoryEntry` records through an injected `MemoryRepository`. A repository query is always scoped by `projectId`; no selection method may read across projects.

`verified` records may be created only from project detection, a user confirmation, or a concrete tool or verification result. `agent_observed` records must carry at least one non-empty `sourceTraceId`, as already enforced by the T-002 contracts. Sensitive content is rejected before repository insertion with `sensitive_content`; Todex stores neither a raw value, a redacted copy, nor a hash for this failure category.

Deletion is logical or physical at repository discretion, but it is durable at the repository boundary: a record deleted for one project cannot be returned by a later list or context-selection call for that project. The implementation returns immutable record copies so callers cannot mutate repository state through aliases.

`ContextBuilder` chooses at most 12 entries and at most 4096 characters of memory content for one project. It orders eligible records by: verified project facts and user-confirmed commands, current verification or failure context, then trace-backed agent observations. It emits an explanation for each selected entry using only its memory ID, kind, trust level, and selection reason. It never includes deleted records, a different project's records, or rejected sensitive input.

## Failure and Security Semantics

| Condition | Outcome | Dispatcher/file write |
| --- | --- | --- |
| Workspace or symlink escape | hard deny | no file operation |
| Sensitive path or sensitive memory content | hard deny / `sensitive_content` | no content returned or stored |
| Malformed unified diff | failed `patch_invalid` | no file write |
| Hunk context mismatch | failed `patch_conflict` | atomic no-op |
| Patch over 8 KiB or over 10 files | `awaiting_approval` | no file write before approval |
| Read/search output beyond limits | succeeded with truncation marker | bounded result only |
| Repository or adapter error | failed, redacted stable summary | no partial observable state |

## Acceptance Tests

Qwen must start from red tests. The focused suites must prove at least:

1. A normal source read/search is bounded and succeeds, while `.env`, case variants, `.git/config`, and symlink/workspace escape reveal no content.
2. A valid unified diff changes the intended in-memory workspace files; malformed diffs and a single conflict in a multi-file patch leave every target unchanged.
3. A patch over the size or file-count threshold pauses through the existing approval path and does not write before an explicit valid decision.
4. Tool results and traces do not include a seeded token or sensitive-file body.
5. Verified memory is prioritized; an agent-observed entry without trace evidence is rejected; sensitive memory is rejected before persistence.
6. Memory is scoped by project, deletion removes it from a newly built context, and selection never exceeds 12 entries or 4096 characters.
7. Repository returns are immutable from the caller's perspective.

Required commands after implementation are `pnpm.cmd --filter @todex/harness-core test --run file-tools.test.ts memory-store.test.ts`, then `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd build`.

## Non-goals and Deferred Work

- No general patch engine that applies fuzzy or semantically inferred changes.
- No real project filesystem or database path in harness-core tests.
- No `better-sqlite3` dependency, migration, or Electron rebuild in T-005; all are T-009 work.
- No verification feedback loop or repair-attempt logic; T-006 owns that behavior.
- No Node/Python project detection; T-007 owns it.

## Design Self-Review

- Placeholder scan: no TODO/TBD or deferred behavior without a named owner task.
- Consistency: unified diff remains the existing `apply_patch` contract; T-004 retains all hard-deny and HITL decisions; T-009 remains the persistence owner.
- Scope: the task adds only file-tool and memory semantics, with the minimum metadata integration necessary to honor T-004 large-patch approval.
- Ambiguity resolved: strict hunk matching, atomic multi-file application, 8 KiB/10-file threshold, no sensitive-memory persistence, and 12-entry/4096-character context budget are exact rules.
