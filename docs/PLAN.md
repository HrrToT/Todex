# Todex V1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

状态：approved for cold-start validation
最后更新：2026-07-17

**Goal:** 构建可在 Windows 本地仓库中运行的 Todex V1.0：自研 coding-agent Harness、Node/Python 支持、治理/HITL、反馈修复、Electron 桌面端和公网 Mock Demo。

**Architecture:** TypeScript pnpm monorepo，以 `packages/harness-core` 提供无 Electron/真实 LLM 依赖的主循环、治理、工具、反馈和记忆。`apps/desktop` 提供本地工作区与凭据适配，`apps/demo-web` 提供受限示例与 Mock LLM；二者复用 contracts 和 UI。

**Tech Stack:** TypeScript strict、pnpm 10.12.1、Vitest、Zod、ESLint 9 flat config、typescript-eslint、React、Vite、Electron、electron-builder、SQLite、keytar、Playwright、GitHub Actions、Render。

---

## 执行纪律与并行边界

- 每项任务在独立 git worktree 和 PR 中完成；任务卡写入 `docs/task-cards/T-NNN-*.md`。
- 先执行任务的“红”步骤并保存失败输出，再写最小实现；每项完成后进行“规格合规检查 -> 代码质量检查”。
- 实现顺序必须遵循依赖；标记为“可并行”的任务只可在其前置任务合并后并行。
- `PLAN.md` 每项完成时必须填写 PR、commit、测试命令和人工验收结论。

## 文件结构锁定

| 路径 | 职责 |
| --- | --- |
| `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json` | 根工作区、统一脚本和 TypeScript 规则 |
| `packages/contracts/src/index.ts` | Action、Run、审批、记忆、校验的共享类型和 schema |
| `packages/harness-core/src/` | 自研主循环、Mock LLM、上下文、护栏、审批、工具、校验、记忆、trace、探测器 |
| `packages/harness-core/test/` | 无网络、无真实 LLM 的 Vitest 单元/集成测试 |
| `apps/desktop/src/main/` | Electron 主进程、工作区、SQLite、Credential Manager、IPC |
| `apps/desktop/src/renderer/` | 本地工作台 React UI |
| `apps/demo-web/src/` | Render 部署的受限 Mock Demo 宿主 |
| `packages/ui/src/` | 工作台、审批卡、trace、diff、记忆等复用组件 |
| `examples/node-bug-repo/`、`examples/python-bug-repo/` | 可重复的 Node/Python 机制演示夹具 |
| `scripts/` | 演示、构建和验证入口 |
| `.github/workflows/` | GitHub Actions 测试、构建和 Release 工作流 |

## 任务依赖图

```text
T-001 -> T-002 -> T-003 -> T-004 -> T-005 -> T-006
                                      |         |
                                      v         v
                                   T-007 ----> T-008 -> T-009
T-001 -> T-010 -> T-011 -> T-012
T-006 + T-009 + T-011 -> T-012
```

### Task 1: T-001 建立 pnpm monorepo 与测试基线

**依赖：** 无。
**建议责任：** GLM，可独立完成。
**状态：** 已完成，冷启动验证 PR #1；实现 commits `d803fa2`。

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

### Task 2: T-002 定义共享动作、Run 与工具协议

**依赖：** T-001。
**建议责任：** DeepSeek，可独立完成。

冻结设计与逐步实施计划：[T-006 设计](superpowers/specs/2026-07-16-t-006-verification-feedback-design.md)、[T-006 实施计划](superpowers/plans/2026-07-16-t-006-verification-feedback.md)、[DeepSeek 任务卡](task-cards/T-006-verification-feedback-and-repair.md)。T-006 只使用注入式 CommandRunner 和已确认的固定 commandId；真实进程执行、项目探测、SQLite 和 Electron 宿主能力不在本任务范围。
**状态：** 已完成，冷启动验证 PR #1；实现 commit `a87325e`，P1 修复 commit `a04ad9f`。

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

### Task 3: T-003 实现 Mock LLM、trace 和最小 Agent 主循环

**依赖：** T-002。
**建议责任：** Codex 主导；可将 Mock LLM 子任务交给 Qwen。

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

实际提交：`03e9ac5`（实现）、`f57dad1`（P1 审查修复）及后续 CI 入口修复。独立复验记录见 [T-003 验证](verification/2026-07-13-t-003-agent-loop.md)。CI 在干净 checkout 暴露 `@todex/contracts` 的 `dist` 入口未构建；修复为 contracts 增加真实 TypeScript build，并在根测试前构建该 workspace 包。

