# T-013 Real Desktop Agent and Chinese Localization

Date: 2026-08-12

## Scope Completed Locally

- Desktop and Demo user-facing text are Chinese-first with an `en-US` test mode. Technical trace names, paths, commands, diffs, and JSON Action values remain literal.
- The desktop renderer can only invoke intention-level preload APIs. The main process owns canonical workspace selection, project import/detection, SQLite persistence, credentials, HTTP requests, filesystem access, and child processes.
- `OpenAiCompatibleClient` calls only `<baseUrl>/chat/completions`, uses the key only in the Authorization header, has timeout and response-size limits, and maps upstream failures to stable error codes.
- `NodeWorkspaceFs` checks lexical containment before I/O and canonical containment after symlink resolution; sensitive paths and escapes fail closed. `NodeCommandRunner` invokes `spawn(command, argv, { shell: false })` and accepts only fixed configured argv.
- `DesktopRunService` reads the key only through `WorkspaceHost`, uses `AgentRunner` and Guardrail, persists trace/approval projections, and performs exactly one JSON-only protocol repair. A second invalid action stops as `model_protocol_invalid`.
- The desktop live workbench is available only when the Electron preload exposes the live run bridge. Public Demo Web does not expose it and retains fixed Mock scenarios.

## RED/GREEN Evidence

RED tests were observed before each module existed for the OpenAI client, workspace and command adapters, protocol service, and live IPC. Final focused verification:

```powershell
pnpm.cmd --filter @todex/harness-core build
pnpm.cmd --filter @todex/harness-core test --run guardrail.test.ts
pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx ipc.test.ts desktop-run-service.test.ts desktop-agent-e2e.test.ts node-workspace-fs.test.ts node-command-runner.test.ts openai-compatible-client.test.ts
# 8 desktop files plus Guardrail passed locally
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
git diff --check
# all exit 0
```

The final service E2E uses a temporary real Node workspace, fake main-process persistence,
and a scripted Chat Completions boundary. It proves that a normal unified diff changes the
fixture, a confirmed `run_configured_command` pauses with zero child-process calls, one
explicit `once` decision dispatches the fixed argv, and the run then finishes. The API-key
sentinel is absent from snapshots, traces, and captured model prompts. A second E2E proves
two invalid responses stop with `model_protocol_invalid` without preserving either raw response.

Two local loopback HTTP E2Es now use the production `OpenAiCompatibleClient` rather than a
scripted completion adapter. Each temporary Node/Python fixture receives exactly three
`POST /v1/chat/completions` responses: an ordinary unified diff, a configured command that pauses
for `once` approval, and a verified finish. The Node and Python source files change only through
the bounded patch tool; the injected command runner receives the pre-confirmed fixed argv only
after approval. The temporary service binds to `127.0.0.1`, is closed in `finally`, and is not the
public Render Demo or a new public endpoint.

The live-workbench interaction test imports a selected workspace, saves a model and credential,
starts a high-level run, renders a projected approval trace, sends `{ runId, approvalId, decision }`,
and confirms that the password field is cleared after save.

## Live Run Stream Rework (2026-08-13)

- `run.start` now returns a redacted `running` projection immediately. The main process runs the
  governed loop in the background and publishes later projected snapshots through the narrow
  `run.subscribe` / `run.unsubscribe` pair. The subscription receives an immediate replay of the
  current snapshot, so a very fast terminal run cannot be missed between `start` and subscribe.
- The main process filters every notification by its requested `runId`; the preload listener repeats
  that check before calling the renderer callback. IPC tests prove the replay excludes task text and
  seeded secrets, and that another run's event is not sent to this subscription. A review rework also
  makes the subscription registry sender-scoped: two Electron windows may subscribe to the same run
  independently, and one window's unsubscribe no longer removes the other window's listener.
- A running live workbench exposes a labelled stop icon. It invokes only `run.cancel(runId)` and the
  existing main-process cancellation path remains responsible for aborting model HTTP or a fixed
  approved command. No renderer process receives a child-process or filesystem capability.
- Remaining live-workbench labels, placeholders, notices and command-confirm controls now use the
  existing `zh-CN` / `en-US` catalog. Technical evidence such as argv, trace type, diff and JSON
  values remains literal rather than translated.

Focused regression evidence after this rework:

```powershell
pnpm.cmd --filter @todex/desktop test --run ipc.test.ts desktop-agent-e2e.test.ts desktop-run-service.test.ts workbench.spec.tsx
# 4 files, 36 tests passed
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
git diff --check
# all exit 0
```

