# T-009 Desktop Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal secure Electron host that persists Todex state in SQLite and stores API keys only through Windows Credential Manager.

**Architecture:** `apps/desktop` owns Electron-only adapters. `SQLiteStore` owns transactional migrations and typed repositories; `CredentialStore` owns the fail-closed keytar boundary; `WorkspaceHost` composes them; `ipc.ts` exposes only fixed validated operations. Harness Core remains unchanged.

**Tech Stack:** Electron, TypeScript strict, Vitest, better-sqlite3, keytar, @electron/rebuild, Zod, existing @todex/contracts.

---

## Frozen Constraints

- Branch `feat/t-009-desktop-persistence`, based on the approved T-009 design commit.
- API keys never enter SQLite, JSON, `.env`, trace, logs, IPC results, errors, or source fixtures. Credential failure is fail-closed.
- Production database is `app.getPath("userData")/todex.sqlite`; tests inject a temporary directory.
- Renderer has no Node integration and receives only the declared IPC allowlist. No generic SQL, filesystem, IPC, or credential-read method exists.
- Do not add React UI, real LLM calls, project shell execution, file-tool adapters, demo-web work, installer packaging, or release workflow.
- Native verification order is mandatory: Node ABI build and Vitest/root checks first, then Electron ABI rebuild and smoke. Do not run Vitest after Electron rebuilding `better-sqlite3`.

## File Map

| File | Responsibility |
| --- | --- |
| `apps/desktop/package.json` | Desktop workspace dependencies and test/build/rebuild/smoke scripts. |
| `apps/desktop/tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` | Strict compilation and desktop-only test discovery. |
| `apps/desktop/src/main/sqlite-store.ts` | Migrations and typed repositories. |
| `apps/desktop/src/main/credential-store.ts` | Injected keytar adapter and redacted lifecycle DTOs. |
| `apps/desktop/src/main/workspace-host.ts` | Electron-path-to-store composition. |
| `apps/desktop/src/main/ipc.ts` | Fixed IPC handler registration and input validation. |
| `apps/desktop/src/main/index.ts`, `preload.ts`, `smoke.ts` | Minimal secure Electron shell and native smoke entry. |
| `apps/desktop/test/*.test.ts` | Persistence, credentials, IPC and host/smoke tests. |
| root `tsconfig.base.json`, `vitest.workspace.ts`, `pnpm-lock.yaml` | Include desktop source/tests in normal root checks and lock dependencies. |

### Task 1: Create the Desktop Package and Test Boundary

**Files:** Create `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.build.json`, `apps/desktop/vitest.config.ts`, `apps/desktop/test/bootstrap.test.ts`; modify root `tsconfig.base.json`, `vitest.workspace.ts`, `pnpm-lock.yaml`.

- [ ] **Step 1: Write failing bootstrap test**

```ts
import { describe, expect, it } from "vitest";
import { DESKTOP_HOST_VERSION } from "../src/main/index.js";

describe("desktop host", () => {
  it("exports the T-009 host version", () => {
    expect(DESKTOP_HOST_VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @todex/desktop test --run bootstrap.test.ts`

Expected: FAIL because the desktop package/module does not exist.

- [ ] **Step 3: Add workspace package and minimal host export**

