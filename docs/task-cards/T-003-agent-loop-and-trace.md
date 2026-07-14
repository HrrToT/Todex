# T-003：Mock LLM、Trace 与最小 Agent 主循环

状态：verified
责任模型：GLM
主导审查：Codex
分支：`feat/t-003-agent-loop`
前置依赖：T-001、T-002 已在 `main` 合并
关联规约：`docs/SPEC.md` §5、§6、§12；`docs/PLAN.md` T-003

## 目标

在 `@todex/harness-core` 中实现不依赖 Electron、真实 LLM、网络或 agent 框架的最小 Agent loop。它必须通过 `parseAction` 校验每个 LLM 输出，按序记录 trace，调用注入的 Dispatcher，并将 ToolResult 回灌给下一轮模型；只在 `finish`、取消、最大步骤或终端错误时停止。

## 非目标

- 不实现 Guardrail、审批、文件系统工具、校验器、记忆或项目探测器；它们属于后续任务。
- 不接入真实 OpenAI-compatible HTTP API。
- 不修改 `packages/contracts/src/index.ts` 的既有 schema，除非主导审查明确要求修复与 T-003 直接相关的缺陷。
- 不修改根工作区依赖、ESLint、CI 或文档规约。

## 允许修改的文件

- 新建 `packages/harness-core/src/llm.ts`
- 新建 `packages/harness-core/src/mock-llm.ts`
- 新建 `packages/harness-core/src/trace-store.ts`
- 新建 `packages/harness-core/src/agent-runner.ts`
- 修改 `packages/harness-core/src/index.ts`，仅用于导出 T-003 公共 API
- 新建或修改 `packages/harness-core/test/agent-runner.test.ts`
- 新建 `packages/harness-core/test/trace-store.test.ts`（仅当需要独立验证追加顺序）

任何额外文件、依赖或 contracts 修改必须先暂停并说明原因。

## 冻结接口契约

使用 `@todex/contracts` 的 `Action`、`RunStatus`、`ToolResult`、`TraceEvent` 与 `parseAction`。本任务定义以下 Core API，名称和语义不得自行变化：

```ts
export interface LlmTurnContext {
  readonly runId: string;
  readonly projectId: string;
  readonly task: string;
  readonly previousResults: readonly ToolResult[];
  readonly trace: readonly TraceEvent[];
}

export interface LlmClient {
  nextAction(context: LlmTurnContext): Promise<unknown>;
}

export interface ToolDispatcher {
  dispatch(action: Action, context: { runId: string; actionId: string }): Promise<ToolResult>;
}

export interface RunInput {
  readonly runId: string;
  readonly projectId: string;
  readonly task: string;
  readonly maxSteps?: number;
}

export interface RunResult {
  readonly status: RunStatus;
  readonly stopReason?: string;
  readonly trace: readonly TraceEvent[];
  readonly results: readonly ToolResult[];
}
```

`ScriptedMockLlm` 接收 `readonly unknown[]` 脚本并依序返回；脚本耗尽时抛出 `mock script exhausted`。`TraceStore` 追加事件并为每个 Run 生成从 `0` 开始的连续 `sequence`。最小事件类型至少覆盖 `action_requested`、`tool_completed`、`action_rejected`、`run_completed`、`run_failed` 与 `run_cancelled`。

## TDD 步骤

1. 先写 `agent-runner.test.ts`：脚本 LLM 依序返回 `read_file` 与 `finish`，断言 status 为 `completed`，Dispatcher 仅收到 read 动作，trace 顺序为 `action_requested`、`tool_completed`、`action_requested`、`run_completed`。
2. 运行 `pnpm.cmd --filter @todex/harness-core test --run agent-runner.test.ts`，确认因模块或导出不存在而失败。
3. 实现 `LlmClient`、`ScriptedMockLlm`、`TraceStore`、`AgentRunner` 的最小行为。
4. 增加失败测试：未知工具、缺少 tool、非对象动作必须产生 `action_rejected` 或 `run_failed`，且 Dispatcher 调用次数为 0。
5. 增加最大步骤测试：`maxSteps: 1` 的无限 read 脚本必须以 `failed` 和 `max_steps_exceeded` 停止。
6. 增加取消测试：构造输入取消信号或 Runner cancellation hook，在下一次 LLM 调用前停止并写入 `run_cancelled`。
7. 运行：

```text
pnpm.cmd --filter @todex/harness-core test --run
pnpm.cmd test --run
pnpm.cmd typecheck
pnpm.cmd lint
```

8. 完成自审：确认没有引入真实网络、Electron、文件读写或 Guardrail 逻辑；确认所有 raw LLM 输出先调用 `parseAction`。
9. 提交：

```text
git add packages/harness-core/src packages/harness-core/test docs/task-cards/T-003-agent-loop-and-trace.md
git commit -m "feat: add deterministic agent loop"
```

## 验收标准

- [x] Mock LLM 可确定性驱动“read_file -> finish”的循环，且 trace 顺序与 TDD 测试一致。
- [x] 原始 LLM 输出在 Dispatcher 之前经 `parseAction` 校验；非法输出绝不调度工具。
- [x] ToolResult 被带入下一次 `LlmTurnContext.previousResults`。
- [x] `finish` 不会调用 Dispatcher，且 Run 以 `completed` 停止。
- [x] 达到 maxSteps、Mock 脚本耗尽、取消时均有确定的停止状态和 trace 事件。
- [x] 全仓测试、typecheck、lint 均通过。
- [x] 只修改允许文件范围；无新增依赖、无 contracts 漂移。

## 交付报告格式

报告必须包含：状态（DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED）、修改文件、每个红绿命令及结果、commit hash、自审结果、任何假设或未解决问题。不得开始 T-004。

## 实际交付记录

- 实现分支：`feat/t-003-agent-loop`；基线：`main` 的 `713b73a`。
- Pull Request：[PR #2](https://github.com/HrrToT/Todex/pull/2)，GitHub Actions `ci` 已通过；合并状态由 GitHub PR 页面维护。
- 责任模型：GLM。实现提交：`03e9ac5 feat: add deterministic agent loop`。
- P1 审查修复：`f57dad1 test: strengthen agent loop failure coverage`。修复了 `previousResults` 历史上下文可变引用，并补强最大步数、脚本耗尽和 Dispatcher 异常分支测试。
- 受控例外：`packages/harness-core/package.json` 与 `pnpm-lock.yaml` 增加 `@todex/contracts: workspace:*`，使 Core 经 workspace 包使用共享 contracts；未新增外部依赖，也未漂移 contracts。
- CI 根因修复例外：GitHub Actions 的干净 checkout 无被忽略的 `packages/contracts/dist`，导致 Vite 无法解析 workspace 包的 export。为使 T-003 的 workspace 依赖在 CI 与任务卡的包级验收命令中真实可用，新增 `packages/contracts/tsconfig.build.json`、contracts 的 `build` 脚本，并让根及 Harness 的 `test` 在 Vitest 前构建 contracts；未新增依赖、未漂移 contracts schema。
- 独立复验：2026-07-14，Harness 17/17、全仓 54/54、`typecheck`、`lint` 与真实 contracts `build` 均通过。完整命令和审查结论见 [T-003 验证](../verification/2026-07-13-t-003-agent-loop.md)。
- 未解决但不阻塞：`cancelledRuns` 的重用语义和公开观察对象的深度不可变性作为 P2 记录，不改变本任务验收结论。