## Independent Review Rework (2026-08-13)

An independent local review found five issues in the initial live-stream implementation. All were
reproduced with focused RED tests and repaired before PR creation:

- Background `execute()` failures now publish and persist a stable `failed` terminal snapshot with
  the fixed, redacted reason `desktop_run_failed`; the background task is no longer silently left as
  `running`.
- Cancelling while `awaiting_approval` now cancels the pending approval record, clears the pending
  projection, releases the per-project active-run lock and publishes `cancelled` immediately. The
  live stop control is available for running, dispatching and awaiting-approval states.
- Every persisted trace payload and every projected result/approval summary is redacted for
  credential-shaped values and absolute Windows/Unix paths, and is limited to 2000 characters.
  A valid model `finish.summary` containing a seeded key and `C:\\Users\\...` now cannot reach
  the trace table or renderer projection.
- Live status now maps all `RunStatus` values to localized text and correct visual phases; completed,
  failed-environment, repair-limit and cancelled runs are not visually labelled as running.
- Subscription ownership is sender-scoped, so independent Electron windows may observe the same Run
  and may only unsubscribe their own listener.

Focused rework verification:

```powershell
pnpm.cmd --filter @todex/desktop test --run ipc.test.ts desktop-agent-e2e.test.ts desktop-run-service.test.ts workbench.spec.tsx
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
git diff --check
```

## Review Rework Evidence (2026-08-13)

- `command.confirm` accepts only `{ projectId, candidateId }`. The main process parses the stored
  detected profile and derives fixed argv, timeout and the project working directory. Renderer input
  cannot supply argv, cwd, timeout or `confirmedByUser`.
- Project and command IPC results are projections: project list/get/import omit `workspaceRoot`, and
  command list omits working directories. The candidate UI confirms only its ID and displays argv,
  never a local absolute path.
- `DesktopRunService` rejects a second active run for one project and releases the project lock when
  startup fails or a run becomes terminal. Its injected E2E keeps the first model request pending and
  proves the second request returns `project_run_active`.
- Cancellation now aborts an in-flight model request through a main-process-owned `AbortController`.
  The runner records `run_cancelled` rather than a model error and does not dispatch a later action.
  The focused E2E was RED by timeout before the hook and GREEN after it received the abort signal.
- The same cancellation path now aborts an already-approved `run_configured_command`. The desktop
  dispatcher owns an abort controller per run and passes its signal only to the fixed command runner;
  the red E2E timed out before this path existed and the green E2E proves the command received abort
  and the terminal projection is `cancelled`.
- The live workbench now exposes a Chinese/English text toggle. Its interaction test confirms the
  locale change keeps the governed preload run bridge intact. Locale persistence across a desktop
  restart now uses a fixed `app_settings.locale` SQLite value and the narrow
  `settings.getLocale` / `settings.setLocale` IPC pair. The only accepted values are `zh-CN` and
  `en-US`; unknown values and extra input are rejected. The renderer query projections for workspace
  selection, projects, models and runs omit absolute paths, task text, stored command directories,
  credential references and model parameter storage fields.

## Security Evidence

- The IPC allowlist rejects `credential.read`, generic filesystem and SQL operations, renderer workspace roots for a run, `project.selectWorkspace`, and direct `project.save` path writes.
- Focused tests cover `.env`, `../outside.txt`, symlink escape, Windows canonical-path normalization, shell-disabled spawn, timeout, HTTP non-2xx, oversized HTTP response, protocol repair, second-invalid stop, configured-command zero-dispatch before approval, and a live workbench preload surface without Demo fallback.
- A protocol client exception containing a seeded key and absolute path becomes `model_request_failed`; the error projection does not contain either value.

## Remaining Evidence Boundary

