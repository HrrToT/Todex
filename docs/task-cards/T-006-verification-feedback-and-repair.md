# T-006: Verification Feedback and Repair Limits

Status: implemented, awaiting review
Responsible model: DeepSeek
Lead review: Codex
Branch: `feat/t-006-verification-feedback`
Base: `main` at `2bb742d`
Authority: `docs/SPEC.md` sections 5 and 12; `docs/superpowers/specs/2026-07-16-t-006-verification-feedback-design.md`; `docs/superpowers/plans/2026-07-16-t-006-verification-feedback.md`; `docs/PLAN.md` T-006.

## Goal

Implement deterministic primary-command verification after successful patches, bounded feedback to the next LLM turn, three additional repair opportunities, and safe terminal handling for environment failures.

## Implementation Commits

| Commit | Purpose |
| --- | --- |
| `c5247a0` | `feat: add deterministic verification runner` |
| `9733abb` | `feat: feed verification into repair loop` |
| `f6365f8` | `feat: enforce repair limits and environment stops` |
| `8c3ec90` | `fix: repair-loop test type alignment for verification feedback` |

## Changed Files

- Created: `packages/harness-core/src/verification-runner.ts`
- Created: `packages/harness-core/test/verification-runner.test.ts`
- Created: `packages/harness-core/test/repair-loop.test.ts`
- Modified: `packages/harness-core/src/llm.ts`
- Modified: `packages/harness-core/src/agent-runner.ts`
- Modified: `packages/harness-core/src/index.ts`

## Verification

Full evidence in `docs/verification/2026-07-16-t-006-verification-feedback.md`.

- 306/306 tests pass; typecheck, lint, build all pass.
- Confirmed-command authorization: projectId/confirmedByUser/commandId anti-bypass tests pass.
- 2000-char/20-path redaction with sensitive-value and absolute-path stripping tests pass.
- Initial patch + three additional repairs with no fifth LLM call test passes.
- All four environment failures stop as `failed_environment` without consuming repair attempts.
- Cancellation before and after verification produces `cancelled` with no extra dispatch or LLM turn.
- T-003 to T-005 backward compatibility preserved when verification options are absent.
