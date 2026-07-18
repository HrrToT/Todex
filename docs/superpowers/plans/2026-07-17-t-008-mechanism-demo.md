# T-008 Deterministic Mechanism Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Mock-only command that produces machine-readable proof of Todex workspace denial, feedback-driven repair, and approval isolation.

**Architecture:** `mechanism-demo.ts` owns fresh in-memory fakes and returns an immutable report; Vitest imports it directly. `run-mechanism-demo.ts` is a thin `tsx` wrapper that writes the already-redacted report beneath ignored `.todex/demo`. No scenario starts a real project command or changes the repository examples.

**Tech Stack:** TypeScript strict, Vitest, existing Harness Core fakes, `tsx` root dev dependency, Node `fs/promises` only in the CLI wrapper.

---

## Frozen Constraints

- Authority: `docs/SPEC.md` AC-01/04/05/06, `docs/superpowers/specs/2026-07-17-t-008-mechanism-demo-design.md`, and `docs/PLAN.md` T-008.
- Branch: `feat/t-008-mechanism-demo`, based on main plus T-008 design/plan commits.
- The report module has no `node:fs`, `child_process`, network, Electron, SQLite, real LLM, real CommandRunner, or real workspace dependency.
- Scenario data uses an in-memory `WorkspaceFs`; never modify `examples/` while running the demo.
- Only the CLI imports `node:fs/promises`; it writes `.todex/demo/mechanism-report.json` and no other path.
- Add only root `tsx` and its lockfile resolution. Do not change contracts, CI, UI, desktop, demo-web, persistence, T-004 through T-007 production behavior, or install Python packages.
- Use `pnpm.cmd` in PowerShell. Do not push, create a PR, merge main, or start T-009.

## File Map

| File | Responsibility |
| --- | --- |
| `packages/harness-core/src/mechanism-demo.ts` | Immutable report types, three fresh-fake scenarios, `runMechanismDemo()`. |
| `packages/harness-core/src/index.ts` | Export demo module's public function/types. |
| `packages/harness-core/test/mechanism-demo.test.ts` | Direct report and critical trace/call-count tests. |
| `scripts/run-mechanism-demo.ts` | `tsx` CLI, fixed console summary, JSON write, nonzero failure path. |
| `scripts/test/run-mechanism-demo.test.ts` | CLI write/failure-path integration tests with injected writer, avoiding real disk writes in Vitest. |
| `tsconfig.base.json` | Include the new TypeScript CLI and its tests in the existing root typecheck boundary. |
| `vitest.workspace.ts` | Include `scripts` so the root test command discovers the CLI test. |
| `package.json`, `pnpm-lock.yaml` | `tsx` development dependency and `demo:mechanisms` script. |
| `docs/*` | Completion evidence only after green verification. |

### Task 1: Build the In-Memory Scenario Module

**Files:** Create `packages/harness-core/src/mechanism-demo.ts`, `packages/harness-core/test/mechanism-demo.test.ts`; modify `packages/harness-core/src/index.ts`.

- [ ] **Step 1: Write failing report tests**

```ts
it("returns immutable evidence for all course mechanisms", async () => {
  const report = await runMechanismDemo();
  expect(report.allPassed).toBe(true);
  expect(report.workspaceEscape).toMatchObject({ passed: true, status: "completed", dispatcherCalls: 0 });
  expect(report.repairFeedback).toMatchObject({ passed: true, status: "completed", verificationCalls: 2, failedFeedbackObserved: true, repairApplied: true });
  expect(report.approvalIsolation).toMatchObject({ passed: true, runADispatcherCalls: 1, runBDispatcherCalls: 0, runBStatus: "awaiting_approval" });
  expect(Object.isFrozen(report)).toBe(true);
});
```

Add exact trace assertions:

```ts
expect(report.workspaceEscape.traceTypes).toEqual([
  "action_requested", "action_rejected", "action_requested", "run_completed",
]);
expect(report.repairFeedback.traceTypes.filter((type) => type === "verification_completed")).toHaveLength(2);
expect(report.approvalIsolation.runBTraceTypes).toContain("approval_requested");
expect(report.approvalIsolation.runBTraceTypes).not.toContain("tool_completed");
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts`

Expected: FAIL because `mechanism-demo.ts` and `runMechanismDemo` do not exist.

