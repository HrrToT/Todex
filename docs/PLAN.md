# Todex V1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

???approved for cold-start validation
?????2026-07-17

**Goal:** ???? Windows ???????? Todex V1.0??? coding-agent Harness?Node/Python ?????/HITL??????Electron ?????? Mock Demo?

**Architecture:** TypeScript pnpm monorepo?? `packages/harness-core` ??? Electron/?? LLM ???????????????????`apps/desktop` ?????????????`apps/demo-web` ??????? Mock LLM????? contracts ? UI?

**Tech Stack:** TypeScript strict?pnpm 10.12.1?Vitest?Zod?ESLint 9 flat config?typescript-eslint?React?Vite?Electron?electron-builder?SQLite?keytar?Playwright?GitHub Actions?Render?

---

## ?????????

- ??????? git worktree ? PR ????????? `docs/task-cards/T-NNN-*.md`?
- ???????????????????????????????????????? -> ????????
- ????????????????????????????????????
- `PLAN.md` ????????? PR?commit?????????????

## ??????

| ?? | ?? |
| --- | --- |
| `package.json`?`pnpm-workspace.yaml`?`tsconfig.base.json` | ?????????? TypeScript ?? |
| `packages/contracts/src/index.ts` | Action?Run??????????????? schema |
| `packages/harness-core/src/` | ??????Mock LLM????????????????????trace???? |
| `packages/harness-core/test/` | ??????? LLM ? Vitest ??/???? |
| `apps/desktop/src/main/` | Electron ????????SQLite?Credential Manager?IPC |
| `apps/desktop/src/renderer/` | ????? React UI |
| `apps/demo-web/src/` | Render ????? Mock Demo ?? |
| `packages/ui/src/` | ????????trace?diff???????? |
| `examples/node-bug-repo/`?`examples/python-bug-repo/` | ???? Node/Python ?????? |
| `scripts/` | ?????????? |
| `.github/workflows/` | GitHub Actions ?????? Release ??? |

## ?????

```text
T-001 -> T-002 -> T-003 -> T-004 -> T-005 -> T-006
                                      |         |
                                      v         v
                                   T-007 ----> T-008 -> T-009
T-001 -> T-010 -> T-011 -> T-012
T-006 + T-009 + T-011 -> T-012
```

### Task 1: T-001 ?? pnpm monorepo ?????

**???** ??
**?????** GLM???????
**???** ????????? PR #1??? commits `d803fa2`?

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `eslint.config.mjs`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/harness-core/package.json`
- Create: `packages/harness-core/src/index.ts`
- Create: `packages/harness-core/test/smoke.test.ts`
- Create: `.github/workflows/ci.yml`

- [x] **Step 1: Establish the reproducible toolchain baseline**

Create the root `package.json` with `"packageManager": "pnpm@10.12.1"`, workspace scripts, and these root development dependencies: `typescript`, `vitest`, `zod`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, and `@types/node`. Create `eslint.config.mjs` using ESLint flat config for `*.ts` and `*.tsx`, ignoring `dist`, `out`, `coverage`, `node_modules`, `.todex`, and generated release directories.

The exact scripts are:

```json
{
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.base.json",
    "lint": "eslint .",
    "build": "pnpm -r build"
  }
}
```

Run: `corepack enable`
Run: `pnpm install`
Expected: creates `pnpm-lock.yaml` and installs the declared toolchain.

- [x] **Step 2: Write the failing workspace smoke test**

```ts
import { describe, expect, it } from "vitest";
import { HARNESS_VERSION } from "../src/index.js";

describe("harness-core workspace", () => {
  it("exports a semantic version", () => {
    expect(HARNESS_VERSION).toMatch(/^0\.1\.0$/);
  });
});
```

- [x] **Step 3: Run the test and verify red**

Run: `pnpm --filter @todex/harness-core test --run`
Expected: FAIL because `src/index.ts` or `HARNESS_VERSION` does not exist.

- [x] **Step 4: Add the minimal Core export and workspace wiring**

```ts
// packages/harness-core/src/index.ts
export const HARNESS_VERSION = "0.1.0";
```

CI must run `pnpm install --frozen-lockfile` followed by `pnpm lint`, `pnpm test`, and `pnpm typecheck`.

- [x] **Step 5: Verify green, typecheck and lint**

Run: `pnpm test --run`
Expected: PASS with the workspace smoke test.
Run: `pnpm typecheck`
Expected: exit code 0.

Run: `pnpm lint`
Expected: exit code 0.

- [x] **Step 6: Commit and record**

Run: `git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts eslint.config.mjs packages .github/workflows/ci.yml`
Run: `git commit -m "chore: bootstrap Todex monorepo"`

### Task 2: T-002 ???????Run ?????

**???** T-001?
**?????** DeepSeek???????

????????????[T-006 ??](superpowers/specs/2026-07-16-t-006-verification-feedback-design.md)?[T-006 ????](superpowers/plans/2026-07-16-t-006-verification-feedback.md)?[DeepSeek ???](task-cards/T-006-verification-feedback-and-repair.md)?T-006 ?????? CommandRunner ??????? commandId?????????????SQLite ? Electron ????????????
**???** ????????? PR #1??? commit `a87325e`?P1 ?? commit `a04ad9f`?

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/contracts.test.ts`

- [x] **Step 1: Write failing schema tests**

