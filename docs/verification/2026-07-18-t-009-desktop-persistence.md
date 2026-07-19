# T-009 Desktop Persistence Verification

Date recorded: 2026-07-19

## Scope and Commits

The implementation was limited to `apps/desktop`, root TypeScript/Vitest/native-build wiring, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and T-009 evidence. Harness Core, contracts, examples, CI, demo web, installer, and release flow were not modified.

1. `330e9e2` `chore: add desktop host workspace`
2. `b9ad555` `feat: persist desktop state in sqlite`
3. `b8dbaea` `feat: add desktop credential and host adapters`
4. `fd758bb` `feat: expose secure desktop host ipc`
5. `acd7c21` `fix: remove unused desktop ipc import`

No push, pull request, or merge was performed.

## RED and GREEN Evidence

| Task | RED evidence | GREEN evidence |
| --- | --- | --- |
| Workspace | `bootstrap.test.ts` failed because `src/main/index.ts` was absent. | Desktop bootstrap test passed; root typecheck passed. |
| SQLite | `sqlite-store.test.ts` failed because `SQLiteStore` was absent. | `pnpm.cmd --filter @todex/desktop test --run sqlite-store.test.ts` passed 8/8. |
| Credentials and host | Credential and host tests failed because their modules were absent. | `credential-store.test.ts` and `workspace-host.test.ts` passed 4/4; root typecheck passed. |
| IPC and shell | `ipc.test.ts` failed because `ipc.ts` was absent. | `ipc.test.ts` passed 3/3; fixed allowlist, invalid input, absent credential read, and window security flags were asserted. |

The Node ABI root run completed before Electron rebuilding and passed 18 test files and 394 tests. At that point root typecheck also passed.

## Persistence and Secret Boundary

- Fresh migration records version 2; reopen is idempotent; schema version 999 fails closed with `unsupported_schema_version`.
- Project persistence survives reopen. `model_configs` has no secret column. Trace events persist before reopen, order by sequence, and enforce unique `(run_id, sequence)`. Memory deletion is soft and removed from normal lists.
- The in-memory credential seed is absent from exported project data, credential lifecycle DTOs, and the temporary SQLite file. No plaintext fallback exists.
- Failing credential adapter operations map only to `credential_unavailable`; raw adapter text is not exposed.
- IPC registers only the fixed project, command, run, approval, memory, and credential status/save/clear operations. No generic SQL, filesystem, Node, or credential-read channel exists.

## Dual ABI Native Evidence

Native scripts are constrained in `pnpm-workspace.yaml` to `better-sqlite3`, `keytar`, `electron`, and `esbuild`.

1. Use the installed Python 3.12 path and force Node-oriented installation/rebuild before Vitest.
2. Run desktop/root Vitest, typecheck, lint, and build with the Node ABI `better-sqlite3` artifact.
3. Only after those checks, use `pnpm.cmd --filter @todex/desktop smoke:electron`; it explicitly runs `rebuild:native && smoke`. The low-level `smoke` script does not rebuild native modules.
4. Electron rebuild reported `Rebuild Complete` for Electron `v36.9.5`; current Node was `v24.14.0`.

The Electron diagnostic smoke reached production Keytar module loading, temporary `WorkspaceHost.open()` with actual SQLite opening/migration, and `registerTodexIpc`. It did not save or read a credential, call an LLM, execute a shell command, or access a selected workspace.

## Controlled Exception

The current execution environment reproducibly exits Electron with `0xC0000005` during app lifecycle/shutdown. A minimal independent script that only logged before `app.whenReady()` and then awaited it also failed. GPU disabling did not change the boundary. The native smoke therefore proves native module loading, temporary SQLite opening, and IPC registration by reached markers, but does not prove `app.whenReady()`, BrowserWindow, or interactive shutdown behavior in this environment.

T-010/T-012 must validate interactive Electron lifecycle, BrowserWindow behavior, and packaged application shutdown on a suitable environment. This exception is not a fallback, dependency substitution, or security-boundary relaxation.

## Final Commands Observed