### Task 4: T-004 实现工作区边界、风险分类与审批状态机

**依赖：** T-002、T-003。
**建议责任：** GLM 实现 Guardrail；Codex 两阶段审查。

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

实际提交：`430b77a`（初始实现）、`0ec7b07`（禁止不安全 command_prefix）、`0bc5767`（Windows 大小写敏感路径绕过）、`d721397`（PowerShell 编码参数别名）、`4773476`（PowerShell 可执行路径）及后续 Codex 复核修复。最终独立复验记录见 [T-004 验证](verification/2026-07-14-t-004-governance.md)。

### Task 5: T-005 实现文件工具、trace 脱敏与轻量记忆

**依赖：** T-003、T-004。
**建议责任：** Qwen，可独立完成。

冻结设计与逐步实施计划：[T-005 设计](superpowers/specs/2026-07-15-t-005-file-tools-memory-design.md)、[T-005 实施计划](superpowers/plans/2026-07-15-t-005-file-tools-memory.md)、[Qwen 任务卡](task-cards/T-005-file-tools-and-memory.md)。SQLite 的真实持久化、应用数据目录和 Electron 原生模块打包保留给 T-009；T-005 只实现可注入的记忆仓储边界与确定性 fake。

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

实际提交：`d256648`（有界文件工具）、`4f64d43`（严格补丁与审批阈值）、`e17a23d`（项目记忆选择）、`ec7267c`（Runner 记忆上下文集成）、`821a6e4`、`660546e`、`9421249`、`212a331`（Codex 审查发现的治理、证据和严格解析修复）。最终独立复验为全仓 269/269 测试通过，typecheck、lint、build 均通过。详见 [T-005 验证](verification/2026-07-15-t-005-file-tools-memory.md)。

### Task 6: T-006 实现校验器、反馈回灌与限次修复

**依赖：** T-003、T-005。
**建议责任：** DeepSeek，可独立完成。