```ts
it("accepts a read_file action", () => {
  expect(parseAction({ tool: "read_file", path: "src/app.ts" })).toEqual({
    tool: "read_file", path: "src/app.ts",
  });
});

it("rejects an unknown tool", () => {
  expect(() => parseAction({ tool: "launch_missiles" })).toThrow("unknown tool");
});
```

- [x] **Step 2: Verify red**

Run: `pnpm --filter @todex/contracts test --run`
Expected: FAIL because `parseAction` is undefined.

- [x] **Step 3: Implement discriminated contracts**

Use the complete field tables in SPEC section 5 as the only schema authority. Define the eight `Action` variants and the complete `RunStatus`, `ConfiguredCommand`, `VerificationResult`, `ApprovalRequest`, `MemoryEntry`, `TraceEvent`, `RunSession`, and `ToolResult` shapes exactly as specified; implement `parseAction` with the root Zod dependency. Do not import or require any `docs/architecture` file to decide fields.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @todex/contracts test --run`
Expected: PASS; malformed fields and every unknown tool throw a stable error.

- [x] **Step 5: Commit and record**

Run: `git add packages/contracts`
Run: `git commit -m "feat: define harness contracts"`

### Task 3: T-003 ?? Mock LLM?trace ??? Agent ???

**???** T-002?
**?????** Codex ????? Mock LLM ????? Qwen?

**Files:**
- Create: `packages/harness-core/src/llm.ts`
- Create: `packages/harness-core/src/mock-llm.ts`
- Create: `packages/harness-core/src/trace-store.ts`
- Create: `packages/harness-core/src/agent-runner.ts`
- Create: `packages/harness-core/test/agent-runner.test.ts`

- [x] **Step 1: Write the failing scripted-loop test**

```ts
it("records read_file then finish from a scripted LLM", async () => {
  const llm = new ScriptedMockLlm([
    { tool: "read_file", path: "src/app.ts" },
    { tool: "finish", summary: "inspected source" },
  ]);
  const runner = createRunner({ llm, dispatcher: fakeDispatcher() });

  const result = await runner.run({ task: "inspect app", projectId: "p1" });

  expect(result.status).toBe("completed");
  expect(result.trace.map((event) => event.type)).toEqual([
    "action_requested", "tool_completed", "action_requested", "run_completed",
  ]);
});
```

- [x] **Step 2: Verify red**

Run: `pnpm --filter @todex/harness-core test --run agent-runner.test.ts`
Expected: FAIL because `ScriptedMockLlm` and `createRunner` are absent.

- [x] **Step 3: Implement the loop without a framework runner**

Implement `LlmClient.nextAction(context): Promise<unknown>`, `ScriptedMockLlm`, append-only `TraceStore`, and `AgentRunner.run`. The loop must validate every raw LLM result through `parseAction`, dispatch only validated actions, feed `ToolResult` back into the next context, and stop only on `finish`, cancellation, max steps, or terminal error.

- [x] **Step 4: Verify green and add malformed-action coverage**

Run: `pnpm --filter @todex/harness-core test --run agent-runner.test.ts`
Expected: PASS. Add a test proving malformed LLM output becomes a trace error and never reaches the dispatcher.

- [x] **Step 5: Commit and record**

Run: `git add packages/harness-core/src packages/harness-core/test`
Run: `git commit -m "feat: add deterministic agent loop"`

?????`03e9ac5`?????`f57dad1`?P1 ???????? CI ???????????? [T-003 ??](verification/2026-07-13-t-003-agent-loop.md)?CI ??? checkout ?? `@todex/contracts` ? `dist` ????????? contracts ???? TypeScript build?????????? workspace ??

### Task 4: T-004 ??????????????????

**???** T-002?T-003?
**?????** GLM ?? Guardrail?Codex ??????

**Files:**
- Create: `packages/harness-core/src/guardrail.ts`
- Create: `packages/harness-core/src/approval-store.ts`
- Create: `packages/harness-core/src/run-state-machine.ts`
- Modify: `packages/harness-core/src/agent-runner.ts`
- Modify: `packages/harness-core/src/llm.ts`
- Modify: `packages/harness-core/src/index.ts`
- Create: `packages/harness-core/test/guardrail.test.ts`
- Create: `packages/harness-core/test/approval-state-machine.test.ts`

- [x] **Step 1: Write failing hard-deny and approval tests**

```ts
it("denies a path escaping the workspace", () => {
  expect(classifyAction(readFile("../.ssh/id_rsa"), context)).toMatchObject({
    decision: "deny",
    reason: "workspace_escape",
  });
});

