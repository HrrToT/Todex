# T-009 Desktop Persistence and Host Design

**Status:** approved for implementation planning.

## Goal

Add the minimum real Electron host required for Todex V1.0 to persist local project state safely on Windows: SQLite-backed project/run/trace/approval/memory data, Windows Credential Manager-backed API-key references, and a narrow typed IPC boundary. T-009 validates the native-module path early but deliberately leaves the React workbench and installer packaging to T-010 and T-012.

## Confirmed Decisions

- SQLite driver: `better-sqlite3` in the Electron main process.
- Credential provider: `keytar` through a small adapter to Windows Credential Manager.
- Credential failure policy: fail closed. No API key may fall back to SQLite, JSON, `.env`, logs, trace payloads, or any other local file.
- Persistence policy: every trace/approval event is appended immediately; a Run terminal state updates its Run record when it finishes.
- UI boundary: T-009 creates a minimal secure Electron host shell only. T-010 owns the React workbench and user-facing screens.
- IPC policy: renderer code receives only fixed, intention-level, typed and redacted operations. It never receives arbitrary filesystem, SQL, Node, Credential Manager, or API-key access.
- Platform: Windows 10/11 x64 is the only promised desktop target. T-009 must verify Electron-native loading on this machine, but unsigned NSIS distribution remains T-012.

## Scope

### In Scope

- An `apps/desktop` Electron main-process package and a minimal safe BrowserWindow shell.
- Versioned SQLite migrations in the Electron application-data directory.
- Repositories for projects, confirmed commands, model configuration references, Runs, trace events, verification results, approval requests, and project memories.
- A `keytar` credential adapter plus deterministic in-memory fake.
- Typed IPC handlers for project, command, Run, approval, memory, and credential lifecycle operations.
- Vitest tests for persistence, redaction, credential fail-closed behavior, and IPC allowlisting.
- A Windows Electron smoke command that exercises the app host and native modules without calling a real LLM, project command, or Credential Manager write.

### Out of Scope

- React workbench UI, diff viewer, approval UI, project-selection UI, or model-settings UI (T-010).
- Real LLM HTTP requests, API-key entry UI, file-tool adapters, project command execution, free shell execution, or automatic dependency installation.
- NSIS packaging, release workflow, code signing, or GitHub Release assets (T-012).
- Demo-web persistence and any public API-key handling (T-011).
- Cloud sync, user accounts, multi-user use, cross-device state, macOS/Linux support, arbitrary Electron remote APIs, and SQL access from renderer code.

## Module Boundaries

| Module | Responsibility | Must Not Do |
| --- | --- | --- |
| `apps/desktop/src/main/sqlite-store.ts` | Open database, apply migrations, expose typed transactional repositories, validate records on read. | Store API keys, interpolate SQL, access Electron renderer APIs, call LLMs. |
| `apps/desktop/src/main/credential-store.ts` | Wrap `keytar` behind an injectable adapter; save/status/clear credentials. | Return secret values through IPC, persist a fallback copy, log keytar errors verbatim. |
| `apps/desktop/src/main/workspace-host.ts` | Resolve Electron `userData`, assemble store/credentials, retain selected-workspace metadata. | Run the Agent, execute commands, expose Node `fs` to renderer. |
| `apps/desktop/src/main/ipc.ts` | Register a fixed handler allowlist, validate input, map errors to redacted DTOs. | Expose generic `invoke`, arbitrary SQL, arbitrary path/file access, or credential reads. |
| `apps/desktop/src/main/index.ts` | Start the minimal Electron process, create a secure BrowserWindow, initialise host services. | Contain business persistence logic or UI workflow logic. |

`packages/harness-core` remains independent of Electron, SQLite, `better-sqlite3`, `keytar`, real filesystem access, and real LLMs. T-010/T-011 consume the host boundary rather than reaching into the database directly.

## Data Location and Migration Rules

The production database path is:

```text
app.getPath("userData")/todex.sqlite
```

