# Todex 规约（SPEC）

状态：approved
最后更新：2026-07-13

## 当前说明

本规约已由项目负责人完成最终签字确认。实现代码仍必须等待正式 PLAN 生成并通过陌生 agent 冷启动验证后才开始。

## 1. 问题陈述

Todex 是一个面向小型 Node.js 与 Python 代码仓库的轻量 coding agent harness。用户在本地选择工作区并输入修复或改代码任务；Todex 自动探测项目、调用用户配置的 OpenAI-compatible LLM，执行受治理的读写文件与测试动作，并根据客观测试反馈在有限次数内自我修正。

本项目的工程重点不是让 LLM 自己“注意安全”，而是用独立、可测试的代码实现主循环、工具分发、工作区边界、危险动作拦截、HITL 审批、反馈回灌、记忆和配置。

## 2. 已确认产品边界

- 主产品形态：Windows Electron 桌面应用，用户安装后可选择本地代码仓库并直接使用。
- 线上部署：公网 Mock 演示站，使用内置的 Node.js/Python 示例仓库和 Mock LLM；不接收真实 API Key，不访问访问者本地文件，不提供自由 shell。
- 目标仓库：Node.js 与 Python 都是 V1 的完整支持对象，分别支持项目探测、候选命令、用户确认、校验执行与失败反馈闭环。
- 模型接口：单一 OpenAI-compatible 接口；用户配置 `baseUrl`、`model`、`apiKey`、`temperature` 和 `maxTokens`。
- 凭据：桌面端使用 Windows Credential Manager。界面只显示配置状态，不回显 API Key；支持安全录入、更新、清除。
- 自动探测：Todex 扫描仓库标志文件并提出候选测试/质量命令，必须由用户确认后才纳入该项目的已配置命令。
- 记忆：项目级轻量记忆，记录项目探测结果、已确认命令、重要约定、常见失败与修复摘要、审批偏好和最近成功运行摘要；按需注入上下文。
- 自修复：补丁后运行已确认的客观校验；失败输出回灌给 LLM，默认最多进行 3 次修复尝试。
- 主要深入机制：治理护栏、HITL 审批状态机与工作区边界控制。

## 3. 已确认系统架构

采用 TypeScript monorepo，并以共享自研 `harness-core` 为中心：

- `packages/harness-core`：自研 Agent 主循环、动作模型、LLM 抽象、Mock LLM、工具分发、护栏、HITL、反馈、记忆接口和配置解析。
- `packages/shared-contracts`：宿主与核心共享的类型和协议。
- `packages/ui`：桌面端和演示站可复用的 WebUI 组件。
- `apps/desktop`：Electron 宿主，拥有本地工作区和 Windows Credential Manager 权限。
- `apps/demo-web`：公网 Mock 演示宿主，只允许受限的示例工作区。

`harness-core` 不依赖 Electron、React、真实 LLM 或现成 agent 编排框架。真实 LLM 与 `MockLLM` 实现相同的抽象接口。

### 组件数据流

桌面端或 Demo WebUI 将用户任务提交给宿主适配层；适配层创建 `RunSession` 并调用 `harness-core`。Core 依次调用 Context Builder、LLMClient、Action Validator、Guardrail 和 Tool Dispatcher；工具结果、diff、审批状态和校验结果以 `TraceEvent` 回到 Core，并由宿主实时渲染。桌面适配层提供本地工作区、SQLite 与 Credential Manager；Demo 适配层只提供受限示例工作区、临时存储和 Mock LLM。

### 技术选型与理由