it("pauses a free shell command until approval", async () => {
  const result = await runner.runShell("npm install", context);
  expect(result.status).toBe("awaiting_approval");
  expect(fakeRunner.calls).toHaveLength(0);
});
```

- [x] **Step 2: Verify red**

Run: `pnpm --filter @todex/harness-core test --run guardrail.test.ts approval-state-machine.test.ts`
Expected: FAIL because classifier and approval state machine do not exist.

- [x] **Step 3: Implement deterministic governance**

Implement canonical workspace resolution, sensitive path deny rules, `allow | require_approval | deny` classification, immutable `ApprovalRequest`, scopes `once | run | command_prefix | deny`, and state transitions `running -> awaiting_approval -> dispatching/running/cancelled`. Integrate GovernanceController into AgentRunner before every Dispatcher call; a hard denial must never dispatch and an approval-required action must suspend and resume only after a valid decision. Persist prefix grants only for safe normalized command fingerprints and set a 7-day expiry. The detailed frozen contract is [T-004 implementation plan](superpowers/plans/2026-07-14-t-004-governance.md) and its GLM task card.

- [x] **Step 4: Verify green plus bypass cases**

Run: `pnpm --filter @todex/harness-core test --run guardrail.test.ts approval-state-machine.test.ts`
Expected: PASS. Add tests that `npm test; curl ...`, `.env`, duplicate approval clicks, and a new Run after run-scope approval are all rejected or re-approved as specified.

- [x] **Step 5: Commit and record**

Run: `git add packages/harness-core/src/guardrail.ts packages/harness-core/src/approval-store.ts packages/harness-core/src/run-state-machine.ts packages/harness-core/test`
Run: `git commit -m "feat: add governance and HITL state machine"`

?????`430b77a`???????`0ec7b07`?????? command_prefix??`0bc5767`?Windows ???????????`d721397`?PowerShell ????????`4773476`?PowerShell ????????? Codex ?????????????? [T-004 ??](verification/2026-07-14-t-004-governance.md)?

### Task 5: T-005 ???????trace ???????

**???** T-003?T-004?
**?????** Qwen???????

????????????[T-005 ??](superpowers/specs/2026-07-15-t-005-file-tools-memory-design.md)?[T-005 ????](superpowers/plans/2026-07-15-t-005-file-tools-memory.md)?[Qwen ???](task-cards/T-005-file-tools-and-memory.md)?SQLite ?????????????? Electron ????????? T-009?T-005 ????????????????? fake?

**Files:**
- Create: `packages/harness-core/src/file-tools.ts`
- Create: `packages/harness-core/src/memory-store.ts`
- Create: `packages/harness-core/src/context-builder.ts`
- Create: `packages/harness-core/test/file-tools.test.ts`
- Create: `packages/harness-core/test/memory-store.test.ts`

- [x] **Step 1: Write failing file and memory tests**

```ts
it("does not expose content from a sensitive file", async () => {
  await expect(tools.readFile(".env")).rejects.toThrow("sensitive_path");
});

it("requires trace evidence for agent-observed memory", () => {
  expect(() => memory.remember({ kind: "project_convention", content: "x" })).toThrow("traceEventId");
});
```

- [x] **Step 2: Verify red**

Run: `pnpm --filter @todex/harness-core test --run file-tools.test.ts memory-store.test.ts`
Expected: FAIL because tools and memory store are absent.

- [x] **Step 3: Implement bounded tools and memory selection**

Implement list/read/search/applyPatch against injected filesystem adapters, redact sensitive values from `ToolResult`, and implement `MemoryStore` with `verified` and `agent_observed` trust. `ContextBuilder` must choose at most 12 entries and 4096 characters, prioritizing verified project facts and current verification context.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @todex/harness-core test --run file-tools.test.ts memory-store.test.ts`
Expected: PASS. Add a deletion test proving removed memory is absent from a subsequent context.

- [x] **Step 5: Commit and record**

Run: `git add packages/harness-core/src/file-tools.ts packages/harness-core/src/memory-store.ts packages/harness-core/src/context-builder.ts packages/harness-core/test`
Run: `git commit -m "feat: add bounded file tools and project memory"`

?????`d256648`?????????`4f64d43`????????????`e17a23d`?????????`ec7267c`?Runner ?????????`821a6e4`?`660546e`?`9421249`?`212a331`?Codex ???????????????????????????? 269/269 ?????typecheck?lint?build ?????? [T-005 ??](verification/2026-07-15-t-005-file-tools-memory.md)?

### Task 6: T-006 ???????????????

**???** T-003?T-005?
**?????** DeepSeek???????

