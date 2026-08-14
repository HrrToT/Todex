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
| `9268000` | Prevents a stale project's delayed model list from reactivating an old model. |
| `8127b5f` | Added GitLab-compatible `unit-test` CI job and reconciled release/course documents. |

The renderer accepts a password only as short-lived component state. It clears that state before awaiting the save IPC, never displays or pre-fills the value, and has no credential-read capability. The main process remains the sole runtime credential reader. The API key is not included in Git, SQLite, trace, logs, exports, model configuration persistence, or renderer query projections.

## RED / GREEN Evidence

| Area | RED evidence | GREEN evidence |
| --- | --- | --- |
| Credential save IPC | Before implementation, the desktop IPC suite had `14 passed / 3 failed` because `credential.save` was missing. | `pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts`: `18/18 passed`. |
| Credential workbench lifecycle | Before implementation, `pnpm.cmd --filter @todex/desktop test --run test/workbench.spec.tsx` failed with `Unable to find a label with the text of: API Key`. Later independent review regressions used deferred responses and failed before the corresponding generation guards were added. | Current `pnpm.cmd --filter @todex/desktop test --run test/workbench.spec.tsx`: `22/22 passed`; this includes clear-failure, stale status, stale save/clear, stale project-list, stale cross-project model-save, stale same-project model-save, and stale model-save rejection regressions. |
| GitLab compatibility | Before implementation, `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts` failed because `.gitlab-ci.yml` did not exist. | `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts`: `1/1 passed`. |

Focused final checks:

```powershell
pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts test/workbench.spec.tsx
# 2 files, 40 tests passed

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

## PR #22 Integration Evidence

PR [#22](https://github.com/HrrToT/Todex/pull/22) merged the final readiness
branch into `main` on 2026-08-14. GitHub records merge commit
`dfcaf5dca5a754b30a1a3791a307d0ac3000401a`; the final branch head was
`79ef63529f33feb7458f49227c65f38553c7e654`. GitHub Actions
[run 31785166883](https://github.com/HrrToT/Todex/actions/runs/31785166883)
completed successfully for the pull request. Its sole `ci` job completed in
49 seconds.

The run emitted a Node.js 20 action-runtime deprecation warning for
`actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4`.
This warning did not fail the job. It is a maintenance follow-up, not evidence
that CI failed.

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

A subsequent whole-branch review found two further P1 continuation paths:
an old credential save or clear could update a newly selected model, and a
delayed model save could reselect an old project. Three controlled
deferred-Promise tests first reproduced those outcomes. The renderer now
captures the credential or project selection generation at operation start and
ignores a completion that is no longer current. The workbench suite is
`19/19` after this repair.

The final whole-branch review then found one P2 continuation path within the
same project: a pending `model.save()` could reselect the older model after the
user chose another model. A controlled deferred-Promise test first reproduced
the rollback. `saveModel()` now snapshots the model-selection generation before
the save, validates it after the save, and validates the generation returned by
`chooseModel()` before refreshing the project. A second deferred-Promise test
showed that a stale `model.save()` rejection was unhandled; `saveModel()` now
absorbs it and only shows a fixed localized notice when the request is still
current. The regression asserts both that a stale rejection does not display
that notice and that a current rejection displays only the fixed notice, never
the injected error detail. The workbench suite is `22/22` after these repairs.
The only remaining coverage gap is a direct regression test for an old
`command.list()` response; the code already guards that continuation after the
awaited command list.

The following actions remain required before the student can make a fully supported course-submission claim:

1. The student must complete a factual review of the 1500--2500 Chinese-character `docs/REFLECTION.md`, retain ownership of its conclusions, and disclose any AI assistance used to prepare it. The document must not invent personal experience or manual acceptance evidence.
2. The project owner must perform and record a controlled installed-app acceptance with a non-sensitive Node or Python repository, a real OpenAI-compatible provider configuration, and no secrets in the evidence. It must separately verify governed read/patch, approval, trace visibility, and refusal behavior.
3. PR #22 has received the recorded final whole-branch review, a green CI run,
   and a merge into `main`. The remaining course evidence is the student's own
   reflection and a controlled installed-app real-provider acceptance, not an
   additional claim about this merged PR.

Until the two manual actions are complete, the merged project is a verified
implementation and documentation preparation, not proof of an externally
verified live-agent acceptance.