| 层次 | 选择 | 理由 |
| --- | --- | --- |
| 核心语言 | TypeScript 严格类型 | Electron、WebUI、Core、Mock 和 CI 共享类型与 npm 工具链，便于辅助模型按模块协作。 |
| 包管理与质量 | pnpm 10.12.1、ESLint 9 flat config、typescript-eslint、React ESLint plugins | 锁定无歧义的 workspace 安装、lint 脚本、CI 与 React/TypeScript 规则。 |
| WebUI | React + Vite | 适合高频状态更新的任务工作台，并与 Electron 和 Demo 共用 UI 组件。 |
| 桌面分发 | Electron + electron-builder + NSIS | 支持 Windows x64 安装包、原生工作区访问和 Release 构建。 |
| Harness | 自研 TypeScript 主循环 | 满足不得依赖 LangChain/AutoGen/CrewAI 等高层 agent runner 的课程边界。 |
| LLM | OpenAI-compatible HTTP Client | 通过用户提供的 base URL/model 支持 GLM、DeepSeek、Qwen 等兼容服务；Mock LLM 实现同一接口。 |
| 持久化 | SQLite + 应用数据目录 | 适合本地 Run、trace、记忆和审批规则的可查询持久化，不污染用户仓库。 |
| 凭据 | Windows Credential Manager，经 keytar 适配层 | 真实 Key 不落入代码、数据库、日志或明文配置。 |
| 测试 | Vitest + Fake Runner/Clock；Playwright 用于 UI 冒烟 | Core 确定性单测不依赖网络，桌面/WebUI 再做用户流程验证。 |
| CI/CD | GitHub Actions | 作为唯一实际 CI，执行单测、构建和 Windows Release 产物。 |
| 公网 Demo | Node 托管的 `apps/demo-web`，部署到 Render | Demo 需要运行 Core 和受限示例工作区；选择低成本的 Node 服务部署，而非纯静态站点。 |

## 4. 凭据与分发设计

### 凭据生命周期

首次真实模型运行前，桌面端在设置页以隐藏输入引导用户提供 API Key；适配层将 Key 写入 Windows Credential Manager，并在 SQLite 仅保存不可逆的 `credentialRef`。设置页只能显示已配置/未配置，支持更新和清除。模型调用时由适配层按 `credentialRef` 临时读取 Key 发送 HTTPS 请求；日志、trace、错误消息和导出均使用脱敏规则。Demo WebUI 不展示、不接收也不存储真实 Key。

### 分发与部署

V1.0 使用 GitHub Release 分发未签名的 Windows 10/11 x64 NSIS 安装包。README 必须说明下载位置、目标平台、首次运行可能出现的 SmartScreen 提示、校验信息、Credential Manager 配置方式和限制。课程要求的公网 WebUI 由 Render 托管为受限 Mock Demo；它只暴露内置 Node/Python 示例仓库和可重置运行状态。CI 在 push 时运行测试，在 Release 时产出安装包。

## 5. 已确认工具集

- `list_files`
- `read_file`
- `search_text`
- `apply_patch`
- `run_configured_command`
- `run_shell_command_with_approval`
- `remember`
- `finish`

所有动作先经过结构校验与 Guardrail，LLM 无法绕过该路径直接执行外部效果。

### 核心协议字段（T-002 的唯一权威）

以下字段定义属于 `docs/SPEC.md`，用于陌生 agent 实现 `packages/contracts/src/index.ts`；架构文档只提供解释和测试动机，不增加或修改这些字段。

| Action 变体 | LLM 必填字段 | 可选字段 | 约束 |
| --- | --- | --- | --- |
| `list_files` | `tool: "list_files"` | `path`, `maxDepth` | `path` 默认为 `"."`，`maxDepth` 为 0--8 的整数 |
| `read_file` | `tool: "read_file"`, `path` | 无 | `path` 为工作区相对文本路径 |
| `search_text` | `tool: "search_text"`, `query` | `path`, `maxResults` | `query` 非空；`maxResults` 为 1--100，默认 20 |
| `apply_patch` | `tool: "apply_patch"`, `patch` | 无 | `patch` 为非空 unified diff 文本 |
| `run_configured_command` | `tool: "run_configured_command"`, `commandId` | 无 | 只能引用已确认命令 |
| `run_shell_command_with_approval` | `tool: "run_shell_command_with_approval"`, `command` | `cwd` | `command` 非空；仅在 Guardrail 要求审批后调度 |
| `remember` | `tool: "remember"`, `kind`, `content`, `traceEventIds` | 无 | `kind` 为 `project_convention` 或 `failure_resolution`；`content` 非空；至少一个 trace ID |
| `finish` | `tool: "finish"`, `summary` | `completion` | `summary` 非空；`completion` 为 `verified` 或 `unverified`，默认 `verified` |