PR [#19](https://github.com/HrrToT/Todex/pull/19) was merged into `main` at
`2026-08-13T14:43:33Z` as `f9dcd3a8368b32fb14418bb1e05dcdc1e20ada61`.
The final PR head `bc405e38b5220640d5fa92948ad0e90c527699f9` is an ancestor of that
merge commit. GitHub Actions [run 31708987042](https://github.com/HrrToT/Todex/actions/runs/31708987042)
passed for the final PR head.

This integration evidence does not establish an actual external model request, live API key use,
user repository mutation, real command execution, installed Windows Electron interaction, or
scoped real-model acceptance. The local Node 24 runtime cannot load the missing
`better-sqlite3` ABI 137 binding, so the existing SQLite/WorkspaceHost suite and the locale
reopen test still require compatible Windows/CI evidence. This environment limitation is not
suppressed or counted as a passing local native test.

## Pre-merge Security Rework (2026-08-13)

- The renderer, preload surface and IPC allowlist no longer expose `credential.save` or `memory.save`.
  The workbench does not contain an API key input. A model configuration records only base URL and
  model name; the main process reads a pre-existing secret from Credential Manager for the active
  configuration. This avoids sending plaintext credentials through renderer state, IPC, SQLite,
  trace, logs or renderer projections.
- Run task persistence and trace persistence redact the active Credential Manager secret by literal
  value as well as credential-shaped text. The desktop end-to-end regression covers a schema-valid
  `finish` action that echoes the active key and proves it is absent from both the run record and
  persisted trace.
- The renderer loads confirmed commands for the selected project and passes a confirmed test command
  (or another confirmed command when no test exists) as `verificationCommandId`. A `finish` action
  claiming `verified` cannot produce `completed` when no verification runner exists; it is reported
  as `completed_unverified`.
- `NodeWorkspaceFs.commit()` snapshots every target before a multi-file update and restores the
  snapshot after an ordinary write failure. The injected second-write failure test reads both real
  files after rejection and proves neither retained a partial update. This is rollback protection,
  not a claim of crash-atomic filesystem transactions.
- IPC subscription cleanup is bound to Electron sender destruction. A destroyed sender unsubscribes
  its listeners without affecting another sender observing the same run; failed listener callbacks
  are isolated so they cannot prevent terminal run persistence.

Focused evidence for this rework:

```powershell
pnpm.cmd --filter @todex/harness-core test --run agent-runner.test.ts
# 36 tests passed
pnpm.cmd --filter @todex/desktop test --run ipc.test.ts workbench.spec.tsx desktop-agent-e2e.test.ts node-workspace-fs.test.ts desktop-run-service.test.ts
# 48 tests passed
pnpm.cmd typecheck
# exit 0
```

### Credential Lifecycle Amendment (2026-08-14)

The preceding pre-merge record accurately describes the security boundary at that
point in time. It was superseded by the final-submission-readiness work after a
separate design decision: the desktop now exposes only a strict, one-way
`credential.save` IPC for a password field's short-lived value. The handler
delegates to the main-process Credential Manager adapter and returns only
`{ configured: true }`. It does not expose credential reads or references, and
the renderer does not display, pre-fill, persist, trace, or query API keys.
See `docs/verification/2026-08-14-final-submission-readiness.md` for the
corresponding RED/GREEN and secrecy evidence. The remaining evidence boundaries
in this historical record still apply.

## v0.1.2 Candidate Publication (2026-08-14)

PR [#21](https://github.com/HrrToT/Todex/pull/21) merged the desktop candidate as
`e10e597e41a7dd489895bcc374a863db80cef7e8`. Its GitHub Actions
[run 31769832842](https://github.com/HrrToT/Todex/actions/runs/31769832842) passed.

The local Windows x64 packaging sequence ran `electron-rebuild` for `better-sqlite3` and
`keytar`, `pnpm.cmd --filter @todex/desktop run smoke`, and
`pnpm.cmd --filter @todex/desktop run package:win`. The generated installer was
`Todex-0.1.2-win-x64.exe` with SHA-256
`C0513AAA38E9982A5F084FB3BEC459D6281EBDA4120EBEFAED536E23E999CFE1`. The unpacked
`Todex.exe` was launched with an isolated temporary user-data directory; its Electron main,
renderer, and helper processes remained running. The public release is
[`v0.1.2`](https://github.com/HrrToT/Todex/releases/tag/v0.1.2) and contains that installer,
`latest.yml`, and the blockmap.

The focused local desktop regression set passed 69 tests, plus `pnpm.cmd typecheck`,
`pnpm.cmd lint`, and `git diff --check`. The Node 24 ABI limitation remains: after native
modules are rebuilt for Electron, local Node 24 cannot load those Electron binaries for the
SQLite/WorkspaceHost test files. GitHub CI is the compatible complete-suite evidence. This
publication still does not prove an external model request, use of a real API key, a user
repository mutation, real command execution, an installed-app interaction, or scoped
real-model acceptance.
