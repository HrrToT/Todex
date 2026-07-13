# Todex 治理护栏与 HITL 设计

状态：approved
owner：human + codex
last_updated：2026-07-13
related_tasks：[TBD]

## 1. 目标

本设计将 coding agent 的文件系统和命令风险落为可独立验证的代码机制。LLM 只提出结构化动作；Guardrail 依据确定性规则作出 `allow`、`require_approval` 或 `deny` 判定。

## 2. 不可绕过的动作路径

```text
LLM Action
  -> Action Validator
  -> Workspace Boundary Check
  -> Risk Classifier
  -> Approval Policy Check
  -> Tool Dispatcher
  -> Tool Result and Audit Event
  -> LLM feedback
```

未知工具、格式错误或参数无效的动作在 `Action Validator` 被拒绝。Guardrail 必须在 Tool Dispatcher 之前执行，Tool Dispatcher 不接受未经判定的原始 LLM 指令。

## 3. 风险级别

| 级别 | 示例 | 行为 |
| --- | --- | --- |
| allow | 列目录、读普通源码、文本搜索、普通 patch、已确认的 `commandId` 校验命令 | 执行并记录 trace |
| approval | 删除、超过 20 文件或 2000 行的 patch、自由 shell、依赖安装、Git 变更、网络、CI/部署配置、超时/输出量过大的命令 | 创建审批请求并暂停 |
| deny | 工作区逃逸、敏感凭据、提权/系统配置、不可确定目标的破坏性命令、动态或混淆 PowerShell、复杂 shell 结构 | 不执行，向模型回灌原因 |

复杂 shell 结构包括命令拼接、管道、重定向、子表达式和动态执行。V1.0 不尝试将它们“安全解析后运行”。

## 4. 工作区与敏感信息规则

所有文件参数在使用前都要得到规范绝对路径，并验证真实目标属于当前 `workspaceRoot`。符号链接目标同样要验证。禁止路径包括 `.env`、`.env.*`（但 `.env.example` 可读）、`.npmrc`、`.pypirc`、`.netrc`、`credentials.*`、`secrets.*`、`*.pem`、`*.key`、`id_rsa`、`id_ed25519`、`.aws/`、`.ssh/` 与 `.git/config`。

二进制文件、依赖目录、虚拟环境和过大的构建产物默认不读入 LLM 上下文；工具返回可解释的跳过原因。

## 5. 审批作用域

| 决定 | 作用域 | 约束 |
| --- | --- | --- |
| 仅本次允许 | 当前 `actionId` | 只执行一次 |
| 本轮任务允许 | 当前 `runId` 的同类低风险动作 | 不泄漏至新 Run |
| 相同命令前缀允许 | 当前项目内的严格命令指纹 | 7 天后失效，可撤销；不覆盖硬拒绝规则 |
| 拒绝 | 当前动作 | 将结构化拒绝结果回灌 LLM |

命令前缀不是字符串前缀。它绑定 `workspaceId + toolKind + normalized executable + fixed subcommand tokens`。命令在匹配前必须通过完整风险分类；因此 `npm test` 的许可不会放行 `npm test; curl ...` 或任何网络、删除、提权变体。

## 6. HITL 状态机

```text
Running -> Dispatching -> Running
Running -> AwaitingApproval -> Dispatching -> Running
AwaitingApproval -> Running       (denied; feedback sent to LLM)
AwaitingApproval -> Cancelled     (user cancels)
Running -> Completed              (finish and completion conditions met)
Running -> Failed                 (step/repair limit or unrecoverable error)
Running -> Cancelled              (user cancels)
```

每个审批请求都包含不可变 `approvalId`、`actionId`、动作摘要、风险原因、规范化命令指纹、建议作用域和创建时间。重复按钮点击、UI 重连和重新提交同一审批不得导致重复执行。应用关闭、Run 取消或审批过期时均视为未批准。

## 7. 审计字段

每个受治理动作应记录：`runId`、`actionId`、时间、工具类型、参数摘要、工作区、风险级别、匹配规则、审批决定/作用域、审批人时间、执行结果、退出码、截断后的输出、关联 diff 和状态迁移。trace 不得记录敏感文件内容或 API Key。

## 8. 确定性验收测试

测试使用 Mock LLM、Fake Clock 与 Fake Command Runner，不启动真实 shell、不访问网络。至少覆盖：

1. 路径穿越和符号链接逃逸被拒绝，工具不执行。
2. 敏感文件读取或修改被拒绝，trace 不泄漏内容。
3. 自由 shell 进入 `AwaitingApproval`，审批前不执行。
4. 一次允许只执行一次；相同行为再次出现仍请求审批。
5. 本轮允许在本 Run 有效，在新 Run 失效。
6. 前缀许可无法放行 `npm test; curl ...` 等危险变体。
7. 拒绝审批后，Mock LLM 收到结构化反馈并改走安全动作或停止。
8. 删除操作未批准时不执行；批准后只按所选作用域执行。
9. 公网 Mock 宿主无条件拒绝真实 Key 和自由 shell。
10. 取消或重启发生在等待审批期间时，原动作绝不自动执行。