`Action` 不含 `actionId`；Runner 在接收并验证 LLM 动作后生成 `actionId`。所有未知 `tool`、缺字段、额外不允许字段或不符合枚举/范围的值，必须使 `parseAction` 抛出稳定的 `unknown tool` 或 `invalid action` 错误。

| 实体 | 字段与枚举 |
| --- | --- |
| `RunStatus` | `created | running | awaiting_approval | dispatching | completed | completed_unverified | failed_repair_limit | failed_environment | failed | cancelled` |
| `ApprovalScope` | `once | run | command_prefix | deny` |
| `VerificationClassification` | `passed | test_failure | quality_failure | build_failure | command_not_found | dependency_missing | timeout | execution_error | cancelled` |
| `ConfiguredCommand` | `commandId`, `projectId`, `purpose: test|lint|typecheck|build`, `argv: string[]`, `workingDirectory`, `timeoutMs`, `confirmedByUser: boolean`, `lastResult?: passed|failed`；`argv` 不允许 shell 拼接符 |
| `VerificationResult` | `verificationId`, `runId`, `commandId`, `classification: passed|test_failure|quality_failure|build_failure|command_not_found|dependency_missing|timeout|execution_error|cancelled`, `exitCode: number|null`, `durationMs`, `failureSummary`, `relatedPaths: string[]` |
| `ApprovalRequest` | `approvalId`, `runId`, `actionId`, `tool`, `riskReasons: string[]`, `fingerprint`, `state: pending|approved|denied|expired|cancelled`, `decision?: once|run|command_prefix|deny`, `createdAt`, `decidedAt?: string`, `expiresAt?: string` |
| `MemoryEntry` | `memoryId`, `projectId`, `kind: project_profile|verified_command|project_convention|approval_preference|failure_resolution|successful_run_summary`, `trustLevel: verified|agent_observed`, `content`, `sourceTraceIds: string[]`, `createdAt`, `updatedAt`, `deletedAt?: string` |
| `TraceEvent` | `eventId`, `runId`, `sequence`, `type: action_requested|action_rejected|approval_requested|approval_decided|tool_completed|verification_completed|run_completed|run_failed|run_cancelled`, `timestamp`, `payloadSummary`；不得含 API Key 或敏感文件内容 |

`MemoryEntry.trustLevel === "agent_observed"` 时，`sourceTraceIds` 必须至少含一个非空 trace ID；`trustLevel === "verified"` 时，项目探测或用户确认产生的条目允许空数组。`RunSession` 至少包含 `runId`, `projectId`, `taskText`, `status`, `startedAt`, `endedAt?: string`, `repairAttempts`, `stopReason?: string`。`ToolResult` 至少包含 `resultId`, `actionId`, `status: succeeded|rejected|failed|skipped`, `summary`, `truncatedOutput?: string`, `diffRef?: string`。这些类型与上表共同构成 T-002 及后续任务的字段基线；Zod schema 必须使用 strict object 校验，拒绝未列出的输入字段。

## 6. 领域与机制设计：治理、HITL 与工作区边界

治理是 Todex 的主要深入机制。所有 LLM 动作必须经过 `Action Validator -> Workspace Boundary Check -> Risk Classifier -> Approval Policy Check -> Tool Dispatcher`；不存在绕过 Guardrail 直接写文件或执行命令的路径。