Create the desktop package with runtime dependencies `better-sqlite3`, `electron`, `keytar`, `zod`, and `@todex/contracts`; use `@electron/rebuild` as a development dependency. Add scripts `test`, `build`, `rebuild:native`, and `smoke`. Create strict TS configs that emit main/preload/smoke JavaScript to `dist`. Add `apps/desktop/**/*.ts` to root typecheck and `apps/desktop` to the Vitest workspace. Export only `DESKTOP_HOST_VERSION = "0.1.0"` from the initial main entry.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm.cmd install`; `pnpm.cmd --filter @todex/desktop test --run bootstrap.test.ts`; `pnpm.cmd typecheck`.

Expected: PASS and root typecheck compiles `apps/desktop/**`.

Commit: `git add apps/desktop package.json pnpm-lock.yaml tsconfig.base.json vitest.workspace.ts; git commit -m "chore: add desktop host workspace"`

### Task 2: Implement Transactional SQLite Persistence

**Files:** Create `apps/desktop/src/main/sqlite-store.ts`, `apps/desktop/test/sqlite-store.test.ts`.

- [ ] **Step 1: Write failing store tests**

Cover a temporary DB path with these exact expectations: a fresh open has migration version 1; reopening is idempotent; a seeded version 999 throws `unsupported_schema_version`; `saveProject` survives reopen; `listColumns("model_configs")` excludes `api_key`; duplicate `(runId, sequence)` trace insertion throws; a trace appended before reopen remains ordered; a soft-deleted memory is absent from list; a seed `API_KEY=secret-value` is absent from `exportProject(projectId)`.

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @todex/desktop test --run sqlite-store.test.ts`

Expected: FAIL because `SQLiteStore` does not exist.

- [ ] **Step 3: Implement store and migrations**

Implement `SQLiteStore.open({ databasePath })`, `close()`, and typed methods for projects, configured commands, model config references, runs, trace events, verification results, approval requests, and memories. Enable `PRAGMA foreign_keys = ON`; create `schema_migrations`; apply migration 1 in one transaction. Use bound parameters only. Use JSON parse/stringify only for contract array fields and validate read records with existing Zod contracts. Create tables and indexes described in the approved design; use `UNIQUE(run_id, sequence)` and soft-delete memories with `deleted_at`. Reject schema versions above 1 with `Error("unsupported_schema_version")`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm.cmd --filter @todex/desktop test --run sqlite-store.test.ts`

Expected: PASS; no test database appears in Git status.

Commit: `git add apps/desktop/src/main/sqlite-store.ts apps/desktop/test/sqlite-store.test.ts; git commit -m "feat: persist desktop state in sqlite"`

### Task 3: Implement Fail-Closed Credentials and Host Composition

**Files:** Create `apps/desktop/src/main/credential-store.ts`, `apps/desktop/src/main/workspace-host.ts`, `apps/desktop/test/credential-store.test.ts`, `apps/desktop/test/workspace-host.test.ts`.

- [ ] **Step 1: Write failing credential/host tests**

Use an injected in-memory `CredentialAdapter`. Assert `save/status/clear` return only `{ configured, availability }`; no returned value contains the seed key. Make adapter save/read/remove throw and assert fixed `credential_unavailable`, no SQLite fallback row/file, and no raw exception text. Assert `WorkspaceHost.open({ userDataPath, credentialAdapter })` places its DB at `join(userDataPath, "todex.sqlite")` and returns the same store on its lifecycle boundary.

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @todex/desktop test --run credential-store.test.ts workspace-host.test.ts`

Expected: FAIL because credential and host adapters do not exist.

- [ ] **Step 3: Implement adapters**

Define `CredentialAdapter` with `save/read/remove`; production `KeytarCredentialAdapter` uses service `Todex` and opaque UUID credential references. `CredentialStore` exposes only `status`, `save`, `clear` DTOs and maps adapter errors to `credential_unavailable`. `WorkspaceHost` receives injected `userDataPath`, opens `todex.sqlite`, and composes `SQLiteStore` plus `CredentialStore`; it does not scan or operate selected repositories.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm.cmd --filter @todex/desktop test --run credential-store.test.ts workspace-host.test.ts`

Expected: PASS; database/DTO/error serialization contains neither `secret-value` nor `apiKey`.

Commit: `git add apps/desktop/src/main/credential-store.ts apps/desktop/src/main/workspace-host.ts apps/desktop/test/credential-store.test.ts apps/desktop/test/workspace-host.test.ts; git commit -m "feat: add desktop credential and host adapters"`

### Task 4: Register Narrow IPC and Secure Electron Smoke

**Files:** Create `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/preload.ts`, `apps/desktop/src/main/smoke.ts`, `apps/desktop/test/ipc.test.ts`; modify `apps/desktop/src/main/index.ts`.

- [ ] **Step 1: Write failing IPC and shell tests**

Use a fake `ipcMain.handle` recorder. Assert registration contains exactly the frozen project/command/run/approval/memory/credential channels, excludes credential read and generic SQL/filesystem channels, and rejects invalid input with fixed `invalid_ipc_input`. Assert BrowserWindow options are `contextIsolation: true` and `nodeIntegration: false`.

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @todex/desktop test --run ipc.test.ts`

Expected: FAIL because IPC registration/preload functions do not exist.

- [ ] **Step 3: Implement fixed handlers and smoke entry**

Implement `registerTodexIpc(ipcMain, host)` with only the declared allowlist, Zod input parsing and redacted DTO output. Expose the same typed client shape from preload via `contextBridge`. Implement `createDesktopWindow()` with the required security flags. Implement `smoke.ts` to use a temporary userData directory, initialise host/store, load the keytar adapter without writing a key, register IPC, then exit 0; it must never call LLM, shell, or project tools.

- [ ] **Step 4: Verify GREEN, native rebuild, and commit**

Run: `pnpm.cmd --filter @todex/desktop test --run ipc.test.ts`; `pnpm.cmd --filter @todex/desktop rebuild:native`; `pnpm.cmd --filter @todex/desktop smoke`.

Expected: tests pass and Electron loads both native modules. If rebuild/smoke fails, stop and report the exact native ABI failure; do not substitute a non-native credential/storage library.

Commit: `git add apps/desktop/src/main apps/desktop/test/ipc.test.ts; git commit -m "feat: expose secure desktop host ipc"`

### Task 5: Record Evidence and Final Verification

**Files:** Modify `docs/PLAN.md`, `docs/AGENT_LOG.md`, `docs/task-cards/T-009-desktop-persistence.md`; create `docs/verification/2026-07-18-t-009-desktop-persistence.md`.

- [ ] **Step 1: Run final commands**

Run: `pnpm.cmd --filter @todex/desktop test --run`; `pnpm.cmd --filter @todex/desktop rebuild:native`; `pnpm.cmd --filter @todex/desktop smoke`; `pnpm.cmd test --run`; `pnpm.cmd typecheck`; `pnpm.cmd lint`; `pnpm.cmd build`; `git diff --check`; `git status --short`.

Expected: all pass, generated temporary DBs remain ignored, and no command output/report contains the seed API key.

- [ ] **Step 2: Record evidence and commit**

Record every RED/GREEN command, database migration behavior, no-key proof, fail-closed credential proof, IPC allowlist proof, native rebuild/smoke environment versions, assumptions, and controlled exceptions.

Commit: `git add docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-009-desktop-persistence.md docs/verification/2026-07-18-t-009-desktop-persistence.md; git commit -m "docs: record T-009 persistence verification"`

### Execution Update (2026-07-19)

Tasks 1-4 were implemented with the required RED/GREEN evidence and independent commits. Native build scripts are constrained by the workspace allowlist. Node ABI tests completed before Electron rebuilding. Electron rebuild completed, and the smoke reached Keytar module loading, temporary SQLite host opening, and IPC registration. The process then hit a reproducible current-environment Electron lifecycle/shutdown `0xC0000005`; this controlled exception is documented rather than hidden. Interactive lifecycle and BrowserWindow validation move to T-010/T-012.

## Plan Self-Review

Tasks 1-4 cover package setup, SQLite, credentials/host, and IPC/native smoke without changing Harness Core or adding UI. Task 5 records only observed evidence. The same names and boundaries are used throughout. No step requests real model access, project shell execution, installer packaging, or a plaintext credential fallback.
