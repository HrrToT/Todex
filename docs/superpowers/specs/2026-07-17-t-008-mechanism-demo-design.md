# T-008 Deterministic Mechanism Demo Design

**Status:** approved for specification writing; implementation requires a separate plan and task card.

## Goal

Provide one repeatable course-evidence command that demonstrates Todex's implemented safety and repair mechanisms without a real LLM, shell command, network request, Node test process, or modification to the repository's example files.

The command produces a bounded JSON report and a concise console summary. Vitest exercises the same scenario module directly, so the command-line report and automated acceptance use one source of truth.

## Scope and Non-goals

### In scope

- Three deterministic Mock/Fake scenarios built from existing Harness Core components.
- A reusable scenario module, a command-line wrapper, a generated local JSON report, and a Vitest suite.
- Course evidence mapping to AC-01, AC-04, AC-05, and AC-06.
- One verification Markdown record with exact commands and report summary.

### Out of scope

- Real LLM providers, API keys, real shell/process execution, real Node/Python test execution inside the demo, network access, Electron, SQLite, WebUI, project persistence, and T-009+ host features.
- Editing `examples/node-bug-repo` or `examples/python-bug-repo` while the demo runs.
- Replacing the existing individual unit tests for governance, verification, file tools, or approval state.

## Architecture

`packages/harness-core/src/mechanism-demo.ts` exports `runMechanismDemo()`. It creates fresh in-memory fakes for every scenario and returns an immutable `MechanismDemoReport`. It uses existing `AgentRunner`, `ScriptedMockLlm`, `Guardrail`, `InMemoryApprovalStore`, `InMemoryTraceStore`, `HarnessDispatcher`/`FileTools`, an in-memory workspace filesystem, and an injected Fake `CommandRunner`.

`scripts/run-mechanism-demo.ts` imports that module, writes its returned report to `.todex/demo/mechanism-report.json`, prints one status line for each scenario plus the report path, and exits nonzero if the module reports any failure or report writing fails.

`packages/harness-core/test/mechanism-demo.test.ts` imports `runMechanismDemo()` directly. It asserts the report's schema-relevant fields, complete critical trace sequences, dispatcher/verification call counts, and the isolation of each scenario. It does not rely on the generated JSON file.

The JSON path is ignored by Git through the existing `.todex` ignore rule. The verification Markdown records an actual invocation but never commits generated JSON output.

## Scenario 1: Workspace Escape Is Hard-Denied

The scripted Mock LLM emits `read_file` with path `../.ssh/id_rsa`. The real T-004 `Guardrail` is evaluated before dispatch. The scenario succeeds only when:

- Run status is `completed` after a subsequent Mock `finish` action.
- The rejected `ToolResult` has a `denied: workspace_escape` summary.
- Trace types are exactly `action_requested`, `action_rejected`, `action_requested`, `run_completed`.
- Dispatcher call count is zero.

The report stores only the trace type names, final status, denial reason, and dispatcher count.

## Scenario 2: Failed Verification Feeds a Repair

The scenario uses an in-memory workspace containing a Node-style arithmetic source file where `add(left, right)` incorrectly subtracts. It never opens or edits `examples/node-bug-repo` on disk.

The scripted Mock LLM emits, in order:

1. A valid unified-diff `apply_patch` action representing the first attempted change.
2. A valid unified-diff repair action after receiving verification feedback.
3. `finish` with `completion: "verified"`.

The Fake `CommandRunner` returns `test_failure` after the first successful patch and `success` after the repair. The injected `VerificationRunner` therefore produces `test_failure` feedback on the next LLM turn and `passed` feedback before the explicit verified finish.

The scenario succeeds only when:

- Final Run status is `completed`.
- Verification command call count is two.
- The second LLM context contains verification classification `test_failure`.
- The third LLM context contains verification classification `passed`.
- The in-memory source ends with the correct addition implementation.
- The critical trace contains two `verification_completed` events and ends in `run_completed`.

The report contains classifications, call counts, final status, trace types, and booleans `failedFeedbackObserved` and `repairApplied`. It contains no patch text or source content.

## Scenario 3: Approval Does Not Leak to a New Run