- 所有路径必须解析为真实绝对路径并位于当前 `workspaceRoot` 内。路径穿越、绝对路径逃逸、符号链接逃逸和访问其他仓库、用户目录、系统目录或盘符根目录一律拒绝。
- `.env`、`.npmrc`、`.pypirc`、`.netrc`、`credentials.*`、`secrets.*`、`*.pem`、`*.key`、SSH/AWS 凭据与 `.git/config` 均不可读取、写入或出现在 trace；`.env.example` 可读但不应包含真实凭据。
- 普通读、搜索、工作区内普通源码/测试/文档 patch、已确认的精确校验命令默认允许并记录 trace。用户确认的项目命令以固定 `commandId` 映射到精确命令模板，LLM 不可替换其 shell 字符串。
- 文件删除、大范围 patch、自由 shell、依赖安装、Git 变更、网络命令、CI/部署配置变更和超阈值命令必须审批。
- 工作区外访问、敏感凭据访问、提权/系统配置、目标不可确定的破坏性操作、动态/混淆 PowerShell、复杂 shell 拼接或重定向结构一律拒绝；公网 Mock 宿主额外拒绝真实 Key 和自由 shell。
- 审批选项为：仅本次允许、本轮任务允许、对相同命令前缀允许、拒绝。项目级前缀许可限定于同项目、同工具、同可执行文件和固定子命令，默认 7 天失效并可撤销；安装、删除、网络与破坏性 Git 操作不支持项目级前缀许可。
- `RunSession` 状态至少包括 `Running`、`AwaitingApproval`、`Dispatching`、`Completed`、`Failed` 与 `Cancelled`。等待审批时主循环暂停；未批准审批不会在重启、超时或前端重连后自动执行。

完整的风险分类、审批指纹、状态迁移、审计字段和确定性测试矩阵见 [治理与 HITL 设计](architecture/2026-07-13-governance-and-hitl-design.md)。

## 7. 用户与用户故事

Todex 面向在 Windows 上维护中小型 Node.js 或 Python 仓库、希望让 Agent 辅助定位 bug 和完成小范围改动的个人开发者与学生开发者。它不试图替代企业级云端协作平台或完全自治的代码机器人；价值在于把本地代码修改置于可见 diff、客观测试反馈、人工审批和审计 trace 中。

| 编号 | 用户故事 | 可独立验收的结果 |
| --- | --- | --- |
| US-01 | 作为开发者，我想选择本地仓库并确认自动探测出的项目类型和候选命令。 | 确认后保存项目画像与命令；失败时可手动添加命令。 |
| US-02 | 作为开发者，我想输入任务并看到 Agent 读了什么、改了什么、跑了什么。 | trace、工具结果、diff 和测试摘要按序可见。 |
| US-03 | 作为开发者，我想在删除、安装依赖、自由 shell 或网络操作前决定是否批准。 | 高风险动作未批准前绝不执行；拒绝结果回灌模型。 |
| US-04 | 作为开发者，我想让测试失败后的自动修复有明确上限和停止报告。 | 最多 3 次修复；显示失败分类、尝试次数和停止原因。 |
| US-05 | 作为开发者，我想安全配置、更新和清除兼容模型的 API Key。 | Key 仅在 Windows Credential Manager；UI 不回显明文。 |
| US-06 | 作为开发者，我想查看、编辑或删除项目记忆和审批偏好。 | 条目可管理，删除后不再进入 Context Builder。 |
| US-07 | 作为评阅者，我想访问无需 Key 的公网 WebUI，复现治理和反馈机制。 | Demo 仅操作内置示例和 Mock LLM，可重置且无自由 shell。 |

## 8. 功能规约

