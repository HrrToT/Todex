# T-006 Verification Feedback and Repair-Limit Design

## Status and Authority

Status: approved design, awaiting review of this written record.

This document freezes the T-006 decisions approved on 2026-07-16. It refines [SPEC section 5](../../SPEC.md), [SPEC section 12](../../SPEC.md), and [PLAN T-006](../../PLAN.md). Existing T-002 contracts remain authoritative for `ConfiguredCommand`, `VerificationResult`, `VerificationClassification`, `RunStatus`, `TraceEvent`, and `ToolResult` fields.

## Goal

Give Todex a deterministic objective-feedback loop: after each successful code patch, it runs one user-confirmed primary verification command, classifies the bounded result, gives a repairable failure packet to the next LLM turn, and stops safely after a defined repair limit or environment failure.

DeepSeek implements the task in an isolated worktree. Codex owns the task card, independent red/green reproduction, specification review, code-quality/security review, PR, CI, and merge decision.

## Scope and Non-goals

T-006 adds `verification-runner.ts` and modifies the real `AgentRunner` path to carry verification feedback and repair state. All command execution is an injected fake `CommandRunner` in Core tests. No real shell, no direct process spawn, no user-provided command string, no Electron, no SQLite, no project detection, and no persistent command registry is introduced.

T-007 later proposes commands for Node/Python projects; T-009 later persists them. T-006 consumes an injected registry of existing `ConfiguredCommand` objects only. A command must match the current project and have `confirmedByUser === true`; the LLM never selects an arbitrary shell command or alters `argv`.

## Trigger and Command Selection

Only a successful `apply_patch` dispatch triggers verification. Read, list, search, remember, rejected/failed patch attempts, approvals, and finish do not trigger it. The Runner receives one injected `verificationCommandId`; it resolves exactly one confirmed primary command for the current project. It uses the command's frozen `argv`, `workingDirectory`, and `timeoutMs`.

When no confirmed primary command exists, no verification is run. A later `finish(completion: "verified")` returns `completed_unverified`, with a deterministic reason that verification was unavailable. This is not a test pass claim.

## Verification Boundary

```text
successful apply_patch
  -> VerificationRunner.run(projectId, verificationCommandId)
  -> ConfiguredCommandRegistry exact lookup and confirmation check
  -> CommandRunner.run(fixed argv, workingDirectory, timeoutMs)
  -> VerificationResult + verification_completed trace
  -> bounded VerificationFeedback in next LlmTurnContext
```

`CommandRunner` returns an injected result containing exit status, duration, stdout/stderr or a typed execution condition. `VerificationRunner` converts it to the existing `VerificationResult` contract. It strips sensitive values and absolute host paths before creating `failureSummary`; it retains at most 2000 characters and at most 20 related paths. The LLM receives only this bounded projection, never raw process output.

## Classification and Terminal Behavior

| Result condition | Classification | Runner behavior |
| --- | --- | --- |
| Exit code 0 | `passed` | Store latest pass, append trace, return to LLM for explicit finish. |
| Test assertion failure | `test_failure` | Repairable: feedback is returned to LLM. |
| Lint/format/static quality failure | `quality_failure` | Repairable: feedback is returned to LLM. |
| Build/typecheck failure | `build_failure` | Repairable: feedback is returned to LLM. |
| Executable unavailable | `command_not_found` | Stop `failed_environment`; no repair count. |
| Dependency/module missing | `dependency_missing` | Stop `failed_environment`; no repair count. |
| Confirmed timeout exceeded | `timeout` | Stop `failed_environment`; no repair count. |
| Other runner failure | `execution_error` | Stop `failed_environment`; no repair count. |
| Run cancellation | `cancelled` | Stop `cancelled`; no repair count. |

The classification input is injected and deterministic; Core does not parse arbitrary real terminal output. Test fixtures explicitly declare each condition and its bounded summary/related paths.

## Repair Limit and Completion

The first successful patch is the initial attempt and does not increment `repairAttempts`. If its verification is repairably failed, the result is sent to the next LLM turn. The following three successful patches are additional repair attempts and increment `repairAttempts` to 1, 2, and 3 respectively.

If the third additional repair patch still receives a repairable failure, the Runner appends the verification trace, transitions to `failed_repair_limit`, and does not call the LLM again. Rejected, conflicted, cancelled, and environment-failed patch paths do not consume repair attempts.

After `passed`, the Runner gives the LLM a final context containing the pass result. It reaches `completed` only when the LLM emits `finish(completion: "verified")` while that pass is still current. Any later successful patch invalidates the earlier pass and triggers a new verification. `finish(completion: "unverified")` remains `completed_unverified`.

## Public Integration Shape

`LlmTurnContext` gains optional `verification?: VerificationFeedback`, where the feedback is a bounded immutable projection of the latest `VerificationResult` plus current repair count. `RunnerOptions` gains an optional verification coordinator and an optional primary command ID. Existing T-003 through T-005 behavior remains compatible when verification is absent.

The Runner owns all state transitions and is the only component that decides whether another LLM turn is permitted. `VerificationRunner` has no access to the LLM, patch tool, approval store, or filesystem tools. `ConfiguredCommandRegistry` cannot execute a command and only returns immutable confirmed command data.

## Acceptance Tests

DeepSeek must write and observe red tests before each implementation step. Required deterministic tests include:

1. Initial patch -> `test_failure` -> feedback in the next LLM context -> repair patch -> `passed` -> explicit verified finish -> `completed`.
2. Four consecutive repairable verification failures: one initial patch plus three additional repairs, ending `failed_repair_limit` with no fifth LLM request.
3. `dependency_missing`, `command_not_found`, `timeout`, and `execution_error` each end `failed_environment` without incrementing repair attempts or calling the LLM again.
4. Unknown command ID, unconfirmed command, and project mismatch do not reach CommandRunner.
5. No command causes verified finish to become `completed_unverified` rather than `completed`.
6. A pass followed by another successful patch invalidates the old pass and requires fresh verification before verified completion.
7. Failure feedback is capped at 2000 characters and 20 paths, excludes seeded sensitive values/absolute paths, and is copied per LLM context.
8. Cancellation before or during verification produces `cancelled` and does not dispatch another action.

## Design Self-Review

- Placeholder scan: no TODO/TBD or unowned deferred behavior exists.
- Consistency: only confirmed fixed `argv` reaches CommandRunner; T-004 governance remains before Dispatcher; T-005 patch success is the only trigger; T-007 and T-009 retain detection/persistence ownership.
- Scope: one verification command per successful patch, injected fake execution, bounded feedback, and repair state fit one task without introducing process execution or UI.
- Ambiguity resolved: trigger, command selection, classifications, exact repair count, completion after pass, no-command outcome, and feedback budget are explicit.
