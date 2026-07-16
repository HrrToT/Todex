# T-006 Verification Feedback and Repair Limits Verification

Status: verified
Verification date: 2026-07-16
Verification branch: `feat/t-006-verification-feedback`
Base: `main` at `2bb742d`

## Scope

This record verifies deterministic primary-command verification after successful patches, bounded feedback to the next LLM turn, three additional repair opportunities, and safe terminal handling for environment failures and cancellation. It covers confirmed-command authorization, all nine verification classifications, 2000-character/20-path feedback redaction, repair-count enforcement, environment-stop behavior, cancellation safety, verified/unverified finish rules, and T-003 through T-005 backward compatibility. It does not claim real process execution, project detection, SQLite persistence, Electron, or network coverage; those are T-007, T-009, and later tasks.

## Implementation and review chain

| Commit | Purpose |
| --- | --- |
| `c5247a0` | `feat: add deterministic verification runner` — `VerificationRunner`, `CommandRunner`, `ConfiguredCommandRegistry`, `VerificationFeedback`, classification mapping, redaction, truncation, 20-path cap |
| `9733abb` | `feat: feed verification into repair loop` — `LlmTurnContext.verification`, `RunnerOptions.verificationRunner`/`verificationCommandId`, patch trigger, `verification_completed` trace, verified/unverified finish, pass invalidation |
| `f6365f8` | `feat: enforce repair limits and environment stops` — initial-plus-three repair limit, `failed_repair_limit`, `failed_environment`, cancellation before/after verification, quality/build repair paths |
| `8c3ec90` | `fix: repair-loop test type alignment for verification feedback` — typecheck fix for `getVerification` return type |

## Red-green evidence

| Stage | Command | Result |
| --- | --- | --- |
| Task 1 RED | `pnpm.cmd --filter @todex/harness-core test --run verification-runner.test.ts` | 0 tests collected; `Failed to load url ../src/verification-runner.js` |
| Task 1 GREEN | Same | 22/22 passed |
| Task 2 RED | `pnpm.cmd --filter @todex/harness-core test --run repair-loop.test.ts` | 5 failed / 1 passed (6 total); `verification` field undefined in LLM contexts |
| Task 2 GREEN | Same | 6/6 passed |
| Task 3 RED | Tests added to `repair-loop.test.ts`; implementation already in Task 2 | 15/15 passed (implementation from Task 2 covered all Task 3 cases) |
| Task 3 GREEN | `pnpm.cmd --filter @todex/harness-core test --run repair-loop.test.ts verification-runner.test.ts` | 37/37 passed |
| Full suite | `pnpm.cmd test --run` | 306/306 passed across 10 test files |
| Type safety | `pnpm.cmd typecheck` | Exit code 0 |
| Lint | `pnpm.cmd lint` | Exit code 0 |
| Build | `pnpm.cmd build` | Exit code 0; contracts TypeScript build executed |
| Whitespace | `git diff --check` | No whitespace errors |
| Status | `git status --short` | Clean working tree after final commit |

## Confirmed-command authorization proof (projectId / confirmedByUser / commandId anti-bypass)

The `VerificationRunner.run` method resolves commands exclusively through the injected `ConfiguredCommandRegistry.find(projectId, commandId)`. The LLM never supplies `argv`, `workingDirectory`, or `timeoutMs`; these come from the frozen `ConfiguredCommand`:

| Test | Assertion |
| --- | --- |
| `runs only a confirmed command for the current project` | `commandRunner.calls` equals `[{ argv: ["pnpm", "test"], workingDirectory: ".", timeoutMs: 10_000 }]` — argv from registry, not LLM |
| `does not call CommandRunner for unknown command` | `classification` is `command_not_found`; `commandRunner.calls` length is 0 |
| `does not call CommandRunner for mismatched project` | `classification` is `command_not_found`; `commandRunner.calls` length is 0 |
| `does not call CommandRunner for unconfirmed command` | `classification` is `command_not_found`; `commandRunner.calls` length is 0 |

The `ConfiguredCommand` schema (T-002 contracts) enforces `confirmedByUser: boolean` and rejects shell concatenation characters in `argv`. The `AgentRunner` passes only the fixed `verificationCommandId` to `VerificationRunner.run`; the LLM has no action variant that can alter it.

## 2000-character, 20-path, sensitive-value and absolute-path redaction proof