| 模块 | 输入 | 行为 | 输出 | 边界与错误处理 |
| --- | --- | --- | --- | --- |
| 工作区与探测 | 本地目录 | 扫描 Node/Python 标志和候选命令，等待用户确认 | `ProjectProfile` 与待确认命令 | 未识别时进入通用模式；确认前不执行候选命令 |
| 模型与凭据 | base URL、模型参数、隐藏输入 Key | 写入或更新 Credential Manager，保存非敏感配置引用 | `ModelConfigRef` 与配置状态 | 不显示/记录 Key；缺 Key 时仅可用 Mock 模式 |
| 任务执行 | 已确认项目、任务文本、模型配置 | 创建单一活跃 Run，构建上下文并驱动主循环 | trace、动作、结果、diff、最终报告 | 同项目拒绝并发 Run；取消后不调度新动作 |
| 文件与 patch | 已验证工具参数 | 受路径和敏感文件规则约束地读、搜索、修改 | 内容摘要、搜索结果、统一 diff | 越界/敏感/二进制/过大文件返回结构化拒绝或跳过原因 |
| 校验与修复 | `commandId` 与最新 diff | 运行确认命令，分类并回灌结果 | `VerificationResult`、计数、停止报告 | 环境/依赖/超时不无限修补；无命令仅能未验证完成 |
| 治理与审批 | 风险动作、用户决定 | 创建请求、暂停/恢复 Run、应用许可或拒绝 | 审批卡、审计事件、拒绝反馈 | 硬拒绝无允许按钮；取消/重启不自动批准 |
| 项目记忆 | 探测、用户编辑、带证据 Agent 观察 | 持久化、排序、按需装配、编辑删除 | `MemoryEntry` 列表 | 无 trace 证据的 Agent 记忆拒绝写入 |
| 公网 Demo | 预设任务、内置示例、Mock 脚本 | 复用 Harness Core 演示拦截和修复 | 可重置 trace、diff、测试结果 | 禁止真实 Key、自由 shell、本地路径和用户上传代码 |

## 9. WebUI 信息架构与设计方法

启动后直接进入开发任务工作台，而不是营销页面。桌面端和线上 Demo 复用主要布局，但后者隐藏本地工作区与真实模型设置。

```text
顶栏：工作区 / 项目类型 / 模型状态 / Run 状态
左侧：工作区、探测结果、已确认命令、项目记忆
中央：任务输入、运行控制、Agent trace、工具输出和失败反馈
右侧：当前 diff、测试结果、审批卡和最终报告
底栏：修复次数、校验状态和最近审计事件
```

主要视图包括工作区探测、任务工作台、diff 与验证、审批、项目记忆、模型与安全设置；公网 Demo 只显示可重置的内置场景。

V1.0 采用 Open Design 作为前端设计方法与实现参考，并在开始前端任务前启用/安装对应 skill、在 `AGENT_LOG.md` 记录实际使用。UI 使用 React 可访问性优先组件和 Lucide 图标，保持开发工具风格：任务工作台为首屏，审批/失败/未验证以清晰状态呈现，diff/命令输出/trace 使用等宽字体，窄屏不遮挡关键操作。

## 10. 安全威胁模型与非功能性需求

Todex 保护的资产包括真实 API Key、用户本地代码和敏感文件、用户 Windows 系统与其他目录、以及 trace/项目记忆/Demo 运行环境。它是工作区级治理工具，而不是操作系统级沙箱：它降低模型越权与误操作风险，但不承诺在恶意本地程序、被攻破 Windows 账户或用户主动批准高风险动作时提供完全隔离。

| 威胁 | 对策 |
| --- | --- |
| Key 出现在配置、日志、trace、Git 或错误回显 | Key 仅在 Windows Credential Manager；SQLite 仅存 `credentialRef`；日志和输出脱敏；Git 忽略 `.env` |
| Agent 读取仓库秘密 | 敏感路径硬拒绝，拒绝结果不含内容；用户可后续扩展规则 |
| Agent 逃出工作区 | 解析真实绝对路径和符号链接目标后检查 `workspaceRoot`；越界直接拒绝 |
| 仓库内容 prompt injection | 仓库文本是非可信上下文；工具权限只由确定性 Guardrail 决定 |
| 命令/审批绕过 | 结构化动作、固定 `commandId`、规范化指纹和复杂 shell 硬拒绝 |
| 依赖或网络供应链风险 | 安装/网络动作必须审批；Demo 禁止自由 shell |
| 公网 Demo 被滥用 | 内置示例、Mock LLM、禁用真实 Key/自由 shell，限制 Run 步数、输出和超时并支持重置 |
| trace 或记忆泄露 | 输出截断脱敏，不存敏感文件或 Key；用户可清除项目记忆 |

