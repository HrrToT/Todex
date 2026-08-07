# Todex

状态：T-012 实现中
最后更新：2026-08-07

Todex 是一个面向小型 Node.js 和 Python 仓库的轻量 coding agent harness。它把模型的单步决策放进仓库自研的确定性主循环：结构化动作、工具分发、工作区边界、危险动作审批、测试反馈、限次修复、项目记忆和可审计 trace 都由本仓库代码实现。

## 当前进度

已合入主线的核心能力：

- 共享动作、Run、审批、验证、记忆和 trace contracts。
- Scripted Mock LLM 与确定性 AgentRunner。
- 工作区真实路径围栏、敏感文件硬拒绝、HITL 审批和作用域治理。
- 有界文件读写/搜索、严格原子 unified diff、项目记忆和 trace 证据约束。
- 成功 patch 后的确认命令验证、脱敏反馈、初始 patch 加三次修复上限，以及环境失败安全停止。

T-001 至 T-011 已完成；T-012 正在补齐 Windows 发布链路和最终验收。T-011 公网 Mock Demo 只使用固定场景、Mock LLM 和服务端会话，不接收真实 API Key、任意路径、自由 shell 或任意 patch。

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
pnpm.cmd demo:mechanisms
pnpm.cmd verify:release
```

`verify:release` 还要求环境变量 `TODEX_DEMO_URL` 为 HTTPS 公网地址，并要求 `apps/desktop/release/` 下存在 `Todex-<version>-win-x64.exe`；如产物不在默认目录，可设置 `TODEX_RELEASE_ARTIFACTS`。当前本地验证故意因缺少这两项而失败；这不等同于发布完成。

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

### 发布与安全说明

Windows 安装包由 electron-builder 生成 unsigned NSIS x64 artifact。未签名安装包可能触发 Windows SmartScreen 警告；用户应从项目 GitHub Release 获取文件，并在安装前核对 Release 页面提供的校验信息。生产凭据只通过 Electron 主进程的 Windows Credential Manager 适配器处理，renderer 不接触明文 API Key。

公网 Demo 的 Render URL 尚未配置，不能在 README 中伪造地址。部署完成后只填入实际 HTTPS URL，并重新运行 `pnpm.cmd verify:release`。

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
apps/                 Electron 桌面端与公网 Mock Demo
examples/             后续 Node.js/Python 示例仓库
```

## 当前限制

- 尚未完成 Windows installer、GitHub Release artifact 和公开 Demo URL 验收。
- Electron 当前环境仍有已记录的生命周期 `0xC0000005` 限制，不能把本地 build 当作安装后启动证据。
- V1.0 的目标平台是 Windows；不承诺 macOS/Linux 桌面版。
- 不支持云端访问用户真实本地仓库、团队协作或运行时多 agent 编排。