| Test | Assertion |
| --- | --- |
| `redacts sensitive values from failure summary` | `failureSummary` does not contain `secret-value` or `another-secret`; contains `[REDACTED]` |
| `redacts absolute host paths from failure summary` | `failureSummary` does not contain `C:\Users` |
| `redacts unix absolute paths from failure summary` | `failureSummary` does not contain `/home/user` |
| `truncates failure summary to at most 2000 characters` | `failureSummary.length <= 2000` for 2500-char input |
| `retains at most 20 related paths` | `relatedPaths.length` is 20 for 25-path input |
| `extracts only relative paths as related paths` | `relatedPaths` contains `src/relative/file.ts` and `packages/core/lib.ts`; no path containing `Users` |
| `does not leak sensitive values into related paths` | `failureSummary + relatedPaths.join("")` does not contain `secret-value` |
| `produces a full 2500-char seeded error with redaction and limits` | `failureSummary.length <= 2000`; `relatedPaths.length <= 20`; no `secret-value`; no `C:\Users`; exactly 20 paths retained |

Redaction order: `redactSensitiveValues` replaces `KEY=value` patterns with `KEY=[REDACTED]`, then `redactAbsolutePaths` replaces Windows (`C:\...`) and Unix (`/path/...`) absolute paths with `[REDACTED_PATH]`. The Unix pattern uses a negative lookbehind `(?<![^\s])` to avoid matching the `/` inside relative paths like `src/file.ts`. Path extraction runs on the already-redacted text, so absolute paths and sensitive values cannot appear in `relatedPaths`.

## Initial patch plus three additional repairs with no fifth LLM call

The test `stops after the initial patch plus three failed repair patches without a fifth LLM call` proves the exact repair budget:

- LLM script: 4 `apply_patch` actions (initial + 3 repairs).
- `CommandRunner` returns `test_failure` for all 4 verifications.
- `result.status` is `failed_repair_limit`.
- `llm.contexts` length is 4 — no fifth LLM call.
- `commandRunner.calls` length is 4 — one verification per patch.
- `repairAttempts` in feedback: context[1] = 0, context[2] = 1, context[3] = 2. No context[4] feedback because the run stops.

Repair-count logic: the initial patch does not increment `repairAttempts` (no prior repairable failure). Each subsequent patch after a repairable failure increments `repairAttempts` to 1, 2, and 3. When `repairAttempts >= 3` and the verification is still repairable, the Runner transitions to `failed_repair_limit` without calling `nextAction` again.

## Environment failure and cancellation no-extra-execution proof

### Environment failures

The `it.each` test covers all four environment classifications:

| Condition | Result status | Stop reason | LLM contexts | CommandRunner calls |
| --- | --- | --- | --- | --- |
| `dependency_missing` | `failed_environment` | `dependency_missing` | 1 | 1 |
| `command_not_found` | `failed_environment` | `command_not_found` | 1 | 1 |
| `timeout` | `failed_environment` | `timeout` | 1 | 1 |
| `execution_error` | `failed_environment` | `execution_error` | 1 | 1 |

In all cases, `llm.contexts` length is 1 (no second LLM turn) and `repairAttempts` is not consumed. The Runner appends `verification_completed` and `run_failed` traces, then returns the terminal result.

### Cancellation before verification

The test `cancels safely before verification without extra dispatch or LLM turn` proves:
- `result.status` is `cancelled`.
- `commandRunner.calls` length is 0 — verification was not executed.
- `llm.contexts` length is 1 — no second LLM turn.
- `dispatcher.calls` length is 1 — only the patch was dispatched; no extra dispatch after cancellation.

The cancellation flag is set during the `onTurn` callback. When `runVerification` checks `cancelledRuns` before calling `CommandRunner.run`, it detects the cancellation, appends `run_cancelled`, and returns `cancelled` without invoking the `CommandRunner` or calling the LLM again.

### Cancellation after verification

The test `cancels safely after verification without extra LLM turn` proves:
- `result.status` is `cancelled`.
- `llm.contexts` length is 1 — no second LLM turn.

The `CancellingCommandRunner` sets the cancellation flag during `CommandRunner.run`. When `runVerification` checks `cancelledRuns` after the `CommandRunner.run` call returns, it detects the cancellation, appends `verification_completed` and `run_cancelled`, and returns `cancelled` without calling the LLM again.

## Verified finish and no-command downgrade

