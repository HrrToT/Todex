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
  seeded secrets, and that another run's event is not sent to this subscription.
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

No actual external model request, real API key, user repository mutation, real command, installed Windows Electron interaction, external Mock HTTP server fixture, PR, CI, or release was claimed by this record. The local Node 24 runtime cannot load the missing `better-sqlite3` ABI 137 binding, so the existing SQLite/WorkspaceHost suite and the new locale reopen test require Windows Node 20 CI evidence. This environment limitation is not suppressed or counted as a passing local native test.