冻结设计与逐步实施计划：[T-006 设计](superpowers/specs/2026-07-16-t-006-verification-feedback-design.md)、[T-006 实施计划](superpowers/plans/2026-07-16-t-006-verification-feedback.md)、[DeepSeek 任务卡](task-cards/T-006-verification-feedback-and-repair.md)。T-006 只使用注入式 CommandRunner 和已确认的固定 commandId；真实进程执行、项目探测、SQLite 和 Electron 宿主能力不在本任务范围。
**状态：** 已完成并合入 `main`。实现 commits `c5247a0`、`9733abb`、`f6365f8`、`8c3ec90`；Codex 审查返工 commits `bea859a`、`cf11eed`；[PR #5](https://github.com/HrrToT/Todex/pull/5) 的 GitHub Actions CI 通过后，以 merge commit `adc33c3` 合入。最终独立复验为全仓 327/327 测试通过，typecheck、lint、build 和 `git diff --check` 均通过。详见 [T-006 验证](verification/2026-07-16-t-006-verification-feedback.md)。

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

实际提交：`c5247a0`（验证运行器）、`9733abb`（反馈回灌修复循环）、`f6365f8`（修复限制与环境停止）、`8c3ec90`（类型对齐修复）、`4449fcc`（初始证据）、`bea859a`（P1/P2 审查返工）和 `cf11eed`（每轮 LLM 校验反馈快照冻结）。Codex 先完成规约符合性审查，再完成代码质量/安全审查；其发现的命令注册表信任、异常收敛、Unix 绝对路径脱敏、反馈不可变性和精确终态问题均以先红后绿方式修复。最终独立复验为全仓 327/327 测试通过，typecheck、lint、build 和 `git diff --check` 均通过；[PR #5](https://github.com/HrrToT/Todex/pull/5) CI 通过后以 `adc33c3` 合入 `main`。详见 [T-006 验证](verification/2026-07-16-t-006-verification-feedback.md)。

### Task 7: T-007 实现 Node.js/Python 探测与示例仓库

**依赖：** T-005。
**可并行：** 与 T-006 并行。
**建议责任：** 一个 GLM 在单一隔离 worktree 内完成 Node 与 Python 探测；Codex 负责规约、审查和整合。

冻结设计与逐步实施计划：[T-007 设计](superpowers/specs/2026-07-17-t-007-project-detection-design.md)、[T-007 实施计划](superpowers/plans/2026-07-17-t-007-project-detection.md)、[GLM 任务卡](task-cards/T-007-project-detection-and-examples.md)。项目负责人决定由一个 GLM 在单一隔离 worktree 内完成 Node 与 Python 探测，Codex 负责规约、两阶段审查、PR、CI 和整合。T-007 只发现未确认候选，绝不执行命令、安装依赖或创建持久化 `ConfiguredCommand`。
**状态：** 已完成 Codex 规约审查返工。实现 commits `830f32d`（Node 探测）、`ddc570d`（Python 探测）、`b41ac16`（示例仓库与 fixture 断言）；返工 commit 修复 P1-1（lockfile 读取异常 fail-closed）、P1-2（notice 不回显 script 名称）和 P2（文档类型事实）。全仓 367/367 测试通过，typecheck、lint、build 和 `git diff --check` 均通过。详见 [T-007 验证](verification/2026-07-17-t-007-project-detection.md)。

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

实际提交：`830f32d`（Node 探测，含 contract、index 导出和 18 个测试）、`ddc570d`（Python 探测，含 marker regex、混合项目、降级和 13 个测试）、`b41ac16`（示例仓库与 fixture 断言）。Node 示例 `node --test` 以 `-1 !== 5` 算术缺陷失败；Python 示例因环境无 pytest（`No module named pytest`）而阻塞，未安装。详见 [T-007 验证](verification/2026-07-17-t-007-project-detection.md)。

### Task 8: T-008 编写可重复机制演示脚本

**依赖：** T-004、T-006、T-007。
**建议责任：** Codex 主导，因其覆盖课程评分证据。

冻结设计与逐步实施计划：[T-008 设计](superpowers/specs/2026-07-17-t-008-mechanism-demo-design.md)、[T-008 实施计划](superpowers/plans/2026-07-17-t-008-mechanism-demo.md)、[GLM 任务卡](task-cards/T-008-mechanism-demo.md)。一个 GLM 在单一隔离 worktree 内按冻结场景实现，Codex 负责课程证据规约、两阶段审查、PR、CI 和整合。T-008 只用 Mock/Fake 和内存工作区；允许新增 `tsx` 作为 TypeScript CLI 开发依赖，不执行真实项目命令或修改示例仓库。
**状态：** GLM 实现后的 Codex 审查返工已完成。实现 commits `12a4782`（场景模块）、`1d44ccd`（CLI 与 `tsx`）；审查返工改为从 `AgentRunner` 的实际拒绝 `ToolResult` 取 Scenario 1 证据，并抽取可注入、无异常泄露的 CLI。最终全仓 378/378 测试通过，typecheck、lint、build 和 `git diff --check` 均通过；详见 [T-008 验证](verification/2026-07-17-t-008-mechanism-demo.md)。

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

### Task 9: T-009 实现 SQLite 持久化与桌面宿主适配层

**依赖：** T-005、T-006。
**建议责任：** DeepSeek，可独立完成；Credential Manager 必须由 Codex 审查。

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/sqlite-store.ts`
- Create: `apps/desktop/src/main/credential-store.ts`
- Create: `apps/desktop/src/main/workspace-host.ts`
- Create: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/test/sqlite-store.test.ts`
- Create: `apps/desktop/test/credential-store.test.ts`

- [ ] **Step 1: Write failing persistence and credential tests**

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

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @todex/desktop test --run sqlite-store.test.ts credential-store.test.ts`
Expected: FAIL because host adapters do not exist.

- [ ] **Step 3: Implement host adapters and narrow IPC**

Use SQLite migrations for projects, commands, runs, trace, approvals and memory; use an injected keytar adapter for credential tests. Expose typed IPC only for workspace selection, project CRUD, run events, approval decisions, memory CRUD and credential status/update/clear. Never expose arbitrary Node APIs to the renderer.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @todex/desktop test --run`
Expected: PASS. Add a test that exported trace text contains no credential value.

- [ ] **Step 5: Commit and record**

Run: `git add apps/desktop`
Run: `git commit -m "feat: add desktop persistence and credential adapters"`

### Task 10: T-010 实现共享工作台 UI 与桌面主窗口

**依赖：** T-001、T-009。
**建议责任：** Qwen 负责 UI components；Codex 审查 Open Design 和可访问性。

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/src/WorkspacePanel.tsx`
- Create: `packages/ui/src/TaskWorkbench.tsx`
- Create: `packages/ui/src/TraceTimeline.tsx`
- Create: `packages/ui/src/ApprovalCard.tsx`
- Create: `packages/ui/src/DiffPanel.tsx`
- Create: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/test/workbench.spec.tsx`

- [ ] **Step 1: Write failing workbench UI tests**

```tsx
it("disables Run until workspace and model mode are selected", () => {
  render(<TaskWorkbench state={emptyWorkbenchState} />);
  expect(screen.getByRole("button", { name: "运行任务" })).toBeDisabled();
});

it("renders an approval card before command execution", () => {
  render(<ApprovalCard request={fixtureApprovalRequest} />);
  expect(screen.getByText("需要人工审批")).toBeVisible();
  expect(screen.getByRole("button", { name: "仅本次允许" })).toBeVisible();
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @todex/desktop test --run workbench.spec.tsx`
Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the constrained workbench**

Build the left project panel, central task/trace workbench, right diff/test/approval panel and status footer from SPEC. Use accessible labels, keyboard reachable controls, Lucide icons, stable grid layout and explicit `Mock`/`真实模型` status. Do not add a landing hero or expose free shell controls outside an approval flow.

- [ ] **Step 4: Verify green and screenshot behavior**

Run: `pnpm --filter @todex/desktop test --run workbench.spec.tsx`
Expected: PASS.
Run: `pnpm --filter @todex/desktop test:e2e`
Expected: PASS with a screenshot showing workspace, trace, diff and approval card without overlap.

- [ ] **Step 5: Commit and record**

Run: `git add packages/ui apps/desktop/src/renderer apps/desktop/test`
Run: `git commit -m "feat: add Todex desktop workbench"`

### Task 11: T-011 实现公网 Mock Demo 宿主

**依赖：** T-008、T-010。
**建议责任：** GLM，可独立完成。

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

### Task 12: T-012 打包、CI、发布文档与端到端验收

**依赖：** T-008、T-009、T-010、T-011。
**建议责任：** Codex 主导，所有辅助模型结果进入最终两阶段评审。

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `apps/desktop/electron-builder.yml`
- Create: `scripts/verify-release.ts`
- Create: `docs/verification/2026-07-13-cold-start-validation.md`
- Create: `docs/verification/2026-07-13-release-verification.md`
- Modify: `README.md`
- Modify: `docs/PLAN.md`

- [ ] **Step 1: Write failing release-verification tests**

```ts
it("requires a Windows x64 NSIS artifact and a public demo URL", async () => {
  const result = await verifyRelease({ artifactsDir: "release" });
  expect(result.checks).toContainEqual({ name: "windows-nsis", passed: true });
  expect(result.checks).toContainEqual({ name: "demo-url", passed: true });
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm verify:release`
Expected: FAIL because no artifact or configured Demo URL exists.

- [ ] **Step 3: Implement packaging and CI**

Configure electron-builder for unsigned NSIS x64 output. CI must run `pnpm lint`, `pnpm test --run`, `pnpm typecheck`, and `pnpm build` on push; release workflow must upload the installer artifact. Add `verify:release` that checks artifact metadata and an HTTPS Demo URL. Update README only with commands actually executed, Credential Manager steps, SmartScreen disclosure, Render URL, limitations and directory structure.

- [ ] **Step 4: Verify end-to-end evidence**

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

- [ ] **Step 5: Complete course evidence and commit**

Record cold-start observations, revision diffs, CI links, installer verification and Demo URL in `docs/verification/`. Update each completed task in this PLAN with PR/commit/test evidence. Run final specification and code review, then commit with `git commit -m "release: prepare Todex v1.0"`.

## Plan Self-Review

### Spec coverage

- 自研主循环、Mock LLM、工具分发和停机：T-002、T-003。
- 治理/HITL 与工作区边界：T-004。
- 工具、记忆与上下文：T-005。
- 客观反馈与限次修复：T-006。
- Node/Python 双支持：T-007。
- 必交机制演示：T-008。
- Windows 凭据、SQLite、Electron：T-009、T-010、T-012。
- 公网 Mock WebUI：T-011、T-012。
- CI、分发、README、验证证据：T-001、T-012。
- TDD、worktree、subagent、两阶段评审：所有任务的固定步骤和执行纪律。

### Placeholder scan

本计划不含未定占位、空泛错误处理或“稍后实现”步骤。每项实现任务均指定文件、先失败测试、预期失败、最小实现、验证命令和提交方式。

### Type consistency

所有后续任务使用 T-002 定义的 `Action`、`RunSession`、`ConfiguredCommand`、`VerificationResult`、`ApprovalRequest`、`MemoryEntry` 和 `TraceEvent`。T-003 的 `AgentRunner` 是 T-004、T-006 和 T-008 的唯一循环入口；宿主应用只通过 T-009 的 typed IPC 与 Core 交互。