| Test | Assertion |
| --- | --- |
| `feeds a failed verification to the next turn then completes after pass and finish` | `finish(verified)` with current `passed` → `completed` |
| `completes as completed_unverified when verification runner is set but no command id` | `finish(verified)` with `verificationRunner` but no `verificationCommandId` → `completed_unverified` |
| `completes as completed_unverified when finish(verified) has no current pass` | `finish(verified)` with `verificationRunner` and `verificationCommandId` but no prior patch → `completed_unverified` |
| `invalidates a prior pass when a later patch is applied` | Patch 1 passes, Patch 2 fails → `finish(verified)` → `completed_unverified` |
| `completes as completed when pass is still current and finish(verified) is sent` | Patch passes, `finish(verified)` → `completed` |
| `preserves T-003 to T-005 behavior when verification options are absent` | No `verificationRunner` → `finish(verified)` → `completed` (original behavior) |

The `AgentRunner` distinguishes:
1. No `verificationRunner` in `RunnerOptions` → T-003 to T-005 behavior: `finish(verified)` → `completed`.
2. `verificationRunner` present but no `verificationCommandId` → no verification runs: `finish(verified)` → `completed_unverified`.
3. `verificationRunner` and `verificationCommandId` present, `latestVerification.classification === "passed"` → `finish(verified)` → `completed`.
4. `verificationRunner` and `verificationCommandId` present, no current pass → `finish(verified)` → `completed_unverified`.

A successful later patch clears `latestVerification` before running new verification, invalidating any prior pass.

## Quality and build repair paths

The `it.each` test proves `quality_failure` and `build_failure` are repairable:

| Condition | Feedback classification | After repair | Result status |
| --- | --- | --- | --- |
| `quality_failure` | `quality_failure` | `passed` | `completed` |
| `build_failure` | `build_failure` | `passed` | `completed` |

## Full repository verification output summary

```
pnpm.cmd test --run     → 306/306 passed (10 test files)
pnpm.cmd typecheck      → Exit code 0
pnpm.cmd lint           → Exit code 0
pnpm.cmd build          → Exit code 0
git diff --check        → No whitespace errors
git status --short      → Clean
```

Test file breakdown:
- `contracts.test.ts`: 37 tests
- `agent-runner.test.ts`: 36 tests
- `guardrail.test.ts`: 75 tests
- `file-tools.test.ts`: 50 tests
- `memory-store.test.ts`: 28 tests
- `approval-state-machine.test.ts`: 38 tests
- `trace-store.test.ts`: 4 tests
- `smoke.test.ts`: 1 test
- `verification-runner.test.ts`: 22 tests
- `repair-loop.test.ts`: 15 tests

## Assumptions and controlled exceptions

1. **State machine proxy for terminal states**: `RunStateMachine` (T-004) does not include `failed_repair_limit` or `failed_environment` in its `RunState` type. The `AgentRunner` transitions the state machine to `"failed"` as a proxy and reports the specific `RunStatus` (`failed_repair_limit` or `failed_environment`) in the `RunResult`. This is within the allowed files boundary (only `agent-runner.ts` was modified, not `run-state-machine.ts`).

2. **`command_not_found` dual semantics**: When `verificationCommandId` is set but the command is not in the registry, `VerificationRunner.run` returns `command_not_found` without calling `CommandRunner`. The `AgentRunner` treats this as `failed_environment`, consistent with the classification table. When `verificationCommandId` is not set at all, no verification runs and `finish(verified)` yields `completed_unverified`. The design's "no confirmed primary command" clause is interpreted as `verificationCommandId` being absent, not as a registry miss.

3. **`VerificationRunner` has no `hasConfirmedCommand` method**: The `AgentRunner` calls `VerificationRunner.run` directly. A registry miss returns `command_not_found` with `durationMs: 0`, which the `AgentRunner` treats as `failed_environment`. This is simpler than adding a separate lookup method and is consistent with the classification table.

4. **No real process execution**: All `CommandRunner` implementations in tests are injected fakes. No real shell, process, network, or database is used. The `CommandExecution.condition` field is an injected deterministic value; Core does not parse real terminal output.

5. **Approval-path verification**: The `decideApproval` method also triggers verification after a successful approved `apply_patch`, using the same `runVerification` method. This ensures verification runs regardless of whether the patch was auto-allowed or human-approved.

6. **Feedback is per-turn immutable**: `verificationFeedback` is stored in `RunState` and copied into each `LlmTurnContext` before the LLM call. A new verification result replaces the old feedback; the LLM never sees stale feedback from a prior verification cycle.

## T-007 and T-009 deferral

T-006 consumes only injected `ConfiguredCommand` objects. Project detection (proposing candidate commands) is T-007. SQLite persistence of confirmed commands is T-009. No real Node `child_process`, no `better-sqlite3`, no Electron, and no network call was introduced.
