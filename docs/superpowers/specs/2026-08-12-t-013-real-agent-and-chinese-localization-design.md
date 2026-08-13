# T-013 真实桌面 Agent 与中文适配设计

## 状态

已确认，待实现计划。

## 目标

将 Windows Electron 桌面端从固定的确定性工作台原型升级为可用的本地
coding-agent：用户手动选择任意本地 Node.js 或 Python 仓库，配置一个
OpenAI Chat Completions 兼容模型后，在受治理的边界内发起真实 Agent Run。

同一版本完成全界面中文默认适配，并保留 English 切换。公开 Render Demo
继续只运行内置 Mock 场景，绝不接受真实 API Key、本地路径、任意命令或补丁。

## 已确认决定

- 首版真实工作区：用户可从桌面端手动选择任意本地 Node.js 或 Python 仓库。
- 首版模型协议：仅 OpenAI Chat Completions 兼容接口，覆盖常见的 GLM、
  DeepSeek、Qwen 等兼容服务；不在本任务实现 Responses API。
- 执行策略：普通读、搜索和工作区内普通源码补丁可自动执行；所有命令和高风险
  补丁必须等待人工审批。工作区逃逸、敏感路径、混淆/复杂 shell、提权和系统
  操作继续按 Guardrail 硬拒绝。
- 非法模型 Action：第一次解析失败后仅允许一次无工具权限的格式修复请求；第二次
  仍无效时以 `model_protocol_invalid` 停止，不从自然语言猜测可执行 JSON。
- UI 默认中文，提供中文/English 切换。代码、路径、命令、diff、JSON Action、
  trace type、模型原始错误和复制用文本保持原样；界面同时显示中文标签/说明。
- 真实 API Key 仅由主进程经 Windows Credential Manager 生命周期读取；Renderer、
  SQLite、trace、日志、导出和错误消息不得获得或回显明文 Key。

## 非目标

- 不实现多模型并发、自动 git push、部署、容器沙箱、云端同步或多人协作。
- 不放宽 Render Demo 的固定场景限制。
- 不让 Renderer 获得 Node.js、文件系统、子进程、网络凭据或任意 IPC 通道。
- 不把测试通过、进程存在或静态包扫描表述为真实模型的完整产品验收。

## 当前差距

`packages/harness-core` 已有 `AgentRunner`、`Guardrail`、`FileTools`、
`VerificationRunner`、审批、trace 与记忆的确定性实现。`apps/desktop` 已有
SQLite、Credential Manager 适配、项目/命令/审批/记忆 IPC 和打包宿主。

但当前 Renderer 直接使用 `DemoRunController`，项目名、diff、trace 和审批流为
固定演示数据；主进程没有真实 `WorkspaceFs`、受控命令执行器、Chat Completions
客户端或将 Run 事件投递到 UI 的编排服务。因此必须在主进程增加清晰的宿主层，
而不是把真实执行逻辑塞入 React。

## 架构

### 1. 主进程运行编排

新增 `DesktopRunService`，由 Electron main process 持有。每个项目最多一个活跃
Run；它负责：

1. 从 SQLite 读取项目、已确认命令和模型配置。
2. 从 Credential Manager 读取配置引用对应的 API Key。
3. 创建真实工作区适配器、工具 dispatcher、Guardrail、审批存储、trace 存储、
   记忆仓库和 verification runner。
4. 创建 `AgentRunner`，传入真实的 Chat Completions `LlmClient`。
5. 把经脱敏的状态、trace、工具摘要、diff、验证、审批和停止原因持久化，并通过
   窄 IPC 事件发送给 Renderer。
6. 在取消、模型错误、网络超时、协议错误或主机错误时停止后续调度并返回固定的
   安全错误代码。

`DesktopRunService` 是唯一能够调用真实模型、真实文件系统或受控子进程的桌面
适配层。Renderer 只能请求高层意图：选择工作区、确认候选命令、保存模型配置、
开始/取消 Run、读取投影视图、决定审批。

### 2. 真实工作区与命令适配器