- [ ] **Step 3: Define report types and shared deterministic fakes**

Define and export only these immutable shapes:

```ts
export interface WorkspaceEscapeDemo { readonly passed: boolean; readonly status: RunStatus; readonly denialReason: "workspace_escape"; readonly dispatcherCalls: number; readonly traceTypes: readonly TraceEventType[]; }
export interface RepairFeedbackDemo { readonly passed: boolean; readonly status: RunStatus; readonly verificationCalls: number; readonly failedFeedbackObserved: boolean; readonly repairApplied: boolean; readonly traceTypes: readonly TraceEventType[]; }
export interface ApprovalIsolationDemo { readonly passed: boolean; readonly runAStatus: RunStatus; readonly runBStatus: RunStatus; readonly runADispatcherCalls: number; readonly runBDispatcherCalls: number; readonly approvalScope: "run"; readonly runBTraceTypes: readonly TraceEventType[]; }
export interface MechanismDemoReport { readonly allPassed: boolean; readonly workspaceEscape: WorkspaceEscapeDemo; readonly repairFeedback: RepairFeedbackDemo; readonly approvalIsolation: ApprovalIsolationDemo; }
export async function runMechanismDemo(): Promise<MechanismDemoReport>;
```

Copy the minimal FakeClock, FakePathResolver, in-memory `WorkspaceFs`, counting dispatcher, and scripted fake `CommandRunner` patterns from existing Harness tests into this module. They must be module-private. Use workspace root `/workspace`, deterministic IDs, and no absolute host path.

- [ ] **Step 4: Implement Scenario 1 and verify green**

Use `ScriptedMockLlm([{ tool: "read_file", path: "../.ssh/id_rsa" }, { tool: "finish", summary: "blocked", completion: "unverified" }])`. Use the real `Guardrail` and `AgentRunner`; assert in implementation that the returned trace types exactly match the test expectation and dispatcher count is zero. Freeze all returned arrays/objects.

Run: `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts`

Expected: scenario-1 assertions pass; other scenario assertions remain red until implemented.

- [ ] **Step 5: Implement Scenario 2 and verify green**

Seed the private in-memory filesystem with `src/price.js` content `export function add(left, right) { return left - right; }\n`. Script two valid unified-diff patches and a verified finish. Inject a `VerificationRunner` whose registry exposes one confirmed `demo.test` command and whose fake command runner returns `test_failure` then `success`.

Require the implementation to inspect captured LLM contexts: context 2 contains `verification.classification === "test_failure"`; context 3 contains `"passed"`. Assert source text contains `return left + right;` after the run. Report only booleans/counts/types, never patch/source/output text.

Run: `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts`

Expected: workspace-escape and repair-feedback assertions pass.

- [ ] **Step 6: Implement Scenario 3 and commit**

Create one shared `AgentRunner` with real `Guardrail`/`InMemoryApprovalStore`; use a counting dispatcher. Run A requests `{ tool: "run_shell_command_with_approval", command: "npm install" }`, receive pending approval, decide scope `run`, and finish. Run B requests the same action and must return `awaiting_approval` before any decision. Use different run IDs and assert Run B dispatcher count remains zero.

Run: `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts`

Expected: PASS for all three report sections, immutability, exact trace/call-count checks, and no report field containing `npm install`, `/workspace`, `return left`, or `secret`.

Commit: `git add packages/harness-core/src/mechanism-demo.ts packages/harness-core/src/index.ts packages/harness-core/test/mechanism-demo.test.ts; git commit -m "test: add deterministic mechanism scenarios"`

### Task 2: Add the CLI and `tsx` Entry Point

**Files:** Create `scripts/run-mechanism-demo.ts`, `scripts/test/run-mechanism-demo.test.ts`; modify `tsconfig.base.json`, `vitest.workspace.ts`, `package.json`, `pnpm-lock.yaml`.

- [ ] **Step 1: Write failing CLI tests**

Extract a testable `writeDemoReport(report, deps)` helper from the CLI module. Test it with a fake writer:

