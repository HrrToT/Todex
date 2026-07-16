# T-006: Verification Feedback and Repair Limits

Status: ready
Responsible model: DeepSeek
Lead review: Codex
Branch: `feat/t-006-verification-feedback`
Base: `main` at `2bb742d`
Authority: `docs/SPEC.md` sections 5 and 12; `docs/superpowers/specs/2026-07-16-t-006-verification-feedback-design.md`; `docs/superpowers/plans/2026-07-16-t-006-verification-feedback.md`; `docs/PLAN.md` T-006.

## Goal

Implement deterministic primary-command verification after successful patches, bounded feedback to the next LLM turn, three additional repair opportunities, and safe terminal handling for environment failures.

## Allowed Files

- Create `packages/harness-core/src/verification-runner.ts`, `packages/harness-core/test/verification-runner.test.ts`, `packages/harness-core/test/repair-loop.test.ts`.
- Modify `packages/harness-core/src/llm.ts`, `src/agent-runner.ts`, `src/index.ts`.
- Modify existing `packages/harness-core/test/agent-runner.test.ts` only for T-006 fixture and integration assertions.

Stop and report before changing contracts, dependencies, package manifests, CI, Electron, app packages, project detector, persistence, or unrelated documentation.

## Frozen Rules

- Trigger verification only after a succeeded `apply_patch`; use one fixed confirmed command ID for the current project.
- LLM never supplies a command string or modifies argv, working directory, or timeout.
- Feedback is at most 2000 characters and 20 relative paths, after sensitive/absolute-path redaction.
- Initial patch does not count as a repair. At most three later successful repair patches may follow repairable failure; the third added repair failure ends `failed_repair_limit` with no more LLM turn.
- `test_failure`, `quality_failure`, `build_failure` are repairable. `command_not_found`, `dependency_missing`, `timeout`, `execution_error` stop `failed_environment`; cancellation stops `cancelled`; none consume repair attempts.
- Passed verification returns to the LLM; only explicit `finish(verified)` with a current pass becomes `completed`. No command or stale pass yields `completed_unverified`.
- Use injected fakes only. Do not spawn a real process, shell, network, database, or Electron component.

## TDD and Final Report

1. Write and run a failing test before each production behavior change.
2. Implement the minimum code and rerun the focused test to green.
3. Run every full command named in the implementation plan before committing final evidence.
4. Commit implementation separately from docs. Do not start T-007 or later tasks.
5. Report changed files, RED/GREEN evidence, commits, command authorization, redaction/truncation, repair-count proof, environment/cancellation behavior, assumptions, and controlled exceptions.
