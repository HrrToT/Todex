# T-008 Deterministic Mechanism Demo Verification

Status: implemented; awaiting Codex lead review
Verification date: 2026-07-18
Verification branch: `feat/t-008-mechanism-demo`
Base: `5954e7b` (current `main` plus T-008 design/plan commits)

## Scope

This record verifies the T-008 Mock-only mechanism demonstration: one reusable `runMechanismDemo()` module, one `tsx` CLI wrapper, and two Vitest suites that together prove workspace hard denial (AC-04), feedback-driven repair (AC-01, AC-06), and approval isolation (AC-05) through the existing Harness Core. It covers the three frozen scenarios, the immutable redacted report contract, the fixed CLI summary and nonzero failure path, generated-file ignore behavior, and the zero-real-execution boundary. It does not claim Electron, SQLite, real LLM, real shell/process, network, persistence, or T-009+ coverage; those remain out of scope.

## Implementation and review chain

| Commit | Purpose |
| --- | --- |
| `12a4782eac789f910693867a76fba802148e76a7` | `test: add deterministic mechanism scenarios` — `packages/harness-core/src/mechanism-demo.ts` with `runMechanismDemo()`, module-private in-memory fakes, three scenarios, and `deepFreeze` report; public exports in `packages/harness-core/src/index.ts`; `packages/harness-core/test/mechanism-demo.test.ts` with six direct report/trace/redaction/immutability tests |
| `1d44ccd8acc1b0be56326250136a23fee8907895` | `feat: add mechanism demo command` — `scripts/run-mechanism-demo.ts` (`writeDemoReport` helper + `main`), `scripts/test/run-mechanism-demo.test.ts` (three CLI write/failure-path tests), `tsconfig.base.json` include of `scripts/**/*.ts`, `vitest.workspace.ts` `scripts` project, root `package.json` `tsx` dev dependency and `demo:mechanisms` script, `pnpm-lock.yaml` |

## Red-green evidence

| Stage | Command | Result |
| --- | --- | --- |
| Task 1 RED | `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts` | 6 failed; `TypeError: runMechanismDemo is not a function` |
| Task 1 GREEN | Same | 6/6 passed |
| Task 2 RED | `pnpm.cmd test --run scripts/test/run-mechanism-demo.test.ts` | 1 failed suite; `Failed to load url ../run-mechanism-demo.js` (scripts project discovered as `|scripts|`) |
| Task 2 GREEN | Same | 3/3 passed |
| Full suite | `pnpm.cmd test --run` | 376/376 passed across 13 test files |
| Type safety | `pnpm.cmd typecheck` | Exit code 0 (compiles `packages/**` and `scripts/**`) |
| Lint | `pnpm.cmd lint` | Exit code 0 |
| Build | `pnpm.cmd build` | Exit code 0; contracts TypeScript build executed |
| Whitespace | `git diff --check` | No whitespace errors |
| Status | `git status --short` | Clean except staged evidence; generated `.todex/demo/mechanism-report.json` does not appear |

Test file breakdown after T-008:
- `contracts.test.ts`: 37 tests
- `agent-runner.test.ts`: 36 tests
- `guardrail.test.ts`: 75 tests
- `file-tools.test.ts`: 50 tests
- `memory-store.test.ts`: 28 tests
- `approval-state-machine.test.ts`: 42 tests
- `trace-store.test.ts`: 4 tests
- `smoke.test.ts`: 1 test
- `verification-runner.test.ts`: 33 tests
- `repair-loop.test.ts`: 21 tests
- `project-detector.test.ts`: 40 tests
- `mechanism-demo.test.ts`: 6 tests
- `scripts/test/run-mechanism-demo.test.ts`: 3 tests

## Scenario 1: Workspace escape is hard-denied before dispatch (AC-04)

The scripted Mock LLM emits `read_file` with path `../.ssh/id_rsa` and then `finish`. The real T-004 `Guardrail` evaluates the action before dispatch.

