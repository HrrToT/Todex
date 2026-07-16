# T-006 Verification Feedback and Repair Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox syntax.

**Goal:** Add one confirmed-command verification after each successful patch, bounded feedback to the next LLM turn, and deterministic repair/environment terminal behavior.

**Architecture:** `VerificationRunner` resolves an injected, project-scoped confirmed command and invokes an injected `CommandRunner`; it emits a bounded `VerificationResult` and no process is spawned in Core. `AgentRunner` owns trigger timing, latest verification, repair counts, completion rules, traces, and all terminal transitions.

**Tech Stack:** TypeScript strict, Vitest, existing contracts, existing AgentRunner/TraceStore/Guardrail. No real shell, process spawning, SQLite, Electron, project detection, or new dependency.

---

## Frozen Constraints

- Authority: `SPEC` sections 5/12, `PLAN` T-006, and `docs/superpowers/specs/2026-07-16-t-006-verification-feedback-design.md`.
- Base is `main@2bb742d`; implementation branch is `feat/t-006-verification-feedback` in a fresh worktree.
- Verification triggers only after a successful `apply_patch`; no other action, rejected patch, conflicted patch, or approval event triggers it.
- Only one injected `verificationCommandId` is run; its command must match projectId and `confirmedByUser === true`. LLM cannot choose or alter argv.
- Feedback is capped at 2000 characters and 20 paths after redaction. Raw output, sensitive values, and absolute host paths never enter LLM context or trace.
- Initial patch does not consume a repair attempt. Three additional successful patches may follow repairable failures; the third additional failure ends `failed_repair_limit` without another LLM turn.
- Environment classes stop `failed_environment` without consuming repair attempts. Missing command causes only `completed_unverified` on later verified finish.

## File Map

| File | Responsibility |
| --- | --- |
| `packages/harness-core/src/verification-runner.ts` | CommandRunner, confirmed registry, deterministic execution classification and feedback projection. |
| `packages/harness-core/src/llm.ts` | Verification feedback type and LLM/Runner option interfaces. |
| `packages/harness-core/src/agent-runner.ts` | Patch trigger, verification trace, repair state, terminal behavior, context snapshot. |
| `packages/harness-core/src/index.ts` | Public verification exports. |
| `packages/harness-core/test/verification-runner.test.ts` | Registry, classification, redaction, truncation tests. |
| `packages/harness-core/test/repair-loop.test.ts` | Real Runner patch-feedback-repair terminal state tests. |
| `docs/*` | Task completion evidence only after green verification. |

### Task 1: Define Verification Runner and Registry

**Files:** Create `src/verification-runner.ts`, `test/verification-runner.test.ts`; modify `src/index.ts`.

- [ ] **Step 1: Write failing confirmed-command tests**

```ts
it("runs only a confirmed command for the current project", async () => {
  const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });
  expect(commandRunner.calls).toEqual([{ argv: ["pnpm", "test"], workingDirectory: ".", timeoutMs: 10_000 }]);
  expect(result.classification).toBe("passed");
});
it("does not call CommandRunner for unknown, mismatched, or unconfirmed commands", async () => {
  await expect(runner.run({ projectId: "p1", commandId: "p2.test", runId: "r1" })).resolves.toMatchObject({ classification: "command_not_found" });
  expect(commandRunner.calls).toHaveLength(0);
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run verification-runner.test.ts`

Expected: FAIL because `VerificationRunner` is absent.

- [ ] **Step 3: Implement injected interfaces and deterministic classification**

```ts
export interface CommandRunner { run(input: { argv: readonly string[]; workingDirectory: string; timeoutMs: number }): Promise<CommandExecution>; }
export interface ConfiguredCommandRegistry { find(projectId: string, commandId: string): ConfiguredCommand | undefined; }
export interface VerificationFeedback { readonly classification: VerificationClassification; readonly commandId: string; readonly exitCode: number | null; readonly durationMs: number; readonly failureSummary: string; readonly relatedPaths: readonly string[]; readonly repairAttempts: number; }
```

`VerificationRunner` returns the existing `VerificationResult` shape. It allows only registry commands with matching projectId and `confirmedByUser`. Map injected execution conditions exactly to passed/test_failure/quality_failure/build_failure/command_not_found/dependency_missing/timeout/execution_error/cancelled.

- [ ] **Step 4: Add bounded redaction tests and implementation**

Test a 2500-character seeded error containing `TOKEN=secret-value`, `C:\\Users\\Lenovo\\project`, and 25 paths. Implement a stable projection with at most 2000 characters and 20 relative paths, replacing sensitive values and host absolute paths before output is stored or returned.