| 类别 | V1.0 要求 |
| --- | --- |
| 性能 | 推荐仓库不超过 20,000 文件和 500 MB；探测跳过依赖/虚拟环境/构建目录，并在普通本地仓库 5 秒内给出候选结果 |
| 响应性 | trace、审批和校验状态在本地 UI 收到事件后 500 ms 内更新；长输出按块展示并截断存储 |
| 可靠性 | 每项目最多一个活跃 Run；重启/取消不自动执行未批准动作；所有停止都给出原因 |
| 可用性 | 始终显示工作区、模型配置状态、Run、修复次数、测试结果和待审批动作；无 Key 时 Mock 模式可用 |
| 可观测性 | Run 的动作、审批、工具结果、diff、校验、状态迁移和停止原因可查询与导出 |
| 隐私 | Key 不进入 Git、数据库、日志、trace 或 Demo；本地记忆可查看、编辑、删除 |
| 可测试性 | Core 不依赖 Electron、真实 LLM 或网络；使用 Mock LLM、Fake Runner、Fake Clock 做确定性测试 |
| 可维护性 | TypeScript 严格类型，Core/宿主通过共享协议隔离；辅助模型只在任务卡和 worktree 指定边界内开发 |
| 可访问性 | 关键动作键盘可达、有可见焦点与文本/图标语义；状态不只用颜色表达 |
| 兼容性 | 正式支持 Windows 10/11 x64 与 Node.js/Python 小型仓库；不承诺其他桌面系统或大型 monorepo |

## 11. 验收标准、风险与未决问题

| 编号 | V1.0 客观验收标准 |
| --- | --- |
| AC-01 | 无网络、无真实 LLM 时，Mock LLM 可驱动“读文件 -> patch -> 校验 -> finish”主循环。 |
| AC-02 | Node.js 示例仓库可被探测、确认并运行测试与至少一种质量命令。 |
| AC-03 | Python 示例仓库可被探测、确认并运行 `pytest` 与至少一种质量命令。 |
| AC-04 | 越界、敏感文件、复杂 shell、提权或未允许网络动作被确定性拒绝且工具不执行。 |
| AC-05 | 高风险动作进入 `AwaitingApproval`；四种审批作用域均有确定性单测。 |
| AC-06 | Mock 场景注入一次测试失败后，Agent 接收反馈并采用不同下一步动作修复通过；超过 3 次停止。 |
| AC-07 | 项目画像、命令和带 trace 的记忆可跨 Run 按需加载；无证据记忆拒绝，删除后不再注入。 |
| AC-08 | Key 可安全录入、更新、清除、检查状态；仓库、SQLite、trace、日志均不含明文 Key。 |
| AC-09 | Windows Electron 安装包可在 Windows x64 安装、启动、选择本地示例仓库并完成 Mock 模式任务。 |
| AC-10 | 公网 Mock WebUI 可访问、可重置，并展示危险拦截、失败反馈修复和重点治理行为。 |
| AC-11 | 一键测试命令覆盖 Core；GitHub Actions 在每次 push 运行，最终提交对应 Actions 为通过。 |
| AC-12 | 实现任务有任务卡、TDD 红绿证据、worktree/PR、规格合规审查和代码质量审查记录。 |

| 风险或未决问题 | 影响与 V1.0 处理 |
| --- | --- |
| Windows 安装包未签名 | SmartScreen 可能提示未知发布者；不购买课程项目代码签名证书，README 透明说明并在 Release 提供校验信息 |
| Credential Manager 原生模块兼容性 | 早期定义凭据适配器和 Mock，优先验证 Electron 打包环境 |
| Node/Python 环境差异 | 用户确认命令；清晰分类环境/依赖错误，不自动安装依赖 |
| 已确认项目脚本仍可能有副作用 | 显示完整命令并由用户确认；自由 shell 仍单独审批 |
| Open Design skill 可用性 | 前端实现前检查安装，记录实际使用；若偏离，在 AGENT_LOG 说明原因 |
| Demo 免费部署限制 | 采用低成本、受限、可重置设计，并保留本地可运行 Demo 作为备份 |
| 规约仍可能有歧义 | 使用陌生 agent 冷启动验证 1--2 个任务，记录问题并修订 SPEC/PLAN |

