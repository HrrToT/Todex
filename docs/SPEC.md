# Todex 规约（SPEC）

状态：draft
最后更新：2026-07-13

## 当前说明

本规约正在通过 Superpowers brainstorming 分段设计。这里记录已经由项目负责人确认的事实；未完成的章节会在对应设计分段获确认后补全。实现代码必须等待完整 SPEC、PLAN 和冷启动验证完成后才开始。

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

## 4. 已确认工具集

- `list_files`
- `read_file`
- `search_text`
- `apply_patch`
- `run_configured_command`
- `run_shell_command_with_approval`
- `remember`
- `finish`

所有动作先经过结构校验与 Guardrail，LLM 无法绕过该路径直接执行外部效果。

## 5. 领域与机制设计：治理、HITL 与工作区边界

治理是 Todex 的主要深入机制。所有 LLM 动作必须经过 `Action Validator -> Workspace Boundary Check -> Risk Classifier -> Approval Policy Check -> Tool Dispatcher`；不存在绕过 Guardrail 直接写文件或执行命令的路径。

- 所有路径必须解析为真实绝对路径并位于当前 `workspaceRoot` 内。路径穿越、绝对路径逃逸、符号链接逃逸和访问其他仓库、用户目录、系统目录或盘符根目录一律拒绝。
- `.env`、`.npmrc`、`.pypirc`、`.netrc`、`credentials.*`、`secrets.*`、`*.pem`、`*.key`、SSH/AWS 凭据与 `.git/config` 均不可读取、写入或出现在 trace；`.env.example` 可读但不应包含真实凭据。
- 普通读、搜索、工作区内普通源码/测试/文档 patch、已确认的精确校验命令默认允许并记录 trace。用户确认的项目命令以固定 `commandId` 映射到精确命令模板，LLM 不可替换其 shell 字符串。
- 文件删除、大范围 patch、自由 shell、依赖安装、Git 变更、网络命令、CI/部署配置变更和超阈值命令必须审批。
- 工作区外访问、敏感凭据访问、提权/系统配置、目标不可确定的破坏性操作、动态/混淆 PowerShell、复杂 shell 拼接或重定向结构一律拒绝；公网 Mock 宿主额外拒绝真实 Key 和自由 shell。
- 审批选项为：仅本次允许、本轮任务允许、对相同命令前缀允许、拒绝。项目级前缀许可限定于同项目、同工具、同可执行文件和固定子命令，默认 7 天失效并可撤销；安装、删除、网络与破坏性 Git 操作不支持项目级前缀许可。
- `RunSession` 状态至少包括 `Running`、`AwaitingApproval`、`Dispatching`、`Completed`、`Failed` 与 `Cancelled`。等待审批时主循环暂停；未批准审批不会在重启、超时或前端重连后自动执行。

完整的风险分类、审批指纹、状态迁移、审计字段和确定性测试矩阵见 [治理与 HITL 设计](architecture/2026-07-13-governance-and-hitl-design.md)。

## 6. 用户与用户故事

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

## 7. 功能规约

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

## 8. WebUI 信息架构与设计方法

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

## 9. 待完成章节

- 完整安全威胁模型与非功能性需求
- 验收标准、风险和未决问题

## 10. 反馈闭环、记忆与数据模型

测试、lint、typecheck 与 build 是 Todex 的客观反馈传感器。每次产生 patch 后，`VerificationRunner` 只执行用户确认或 Demo 冻结的 `commandId`，将结构化 `VerificationResult` 回灌下一轮 LLM 上下文。失败分类至少包括 `passed`、`test_failure`、`quality_failure`、`build_failure`、`command_not_found`、`dependency_missing`、`timeout`、`execution_error` 和 `cancelled`。

默认 `maxRepairAttempts` 为 3。只有失败校验后的再次代码修复才消耗修复次数；环境缺失、依赖缺失、超时和不可恢复执行错误不会被错误地当作代码问题反复修补。未配置已确认校验命令的 Run 只能标记为 `completed_unverified`，不得声称验证通过。

项目级轻量记忆只保存可解释的项目画像、已验证命令、项目约定、审批偏好、失败修复摘要与成功 Run 摘要。桌面端将这些数据放在 Todex 应用数据目录的 SQLite 中，不写回用户仓库；公网 Demo 使用可重置的临时存储。API Key 永远只由 Windows Credential Manager 保存，数据库仅保存 `credentialRef`。

跨会话记忆按可信度区分：项目探测和用户确认的条目为 `verified`；Agent 写入的条目必须关联工具 trace 证据，标为 `agent_observed` 且低优先级；无工具证据的模型主观推断不可持久化。Context Builder 按当前任务、校验阶段和失败类型选择记忆，并限制数量与文本预算。

完整的反馈协议、记忆策略、实体字段与确定性测试见 [反馈、记忆与数据模型设计](architecture/2026-07-13-feedback-memory-and-data-model.md)。

## 11. 范围与演进路线图

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
