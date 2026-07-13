# Todex 反馈闭环、轻量记忆与数据模型设计

状态：approved
owner：human + codex
last_updated：2026-07-13
related_tasks：[TBD]

## 1. 反馈闭环

`apply_patch` 产生 diff 后，`VerificationRunner` 运行用户确认或 Demo 冻结的 `ConfiguredCommand`。模型不能临时提供新的校验 shell 字符串。`VerificationResult` 记录命令、退出码、耗时、失败分类、截断脱敏后的摘要和关联 Run。

| 分类 | 处理 |
| --- | --- |
| `passed` | 允许继续或完成 |
| `test_failure`、`quality_failure`、`build_failure` | 构造最小 Feedback Packet，允许限次修复 |
| `command_not_found`、`dependency_missing` | 报告环境前提；不盲目修代码，安装须重新审批 |
| `timeout`、`execution_error` | 停止自动修复，报告可操作原因 |
| `cancelled` | 结束 Run，不再进入循环 |

Feedback Packet 只包含命令、分类、退出码、失败摘要、相关文件位置、最近 diff 摘要和已用修复次数。输出必须截断和脱敏。

默认 `maxRepairAttempts = 3`。只有失败校验后再次修改代码才计数；第四次可修复失败以 `failed_repair_limit` 结束。没有已确认验证命令时，停止状态只能是 `completed_unverified`。

## 2. 轻量记忆

V1.0 不做向量数据库或全文 RAG。桌面端在 Todex 应用数据目录使用 SQLite 保存记忆、Run 和审计数据，不向用户仓库写入数据库；公网 Demo 使用可重置临时存储。

| 类型 | 例子 | 可信度与注入规则 |
| --- | --- | --- |
| `project_profile` | Node/Python 类型、包管理器、解释器 | `verified`，任务开始时小体积注入 |
| `verified_command` | `commandId`、用途、超时、最近结果 | `verified`，按校验阶段注入 |
| `project_convention` | 测试目录、禁止修改区域 | 用户确认时 `verified`；Agent 证据总结时低优先级 |
| `approval_preference` | 前缀许可、到期与撤销 | 不发送给 LLM，仅供 Guardrail |
| `failure_resolution` | 失败分类与已验证修复 | 相近失败时按需注入 |
| `successful_run_summary` | 任务、改动、通过校验、停止原因 | 作为历史摘要按需注入 |

Agent 的 `remember` 必须提供至少一个 `traceEventId`；否则拒绝跨会话写入。`agent_observed` 记忆在 UI 中明确来源，用户可以编辑、删除或提升。Context Builder 最多注入 12 条、约 4 KB 的压缩记忆，优先级为用户确认/探测事实、当前验证相关事实、带证据的 Agent 观察和历史摘要。

## 3. 主要实体

| 实体 | 关键字段与约束 |
| --- | --- |
| `ProjectProfile` | `projectId`、`workspaceHash`、`displayName`、`projectKinds`、探测/确认时间；一个工作区对应一个画像 |
| `ConfiguredCommand` | `commandId`、`projectId`、`purpose`、固定 `template`、工作目录、超时、用户确认标志 |
| `RunSession` | `runId`、`projectId`、任务、状态、模型配置引用、开始/结束时间、修复次数、停止原因；同一项目最多一个活跃 Run |
| `Action` | `actionId`、`runId`、顺序、工具、已验证参数、来源；顺序在 Run 内唯一 |
| `ToolResult` | `resultId`、`actionId`、状态、摘要、截断输出、diff 引用；不得含敏感数据 |
| `VerificationResult` | `verificationId`、`runId`、`commandId`、分类、退出码、耗时、失败摘要 |
| `ApprovalRequest` / `ApprovalGrant` | 审批动作、风险原因、指纹、状态/作用域/失效/撤销时间；与治理状态机关联 |
| `MemoryEntry` | `memoryId`、`projectId`、类型、可信度、内容、证据 trace、创建/更新时间；可查看编辑删除 |
| `TraceEvent` | `eventId`、`runId`、顺序、类型、时间、脱敏载荷摘要；追加式审计记录 |
| `ModelConfigRef` | 供应商、base URL、模型与 `credentialRef`；绝不保存 API Key |

## 4. 确定性验收

使用 Mock LLM、Fake Clock 与 Fake Command Runner，至少验证：失败测试结果被下一轮上下文接收；第二次 patch 后通过则 Run 完成；超过 3 次修复失败停止；环境/依赖错误不进入无限修补；无验证命令不能声称通过；用户确认记忆在新 Run 中按需注入；无 trace 证据的记忆写入被拒绝；删除记忆后不再注入；API Key 不出现在 SQLite、trace、导出或 UI 查询结果。