```ts
it("writes only the fixed report path and a JSON copy of the immutable report", async () => {
  const writes: Array<{ path: string; text: string }> = [];
  await writeDemoReport(passingReport, { mkdir: async () => undefined, writeFile: async (path, text) => { writes.push({ path, text }); } });
  expect(writes).toEqual([{ path: ".todex/demo/mechanism-report.json", text: JSON.stringify(passingReport, null, 2) }]);
});

it("throws demo_report_failed when allPassed is false or the writer rejects", async () => {
  await expect(writeDemoReport(failingReport, fakeWriter)).rejects.toThrow("demo_report_failed");
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd test --run scripts/test/run-mechanism-demo.test.ts`

Expected: FAIL because the CLI module and helper do not exist. If Vitest reports that the scripts project is not part of the workspace, first make the narrow workspace update in Step 3, then rerun and retain the missing-module failure as the RED evidence.

- [ ] **Step 3: Add test-discovery/typecheck coverage, `tsx`, root command, and minimal wrapper**

Update `tsconfig.base.json` include list with exactly `"scripts/**/*.ts"`. Update `vitest.workspace.ts` to define both existing package projects and the scripts project:

```ts
export default defineWorkspace(["packages/*", "scripts"]);
```

This is deliberately limited to the TypeScript CLI introduced by this task; the existing root `pnpm.cmd test --run` and `pnpm.cmd typecheck` must both cover it.

Update root `package.json` exactly:

```json
{
  "scripts": { "demo:mechanisms": "tsx scripts/run-mechanism-demo.ts" },
  "devDependencies": { "tsx": "<lockfile-resolved version>" }
}
```

Run `pnpm.cmd install` to update only `pnpm-lock.yaml`. In the wrapper use `mkdir(".todex/demo", { recursive: true })`, `writeFile(".todex/demo/mechanism-report.json", JSON.stringify(report, null, 2), "utf8")`, and fixed console lines `workspace-escape: passed`, `repair-feedback: passed`, `approval-isolation: passed`, and `report: .todex/demo/mechanism-report.json`. Catch all wrapper failures, print `mechanism-demo: failed`, and set `process.exitCode = 1` without raw exception output.

- [ ] **Step 4: Verify green and command output**

Run: `pnpm.cmd test --run scripts/test/run-mechanism-demo.test.ts`

Expected: PASS.

Run: `pnpm.cmd typecheck`

Expected: PASS after compiling both `packages/**` and `scripts/**`; a type error intentionally introduced into `scripts/run-mechanism-demo.ts` must be reported by this command during the RED check and then removed before the green run.

Run: `pnpm.cmd demo:mechanisms`

Expected: exit 0; four fixed console lines; `.todex/demo/mechanism-report.json` exists, parses as JSON, has `allPassed: true`, and contains no source code, shell command, absolute path, secret, or patch text.

Commit: `git add tsconfig.base.json vitest.workspace.ts package.json pnpm-lock.yaml scripts/run-mechanism-demo.ts scripts/test/run-mechanism-demo.test.ts; git commit -m "feat: add mechanism demo command"`

### Task 3: Record Evidence and Final Verification

**Files:** Modify `docs/PLAN.md`, `docs/AGENT_LOG.md`, `docs/task-cards/T-008-mechanism-demo.md`; create `docs/verification/2026-07-17-t-008-mechanism-demo.md`.

- [ ] **Step 1: Run final commands**

Run: `pnpm.cmd demo:mechanisms`; `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts`; `pnpm.cmd test --run`; `pnpm.cmd typecheck`; `pnpm.cmd lint`; `pnpm.cmd build`; `git diff --check`; `git status --short`.

Expected: all pass; generated `.todex/demo/mechanism-report.json` remains ignored and does not appear in status.

- [ ] **Step 2: Record exact evidence and commit**

Record red/green failures, final command output, JSON field summary, AC-01/04/05/06 mapping, zero-real-execution boundary, Node in-memory repair proof, Python/pytest non-dependency, assumptions, and controlled exceptions.

Commit: `git add docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-008-mechanism-demo.md docs/verification/2026-07-17-t-008-mechanism-demo.md; git commit -m "docs: record T-008 mechanism evidence"`

## Plan Self-Review

Task 1 produces the reusable, directly tested scenario source of truth. Task 2 adds only the `tsx` host and fixed local report writer. Task 3 records real evidence after command and repository verification. The report type and field names introduced in Task 1 are used unchanged by Tasks 2 and 3. The plan does not run a real project test, shell, network action, or Python dependency installation.