The `DemoPathResolver` resolves `../.ssh/id_rsa` against workspace root `/workspace` to canonical `/.ssh/id_rsa`, which is outside the workspace, so `checkPath` returns `deny: workspace_escape`. The `AgentRunner` records `action_requested`, `action_rejected`, then on the next turn `action_requested` (finish) and `run_completed`.

| Assertion | Evidence |
| --- | --- |
| Final status | `completed` |
| `denialReason` | `workspace_escape` |
| `dispatcherCalls` | `0` — the `CountingDispatcher` records no calls for run `demo-escape` |
| `traceTypes` | exactly `["action_requested", "action_rejected", "action_requested", "run_completed"]` |

The report stores only the trace type names, final status, fixed denial reason, and dispatcher count. No file content, workspace path, or exception text enters the report.

## Scenario 2: Failed verification feeds a repair (AC-01, AC-06)

An in-memory `WorkspaceFs` is seeded with `src/price.js` content `export function add(left, right) { return left - right; }\n` (the Node arithmetic bug from `examples/node-bug-repo`, copied into memory — the example file on disk is never touched). The real `FileTools` dispatcher applies patches against this in-memory filesystem.

The scripted Mock LLM emits, in order: a first `apply_patch` (changing `left - right` to `right - left`), a repair `apply_patch` (changing `right - left` to `left + right`), and `finish` with `completion: "verified"`. The injected `ScriptedCommandRunner` returns `test_failure` after the first patch and `success` after the repair. The `VerificationRunner` therefore produces `test_failure` feedback on the second LLM turn and `passed` feedback on the third.

| Assertion | Evidence |
| --- | --- |
| Final status | `completed` |
| `verificationCalls` | `2` — the `ScriptedCommandRunner` records exactly two calls |
| `failedFeedbackObserved` | `true` — `llm.contexts[1].verification.classification === "test_failure"` |
| `repairApplied` | `true` — in-memory source ends with `return left + right;` and `llm.contexts[2].verification.classification === "passed"` |
| `traceTypes` | contains two `verification_completed` events and ends in `run_completed` |

The fake `test_failure` stderr deliberately embeds `expected 5 received -1 at /home/user/project/src/bug.ts API_KEY=secret-value`. None of this raw output, patch text, or source text appears in the report; only booleans, counts, statuses, and trace type names are stored.

## Scenario 3: Approval does not leak to a new Run (AC-05)

One shared `AgentRunner` with a real `Guardrail` and `InMemoryApprovalStore` and a `CountingDispatcher` (tracking calls per `runId`) is used for both runs. The scripted Mock LLM provides `npm install`, then `finish`, then `npm install` again across the two runs.

Run A requests `run_shell_command_with_approval` with `npm install`. The guardrail classifies it as `require_approval` (risk reasons `free_shell`, `dependency_install`). The scenario decides approval with scope `run`. The run-scope grant is stored for run `demo-approval-a` only. After approval, Run A dispatches exactly once and completes via `finish`.

Run B (different `runId`, same `projectId`, same command) requests the same action. `matchesGrant` checks the run-scope grant: the fingerprint matches, but the grant's `runId` is `demo-approval-a` while the context `runId` is `demo-approval-b`, so the grant does not authorize Run B. Run B returns `awaiting_approval` before any dispatch.

| Assertion | Evidence |
| --- | --- |
| `runAStatus` | `completed` (initially `awaiting_approval`, then resumed after `run` approval) |
| `runBStatus` | `awaiting_approval` |
| `runADispatcherCalls` | `1` |
| `runBDispatcherCalls` | `0` |
| `approvalScope` | `run` |
| `runBTraceTypes` | `["action_requested", "approval_requested"]` — contains `approval_requested`, does not contain `tool_completed` |

The report never stores the `npm install` command text; only the fixed `approvalScope: "run"` label, statuses, counts, and trace type names are stored.

## Report contract and redaction proof

`MechanismDemoReport` has one immutable entry per scenario plus an immutable `allPassed` boolean. Each entry contains only: `passed` and final `status`; trace event type names; small integer dispatch/verification counts; fixed denial or approval-scope labels; and fixed booleans for failed-feedback and repair behavior.