Tests inject a temporary application-data directory and never use the user's actual Todex application data. The database never lives in the selected user repository.

`SQLiteStore.open()` enables foreign keys, creates a `schema_migrations` table, and applies numbered migrations in increasing order. Each migration runs within one SQLite transaction. The store refuses to open a database whose recorded migration version is greater than the application supports; it never attempts downgrade or destructive guessing.

All records written to and returned from repositories use the existing strict Zod contracts where such contracts already exist. Structured columns are JSON text only when the contract is structured (`argv`, `riskReasons`, `relatedPaths`, and `sourceTraceIds`); SQL values are always bound parameters.

## Schema

| Table | Key data and constraints |
| --- | --- |
| `schema_migrations` | `version` primary key, `applied_at`. |
| `projects` | `project_id` primary key, selected `workspace_root`, display/profile metadata, created/updated timestamps. |
| `model_configs` | `config_id` primary key, optional project link, `base_url`, model parameters, `credential_ref`, timestamps. No `api_key` column or derived secret value. |
| `configured_commands` | `command_id` primary key, project foreign key, purpose, JSON `argv`, working directory, timeout, confirmation and last-result state. |
| `runs` | `run_id` primary key, project foreign key, task text, `RunStatus`, start/end timestamps, repair attempts, stop reason. |
| `trace_events` | `event_id` primary key, run foreign key, sequence, type, timestamp, redacted payload summary; unique `(run_id, sequence)`. |
| `verification_results` | `verification_id` primary key, run and command references, classification, exit/duration, redacted failure summary and JSON related paths. |
| `approval_requests` | `approval_id` primary key, run reference, action metadata, fingerprint, decision/state and timestamps. |
| `memory_entries` | `memory_id` primary key, project foreign key, kind/trust/content, JSON source trace IDs, timestamps, soft-delete `deleted_at`. |

Indexes cover project-scoped list queries and the ordered trace lookup `(run_id, sequence)`. A trace is committed before host code reports it as persisted. Run creation/terminal update and all state transitions use explicit transactions where their related state must change together.

## Credential Boundary

`CredentialAdapter` has only three production-facing operations:

```ts
save(credentialRef: string, apiKey: string): Promise<void>
read(credentialRef: string): Promise<string | undefined>
remove(credentialRef: string): Promise<void>
```

The production adapter calls `keytar` with service name `Todex` and the opaque `credentialRef` as account name. The reference is generated independently of workspace paths, base URLs, models, or secret material.

Only a future main-process LLM client may call `read`. T-009 IPC has no credential-read channel. Renderer-visible credential operations are exactly:

```ts
credential.status -> { configured: boolean, availability: "available" | "unavailable" }
credential.save   -> { configured: true }
credential.clear  -> { configured: false }
```

Adapter failures map to fixed availability/error codes. They do not emit raw `keytar` messages, create a plaintext fallback, or serialize a key into SQLite, trace, logs, diagnostics, or IPC responses.

## Workspace Host and IPC

`WorkspaceHost` receives Electron path access and production adapters, creates/open the database, and supplies typed repository services. It only records user-selected workspace metadata in this task; it does not scan, read, patch, execute, or otherwise manipulate repository contents.

`ipc.ts` uses only `ipcMain.handle` registrations. The fixed allowlist is:

- `project.selectWorkspace`, `project.list`, `project.get`, `project.save`, `project.delete`
- `command.list`, `command.confirm`, `command.remove`
- `run.list`, `run.get`, `run.cancel`
- `approval.listPending`, `approval.decide`
- `memory.list`, `memory.save`, `memory.delete`
- `credential.status`, `credential.save`, `credential.clear`

Each handler parses input, calls the host service, returns a redacted DTO, and maps host errors to fixed codes. No handler accepts arbitrary SQL, arbitrary IPC channel names, arbitrary paths, Node handles, or API-key reads.