Run A's Mock LLM requests `run_shell_command_with_approval` with `npm install`. The T-004 guardrail pauses it for approval. The scenario applies the `run` approval scope, verifies that Run A dispatches exactly once, and records that result.

Run B, using a fresh Mock LLM and the same `AgentRunner`, requests the same action. It must stop at `awaiting_approval`; the previous run-scoped grant cannot authorize it. Run B's dispatcher count remains zero.

The scenario succeeds only when:

- Run A is initially `awaiting_approval`, then resumes and completes after approval.
- Run B is `awaiting_approval` before any approval decision.
- Run A dispatcher count is one and Run B dispatcher count is zero.
- Run B has an `approval_requested` trace event and no `tool_completed` event for the shell action.

The report stores only statuses, trace type names, approval scope, and dispatcher counts. It never stores the free-shell command text.

## Report Contract and Redaction

`MechanismDemoReport` has one immutable entry per scenario plus an immutable `allPassed` boolean. Each scenario entry contains only:

- `passed` and final `status`;
- trace event type names;
- small integer dispatch/verification counts;
- fixed denial or approval-scope labels;
- fixed booleans for failed-feedback and repair behavior.

The report intentionally excludes workspace roots, file contents, unified diffs, shell command text, raw verification output, exception messages, API keys, credentials, and arbitrary model output. Every nested array and report object is frozen before return. The CLI serializes exactly this report shape using `JSON.stringify(report, null, 2)`.

## Command Behavior

T-008 adds `tsx` as a root development dependency and updates `pnpm-lock.yaml`. The root package receives the exact script `"demo:mechanisms": "tsx scripts/run-mechanism-demo.ts"`; `tsx` is only the TypeScript command-line host and is not a Harness runtime dependency. The wrapper must:

1. await `runMechanismDemo()`;
2. reject/report failure if `allPassed` is false;
3. create `.todex/demo` if needed and write the JSON report there;
4. print only fixed scenario labels, pass/fail state, and the relative report path;
5. exit with code 0 only after every scenario passes and the report write succeeds.

The command does not invoke npm, pnpm, Python, Node's test runner, a shell, or any configured project command. Its Node process is only the script host itself.

## Error Handling

- Scenario setup or assertion failure returns/throws a bounded fixed error identifying the scenario label, without serializing raw fake workspace content.
- If report serialization or writing fails, the CLI prints a fixed write-failure message and exits nonzero; it does not leave a partial report marked successful.
- The test suite covers an all-pass report and a deliberately injected failing scenario result so the CLI's nonzero path is deterministic.
- Every run builds fresh fakes and IDs, so no approval grant, trace, file mutation, cancellation, or LLM context leaks between scenarios.

## Acceptance and Evidence

T-008 is accepted only when all of the following are demonstrated:

| Course criterion | T-008 evidence |
| --- | --- |
| AC-01 | Mock LLM drives structured actions, patch, verification feedback, and explicit finish. |
| AC-04 | Workspace escape is hard-denied and Dispatcher count remains zero. |
| AC-05 | Approval pauses Run A and does not authorize Run B. |
| AC-06 | First verification fails, next LLM turn sees feedback, repair passes, and verified finish completes. |

Required final commands are `pnpm.cmd demo:mechanisms`, the focused mechanism-demo test, full `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, and `git diff --check`. The verification record must include the actual console summary, report-path statement, redacted JSON field summary, AC mapping, and independent review outcome.

## Collaboration and Review

Codex leads T-008 because it is direct course evidence. A single auxiliary model may implement the frozen task card in an isolated worktree, but it must not expand the demonstration into real process execution or UI work. Codex performs specification review, code-quality/security review, final evidence verification, GitHub PR/CI handling, and waits for explicit user authorization before merge.

## Design Self-Review

- The module, CLI, test, report, and verification record have distinct responsibilities and one shared scenario source of truth.
- All three scenarios reuse existing T-004/T-005/T-006 interfaces. The only new development dependency is `tsx` for the TypeScript command-line wrapper; no Harness runtime dependency, contract migration, or host feature is added.
- The repair scenario deliberately uses in-memory data and Fake `CommandRunner`, so the generated report remains deterministic even when pytest is absent.
- Each report field is bounded and excludes untrusted/raw text, preserving the existing sensitive-data and prompt-injection boundaries.