## 12. 反馈闭环、记忆与数据模型

测试、lint、typecheck 与 build 是 Todex 的客观反馈传感器。每次产生 patch 后，`VerificationRunner` 只执行用户确认或 Demo 冻结的 `commandId`，将结构化 `VerificationResult` 回灌下一轮 LLM 上下文。失败分类至少包括 `passed`、`test_failure`、`quality_failure`、`build_failure`、`command_not_found`、`dependency_missing`、`timeout`、`execution_error` 和 `cancelled`。

默认 `maxRepairAttempts` 为 3。只有失败校验后的再次代码修复才消耗修复次数；环境缺失、依赖缺失、超时和不可恢复执行错误不会被错误地当作代码问题反复修补。未配置已确认校验命令的 Run 只能标记为 `completed_unverified`，不得声称验证通过。

项目级轻量记忆只保存可解释的项目画像、已验证命令、项目约定、审批偏好、失败修复摘要与成功 Run 摘要。桌面端将这些数据放在 Todex 应用数据目录的 SQLite 中，不写回用户仓库；公网 Demo 使用可重置的临时存储。API Key 永远只由 Windows Credential Manager 保存，数据库仅保存 `credentialRef`。

跨会话记忆按可信度区分：项目探测和用户确认的条目为 `verified`；Agent 写入的条目必须关联工具 trace 证据，标为 `agent_observed` 且低优先级；无工具证据的模型主观推断不可持久化。Context Builder 按当前任务、校验阶段和失败类型选择记忆，并限制数量与文本预算。

完整的反馈协议、记忆策略、实体字段与确定性测试见 [反馈、记忆与数据模型设计](architecture/2026-07-13-feedback-memory-and-data-model.md)。

主数据模型由 `ProjectProfile`、`ConfiguredCommand`、`RunSession`、`Action`、`ToolResult`、`VerificationResult`、`ApprovalRequest`、`ApprovalGrant`、`MemoryEntry`、`TraceEvent` 和 `ModelConfigRef` 构成。T-002 所需字段、枚举、约束和脱敏规则以本章“核心协议字段”为唯一权威；链接架构文档只解释设计动机和测试场景，不增加或修改 schema。真实 API Key 不属于任何持久化实体。

## 13. 范围与演进路线图

### V1.0：本课程交付范围

V1.0 是 Todex 的正式课程交付版，包含 Windows Electron 桌面端、Node.js/Python 双完整项目探测与反馈闭环、OpenAI-compatible 单模型接口、项目级轻量记忆、Mock LLM 确定性测试、工作区边界、HITL 审批、受限自修复和公网 Mock WebUI。

V1.0 明确不包含云端访问用户真实本地仓库、用户登录和多人协作、运行时多 agent 编排、向量检索/RAG、macOS/Linux 桌面发行版、自动 `git push`/发布/生产部署、自由 shell 默认执行、特权容器和全语言生态支持。

开发将依次经过：规约冻结与陌生 agent 冷启动验证；Harness 内核与 Mock 测试；治理和反馈闭环；Node/Python 适配；桌面端、WebUI 和凭据；公网 Demo、打包、CI 与交付收尾。

### V1.1：可靠性和真实开发体验

后续优先增强 Git 分支/worktree 创建、diff 分块接受或撤销、任务回滚、审批规则编辑、长任务恢复、trace 导出、Node/Python 环境探测和敏感信息扫描。

### V1.2：受控多模型协作

后续可将开发阶段的“主导 agent + 辅助模型”协作模式产品化：规划、局部补丁和独立审查由不同模型承担；子任务隔离在 worktree 中，设定文件范围和预算上限，并以测试与人工审批作为整合前提。

### V2.0：团队和跨平台

在单人本地模式稳定后，再考虑 macOS/Linux、团队策略和审计、Java/Go/Rust 适配器、插件化工具协议及受沙箱约束的远程执行器。
