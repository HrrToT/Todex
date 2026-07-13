# 冷启动验证记录：Round 1

状态：completed with specification defects
日期：2026-07-13
验证智能体：GLM（全新会话，与主导 agent 类型不同）
允许材料：`docs/SPEC.md`、`docs/PLAN.md`；额外仅检查文档事实来源与仓库状态，不读取架构细节文档。

## 指派范围

尝试 PLAN 的 T-001 和 T-002；遇到影响实现的歧义必须暂停而非猜测。

## 结果

GLM 未创建 worktree、分支、实现代码或 commit，因为在“先红”之前发现两项阻塞性规约缺陷。该暂停符合冷启动指令。

### 缺陷 CS-01：lint 工具链未冻结

PLAN 要求根脚本含 `lint`，但原 SPEC/PLAN 未指定 linter、依赖、配置文件、命令或 CI 调用。它还发现 pnpm 未安装、缺少 `pnpm install` 与 `pnpm-lock.yaml` 提交步骤，而 CI 使用 `--frozen-lockfile`。

**修订：** SPEC 明确选择 pnpm 10.12.1、ESLint 9 flat config、typescript-eslint 和 React plugins；PLAN T-001 明确 root dependencies、`eslint.config.mjs`、`corepack enable`、`pnpm install`、`pnpm lint`、lockfile 提交与 CI 调用。

### 缺陷 CS-02：T-002 字段形状被外置文档承载

PLAN 要求实现 Action 与多个实体的完整 schema，但原 SPEC 只列实体名，并将字段权威委托给不允许读取的架构文档。GLM 因而拒绝编造字段或 Zod dependency。

**修订：** SPEC section 5 现在内联八种 Action 变体、RunStatus、ConfiguredCommand、VerificationResult、ApprovalRequest、MemoryEntry、TraceEvent、RunSession 和 ToolResult 的字段、枚举、范围、脱敏和关联约束；PLAN T-002 指定这些字段表是唯一 schema authority，并将 Zod 冻结为 T-001 root dependency。

## 影响评估

这两项是 SPEC/PLAN 的规约缺陷，不是 GLM 的误读。修订前不应继续 T-001/T-002。修订后必须使用新的不同冷启动会话，仅阅读更新后的 SPEC/PLAN，重新尝试 T-001 与 T-002，不携带本轮问答或补充说明。