`runMechanismDemo()` calls `deepFreeze` on the report before return, so every nested object and array is frozen. The test `freezes every nested report entry and array` asserts `Object.isFrozen` on the report and all nested entries/arrays.

The redaction test `redacts shell text, paths, source text, and secrets from the report` asserts that `JSON.stringify(report)` does not contain:
- `npm install` (shell command text)
- `/workspace` (workspace path)
- `return left` (source text)
- `secret` (secret marker)
- `left - right` (buggy source text)
- `left + right` (repaired source text)

All assertions pass. The generated `.todex/demo/mechanism-report.json` contains exactly the whitelisted fields: `allPassed`, `passed`, `status`, `denialReason`, `dispatcherCalls`, `verificationCalls`, `failedFeedbackObserved`, `repairApplied`, `runAStatus`, `runBStatus`, `runADispatcherCalls`, `runBDispatcherCalls`, `approvalScope`, and `traceTypes` arrays of type-name strings.

## Command behavior proof

`pnpm.cmd demo:mechanisms` runs `tsx scripts/run-mechanism-demo.ts`. The wrapper:

1. awaits `runMechanismDemo()`;
2. calls `writeDemoReport(report, deps)` which throws `demo_report_failed` if `allPassed` is false or if `mkdir`/`writeFile` reject;
3. creates `.todex/demo` with `mkdir(..., { recursive: true })` and writes `.todex/demo/mechanism-report.json` with `JSON.stringify(report, null, 2)`;
4. prints exactly four fixed lines: `workspace-escape: passed`, `repair-feedback: passed`, `approval-isolation: passed`, `report: .todex/demo/mechanism-report.json`;
5. exits with code 0 only after every scenario passes and the report write succeeds.

Actual console output:

```
workspace-escape: passed
repair-feedback: passed
approval-isolation: passed
report: .todex/demo/mechanism-report.json
```

On any failure the wrapper prints the fixed line `mechanism-demo: failed` and sets `process.exitCode = 1` without raw exception output. The CLI test `throws demo_report_failed when allPassed is false and never calls the writer` and `throws demo_report_failed when the writer rejects` cover both nonzero paths with injected fakes (no real disk writes during Vitest).

