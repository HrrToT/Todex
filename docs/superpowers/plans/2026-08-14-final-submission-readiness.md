# Final Submission Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close remaining course-submission gaps while preserving Todex's main-process-only credential security model.

**Architecture:** `WorkspaceHost.saveCredential` stays the only component that creates credential references and writes secrets. A narrow `credential.save` bridge passes one password value to it and returns only `{ configured: true }`; durable query projections remain redacted. A GitLab compatibility job and exact v0.1.2 documentation close delivery gaps without changing GitHub Actions.

**Tech Stack:** TypeScript, React, Electron context bridge and IPC, Zod, Vitest, pnpm, GitHub Actions, GitLab CI.

---

## Task 1: Restore Narrow Credential Save IPC (completed: `b631c70`, test hardening: `13f7f35`)

**Files:**
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/renderer/bridge.ts`
- Modify: `apps/desktop/test/ipc.test.ts`

- [x] **Step 1: Write a failing lifecycle IPC test.**

Add `credential.save` to `EXPECTED_CHANNELS`. Use a fake host whose `saveCredential` resolves to `{ configured: true }`. Invoke the handler with `{ configId: "config-1", apiKey: "secret-value" }`; assert exactly `{ configured: true }`, assert the host received both arguments, and assert `JSON.stringify(result)` contains neither the key nor `credentialRef`. Assert an empty key and an extra request property reject with `invalid_ipc_input`.

- [x] **Step 2: Run RED.**

Run `pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts`. Expected: the allowlist and save tests fail because `credential.save` is absent.

- [x] **Step 3: Implement the typed redacted path.**

In `ipc.ts`, append `credential.save` to `TODexIpcChannels`; define strict `credentialSaveSchema` as `{ configId: z.string().min(1), apiKey: z.string().min(1) }`; register it as `host.saveCredential(input.configId, input.apiKey)`. In `preload.ts`, expose `save(configId, apiKey)` using only `invoke("credential.save", { configId, apiKey })`. In `bridge.ts`, add redacted `save` and `clear` lifecycle DTOs. Do not expose reads, credential references, generic credentials, filesystem, SQL, or process APIs.

- [x] **Step 4: Run GREEN and commit.**

Run `pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts`; expected pass. Stage the four listed files and commit with `feat: add redacted credential save IPC`.

## Task 2: Add First-Run, Update, and Clear UI Controls (completed: `fa63fc6`, failure-path hardening: `91ec3d9`)

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/i18n.ts`
- Modify: `apps/desktop/test/workbench.spec.tsx`

- [x] **Step 1: Write failing live-workbench lifecycle tests.**

Provide a fake `window.todex` surface with a selected model and credential status `{ configured: false, availability: "available" }`. Assert a labeled `API Key` password input. Type `secret-value`, activate save, assert the save spy received `("m1", "secret-value")`, then assert the input value is empty and `document.body.textContent` does not contain the secret. Switch status to configured, assert no password input and assert the clear control calls `credential.clear("m1")`.

- [x] **Step 2: Run RED.**

Run `pnpm.cmd --filter @todex/desktop test --run test/workbench.spec.tsx`. Expected: it fails because the UI lacks the input, save bridge, and clear control.

- [x] **Step 3: Implement transient state only.**

In `LiveWorkbenchApp`, add `apiKey` and `credentialConfigured` state. On model selection, derive configured status and clear `apiKey`. Render an `aria-label="API Key"`, `type="password"`, `autoComplete="off"` input only for an unconfigured selected model. Snapshot the key locally, clear state before awaiting `surface.credential.save`, and set configured only from its redacted result. Clear calls `surface.credential.clear`, then clears state and configuration status. Add Chinese and English labels for API key, save/update, configured, clear, and unavailable. Do not include `apiKey` in models, snapshots, notices, dependencies, model-save payloads, or traces.

- [x] **Step 4: Run GREEN and commit.**

Run `pnpm.cmd --filter @todex/desktop test --run test/workbench.spec.tsx`; expected pass. Stage the three files and commit with `feat: add secure desktop credential lifecycle`.

## Task 3: Add CI Compatibility and Delivery Documentation (completed: `8127b5f`)

**Files:**
- Create: `.gitlab-ci.yml`
- Create: `scripts/test/gitlab-ci.test.ts`
- Modify: `README.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/AGENT_LOG.md`
- Modify: `docs/task-cards/T-013-real-agent-and-chinese-localization.md`
- Modify: `docs/verification/2026-08-12-t-013-real-agent-and-localization.md`
- Modify: `docs/REFLECTION.md`

- [x] **Step 1: Write a failing GitLab CI structural test.**

Create `scripts/test/gitlab-ci.test.ts`. Read `.gitlab-ci.yml` and assert it contains a top-level `unit-test:` key, `pnpm install --frozen-lockfile`, and `pnpm test --run`. The test must not require GitLab to replace `.github/workflows/ci.yml`.

- [x] **Step 2: Run RED.**

Run `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts`. Expected: it fails because `.gitlab-ci.yml` does not exist.

- [x] **Step 3: Add the compatibility job and factual documentation.**

Create `.gitlab-ci.yml` with image `node:20`; its `unit-test` job must run `corepack enable`, activate `pnpm@10.12.1`, run `pnpm install --frozen-lockfile`, then `pnpm test --run`. Apply the verified `068a6805` documentation changes or their exact factual equivalent: identify v0.1.2, retain historical v0.1.0/v0.1.1 caveats, link release CI, and keep manual installed-app and scoped real-provider acceptance pending unless actually performed. Replace the bare reflection reservation with eight course-question headings, evidence links, and a 1500-2500 Chinese-character target, but do not write substantive reflection answers.

- [x] **Step 4: Run GREEN and commit.**

Run `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts` and `git diff --check`; expected pass. Stage Task 3 files and commit with `docs: complete final submission evidence`.

## Task 4: Verify, Review, and Integrate (in progress)

**Files:**
- Create: `docs/verification/2026-08-14-final-submission-readiness.md`

- [x] **Step 1: Run focused tests.**

Run `pnpm.cmd --filter @todex/desktop test --run test/ipc.test.ts test/workbench.spec.tsx` and `pnpm.cmd test --run scripts/test/gitlab-ci.test.ts`. Expected: targeted credential and CI tests pass.

- [x] **Step 2: Run repository gates.**

Run `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, `pnpm.cmd demo:mechanisms`, `pnpm.cmd verify:release`, and `git diff --check`. Record exact results. A Node 24 `better-sqlite3` ABI failure must be recorded as environment-limited, never called a local green pass.

- [x] **Step 3: Write evidence and commit.**

Create the verification record with branch/base, RED-GREEN summaries, secrecy assertions, GitLab job proof, documentation facts, release/CI URLs, and remaining student-only/manual actions. Stage it and commit with `docs: verify final submission readiness`.

- [ ] **Step 4: Request two-stage review, create PR, and wait for CI.**

Perform an independent specification review followed by code-quality/security review. Resolve all P0/P1 findings, push `codex/final-submission-readiness`, create a PR, and wait for GitHub Actions before asking the project owner to merge.
