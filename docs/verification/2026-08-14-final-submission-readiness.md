# Final Submission Readiness Verification

**Date:** 2026-08-14
**Branch:** `codex/final-submission-readiness`
**Base:** `origin/main` at `e10e597e41a7dd489895bcc374a863db80cef7e8`
**Scope:** close documented course-submission gaps without weakening Todex governance or credential boundaries.

## Implemented Changes

| Commit | Change |
| --- | --- |
| `b631c70` | Added strict, narrow `credential.save` IPC. It calls `WorkspaceHost.saveCredential` and returns only `{ configured: true }`. |
| `13f7f35` | Added invalid-input and host-exception redaction coverage for credential save. |
| `fa63fc6` | Added first-run, update, and clear Credential Manager controls in the desktop workbench. |
| `91ec3d9` | Handles credential-clear failures with a redacted localized notice while retaining the configured state. |
| `4636dce` | Prevents delayed credential-status responses from overwriting a newer model selection. |
| `8127b5f` | Added GitLab-compatible `unit-test` CI job and reconciled release/course documents. |

The renderer accepts a password only as short-lived component state. It clears that state before awaiting the save IPC, never displays or pre-fills the value, and has no credential-read capability. The main process remains the sole runtime credential reader. The API key is not included in Git, SQLite, trace, logs, exports, model configuration persistence, or renderer query projections.

## RED / GREEN Evidence

| Area | RED evidence | GREEN evidence |
| --- | --- | --- |
| Credential save IPC | Before implementation, the desktop IPC suite had `14 passed / 3 failed` because `credential.save` was missing. | `pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts`: `18/18 passed`. |
| Credential workbench lifecycle | Before implementation, `pnpm.cmd --filter @todex/desktop test --run test/workbench.spec.tsx` failed with `Unable to find a label with the text of: API Key`. | Current `pnpm.cmd --filter @todex/desktop test --run test/workbench.spec.tsx`: `16/16 passed`; this includes clear-failure, stale-model-status, and stale-project-list regressions. |
| GitLab compatibility | Before implementation, `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts` failed because `.gitlab-ci.yml` did not exist. | `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts`: `1/1 passed`. |

Focused final checks:

```powershell
pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts test/workbench.spec.tsx
# 2 files, 34 tests passed

pnpm.cmd test --run scripts/test/gitlab-ci.test.ts
# 1 file, 1 test passed

pnpm.cmd lint
# exit 0

pnpm.cmd build
# exit 0

pnpm.cmd demo:mechanisms
# workspace-escape: passed
# repair-feedback: passed
# approval-isolation: passed

git diff --check
# exit 0
```

Follow-up lifecycle hardening was developed test-first: a simulated
`credential.clear` rejection containing `secret-value credentialRef=private-ref`
initially produced an unhandled rejection and no user-visible fixed notice. The
minimal fix catches the rejection, preserves the configured state, and renders
the fixed localized message `Credential clear failed; try again`. The updated
workbench suite passes `14/14`; the injected key and reference are absent from
the DOM.

## CI and Release Facts

The repository retains GitHub Actions as its actual hosted CI. `.gitlab-ci.yml` is a course-compatibility layer: its `unit-test` job uses Node 20, enables Corepack, activates `pnpm@10.12.1`, runs `pnpm install --frozen-lockfile`, then runs `pnpm test --run`.

PR [#21](https://github.com/HrrToT/Todex/pull/21) merged the v0.1.2 desktop candidate into `main` as `e10e597e41a7dd489895bcc374a863db80cef7e8`. GitHub Actions [run 31769832842](https://github.com/HrrToT/Todex/actions/runs/31769832842) passed. GitHub Release [v0.1.2](https://github.com/HrrToT/Todex/releases/tag/v0.1.2) publishes `Todex-0.1.2-win-x64.exe`, `latest.yml`, and the blockmap.

The public Render deployment remains a fixed-scenario Mock Demo. It must not accept real API keys, local filesystem paths, arbitrary commands, arbitrary patches, uploads, or a real-model URL.

## Known Local Verification Limits

`pnpm.cmd test --run` was executed, but the complete local suite is not green in this worktree. It reports 18 failures: all 12 `sqlite-store.test.ts` tests and all 6 `workspace-host.test.ts` tests fail before their behavior can run because the native `better-sqlite3` dependency was built for Electron Node ABI 135, whereas the active Node 24 runtime requires ABI 137. This is a known environment compatibility limit, not a passing full-suite result and not a regression attributed to this change.

`pnpm.cmd verify:release` also cannot pass inside this isolated worktree without both the already-published NSIS artifacts and release-check environment values (`TODEX_RELEASE_ARTIFACTS`, `TODEX_DEMO_URL`). No artifacts were copied or fabricated merely to make this local check pass.

## Review and Remaining Actions

Task 1 received independent specification review and code/security review; neither found P0 or P1 issues. The focused P2 coverage additions are included in `13f7f35`. A fresh independent Task 2 review could not be dispatched because the subagent service returned a quota `403`; this must remain visible until an independent final whole-branch review occurs.

A later independent whole-branch review found no P0 and two P1 async-selection
paths. A delayed credential-status response for an old model selection could
overwrite the current model's credential state; an old project's delayed
model-list response could also resume and reactivate that old model. The
renderer now invalidates earlier status requests on every model or project
selection and rejects stale project continuations after both asynchronous list
operations. The `16/16` workbench suite contains controlled deferred-response
regressions for both paths. The review also identified two documentation P2
items, both corrected here: focused test counts match the current suite and
this Markdown file uses no trailing-space line breaks.

The following actions remain required before the student can make a fully supported course-submission claim:

1. The student must personally complete the 1500--2500 Chinese-character substantive answers in `docs/REFLECTION.md`; the repository only supplies the question framework and evidence links.
2. The project owner must perform and record a controlled installed-app acceptance with a non-sensitive Node or Python repository, a real OpenAI-compatible provider configuration, and no secrets in the evidence. It must separately verify governed read/patch, approval, trace visibility, and refusal behavior.
3. This branch needs a final independent specification review and code/security review, followed by a green PR CI run and merge.

Until those actions are complete, this branch is a verified implementation and documentation preparation, not proof of an externally verified live-agent acceptance.