The `main()` entry is guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`, so importing the module in Vitest does not trigger a real report write.

## Generated-file ignore proof

`.todex/` is listed in `.gitignore` (line 18: `.todex/`). After running `pnpm.cmd demo:mechanisms`, `git status --short` does not show `.todex/demo/mechanism-report.json`. The generated report is local evidence only and is never committed.

## Test discovery and typecheck coverage proof

- `vitest.workspace.ts` now defines `defineWorkspace(["packages/*", "scripts"])`. Root `pnpm.cmd test --run` discovers `scripts/test/run-mechanism-demo.test.ts` as the `|scripts|` project (visible in the full-suite output). No second test command was added.
- `tsconfig.base.json` include now lists `scripts/**/*.ts`. Root `pnpm.cmd typecheck` compiles both `packages/**` and `scripts/**` with exit code 0. No second typecheck command or untracked script-only config was added.
- `tsx` is a root development dependency only (`devDependencies`); it is not a Harness runtime dependency and is not imported by `packages/harness-core`.

## Zero-real-execution boundary proof

`packages/harness-core/src/mechanism-demo.ts` has no import of `node:fs`, `node:child_process`, `node:net`, Electron, SQLite, or any real LLM/CommandRunner. Its only imports are existing Harness Core modules (`mock-llm`, `agent-runner`, `guardrail`, `approval-store`, `verification-runner`, `file-tools`, `trace-store` types) and `@todex/contracts` types. The `InMemoryWorkspaceFs`, `CountingDispatcher`, and `ScriptedCommandRunner` are module-private fakes that never touch the disk, spawn a process, or open a socket. The `examples/` directory is never read or modified; the arithmetic bug is copied into the in-memory filesystem as a string literal.

Only `scripts/run-mechanism-demo.ts` imports `node:fs/promises` and `node:url`, and only to write the single ignored report file and guard the entry point.

## Acceptance criteria mapping

| Course criterion | T-008 evidence |
| --- | --- |
| AC-01 | Mock LLM drives structured actions (`read_file`, `apply_patch`, `run_shell_command_with_approval`, `finish`), patch application, verification feedback, and explicit verified finish across all three scenarios. |
| AC-04 | Scenario 1 hard-denies `../.ssh/id_rsa` with `workspace_escape` before dispatch; `dispatcherCalls` is `0`; trace shows `action_rejected`. |
| AC-05 | Scenario 3 pauses Run A at `awaiting_approval`, approves scope `run`, dispatches Run A once, and proves Run B (same command, same project, different run) returns `awaiting_approval` with `runBDispatcherCalls: 0` and no `tool_completed` trace. |
| AC-06 | Scenario 2 injects one `test_failure`, the next LLM turn observes the feedback, the repair patch produces `passed`, and the explicit `finish` with `completion: "verified"` completes the run; `repairAttempts` stays within the T-006 limit. |

## Assumptions and controlled exceptions

1. **Branch base**: The branch `feat/t-008-mechanism-demo` already contained the T-008 design (`6bad29a`) and plan (`5954e7b`) commits when work began. No new design/plan documents were created; the frozen design and plan were followed as-is.

2. **Scenario 1 finish completion**: The plan's Step 4 script specified `completion: "unverified"` for scenario 1's finish, but that produces `completed_unverified`, which conflicts with the plan's own Step 1 test expectation (`status: "completed"`) and the design's "Run status is `completed`". To satisfy the frozen test and design, scenario 1's finish uses the default `verified` completion (the `completion` field is omitted), yielding `status: "completed"` with no `verificationRunner` attached. This deviation is recorded here for the lead reviewer.

3. **Single shared AgentRunner for scenario 3**: The plan specifies "one shared `AgentRunner`" for Run A and Run B. A single `AgentRunner` holds one `LlmClient`, so a single `ScriptedMockLlm` with a three-item script (`npm install`, `finish`, `npm install`) drives both runs sequentially. Run B still receives a fresh run context (new `runId`, new trace, new approval request). The "fresh Mock LLM" wording in the design is interpreted as a fresh run context rather than a second LLM instance, because the runner's LLM is fixed at construction.

4. **Per-run dispatcher counting**: Because Run A and Run B share one `CountingDispatcher`, the dispatcher tracks call counts per `runId` (via the `context.runId` passed to `dispatch`) rather than a single global counter. `runADispatcherCalls` and `runBDispatcherCalls` are read from `callsFor(runAId)` and `callsFor(runBId)`.

5. **FileTools as the scenario 2 dispatcher**: Scenario 2 uses the real `FileTools` (an existing Core `ToolDispatcher`) with the in-memory `WorkspaceFs` so that `apply_patch` actually mutates the in-memory source and the repair can be asserted from the final file content. Scenarios 1 and 3 use the `CountingDispatcher` fake because their actions are denied or approval-gated before any file/shell work, and only call counts are asserted.

6. **No PLAN.md / AGENT_LOG.md / task-card status update in this commit set**: Per the task's Allowed Files, only T-008 completion evidence files named in the implementation plan are modified. The verification Markdown is the primary evidence. PLAN.md checkboxes, AGENT_LOG, and the task-card completion section are left for the Codex lead to finalize after two-stage review and PR, consistent with "Do not push, create a PR, merge main, or begin T-009."

7. **pnpm store location**: The worktree's `node_modules` is linked from the shared store at `D:\Todex\.pnpm-store`. `pnpm add` and `pnpm install` were run with `--store-dir D:\Todex\.pnpm-store` to match; no global pnpm config was changed.

8. **Line-ending warnings**: Git emits `LF will be replaced by CRLF` warnings on Windows for the new files. These are normalization warnings only; `git diff --check` reports no whitespace errors and the committed content is unchanged.

## T-009 deferral

T-008 produces a local, redacted, immutable demonstration report only. SQLite persistence, Electron, real LLM, real shell/process execution, network access, and desktop host adapters are out of scope and remain T-009+ work.
