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

The live-workbench interaction test imports a selected workspace, saves a model and credential,
starts a high-level run, renders a projected approval trace, sends `{ runId, approvalId, decision }`,
and confirms that the password field is cleared after save.

## Security Evidence

- The IPC allowlist rejects `credential.read`, generic filesystem and SQL operations, renderer workspace roots for a run, `project.selectWorkspace`, and direct `project.save` path writes.
- Focused tests cover `.env`, `../outside.txt`, symlink escape, Windows canonical-path normalization, shell-disabled spawn, timeout, HTTP non-2xx, oversized HTTP response, protocol repair, second-invalid stop, configured-command zero-dispatch before approval, and a live workbench preload surface without Demo fallback.
- A protocol client exception containing a seeded key and absolute path becomes `model_request_failed`; the error projection does not contain either value.

## Remaining Evidence Boundary

No actual external model request, real API key, user repository mutation, real command, installed Windows Electron interaction, external Mock HTTP server fixture, PR, CI, or release was claimed by this record. A full-suite attempt passed all non-native suites and failed 17 existing SQLite/WorkspaceHost tests because the local Node 24 runtime could not load the missing `better-sqlite3` ABI 137 binding.