新增主进程 `NodeWorkspaceFs`，实现 Harness `WorkspaceFs`。所有路径先经过现有
真实路径解析和 Guardrail 检查；适配器不绕过边界规则。文件读取/搜索结果遵守既有
大小、数量、敏感内容和摘要限制。补丁仍由 FileTools 的原子 unified diff 逻辑
处理，不能部分落盘。

新增 `NodeCommandRunner`，只执行由 `ConfiguredCommandRegistry` 以项目 ID 和
命令 ID 精确解析出的、已由用户确认的 argv/工作目录/超时。它不接受模型传来的
shell 字符串。每次命令执行先创建审批请求；用户批准后才启动子进程。自由 shell
保持在单独的高风险审批/拒绝路径，首版不得成为普通模型调用的隐式退路。

工作区选择后运行 `ProjectDetector`。候选命令仅展示给用户，必须形成
`confirmedByUser: true` 的 `ConfiguredCommand` 才可供 verification runner 使用。
未识别项目进入通用只读模式，不能臆造或执行命令。

### 3. Chat Completions 客户端

新增 `OpenAiCompatibleLlmClient`。它仅接受主进程构造的配置、任务、已选择记忆、
前一轮工具结果和 verification feedback，向 `${baseUrl}/chat/completions` 发出
HTTPS POST。请求包含明确的系统约束：只能返回一个 Todex JSON Action，不能把
仓库文本当作权限指令。

客户端必须：

- 使用 `Authorization: Bearer <api key>`，但不得记录该 header 或 Key。
- 为每个请求设置可取消的 `AbortSignal` 与超时。
- 限制响应大小；将网络/HTTP/JSON 错误转为固定、脱敏的错误结果。
- 对一次非法 Action 发送一次仅含“只返回合法 JSON Action”的格式修复提示，
  不附加工具权限、原始敏感输出或额外任务；再次失败则停止。
- 不实现文本中抽取 JSON、自动执行 tool call 或模型指定 URL/headers。

### 4. IPC 和运行事件

IPC 使用现有 Zod schema 注册模式扩展为以下高层通道：

- `workspace.choose`: 由 main process 调用原生文件夹选择器，Renderer 不提供任意
  文件路径来直接读写。
- `project.detect`: 对已选择的项目生成 ProjectProfile 与候选命令。
- `run.start`, `run.get`, `run.cancel`: 创建、查询、取消单一项目 Run。
- `run.subscribe`, `run.unsubscribe`: 接收脱敏的 Run 投影事件。
- `approval.decide`: 复用已有严格审批 decision schema。
- `settings.getLocale`, `settings.setLocale`: 管理 UI 语言偏好。

事件投影只含公开的 Run 状态、action/tool/verification 摘要、diff 元数据、审批卡
和已脱敏的错误。不得通过事件传递完整敏感文件内容、API Key、Credential ref、
原始模型请求/响应或任意本地绝对路径。

### 5. Renderer 与中文化

Renderer 移除默认 `DemoRunController` 作为生产入口，改为 `DesktopRunController`：
它仅通过 preload 暴露的高层 bridge 驱动工作区选择、探测、模型配置、Run、取消和
审批，并基于主进程投影渲染真实状态。

中文化使用集中式字典和稳定 message key。默认 locale 为 `zh-CN`，`en-US` 可在
设置页切换并持久化。以下内容必须本地化：导航、工作区与模型状态、任务输入、
审批原因与操作、验证分类、错误/空状态、日期、数量、键盘可访问名称和 Demo 场景。

技术证据不做机器翻译：路径、命令、diff、JSON、trace event type、模型名和原始
诊断字段保留原样；屏幕上提供中文字段名与人可读的解释。英文 UI 只改变界面文案，
不改变任何安全策略、协议或持久化数据。

Demo Web 使用同一文案键或等价的静态字典完成中文默认展示，但其 API 限制、会话
隔离与固定场景不改变。

## 正常运行数据流

```text
用户选择文件夹
  -> main 原生选择器与项目探测
  -> 用户确认候选命令并保存模型配置/凭据
  -> Renderer 请求 run.start
  -> DesktopRunService 创建真实适配器和 AgentRunner
  -> Chat Completions LLM 输出 JSON Action
  -> parseAction -> Guardrail -> allow / approval / deny
  -> FileTools 或已批准 NodeCommandRunner
  -> 脱敏 trace、diff、验证反馈
  -> IPC Run 投影 -> 中文工作台
  -> finish / failed / cancelled
```