- [ ] **Step 5: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run verification-runner.test.ts`

Expected: PASS for command authorization, all classifications, redaction, and limits.

Commit: `git add packages/harness-core/src/verification-runner.ts packages/harness-core/src/index.ts packages/harness-core/test/verification-runner.test.ts; git commit -m "feat: add deterministic verification runner"`

### Task 2: Feed Verification into the Real AgentRunner

**Files:** Modify `src/llm.ts`, `src/agent-runner.ts`, `src/index.ts`; create `test/repair-loop.test.ts`; modify existing Runner tests only for T-006 fixtures.

- [ ] **Step 1: Write failing patch-feedback-passed test**

```ts
it("feeds a failed verification to the next turn then completes after pass and finish", async () => {
  const llm = new ScriptedMockLlm([patchAction("first"), patchAction("repair"), finishAction("verified")]);
  const result = await runner.run(input);
  expect(llm.contexts[1].verification?.classification).toBe("test_failure");
  expect(llm.contexts[2].verification?.classification).toBe("passed");
  expect(result.status).toBe("completed");
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run repair-loop.test.ts`

Expected: FAIL because Runner has no verification trigger or feedback context.

- [ ] **Step 3: Add the smallest Runner state and interfaces**

Add optional `verificationRunner` and `verificationCommandId` to `RunnerOptions`; add optional immutable `verification` to `LlmTurnContext`. Run verification only after a succeeded `apply_patch` result. Append `verification_completed`, retain the latest result, and build a copied feedback packet before the next `nextAction` call. Preserve T-003 through T-005 behavior unchanged when options are absent.

- [ ] **Step 4: Enforce verified finish and no-command behavior**

`finish(verified)` yields `completed` only with a current `passed` result. With no primary command or no current pass it yields `completed_unverified` with deterministic stop reason. A successful later patch clears a prior pass before verification. `finish(unverified)` remains `completed_unverified`.

- [ ] **Step 5: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run repair-loop.test.ts agent-runner.test.ts`

Expected: PASS for failed feedback, passed feedback, explicit finish, no-command, and pass-invalidated-by-later-patch cases.

Commit: `git add packages/harness-core/src/llm.ts packages/harness-core/src/agent-runner.ts packages/harness-core/src/index.ts packages/harness-core/test/repair-loop.test.ts packages/harness-core/test/agent-runner.test.ts; git commit -m "feat: feed verification into repair loop"`

### Task 3: Enforce Repair Limits and Environment Stops

**Files:** Modify `src/agent-runner.ts`, `test/repair-loop.test.ts`.

- [ ] **Step 1: Write failing terminal-state tests**

```ts
it("stops after the initial patch plus three failed repair patches without a fifth LLM call", async () => {
  const result = await runner.run(input);
  expect(result.status).toBe("failed_repair_limit");
  expect(llm.contexts).toHaveLength(4);
});
it("stops environment failures without consuming repair attempts", async () => {
  const result = await environmentFailureRunner.run(input);
  expect(result.status).toBe("failed_environment");
  expect(result.stopReason).toBe("dependency_missing");
  expect(llm.contexts).toHaveLength(1);
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run repair-loop.test.ts`

Expected: FAIL because repair attempts and verification terminal classes are not connected to RunStatus.

- [ ] **Step 3: Implement deterministic limit/state rules**

Treat test_failure, quality_failure, and build_failure as repairable. Initial failure sends feedback with repairAttempts 0. Before dispatching each additional successful patch, increment the pending repair count; after its third failed verification, append trace and return `failed_repair_limit` without `nextAction`. Return `failed_environment` for command_not_found/dependency_missing/timeout/execution_error. Return `cancelled` when cancellation is observed before or after verification. None of these terminal paths dispatches another action or LLM request.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run repair-loop.test.ts verification-runner.test.ts`

Expected: PASS for test/quality/build repair paths, all environment paths, cancellation, exact three additional repairs, and zero extra LLM calls.

Commit: `git add packages/harness-core/src/agent-runner.ts packages/harness-core/test/repair-loop.test.ts; git commit -m "feat: enforce repair limits and environment stops"`

### Task 4: Full Verification and Course Evidence

**Files:** Modify `docs/PLAN.md`, `docs/AGENT_LOG.md`, `docs/task-cards/T-006-verification-feedback-and-repair.md`; create `docs/verification/2026-07-16-t-006-verification-feedback.md`.

- [ ] **Step 1: Run focused and repository verification**

Run: `pnpm.cmd --filter @todex/harness-core test --run verification-runner.test.ts repair-loop.test.ts`

Expected: PASS.

Run: `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, `git diff --check`, `git status --short`.

Expected: all pass, no whitespace error, and no untracked process output, secret, database, or build artifact.

- [ ] **Step 2: Record evidence and commit**

Record exact RED/GREEN commands/counts, command authorization proof, 2000/20 feedback proof, initial-plus-three repair proof, no-command verified-finish downgrade, environment-stop proof, and Codex review results.

Commit implementation and docs separately:

`git add packages/harness-core/src packages/harness-core/test; git commit -m "feat: add verification feedback and repair limits"`

`git add docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-006-verification-feedback-and-repair.md docs/verification/2026-07-16-t-006-verification-feedback.md; git commit -m "docs: record T-006 verification"`

## Plan Self-Review

Task 1 covers confirmed command lookup, classification, redaction, and feedback limits. Task 2 covers real Runner trigger/context/finish behavior. Task 3 covers repair count and all terminal states. Task 4 covers full validation and course evidence. The interfaces introduced in Tasks 1-2 are used consistently in Tasks 2-3. No real process execution, detector, persistence, UI, or dependency is introduced.
