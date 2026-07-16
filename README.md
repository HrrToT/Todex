# Todex

状态：in progress
最后更新：2026-07-17

Todex 是一个面向小型 Node.js 和 Python 仓库的轻量 coding agent harness。它把模型的单步决策放进仓库自研的确定性主循环：结构化动作、工具分发、工作区边界、危险动作审批、测试反馈、限次修复、项目记忆和可审计 trace 都由本仓库代码实现。

## 当前进度

已合入主线的核心能力：

- 共享动作、Run、审批、验证、记忆和 trace contracts。
- Scripted Mock LLM 与确定性 AgentRunner。
- 工作区真实路径围栏、敏感文件硬拒绝、HITL 审批和作用域治理。
- 有界文件读写/搜索、严格原子 unified diff、项目记忆和 trace 证据约束。
- 成功 patch 后的确认命令验证、脱敏反馈、初始 patch 加三次修复上限，以及环境失败安全停止。

当前 T-007 正在进行书面规约：Todex 将自动识别 Node/Python 项目并展示未确认的验证命令候选。Electron 桌面端、真实模型接入、SQLite 持久化、Windows Credential Manager、公开 Mock WebUI 和 Windows 安装包仍未实现。

## 当前可验证开发命令

先安装与锁文件一致的依赖：

```powershell
pnpm.cmd install --frozen-lockfile
```

在仓库根目录运行：

```powershell
pnpm.cmd test --run
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
```

截至 T-006 合并，这些命令在 GitHub Actions 和独立本地复验中均通过；测试总数为 327。项目还没有可供最终用户双击运行的桌面程序，以上命令仅用于开发与课程证据验证。

## 已实现的安全边界

- 每个模型动作先经过严格结构化协议校验，再可能到达工具分发。
- 工作区外路径、符号链接逃逸、敏感凭据文件、提权/系统配置、混淆 PowerShell 和复杂 shell 结构由 Guardrail 硬拒绝。
- 高风险但可确认的动作会暂停在 HITL 审批前；未获批准不会执行。
- 验证只使用用户确认的固定命令 ID。模型不能提供或改写 shell 字符串、argv、工作目录或超时。
- 校验输出在进入 trace 或模型上下文前会脱敏并限制长度；连续修复次数受限，环境错误不会被当作代码错误无限重试。
- 当前 Harness Core 使用注入式 fake 适配器测试；它尚未在运行时启动真实 shell、网络、Electron、SQLite 或真实 LLM。

## 计划交付形态

- **Windows Electron 安装包**：面向本地真实仓库和 OpenAI-compatible 模型接口，最终使用 Windows Credential Manager 保存 API Key。
- **公网 Mock WebUI**：仅使用内置示例仓库和 Mock LLM，不接收真实 API Key，也不开放自由 shell。

真实安装包、下载地址、签名状态、SmartScreen 提示说明和 Demo URL 只能在后续实际打包、部署和验收后写入本文件。

## 文档入口

- [产品与系统规约](docs/SPEC.md)
- [实施计划](docs/PLAN.md)
- [规约过程](docs/SPEC_PROCESS.md)
- [Agent 开发日志](docs/AGENT_LOG.md)
- [统一文档规约](docs/DOCS_CONVENTIONS.md)
- [架构决策](docs/adr/README.md)
- [辅助模型任务卡](docs/task-cards/README.md)
- [验证证据](docs/verification/README.md)

## 目录结构

```text
docs/                 课程规约、计划、过程、日志和验证证据
docs/task-cards/      辅助模型实施任务卡
docs/verification/    冷启动、测试、审查、构建和部署证据
packages/             Harness Core、共享 contracts 和后续 UI 包
apps/                 后续 Electron 桌面端与公网 Mock Demo
examples/             后续 Node.js/Python 示例仓库
```

## 当前限制

- 尚未提供 Electron 桌面端、Windows 安装包、公开 Demo URL 或真实模型 API 配置界面。
- Node/Python 自动探测与示例仓库尚在 T-007 设计阶段。
- V1.0 的目标平台是 Windows；不承诺 macOS/Linux 桌面版。
- 不支持云端访问用户真实本地仓库、团队协作或运行时多 agent 编排。