- `pnpm.cmd --filter @todex/desktop test --run sqlite-store.test.ts`: pass, 8/8.
- `pnpm.cmd --filter @todex/desktop test --run credential-store.test.ts workspace-host.test.ts`: pass, 4/4.
- `pnpm.cmd --filter @todex/desktop test --run ipc.test.ts`: pass, 3/3.
- `pnpm.cmd test --run`: pass before Electron rebuild, 18 files/394 tests.
- `pnpm.cmd typecheck`: pass before Electron rebuild.
- `pnpm.cmd lint`: pass after the final IPC import cleanup.
- `pnpm.cmd build`: pass after the final IPC import cleanup.
- `git diff --check`: pass before evidence edits.

The permanent smoke contains no diagnostic marker. Its native boundary is intentionally limited to adapter loading, temporary host/store open, IPC registration, close, and cleanup. No command in this record contains an API key value.

## P1 Rework (2026-07-19)

Review found that the original in-memory `CredentialStore` reference was not associated with a persisted model configuration after restart, and that `exportProject()` omitted terminal approval decisions by using the pending-only query.

RED: new host tests failed because `saveCredential(configId, value)` and config-bound status/clear did not exist. A new SQLite audit test saved approved and denied requests, then failed because exported approvals was empty. IPC RED additionally showed that credential status accepted input without a configuration id.

GREEN: `WorkspaceHost` now loads a `ModelConfigReference` by `configId`, saves a generated opaque reference to `model_configs.credential_ref` only after Keytar save succeeds, and clears that column only after Keytar delete succeeds. Reopen status resolves through the persisted ref. Adapter failure returns `credential_unavailable`, leaves the prior ref unchanged, and does not create a database fallback. IPC credential status/save/clear require `configId` and return no ref or secret. `SQLiteStore.listApprovals(projectId)` returns every approval state for audit export, while `listPendingApprovals` remains the IPC list behavior.

Verification after the rework: `pnpm.cmd --filter @todex/desktop test --run credential-store.test.ts ipc.test.ts workspace-host.test.ts sqlite-store.test.ts` passed 4 files/18 tests. Root `pnpm.cmd test` passed 18 files/397 tests; root `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, and `git diff --check` passed. The P1 implementation and this evidence are committed as `fix: persist credential references and approval audit`.

## Final Review P1/P2 Rework (2026-07-19)

RED: the added tests showed that a successful Keytar save leaked its newly generated reference when `replaceCredentialReference` threw, a successful Keytar deletion could leave a dead SQLite reference when its final persistence threw, and `saveVerification()` accepted a run/command pair from different projects. Window tests also showed missing sandbox/navigation/window-open protections, and the package test showed the absent `smoke:electron` composition.

GREEN: SQLite schema version 2 adds `credential_clear_pending`, including a direct v1-to-v2 migration regression. Every credential save writes a new Keytar UUID; the same SQLite transaction switches the active reference and records the previous UUID for cleanup. If that transaction fails, the new UUID is compensated while the previous configured secret remains intact, and the error is only `credential_persistence_failed`. Clearing atomically removes the active `credential_ref` and records pending work before deleting Keytar; a final SQLite failure leaves no active dead reference and the pending record is reconciled on the next credential operation. `saveVerification()` reads both project ids inside its insert transaction and throws `verification_project_mismatch` before any insert. The window is sandboxed and rejects navigation/new windows. `smoke:electron` is exactly `rebuild:native && smoke`, while `smoke` remains a low-level build-and-launch command without rebuild.

Node-ABI GREEN evidence: `pnpm.cmd --filter @todex/desktop test --run workspace-host.test.ts sqlite-store.test.ts ipc.test.ts package.test.ts` passed 4 files/22 tests. Final root `pnpm.cmd test --run` passed 19 files/403 tests; `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, and `git diff --check` exited 0. Electron lifecycle/smoke was not re-run because the recorded `0xC0000005` environment exception remains controlled scope.

## CI P1 Rework (2026-07-19)

RED: importing `credential-store.ts` for an injected fake adapter loaded native `keytar` immediately. On Linux CI this loads the `libsecret` binding before any production credential operation and prevents otherwise isolated fake-adapter tests from starting.

GREEN: `KeytarCredentialAdapter` now calls a module-cached dynamic loader only from `save`, `read`, and `remove`. New regressions mock `keytar` to throw and prove a `CredentialStore` with an injected fake adapter still saves without loading it; a production-adapter mock proves zero loads before use, exactly one load across save/read/remove, and unchanged service/account arguments. Final Node-ABI verification passed 19 files/405 tests; typecheck, lint, recursive build, and diff check passed. Electron lifecycle/smoke remains out of scope because of the recorded `0xC0000005` exception.
