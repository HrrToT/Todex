# T-010 Codex-Style Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dark Codex-style React workbench backed by T-009's typed preload DTOs and deterministic Mock-run fixtures.

**Architecture:** Renderer-only React components own display state. A fixture `RunController` provides causal execution events; production host data reaches UI only through preload. No renderer code imports Electron, SQLite, keytar, Node APIs, or Harness Core.

**Tech Stack:** React, Vite, TypeScript strict, Vitest, Testing Library, lucide icons, existing desktop preload bridge.

---

## Frozen Scope

- Create the React renderer, dark Codex-style rail/stream/Inspector/composer, deterministic fixtures, and component tests.
- Use only typed T-009 IPC DTOs; no real LLM, shell, patch, filesystem, credential read, multi-session, file upload, settings workflow, installer, or demo-web.
- Inspector is collapsed initially; it opens on approval, patch, verification failure, or trace selection and can be pinned/closed.
- Never render API key, credentialRef, sensitive content, or raw unredacted error output.

## File Map

| File group | Responsibility |
| --- | --- |
| `apps/desktop/src/renderer/*` | React entry, styles, bridge types, Mock RunController, Workbench components. |
| `packages/ui/src/*` | Reusable ExecutionStream, Inspector, ApprovalCard, DiffPanel, TraceTimeline, TaskComposer. |
| `apps/desktop/test/workbench.spec.tsx`, `packages/ui/test/*.spec.tsx` | Component and flow tests. |
| `apps/desktop/package.json`, root workspace configs/lockfile | Renderer dependencies and test/build inclusion only. |

### Task 1: Renderer and Fixture Baseline

**Files:** Create renderer entry/App/styles/fixture controller and `apps/desktop/test/workbench.spec.tsx`; modify desktop package/config/lockfile as needed.

- [ ] Write RED test asserting initial rail, collapsed Inspector, bottom composer, and `idle` text render.
- [ ] Run `pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx`; expect missing module failure.
- [ ] Implement strict React/Vite entry plus fixture controller with `idle`, `running`, `failed`, `awaiting_approval`, `completed` snapshots only.
- [ ] Re-run focused test; expect PASS.
- [ ] Commit `feat: add codex-style workbench baseline`.

### Task 2: Execution Stream and Inspector

- [ ] Write RED tests for ordered user/agent/tool/verification events; verification failure and trace click open Inspector; manual close remains closed for ordinary events.
- [ ] Implement `ExecutionStream`, `TraceTimeline`, `InspectorPanel`, `DiffPanel`, and fixture transitions without parsing/applying diffs.
- [ ] Run focused UI tests; expect PASS.
- [ ] Commit `feat: add workbench execution inspector`.

### Task 3: Approval and Composer Safety

- [ ] Write RED tests that approval opens Inspector, displays reason/scope controls, sends only `{ approvalId, decision }`, keeps composer focus, and hides seed secrets/credential refs.
- [ ] Implement `ApprovalCard` and `TaskComposer`; bind only typed bridge decision calls and fixture continuation input.
- [ ] Run focused UI tests; expect PASS.
- [ ] Commit `feat: add workbench approval flow`.

### Task 4: Responsive, Accessibility, and Evidence

- [ ] Write RED tests for keyboard reachability, visible labels, narrow Inspector drawer, and non-overflowing stream/composer layout.
- [ ] Implement responsive CSS, focus states, icons/tooltips, and fixed dimensions.
- [ ] Run `pnpm.cmd test --run`, `typecheck`, `lint`, `build`, `git diff --check`; record actual results and Electron lifecycle limitation in T-010 verification docs.
- [ ] Commit `docs: record T-010 workbench verification`.

## Final Acceptance

The desktop workbench is Codex-style, responsive, fixture-driven, and component-tested; typed IPC boundaries remain intact; secret/raw-error redaction is tested; no claim is made that the known local Electron lifecycle exception is a passed browser-window test.