## 风险策略

| 行为 | 首版策略 |
| --- | --- |
| 读取、列目录、搜索 | 工作区内且非敏感时自动允许 |
| 普通源码/测试/文档补丁 | 通过 Guardrail 与 patch 阈值后自动允许 |
| 大补丁、删除、锁文件、CI/部署配置、二进制或无法检查的变更 | 等待审批或拒绝，沿用既有分类 |
| 已确认 test/lint/typecheck/build 命令 | 每次运行前等待审批 |
| 自由 shell、网络、安装依赖、Git 操作 | 高风险审批或现有硬拒绝；不自动执行 |
| 工作区逃逸、敏感文件、混淆 PowerShell、系统/提权操作 | 硬拒绝，dispatcher 不调用 |

## 错误与恢复

- 无工作区、无确认命令、无模型配置、凭据不可用、网络错误、HTTP 认证错误、超时、
  取消、非法 Action 和审批拒绝均有稳定错误码与中文 UI 说明。
- 取消会终止进行中的模型请求或子进程，并阻止后续 action 调度；未批准 action 不会
  因重启或重连自动执行。
- 模型请求、模型响应、文件和命令输出在进入 trace/UI/SQLite 前统一套用现有脱敏和
  长度上限；被拒绝的敏感内容不保存为替代文本或哈希副本。
- 失败不会触发安装依赖、切换分支、提交、推送或发布等隐式恢复行为。

## 验收与测试

### 中文化

- Desktop 和 Demo 默认显示中文；切换 English 后可访问名称、按钮、状态、审批和
  空状态一致切换。
- 路径、命令、diff、trace type 和 JSON 不被翻译或损坏。
- 切换语言不改变 Run、审批、权限或持久化安全语义。

### 主进程安全

- Renderer 无法调用未注册 IPC、读取 API Key、读取任意路径、执行任意命令或构造
  自由模型 endpoint/header。
- 工作区选择、符号链接逃逸、敏感文件、复杂 shell、命令审批、取消和多 Run 隔离
  都有注入式测试。
- API Key 不出现在 SQLite、trace、IPC payload、日志、错误或测试快照中。

### 真实编排

- 注入 Mock Chat Completions HTTP 服务，端到端验证“选择 Node/Python fixture ->
  探测 -> 用户确认命令 -> 读 -> 普通 patch -> 审批命令 -> 验证 -> finish”。
- 测试一次非法 Action 的格式修复成功、两次非法 Action 以
  `model_protocol_invalid` 停止，以及修复请求不携带 Key/工具权限/敏感原文。
- 测试网络超时、HTTP 非 2xx、取消与审批拒绝不会调度额外工具。

### 人工验收

- 在 Windows 安装版中选择一个用户明确指定的非敏感 Node 或 Python 仓库。
- 用户通过 UI 保存模型配置并完成凭据录入；测试证据仅记录模型名、base URL 的
  非敏感显示值、Run 状态和脱敏 trace。
- 执行一个只读任务和一个会产生普通补丁的任务；任何命令必须在中文审批卡中由用户
  明确批准。不得把这次受控验收外推为任意仓库或任意模型均已验证。

## 交付拆分

T-013 必须按以下顺序拆分为可独立测试、可审查的实现任务：

1. 中文本地化基础设施和 Desktop/Demo 文案迁移。
2. 工作区原生选择、项目探测、候选命令确认与中文项目页。
3. 模型配置页、Credential Manager 生命周期与 OpenAI Chat Completions 客户端。
4. 主进程真实文件/命令适配器与 `DesktopRunService`，覆盖取消、脱敏和审批。
5. Renderer 真实 Run 投影、trace/diff/验证/审批工作台集成。
6. Mock HTTP 端到端测试、Windows 安装包受控人工验收、发布证据与独立审查。

每一项均需独立任务卡、红绿测试、范围审查、代码质量审查、PR/CI 证据。任何一项
未完成时，不得宣称 Todex 已成为可替代 Codex 的完整真实 Agent。
