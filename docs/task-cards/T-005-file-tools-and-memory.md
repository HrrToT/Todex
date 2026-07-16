# T-005: Bounded File Tools and Project Memory

Status: done
Responsible model: Qwen
Lead review: Codex
Branch: `feat/t-005-file-tools-memory`
Base: `main` at `f747692`
Authority: `docs/SPEC.md` sections 5, 6, and 12; `docs/superpowers/specs/2026-07-15-t-005-file-tools-memory-design.md`; `docs/superpowers/plans/2026-07-15-t-005-file-tools-memory.md`; `docs/PLAN.md` T-005.

## Goal

Implement live bounded file tools and project-memory context selection. Parsed actions retain T-004 Guardrail enforcement before Dispatcher; a large patch pauses for approval before any write. All tests use injected fakes and Mock LLMs.

## Allowed Files

- Create `packages/harness-core/src/file-tools.ts`, `src/memory-store.ts`, `src/context-builder.ts`.
- Modify `packages/harness-core/src/guardrail.ts`, `src/llm.ts`, `src/agent-runner.ts`, `src/index.ts`.
- Create `packages/harness-core/test/file-tools.test.ts`, `test/memory-store.test.ts`.
- Modify `packages/harness-core/test/guardrail.test.ts`, `test/agent-runner.test.ts` only for T-005 fixtures and exact integration assertions.

Stop and report before changing contracts, dependencies, package manifests, CI, Electron, app packages, or unrelated documentation.

## Frozen Rules

- Unified diff only; exact hunks; malformed is `patch_invalid`; conflict is `patch_conflict`; both are atomic no-ops.
- T-004 canonical workspace and sensitive-path hard denial applies to every target before approval.
- Valid patches above 8192 UTF-8 bytes or above 10 paths require HITL. Exact thresholds do not.
- Output limits: 100 list entries, 64 KiB read text, 20 search results, 240 result-context characters. Sensitive content appears in neither ToolResult nor trace.
- Memory is project-scoped. `agent_observed` needs trace IDs; sensitive content returns `sensitive_content` before insertion. Context contains at most 12 whole entries and 4096 content characters.
- Only a `MemoryRepository` seam and fakes are allowed. `better-sqlite3`, database paths/migrations, and Electron rebuild remain T-009 work.

## Required TDD and Report

1. Write each failing test first and run it before production code.
2. Implement the smallest code required, then rerun the focused suite.
3. Run all Task 4 verification commands before the final commits.
4. Commit implementation separately from evidence; do not start T-006.
5. Report changed files, red/green output, commits, Dispatcher counts, atomic-conflict proof, seeded-secret absence proof, assumptions, and T-009 deferral.

## Completion Evidence

- Qwen implementation and repair commits: `d256648`, `4f64d43`, `e17a23d`, `ec7267c`, `821a6e4`, `660546e`, `9421249`, `212a331`.
- Codex ran a specification-compliance review followed by a code-quality/security review. The review repaired fail-open large-patch classification, inactive `remember` dispatch, malformed diff acceptance, unverified/non-factual trace evidence, adapter error leakage, and mutable context containers.
- Final independent verification: `pnpm.cmd test --run` 269/269; `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd build` all exit 0.
- No P0/P1 remains within T-005's frozen scope. Production SQLite persistence, real filesystem host adapters, and Electron packaging remain T-009 work.
