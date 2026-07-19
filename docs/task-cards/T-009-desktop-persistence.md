# T-009: Desktop Persistence and Secure Host

Status: implementation complete with a controlled Electron lifecycle validation exception
Responsible model: implementation agent
Lead review: Codex
Branch: `feat/t-009-desktop-persistence`
Base: approved T-009 design and plan commits

## Goal

Implement SQLite persistence, Windows Credential Manager integration, a minimal secure Electron host, and narrow typed IPC without UI, real LLM, or project execution.

## Authority

- `docs/SPEC.md` sections 2-4 and AC-08/AC-09
- `docs/superpowers/specs/2026-07-18-t-009-desktop-persistence-design.md`
- `docs/superpowers/plans/2026-07-18-t-009-desktop-persistence.md`

## Allowed Scope

Only the desktop package, root workspace/typecheck/Vitest integration needed to include it, `pnpm-lock.yaml`, and T-009 completion evidence files named by the plan. Do not modify Harness Core, contracts, examples, CI, demo-web, release packaging, or existing T-001 to T-008 behavior.

## Non-Negotiable Rules

- Use `better-sqlite3 + keytar`; do not silently replace either when native loading fails.
- API keys never enter SQLite, JSON, `.env`, trace, logs, errors, IPC DTOs, or tests beyond in-memory seed values.
- Credential-provider failure is `credential_unavailable`; persistence compensation failure is `credential_persistence_failed`; neither exposes a secret or has a plaintext fallback.
- SQLite lives only below injected/Electron userData; never in a selected project workspace.
- Every trace is append-first with unique `(runId, sequence)`; schema versions above the supported maximum fail closed.
- Renderer receives only the frozen typed IPC allowlist; no arbitrary SQL, path, Node, or credential-read API.
- Electron window uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; it denies renderer navigation and new windows.
- Follow the plan's RED/GREEN order, commit per task, record actual evidence, and do not push/create a PR/merge main.

## Completion Record (2026-07-19)

- Implementation commits: `330e9e2`, `b9ad555`, `b8dbaea`, `fd758bb`, and `acd7c21`. No push, PR, or merge was created.
- Node ABI verification ran before Electron ABI rebuilding: desktop persistence, credential/host, and IPC tests passed; the root Vitest run passed 18 files and 394 tests. Typecheck, lint, recursive build, and `git diff --check` also passed when run.
- `pnpm-workspace.yaml` allowlists only `better-sqlite3`, `keytar`, `electron`, and `esbuild` build scripts. `better-sqlite3` is rebuilt for Node before Vitest. The only combined Electron entry is `pnpm.cmd --filter @todex/desktop smoke:electron`, which runs `rebuild:native && smoke`; the low-level `smoke` script does not rebuild native modules.
- Electron rebuild completed. A diagnostic Electron smoke reached real Keytar module loading, `WorkspaceHost.open()` with a temporary SQLite database, and IPC registration. The current environment then reproducibly crashed during Electron app lifecycle/shutdown with `0xC0000005`, including an independent `app.whenReady()` script. This does not establish BrowserWindow lifecycle behavior; T-010/T-012 own interactive host and packaging validation.
- The permanent smoke never writes a credential, calls a real LLM, runs a command, or accesses a selected project workspace. It loads the production adapters, opens temporary userData SQLite, registers IPC, closes, and removes the temporary directory.

## P1 Rework Record (2026-07-19)

- `CredentialStore` is now stateless with respect to configuration identity. `WorkspaceHost` obtains a model config by `configId`, writes each save to a newly generated opaque Keytar UUID, and atomically replaces `model_configs.credential_ref` while recording the old UUID for cleanup. If that persistence fails, it compensates only the new Keytar value and leaves the old configured secret intact. Clear first atomically removes the live SQLite reference and writes a `credential_clear_pending` record, then deletes Keytar, then completes the pending record; a final SQLite failure leaves the reference cleared and the pending record recoverable. Reopening the host resolves status from the persisted reference and reconciles pending clears. Adapter failures are exposed only as `credential_unavailable`, persistence failures as `credential_persistence_failed`, and neither returns a secret.
- `credential.status`, `credential.save`, and `credential.clear` all require `configId`; save also requires `apiKey`. Their IPC responses are only lifecycle DTOs (`configured` and, for status, `availability`) and never return a key or reference.
- `SQLiteStore.listApprovals(projectId)` joins every approval associated with project runs. `exportProject()` uses this audit query; `listPendingApprovals()` remains the pending-only IPC path. Approved and denied entries are both covered by the export regression test.
- RED was observed with missing host lifecycle methods and an empty terminal-approval export. GREEN evidence: the targeted desktop command passed 4 files/18 tests, root `pnpm.cmd test` passed 18 files/397 tests, and `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd build` all exited 0. No push, PR, or merge was performed.

## Final Review P1/P2 Rework (2026-07-19)

- RED reproduced a Keytar-success/SQLite-failure orphan, a Keytar-delete/SQLite-completion failure, a verification result joining a run and command from different projects, missing sandbox/navigation protections, and the missing combined Electron smoke script.
- GREEN adds schema version 2 with recoverable `credential_clear_pending`, fixed `credential_persistence_failed` errors without a key, an in-transaction `verification_project_mismatch` check before insert, and `sandbox: true` plus `will-navigate`/new-window denial. Targeted Node-ABI desktop tests passed 4 files/22 tests; final root Node-ABI verification passed 19 files/403 tests plus `typecheck`, `lint`, recursive `build`, and `git diff --check`. Electron lifecycle was intentionally not started because of the recorded `0xC0000005` exception.

## CI P1 Rework (2026-07-19)

- `credential-store.ts` must never import the native `keytar` module at module evaluation time. The Keytar adapter lazily imports and caches it only on real `save`, `read`, or `remove`; fake adapter tests and all host/import paths remain loadable on Linux runners without `libsecret`. Final Node-ABI verification passed 19 files/405 tests plus typecheck, lint, recursive build, and diff check.