????????????[T-006 ??](superpowers/specs/2026-07-16-t-006-verification-feedback-design.md)?[T-006 ????](superpowers/plans/2026-07-16-t-006-verification-feedback.md)?[DeepSeek ???](task-cards/T-006-verification-feedback-and-repair.md)?T-006 ?????? CommandRunner ??????? commandId?????????????SQLite ? Electron ????????????
**???** ?????? `main`??? commits `c5247a0`?`9733abb`?`f6365f8`?`8c3ec90`?Codex ???? commits `bea859a`?`cf11eed`?[PR #5](https://github.com/HrrToT/Todex/pull/5) ? GitHub Actions CI ????? merge commit `adc33c3` ???????????? 327/327 ?????typecheck?lint?build ? `git diff --check` ?????? [T-006 ??](verification/2026-07-16-t-006-verification-feedback.md)?

**Files:**
- Create: `packages/harness-core/src/verification-runner.ts`
- Modify: `packages/harness-core/src/agent-runner.ts`
- Modify: `packages/harness-core/src/llm.ts`
- Modify: `packages/harness-core/src/index.ts`
- Create: `packages/harness-core/test/verification-runner.test.ts`
- Create: `packages/harness-core/test/repair-loop.test.ts`

- [x] **Step 1: Write failing feedback-loop tests**

```ts
it("feeds a failing test summary into the next LLM turn and then passes", async () => {
  const llm = new ScriptedMockLlm([
    patchAction("bug.ts", "bad", "fixed"),
    patchAction("bug.ts", "fixed", "fixed-again"),
    finishAction(),
  ]);
  const verify = fakeVerification([testFailure("expected 2 received 1"), passed()]);

  const result = await createRunner({ llm, verify }).run(runInput);

  expect(result.status).toBe("completed");
  expect(llm.contexts[1].verification?.classification).toBe("test_failure");
});
```

- [x] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run verification-runner.test.ts repair-loop.test.ts`
Expected: FAIL because verification and repair feedback are absent.

- [x] **Step 3: Implement verification and repair rules**

Implement injected `CommandRunner`, exact `commandId` lookup, classifications from SPEC, truncated feedback packets, `maxRepairAttempts = 3`, and terminal statuses `completed`, `completed_unverified`, `failed_repair_limit`, `failed_environment`, and `cancelled`.

- [x] **Step 4: Verify green**

Run: `pnpm.cmd --filter @todex/harness-core test --run verification-runner.test.ts repair-loop.test.ts`
Expected: PASS. Add cases for dependency missing, timeout, no configured command, and fourth repair failure.

- [x] **Step 5: Commit and record**

Run: `git add packages/harness-core/src/verification-runner.ts packages/harness-core/src/agent-runner.ts packages/harness-core/test`
Run: `git commit -m "feat: add verification feedback and repair limits"`

?????`c5247a0`????????`9733abb`???????????`f6365f8`????????????`8c3ec90`?????????`4449fcc`???????`bea859a`?P1/P2 ?????? `cf11eed`??? LLM ??????????Codex ??????????????????/??????????????????????Unix ???????????????????????????????????????? 327/327 ?????typecheck?lint?build ? `git diff --check` ????[PR #5](https://github.com/HrrToT/Todex/pull/5) CI ???? `adc33c3` ?? `main`??? [T-006 ??](verification/2026-07-16-t-006-verification-feedback.md)?

### Task 7: T-007 ?? Node.js/Python ???????

**???** T-005?
**????** ? T-006 ???
**?????** ?? GLM ????? worktree ??? Node ? Python ???Codex ???????????

????????????[T-007 ??](superpowers/specs/2026-07-17-t-007-project-detection-design.md)?[T-007 ????](superpowers/plans/2026-07-17-t-007-project-detection.md)?[GLM ???](task-cards/T-007-project-detection-and-examples.md)??????????? GLM ????? worktree ??? Node ? Python ???Codex ???????????PR?CI ????T-007 ?????????????????????????? `ConfiguredCommand`?
**???** ??? Codex ????????? commits `830f32d`?Node ????`ddc570d`?Python ????`b41ac16`?????? fixture ?????? commit ?? P1-1?lockfile ???? fail-closed??P1-2?notice ??? script ???? P2??????????? 367/367 ?????typecheck?lint?build ? `git diff --check` ?????? [T-007 ??](verification/2026-07-17-t-007-project-detection.md)?

**Files:**
- Create: `packages/harness-core/src/project-detector.ts`
- Create: `packages/harness-core/test/project-detector.test.ts`
- Create: `examples/node-bug-repo/package.json`
- Create: `examples/node-bug-repo/src/price.ts`
- Create: `examples/node-bug-repo/test/price.test.ts`
- Create: `examples/python-bug-repo/pyproject.toml`
- Create: `examples/python-bug-repo/src/calculator.py`
- Create: `examples/python-bug-repo/tests/test_calculator.py`

- [x] **Step 1: Write failing detector tests**

```ts
it("detects npm test and lint scripts", async () => {
  const profile = await detectProject(fixture("node-bug-repo"));
  expect(profile.kinds).toContain("node");
  expect(profile.candidates.map((item) => item.candidateId)).toContain("node.test");
});

it("detects pytest and ruff candidates", async () => {
  const profile = await detectProject(fixture("python-bug-repo"));
  expect(profile.kinds).toContain("python");
  expect(profile.candidates.map((item) => item.candidateId)).toContain("python.pytest");
});
```

- [x] **Step 2: Verify red**

Run: `pnpm --filter @todex/harness-core test --run project-detector.test.ts`
Expected: FAIL because detector and fixtures do not exist.

- [x] **Step 3: Implement conservative detector rules**

Inspect `package.json` scripts and Python markers `pyproject.toml`, `requirements.txt`, `pytest.ini`; return candidates only, never execute them. Create one deterministic arithmetic bug in each example repository so a Mock LLM patch can make its tests pass.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @todex/harness-core test --run project-detector.test.ts`
Expected: PASS. Run each example's native test command manually and confirm it fails before the demonstration patch.

- [x] **Step 5: Commit and record**

Run: `git add packages/harness-core/src/project-detector.ts packages/harness-core/test/project-detector.test.ts examples`
Run: `git commit -m "feat: add Node and Python project detection"`

?????`830f32d`?Node ???? contract?index ??? 18 ?????`ddc570d`?Python ???? marker regex????????? 13 ?????`b41ac16`?????? fixture ????Node ?? `node --test` ? `-1 !== 5` ???????Python ?????? pytest?`No module named pytest`??????????? [T-007 ??](verification/2026-07-17-t-007-project-detection.md)?

### Task 8: T-008 ???????????

**???** T-004?T-006?T-007?
**?????** Codex ??????????????

????????????[T-008 ??](superpowers/specs/2026-07-17-t-008-mechanism-demo-design.md)?[T-008 ????](superpowers/plans/2026-07-17-t-008-mechanism-demo.md)?[GLM ???](task-cards/T-008-mechanism-demo.md)??? GLM ????? worktree ?????????Codex ???????????????PR?CI ????T-008 ?? Mock/Fake ??????????? `tsx` ?? TypeScript CLI ??????????????????????
**???** GLM ???? Codex ?????????? commits `12a4782`???????`1d44ccd`?CLI ? `tsx`????????? `AgentRunner` ????? `ToolResult` ? Scenario 1 ???????????????? CLI????? 378/378 ?????typecheck?lint?build ? `git diff --check` ?????? [T-008 ??](verification/2026-07-17-t-008-mechanism-demo.md)?

**Files:**
- Create: `packages/harness-core/src/mechanism-demo.ts`
- Create: `packages/harness-core/test/mechanism-demo.test.ts`
- Create: `scripts/run-mechanism-demo.ts`
- Create: `scripts/test/run-mechanism-demo.test.ts`
- Create: `docs/verification/2026-07-17-t-008-mechanism-demo.md`
- Modify: `packages/harness-core/src/index.ts`, `tsconfig.base.json`, `vitest.workspace.ts`, `package.json`, `pnpm-lock.yaml`.

- [x] **Step 1: Test the three deterministic scenario reports**

Add direct Core tests that assert: (1) `../.ssh/id_rsa` is hard-denied and dispatcher calls are zero; (2) a Node arithmetic patch receives `test_failure`, repairs, then reaches verified completion; (3) a Run-scoped approval for `npm install` in Run A does not execute the same action in Run B. Assert immutable, redacted report fields only.

- [x] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @todex/harness-core test --run mechanism-demo.test.ts`
Expected: FAIL because `runMechanismDemo` does not exist.

- [x] **Step 3: Implement the Mock-only reusable scenario module**

Use existing `AgentRunner`, `Guardrail`, approval, file-tool and verification contracts with module-private fresh in-memory fakes. Neither the command nor tests may execute a real project command, network request, model call, or mutate `examples/`.

- [x] **Step 4: Test and expose the fixed CLI**

Add `tsx` only as a root development dependency and define `demo:mechanisms` as `tsx scripts/run-mechanism-demo.ts`. Extend the existing root typecheck include with `scripts/**/*.ts` and Vitest workspace with `scripts`, so the normal root checks cover the CLI and its test. The CLI writes only ignored `.todex/demo/mechanism-report.json` and prints fixed redacted summary lines.

- [x] **Step 5: Verify green and record**

Run: `pnpm.cmd demo:mechanisms`; `pnpm.cmd test --run`; `pnpm.cmd typecheck`; `pnpm.cmd lint`; `pnpm.cmd build`; `git diff --check`.
Expected: all pass, the JSON report has `allPassed: true`, and no generated report appears in Git status. Record exact RED/GREEN evidence and AC-01/04/05/06 mapping in the dated verification Markdown.

### Task 9: T-009 ?? SQLite ???????????

**???** T-005?T-006?
**?????** DeepSeek???????Credential Manager ??? Codex ???

??????????[T-009 ??](superpowers/specs/2026-07-18-t-009-desktop-persistence-design.md)?[T-009 ????](superpowers/plans/2026-07-18-t-009-desktop-persistence.md)?[???](task-cards/T-009-desktop-persistence.md)?T-009 ?? `better-sqlite3 + keytar`??????? fail closed????? SQLite?Credential Manager????? Electron ??? typed IPC??????? UI????????????
**???** ????P1 ??????????????????????????

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/sqlite-store.ts`
- Create: `apps/desktop/src/main/credential-store.ts`
- Create: `apps/desktop/src/main/workspace-host.ts`
- Create: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/test/sqlite-store.test.ts`
- Create: `apps/desktop/test/credential-store.test.ts`

- [x] **Step 1: Write failing persistence and credential tests**

```ts
it("persists a project profile without an API key column", async () => {
  await store.saveProject(profile);
  expect(await store.loadProject(profile.projectId)).toEqual(profile);
  expect(await store.listColumns("model_config")).not.toContain("api_key");
});

it("returns only configured status from credential store", async () => {
  await credentials.save("cfg-1", "secret-value");
  expect(await credentials.status("cfg-1")).toEqual({ configured: true });
});
```

- [x] **Step 2: Verify red**

Run: `pnpm --filter @todex/desktop test --run sqlite-store.test.ts credential-store.test.ts`
Expected: FAIL because host adapters do not exist.

- [x] **Step 3: Implement host adapters and narrow IPC**

Use SQLite migrations for projects, commands, runs, trace, approvals and memory; use an injected keytar adapter for credential tests. Expose typed IPC only for workspace selection, project CRUD, run events, approval decisions, memory CRUD and credential status/update/clear. Never expose arbitrary Node APIs to the renderer.

- [x] **Step 4: Verify green**

Run: `pnpm --filter @todex/desktop test --run`
Expected: PASS. Add a test that exported trace text contains no credential value.

- [x] **Step 5: Commit and record**

Run: `git add apps/desktop`
Run: `git commit -m "feat: add desktop persistence and credential adapters"`

#### T-009 Delivery Record (2026-07-19)

Implementation is recorded on `feat/t-009-desktop-persistence` in `330e9e2`, `b9ad555`, `b8dbaea`, `fd758bb`, and `acd7c21`. SQLite persistence, fail-closed credential adapters, secure typed IPC, preload, and a minimal Electron host were implemented without changing Harness Core, contracts, examples, CI, demo web, installer, or release workflow. Node ABI validation ran before Electron ABI rebuilding: the root Vitest run passed 18 files and 394 tests; typecheck, lint, recursive build, and diff checks passed when run. The native workspace allowlist permits only `better-sqlite3`, `keytar`, `electron`, and `esbuild` scripts.

`electron-rebuild -f -w better-sqlite3,keytar` completed for Electron `v36.9.5`. The diagnostic smoke reached production Keytar module load, temporary SQLite host open, and IPC registration. The current execution environment reproducibly crashes in Electron lifecycle/shutdown with `0xC0000005`, including a standalone `app.whenReady()` probe. This is recorded as a controlled exception, not a successful interactive host assertion; T-010/T-012 must validate lifecycle and BrowserWindow behavior on a suitable interactive environment. No credential was written or read in smoke, and no real model, shell, or project action ran.

P1 follow-up: the persisted `model_configs.credential_ref` is now the config-scoped credential source of truth across host reopen; adapter save/delete failures are fixed to `credential_unavailable`. Credential IPC requires `configId` (and `apiKey` for save) and returns only redacted lifecycle DTOs. Project export now uses `listApprovals(projectId)` so approved and denied audit records are preserved, while the IPC pending list remains unchanged. RED covered absent host lifecycle methods and terminal approvals missing from export. GREEN: targeted desktop suites passed 4 files/18 tests; root Vitest passed 18 files/397 tests; typecheck, lint, recursive build, and diff check passed. This follow-up is the single local commit `fix: persist credential references and approval audit`; it was not pushed.

Final review P1/P2 follow-up: schema version 2 adds recoverable `credential_clear_pending`. Every save uses a newly generated Keytar reference; `replaceCredentialReference` atomically switches the active SQLite reference and records the previous reference for cleanup, while a failed transaction compensates the new value and preserves the old configured secret. Clear first removes the active SQLite reference and records pending work, then deletes Keytar, then completes pending so a final database failure cannot leave a dead active reference. These persistence errors are fixed `credential_persistence_failed` values without a secret. `saveVerification()` now checks run/command project ownership inside its insert transaction and rejects `verification_project_mismatch` before writing. BrowserWindow now has `sandbox: true` and denies navigation/new windows. The sole combined Electron workflow is `smoke:electron` (`rebuild:native && smoke`); low-level `smoke` does not rebuild. RED was observed for each boundary. Node-ABI GREEN passed targeted desktop tests (4 files/22 tests) and final root verification (19 files/403 tests), plus typecheck, lint, recursive build, and diff check; Electron lifecycle was intentionally not re-run because of the recorded `0xC0000005` exception.

CI P1 rework: native `keytar` is now a lazy, cached production-adapter dependency. Importing the credential module or using `CredentialStore` with an injected fake adapter does not load the Linux `libsecret` binding. Only actual Keytar `save`, `read`, or `remove` triggers the dynamic import; regression tests prove the fake path remains native-free and the production loader is deferred and reused. Final root Node-ABI verification passed 19 files/405 tests with typecheck, lint, recursive build, and diff check.

### Task 10: T-010 ??????? UI ??????

Implementation update (2026-07-19): renderer-local components are used under `apps/desktop/src/renderer/` instead of adding a new `packages/ui` workspace. The verified scope is a deterministic React/Vite workbench, typed lowercase preload approval adaptation, and component flows only; real model, shell, filesystem, patch, credential, and Electron lifecycle work remain outside T-010.

**???** T-001?T-009?
**?????** Qwen ?? UI components?Codex ?? Open Design ??????

??????????[T-010 ??](superpowers/specs/2026-07-19-t-010-codex-style-workbench-design.md)?[T-010 ????](superpowers/plans/2026-07-19-t-010-codex-style-workbench.md)?[???](task-cards/T-010-codex-style-workbench.md)?T-010 ???? Codex ?? Renderer??? Mock Run ? T-009 typed IPC ?????????? LLM?shell??????????
**???** ?????? renderer ???????? commit `3946bec` ?? PR #9 ? merge commit `05008d3` ?? `main`?????? [T-010 ??](verification/2026-07-19-t-010-codex-style-workbench.md)??????? React renderer/browser ??????? Electron lifecycle ?????????

**Files:**
- Create: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/src/renderer/run-controller.ts`
- Create: `apps/desktop/src/renderer/styles.css`
- Create: `apps/desktop/test/workbench.spec.tsx`

- [ ] **Step 1: Write failing workbench UI tests**

```tsx
it("disables Run until workspace and model mode are selected", () => {
  render(<TaskWorkbench state={emptyWorkbenchState} />);
  expect(screen.getByRole("button", { name: "????" })).toBeDisabled();
});

it("renders an approval card before command execution", () => {
  render(<ApprovalCard request={fixtureApprovalRequest} />);
  expect(screen.getByText("??????")).toBeVisible();
  expect(screen.getByRole("button", { name: "?????" })).toBeVisible();
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @todex/desktop test --run workbench.spec.tsx`
Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the constrained workbench**

Build the left project panel, central task/trace workbench, right diff/test/approval panel and status footer from SPEC. Use accessible labels, keyboard reachable controls, Lucide icons, stable grid layout and explicit `Mock`/`????` status. Do not add a landing hero or expose free shell controls outside an approval flow.

- [ ] **Step 4: Verify green and screenshot behavior**

Run: `pnpm --filter @todex/desktop test --run workbench.spec.tsx`
Expected: PASS.
Run: `pnpm --filter @todex/desktop test:e2e`
Expected: PASS with a screenshot showing workspace, trace, diff and approval card without overlap.

- [ ] **Step 5: Commit and record**

Run: `git add packages/ui apps/desktop/src/renderer apps/desktop/test`
Run: `git commit -m "feat: add Todex desktop workbench"`

### Task 11: T-011 ???? Mock Demo ??

**???** T-008?T-010?
**?????** GLM???????
**???** ?????? `main`???/?? commits ? `88f1dea`?`9813f20`????? `47d7956`?`533539e`?`b218681`?`fd38bae`?`721bba4`?`8fe6c6d`?`773adff`?`107dae6`?`66f60ae`?`178ae1b`?PR #10 ? GitHub Actions CI ????merge commit ? `a1a721b`?Render ?? `todex-mock-demo` ?????????????? `https://todex-mock-demo.onrender.com`??? [T-011 ??](verification/2026-08-05-t-011-public-mock-demo.md) ? [???](task-cards/T-011-public-mock-demo.md)?

**Files:**
- Create: `apps/demo-web/package.json`
- Create: `apps/demo-web/src/server.ts`
- Create: `apps/demo-web/src/demo-session.ts`
- Create: `apps/demo-web/src/App.tsx`
- Create: `apps/demo-web/test/demo-session.test.ts`
- Create: `render.yaml`

- [ ] **Step 1: Write failing demo restriction tests**

```ts
it("rejects real model settings and arbitrary workspace paths", async () => {
  const session = createDemoSession();
  await expect(session.configureRealModel("secret")).rejects.toThrow("demo_restricted");
  await expect(session.openWorkspace("C:/Users/private")).rejects.toThrow("demo_restricted");
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @todex/demo-web test --run demo-session.test.ts`
Expected: FAIL because Demo session restrictions do not exist.

- [ ] **Step 3: Implement isolated Demo mode**

Mount only copied/resettable example fixtures, select only scripted Mock LLM scenarios, expose reset/run/approve/deny events through the same UI contracts, and reject real model configuration, arbitrary path selection and free shell. Add Render build/start configuration for the Node service.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @todex/demo-web test --run`
Expected: PASS.
Run: `pnpm --filter @todex/demo-web build`
Expected: exit code 0.

- [ ] **Step 5: Commit and record**

Run: `git add apps/demo-web render.yaml`
Run: `git commit -m "feat: add restricted public mock demo"`

#### T-011 Delivery Record (2026-08-05)

T-011 keeps the public host fail-closed: it accepts only the three named
fixtures, exact API shapes, and server-owned approval decisions, while built
static assets are constrained to the canonical demo `dist` root. Task 1 session
commits are `47d7956`, `533539e`, and `b218681`; Task 2 API/static-serving
commits are `fd38bae`, `721bba4`, and `8fe6c6d`; Task 3 is `773adff` with
review follow-ups `107dae6` and `66f60ae`. The React dependency/test scope was
declared in the demo package and lockfile by `773adff`, not by Task 4.

Task 4 adds root-level `render.yaml` with the verified pnpm build/start
commands, Node runtime, no unsupported `rootDir`, and the dated local evidence
record. Fresh local verification includes the demo suite (3 files/28 tests),
root suite (23 files/439 tests), typecheck, lint, production build, built `/`
HTTP response, and `1440x900`/`390x844` browser checks. No deployment, PR, CI,
or independent code-quality-review evidence is implied.

### Task 12: T-012 ???CI???????????

**???** T-008?T-009?T-010?T-011?
**?????** Codex ?????????????????????
**???** ????????????????CI/release workflow?Render ?? Demo ??????????? Windows installer?GitHub Release ??? Electron ??????????????

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `apps/desktop/electron-builder.yml`
- Create: `scripts/verify-release.ts`
- Create: `docs/verification/2026-07-13-cold-start-validation.md`
- Create: `docs/verification/2026-07-13-release-verification.md`
- Modify: `README.md`
- Modify: `docs/PLAN.md`

- [x] **Step 1: Write failing release-verification tests**

```ts
it("requires a Windows x64 NSIS artifact and a public demo URL", async () => {
  const result = await verifyRelease({ artifactsDir: "release" });
  expect(result.checks).toContainEqual({ name: "windows-nsis", passed: true });
  expect(result.checks).toContainEqual({ name: "demo-url", passed: true });
});
```

- [x] **Step 2: Verify red**

Run: `pnpm verify:release`
Expected: FAIL because no artifact or configured Demo URL exists.

- [x] **Step 3: Implement packaging and CI**

Configure electron-builder for unsigned NSIS x64 output. CI must run `pnpm lint`, `pnpm test --run`, `pnpm typecheck`, and `pnpm build` on push; release workflow must upload the installer artifact. Add `verify:release` that checks artifact metadata and an HTTPS Demo URL. Update README only with commands actually executed, Credential Manager steps, SmartScreen disclosure, Render URL, limitations and directory structure.

- [x] **Step 4: Verify end-to-end evidence**

Run: `pnpm test --run`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm build`
Expected: PASS.
Run: `pnpm demo:mechanisms`
Expected: all required mechanism booleans true.
Run: `pnpm verify:release`
Expected: PASS after Windows artifact and Demo deployment are available.

- [x] **Step 5: Complete course evidence and commit**
Record cold-start observations, revision diffs, CI links, installer verification and Demo URL in `docs/verification/`. Update each completed task in this PLAN with PR/commit/test evidence. Run final specification and code review, then commit with `git commit -m "release: prepare Todex v1.0"`.
Completion update (2026-08-12): PRs #11 through #15 are merged. `v0.1.0` and
`edd996b78520b06ca6f6c9ee7f03d828efacaa08` are published at
https://github.com/HrrToT/Todex/releases/tag/v0.1.0. The successful Windows
release workflow is https://github.com/HrrToT/Todex/actions/runs/31562649008;
it produced `Todex-0.1.0-win-x64.exe` and `latest.yml`. The fixed-scenario
Render Demo is live at https://todex-mock-demo.onrender.com. See
`docs/verification/2026-08-07-t-012-release-verification.md` for the retained
local Electron lifecycle verification boundary.

Patch publication update (2026-08-12): an installed `v0.1.0` window exposed a
Renderer white screen. The root cause was the main process loading a literal
empty `data:` document rather than the built React entry. `v0.1.1` loads
`dist/renderer/index.html` via `file:` and uses a relative Vite asset base.
Its regression test was observed red then green; the unpacked Windows build
was visually confirmed to render. PR #17 merged as
`5d916956bd434b437a9f7a763b5899d052906280`; `v0.1.1` is published at
https://github.com/HrrToT/Todex/releases/tag/v0.1.1 and its Windows workflow
is https://github.com/HrrToT/Todex/actions/runs/31570728577. The official
installer was downloaded, matched its GitHub SHA-256 and `latest.yml` SHA-512,
and was installed to `C:\Program Files\Todex`; the installed package no longer
contains the old empty `data:` URL. A human confirmation that the installed
window visibly renders the workbench is still required before claiming final
interactive visual acceptance.

## Plan Self-Review

### Spec coverage

- ??????Mock LLM?????????T-002?T-003?
- ??/HITL ???????T-004?
- ??????????T-005?
- ??????????T-006?
- Node/Python ????T-007?
- ???????T-008?
- Windows ???SQLite?Electron?T-009?T-010?T-012?
- ?? Mock WebUI?T-011?T-012?
- CI????README??????T-001?T-012?
- TDD?worktree?subagent??????????????????????

### Placeholder scan

### T-013 Local implementation checkpoint (2026-08-12)

- [x] Chinese-first Desktop and Mock Demo copy with retained English mode.
- [x] Main-process workspace selection, project import/detection, OpenAI Chat Completions client, bounded filesystem/command adapters, and high-level governed Run IPC.
- [x] Every desktop `run_configured_command` requires an explicit approval decision before dispatch; normal read/search/safe patch remain governed automatic actions.
- [x] Focused desktop E2E proves safe patch -> zero command dispatch before approval -> approved fixed argv -> finish, with a credential sentinel absent from projections and traces.
- [x] T-013 review rework closes candidate-derived command confirmation, local-path projection, one-active-run-per-project and cancellation of in-flight model requests and approved fixed commands; the live workbench also exposes a session-local Chinese/English toggle.
- [x] Locale preference is now constrained to `zh-CN`/`en-US`, persisted through the main-process SQLite settings store, and exposed only through `settings.getLocale`/`settings.setLocale`; all renderer-accessible workspace/model/run queries now use redacted projections.
- [x] Local loopback Mock HTTP E2Es use the production Chat Completions client to complete both Node and Python fixture patch -> command approval -> verified finish flows, without changing the public Render Mock Demo boundary.
- [x] Live desktop runs now return an immediate redacted `running` projection and stream matching redacted snapshots through `run.subscribe` / `run.unsubscribe`; subscribers receive a current-snapshot replay, and the workbench exposes a localized stop control for the existing governed cancellation path.
- [x] Run-stream subscriptions are sender-scoped, so separate Electron windows can observe the same Run without either renderer removing the other's listener.
- [x] Independent T-013 review rework closes background terminal-state loss, immediate awaiting-approval cancellation, schema-valid model summary path/key redaction, and localized terminal Run status rendering.
- [x] Remaining live-workbench setup labels, notices, candidate confirmation and accessibility text use the `zh-CN` / `en-US` catalog; argv, paths, diffs, JSON and trace type evidence remain literal.
- [x] Pre-merge security rework removes Renderer/IPC API-key capture and arbitrary memory writes, redacts an active credential value before task/trace persistence, passes a user-confirmed verification command from the live workbench, and returns `completed_unverified` whenever no verification runner exists.
- [x] Pre-merge robustness rework rolls back ordinary multi-file Node workspace write failures and removes sender-scoped run subscriptions when an Electron renderer is destroyed or cannot receive updates.
- [x] PR [#19](https://github.com/HrrToT/Todex/pull/19) merged into `main` as `f9dcd3a8368b32fb14418bb1e05dcdc1e20ada61`; its CI run [31708987042](https://github.com/HrrToT/Todex/actions/runs/31708987042) passed against the final PR head `bc405e38b5220640d5fa92948ad0e90c527699f9`.
- [ ] Independent specification/security review, Windows installed-app manual acceptance, and scoped real-model acceptance remain required before a T-013 release claim.
- [ ] Local complete Vitest evidence remains blocked by missing `better-sqlite3` Node ABI 137 binding under Node 24.14.0; do not suppress the existing SQLite/WorkspaceHost tests.

????????????????????????????????????????????????????????????????

### Type consistency

???????? T-002 ??? `Action`?`RunSession`?`ConfiguredCommand`?`VerificationResult`?`ApprovalRequest`?`MemoryEntry` ? `TraceEvent`?T-003 ? `AgentRunner` ? T-004?T-006 ? T-008 ??????????????? T-009 ? typed IPC ? Core ???
