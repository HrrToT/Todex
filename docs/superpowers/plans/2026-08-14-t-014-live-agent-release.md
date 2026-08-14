# T-014 Live Agent Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship and manually accept a Windows Todex desktop release whose Electron workbench runs the governed real Agent rather than silently presenting the Mock demo.

**Architecture:** The public web app remains a fixed Mock-only demonstration. Electron is the only product surface allowed to use a selected local workspace, a main-process OpenAI-compatible client, Credential Manager, filesystem tools, and configured-command approvals. Renderer fallback remains available for browser tests, but a desktop renderer without the required preload Run bridge renders a non-privileged diagnostic state instead of Demo content.

**Tech Stack:** TypeScript strict, React, Vite, Electron 36, electron-builder/NSIS, Vitest, SQLite, keytar, GitHub Actions, Windows Credential Manager.

---

### Task 1: Make a Missing Electron Preload Bridge Fail Visible

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/bridge.ts`
- Modify: `apps/desktop/test/workbench.spec.tsx`

- [ ] **Step 1: Add a focused failing Renderer test**

Add a test that calls the runtime classifier with `"Electron/36.0"` and no `window.todex.run`, renders `WorkbenchApp`, and asserts that `calculator-lab` is absent while an accessible `desktop_bridge_unavailable` status is present. Keep the existing browser-without-preload Demo test unchanged.

- [ ] **Step 2: Prove RED**

Run:

```powershell
pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx
```

Expected: the new test fails because the current fallback renders `DemoWorkbenchApp`.

- [ ] **Step 3: Implement the smallest runtime classifier and diagnostic view**

In `bridge.ts`, expose a pure classifier taking a preload surface and user agent. It returns `live` only for a surface with `run`, `diagnostic` only for an Electron user agent without `run`, and `demo` otherwise. In `App.tsx`, dispatch on that classifier. The diagnostic view contains only fixed localized recovery text and no project, model, credential, filesystem, shell, or network capability.

- [ ] **Step 4: Prove GREEN**

Run:

```powershell
pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx
pnpm.cmd --filter @todex/desktop test --run ipc.test.ts openai-compatible-client.test.ts desktop-agent-e2e.test.ts
```

Expected: the missing-bridge test passes; Demo remains browser-only; IPC and real-Agent loopback tests remain green.

- [ ] **Step 5: Commit the behavior change**

```powershell
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/bridge.ts apps/desktop/test/workbench.spec.tsx
git commit -m "fix: surface missing desktop preload bridge"
```

### Task 2: Build and Inspect the Release Candidate

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `README.md`
- Create: `scripts/verify-desktop-package.ts`
- Create: `scripts/test/verify-desktop-package.test.ts`

- [ ] **Step 1: Add a failing package-content verification test**

Make the verifier reject an archive unless it contains `dist/main/preload.js`, `dist/main/desktop-run-service.js`, the packaged renderer document, a Renderer bundle with the Live Workbench entry, and a preload bundle exposing `run.start`, `run.cancel`, and `run.subscribe`. The verifier must return booleans and fixed identifiers only; it must never extract workspace, credential, or model content.

- [ ] **Step 2: Prove RED**

Run the verifier test against a deliberately incomplete temporary archive fixture. Expected: it fails with the fixed missing-entry identifier and does not access the installed program directory.

- [ ] **Step 3: Implement the archive verifier and package command**

Use the lockfile-managed `@electron/asar` package to list and inspect bounded application files. Add a root command that builds and checks the current NSIS archive before release. Bump the desktop release version only after the new package passes its checks.

- [ ] **Step 4: Prove GREEN and package**

Run:

```powershell
pnpm.cmd test --run scripts/test/verify-desktop-package.test.ts
pnpm.cmd --filter @todex/desktop package:win
pnpm.cmd verify:desktop-package
pnpm.cmd verify:release
```

Expected: the new archive passes all fixed content checks; no application or user data is read by the verifier.

- [ ] **Step 5: Commit the release verification**

```powershell
git add apps/desktop/package.json package.json README.md scripts
git commit -m "build: verify live desktop release package"
```

### Task 3: Perform Installed-App and Real-Provider Acceptance

**Files:**
- Create: `docs/verification/2026-08-14-t-014-live-agent-release.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/AGENT_LOG.md`
- Modify: `docs/task-cards/T-014-live-agent-release.md`
- Modify: `README.md`

- [ ] **Step 1: Prepare a non-sensitive fixture**

Create a temporary Node or Python fixture containing only an intentionally incorrect arithmetic result and a confirmed local test command. Do not use a user repository, credential file, personal path, proprietary source, production command, or secret.

- [ ] **Step 2: Install the exact candidate and check its live surface**

Install the generated NSIS candidate over the previous version, open Todex, verify that the workspace-import/model setup screen is present, and verify that no fixed `calculator-lab` Demo surface appears. Record product version and fixed pass/fail facts only.

- [ ] **Step 3: Execute the controlled real-model flow**

The user enters the API key directly in the password field. Select the temporary fixture, save a user-controlled OpenAI-compatible `baseUrl` and model, confirm the discovered test command, request the bounded repair, approve the command once, and verify that the fixture test passes. Do not print, copy, persist, or document the key, base URL, absolute path, model response, raw source, or trace payload.

- [ ] **Step 4: Record only factual evidence**

Record whether each of these occurred: workspace selected, model configuration saved, credential status configured, patch proposed/applied, command paused before approval, command executed after approval, verification passed, terminal status. Record redaction assertions and any failure fact. Do not infer success from a process existing or an archive containing files.

- [ ] **Step 5: Commit evidence after it exists**

```powershell
git add README.md docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-014-live-agent-release.md docs/verification/2026-08-14-t-014-live-agent-release.md
git commit -m "docs: record live desktop agent acceptance"
```

### Task 4: Integrate and Publish

**Files:** only files changed by Tasks 1-3.

- [ ] **Step 1: Run all non-native and native-compatible gates**

```powershell
pnpm.cmd test --run
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
git diff --check
```

If the known Node 24 / `better-sqlite3` ABI incompatibility prevents local SQLite suites, preserve it as a failing-environment fact and rely on the hosted Node 20 CI gate. Do not skip or weaken those tests.

- [ ] **Step 2: Push and open a PR**

Push `codex/t-014-live-agent-release`, create a PR with exact verification evidence, and wait for GitHub Actions. Do not merge or create a tag without explicit user confirmation.

- [ ] **Step 3: Merge and release only after approval**

After the user confirms the green PR, merge it, create the next version tag/release through the repository workflow, and append the actual PR, merge, CI, release, installer, and manual-acceptance facts to the verification record.

### Plan Self-Review

- Product boundary: Tasks 1 and 3 distinguish the Electron live product from the public Mock-only demo.
- Security: no task introduces Renderer filesystem/network access or records a credential, URL, user source, absolute path, or raw trace.
- Runtime evidence: Task 1 prevents silent fallback, Task 2 proves package contents, and Task 3 requires installed-app interaction and real-provider evidence.
- Release evidence: Task 4 separates local checks, hosted CI, user-approved merge, tag, and published installer.