The minimal BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, and a dedicated preload bridge. The preload bridge exposes only the above typed operations. T-009 does not create the T-010 workbench UI.

## Testing and Native Smoke

SQLite tests use a temporary database path and cover first migration, idempotent reopen, ordered upgrade, unsupported newer schema failure, transaction rollback, project isolation, immediate trace persistence, sequence uniqueness, memory soft deletion, and all contract round trips.

Credential tests use an injected fake adapter and a seed API key. They prove lifecycle status, fail-closed behavior, and absence of that seed from database rows, repository DTOs, trace/export text, IPC results, and error messages.

IPC tests use fake Electron IPC registration and fake host services. They prove only the allowlist is registered, invalid inputs are rejected, unknown channels are unavailable, and no renderer operation can retrieve credentials or database handles.

The desktop package includes Electron, `better-sqlite3`, `keytar`, and `@electron/rebuild` only where needed. A dedicated Windows smoke command rebuilds native dependencies for the installed Electron ABI, starts the minimal main process with a temporary application-data directory, opens/migrates a temporary database, loads the credential adapter, registers IPC, and exits without a real model call or a real project command. The smoke may query credential availability but must not write a real API key.

### Native ABI Execution Record (2026-07-19)

`better-sqlite3` has separate Node and Electron ABI products. The repeatable order is: allow the declared native build scripts, rebuild for Node, run Vitest and root checks, then run `electron-rebuild -f -w better-sqlite3,keytar` immediately before Electron smoke. Vitest must not run after the Electron rebuild because it requires the Node ABI product.

The T-009 smoke loads the production Keytar adapter without saving or reading a credential, opens and migrates temporary `userData/todex.sqlite`, registers the fixed IPC allowlist, closes the store, and deletes the temporary directory. On this current Windows execution environment, a separate minimal Electron script that only called `app.whenReady()` reproducibly exited with `0xC0000005`. T-009 therefore records successful native module, SQLite, and IPC boundary reachability but does not claim interactive Electron lifecycle or BrowserWindow validation. T-010/T-012 must validate the interactive host and packaged lifecycle on an environment where Electron lifecycle completes.

## Acceptance Criteria

1. Fresh and migrated databases preserve contract-valid project, command, Run, trace, verification, approval, and memory data across reopen.
2. Trace persistence is append-first, ordered, unique per Run sequence, and survives a new store instance.
3. SQLite schema, database content, exported DTOs, trace, logs, and IPC output contain no API-key value or `api_key` column.
4. Keytar failure is explicit and fail-closed; no plaintext or SQLite fallback exists.
5. Renderer IPC is restricted to the declared intention-level allowlist and cannot access arbitrary Node, SQL, filesystem, or credential-read operations.
6. The Electron main process starts with context isolation and no renderer Node integration.
7. Native `better-sqlite3` and `keytar` load in the local Electron smoke environment after the declared rebuild command.
8. `pnpm.cmd --filter @todex/desktop test --run`, the Electron smoke, root test/typecheck/lint/build, and `git diff --check` pass before PR creation.

## Risks and Controlled Handling

- Native module ABI mismatch: run the Electron rebuild and smoke in T-009, record exact Node/Electron versions, and stop as blocked if native loading fails rather than substituting a different storage/credential mechanism silently.
- Windows Credential Manager unavailable: return a fixed unavailable state and keep Mock-only mode viable; never persist a fallback key.
- Database corruption/newer schema: use transactional migrations and fail closed for unknown future versions. Automated backups and restore UX are outside T-009.
- UI scope creep: the Electron shell has no workbench, settings, diff, approval card, or task submission interface; those are T-010 responsibilities.

## Design Self-Review

This design isolates native persistence and credentials from Harness Core, keeps every secret boundary main-process-only, and gives later UI code a small typed surface. It does not rely on a real LLM, project command, or user repository mutation for tests. T-009 remains a single host-adapter milestone; public demo, workbench UI, installer release, and real model execution remain separately planned tasks.
