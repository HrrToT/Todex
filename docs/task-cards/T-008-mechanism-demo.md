# T-008: Deterministic Mechanism Demo

Status: ready
Responsible model: GLM
Lead review: Codex
Branch: `feat/t-008-mechanism-demo`
Base: current `main` plus T-008 design/plan commits
Authority: `docs/SPEC.md` AC-01, AC-04, AC-05, AC-06; T-008 design and plan; `docs/PLAN.md` T-008.

## Goal

Implement one Mock-only evidence command that proves workspace hard denial, feedback-driven repair, and approval isolation through the existing Harness Core.

## Allowed Files

- Create `packages/harness-core/src/mechanism-demo.ts` and `packages/harness-core/test/mechanism-demo.test.ts`.
- Modify `packages/harness-core/src/index.ts`.
- Create `scripts/run-mechanism-demo.ts` and `scripts/test/run-mechanism-demo.test.ts`.
- Modify `tsconfig.base.json` only to include `scripts/**/*.ts` in the existing root TypeScript check.
- Modify `vitest.workspace.ts` only to include the `scripts` Vitest project alongside `packages/*`.
- Modify root `package.json` and `pnpm-lock.yaml` only to add `tsx` and `demo:mechanisms`.
- Modify T-008 completion evidence files named in the implementation plan.

Stop and report before changing contracts, CI, Electron, apps, Guardrail, AgentRunner, file tools, existing example files, project detector, persistence, or unrelated documentation.

## Frozen Rules

- All three scenarios use fresh in-memory fakes and existing Core classes. Never execute a real shell/project command, Node/Python test, network operation, model call, Electron API, SQLite query, or filesystem workspace mutation.
- Scenario one hard-denies `../.ssh/id_rsa` before dispatch. Scenario two uses an in-memory Node arithmetic bug, two fake verification results (`test_failure`, then `success`), and an explicit verified finish. Scenario three approves `npm install` for Run A only and proves Run B pauses before dispatch.
- The report is immutable and contains only statuses, trace event type names, counts, fixed reasons/scopes, and booleans. It must not contain shell text, patch/source text, workspace path, raw output, key, secret, or exception text.
- CLI writes only `.todex/demo/mechanism-report.json`, prints fixed summary lines, and fails nonzero with fixed output when report generation/writing fails.
- `tsx` is a root development host only. `pnpm.cmd demo:mechanisms` is the exact user command.
- Root `pnpm.cmd test --run` must discover `scripts/test/run-mechanism-demo.test.ts`, and root `pnpm.cmd typecheck` must compile `scripts/**/*.ts`; do not add a second typecheck command or an untracked script-only config.
- Do not push, create a PR, merge main, or begin T-009.

## TDD and Final Report

1. Follow the implementation plan in order; run a RED test before each production behavior change.
2. Run every focused and final command in the plan using `pnpm.cmd`.
3. Commit scenarios, CLI/dependency, and documentation evidence separately.
4. Report full commit hashes, changed files, RED/GREEN evidence, JSON redaction proof, AC mapping, generated-file ignore proof, assumptions, and controlled exceptions.

## Completion

Status: implemented; awaiting Codex two-stage review
Branch: `feat/t-008-mechanism-demo`
Base: `5954e7b` (current `main` plus T-008 design/plan commits)

Commits:
- `12a4782eac789f910693867a76fba802148e76a7` — `test: add deterministic mechanism scenarios` (scenario module + exports + 6 tests)
- `1d44ccd8acc1b0be56326250136a23fee8907895` — `feat: add mechanism demo command` (CLI + `tsx` + 3 tests + tsconfig/vitest/workspace/package/lockfile)
- documentation evidence commit (this change)

Verification commands (all passed):
- `pnpm.cmd demo:mechanisms` — exit 0; four fixed summary lines; `.todex/demo/mechanism-report.json` written with `allPassed: true`.
- `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts` — 6/6 passed.
- `pnpm.cmd test --run` — 376/376 passed across 13 test files.
- `pnpm.cmd typecheck` — exit 0 (compiles `packages/**` and `scripts/**`).
- `pnpm.cmd lint` — exit 0.
- `pnpm.cmd build` — exit 0.
- `git diff --check` — no whitespace errors.

Evidence: `docs/verification/2026-07-17-t-008-mechanism-demo.md`.

Controlled exceptions: scenario 1 finish uses default `verified` completion (plan's `unverified` would yield `completed_unverified`, conflicting with the frozen test and design); scenario 3 uses one shared `AgentRunner` with a single three-item `ScriptedMockLlm` (the runner's LLM is fixed at construction); per-run dispatcher counting via `context.runId`. See the verification record for the full list.

PR: not created (per frozen rule). Codex lead handles PR, CI, and merge after two-stage review.
