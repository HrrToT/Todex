# Todex

Todex 是一个面向小型 Node.js 与 Python 代码仓库的 Windows coding-agent
harness。它将受治理的文件操作、命令验证、人工审批、运行 trace 与有限次数
的修复反馈组合在一起；目标是让本地辅助改代码的过程可见、可审计、可测试。

## 当前状态

- 桌面端：Windows Electron 应用，提供本地工作台、SQLite 持久化和 Windows
  Credential Manager 适配边界。
- 公网演示：受限 Mock Demo 已部署到
  [Render](https://todex-mock-demo.onrender.com)。它只提供固定场景，不接收
  API Key，不访问访问者本地文件，不提供自由 shell 或任意 patch。
- 已发布版本：[`v0.1.0`](https://github.com/HrrToT/Todex/releases/tag/v0.1.0)
  的安装包和发布元数据可下载，但实机发现其 Renderer 会显示白屏。请暂勿将
  `v0.1.0` 用作桌面端验证对象。
- 修复版本：`v0.1.1` 已修复打包 Renderer 的加载路径，并已经过本地
  打包、发布校验和非安装版实机界面检查；它正在等待 GitHub Windows CI 与
  新的 Release 发布。发布完成前，不应将其表述为可下载的正式版本。

## 能力边界

- 所有模型动作先经过结构校验、工作区边界、风险分类和审批策略，不能绕过
  Guardrail 直接执行外部效果。
- 读取、搜索、补丁、已确认命令、自由 shell、记忆与结束动作均有明确协议和
  trace 记录；敏感路径、工作区逃逸、复杂 shell 与系统/提权操作会被拒绝或
  要求审批。
- 自动修复仅执行已确认的客观校验命令，并将脱敏后的失败反馈限制性地回灌；
  默认最多三次修复尝试。
- 公开 Demo 与桌面端的权限不同：Demo 只能驱动内置 Mock 场景；桌面端的真实
  模型凭据只通过 Windows Credential Manager 生命周期管理，界面不回显 API Key。

## 本地开发

要求：Node.js 20 或更高版本，以及 pnpm `10.12.1`。

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd test --run
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
```

运行固定机制演示：

```powershell
pnpm.cmd demo:mechanisms
```

该命令只运行内置 Mock 场景，并写入被 Git 忽略的
`.todex/demo/mechanism-report.json`。它不会调用真实模型、访问任意工作区或
执行真实 shell。

## 发布校验

发布工作流在 GitHub Actions 的 Windows runner 上执行安装、lint、测试、类型
检查、构建、NSIS 打包和发布校验。发布校验需要固定命名的 Windows 安装包和
HTTPS Demo URL：

```powershell
$env:TODEX_DEMO_URL = "https://todex-mock-demo.onrender.com"
$env:TODEX_RELEASE_ARTIFACTS = "apps/desktop/release"
pnpm.cmd verify:release
```

`verify:release` 会检查 `Todex-<version>-win-x64.exe`、`latest.yml` 中的更新
元数据，以及 Demo URL。它不会替代实际安装或界面验收。

Windows 安装包为未签名 NSIS 产物。下载正式发布版本时，Windows SmartScreen
可能显示未识别应用提示；只应从项目的 GitHub Release 下载，并在安装前核对
发布页面提供的文件名、大小和 `latest.yml` 中的 SHA-512。不要从非官方来源
下载或绕过系统安全提示。

## 目录

```text
apps/desktop/       Windows Electron 宿主与 React 工作台
apps/demo-web/      Render 上的受限 Mock Demo
packages/contracts/ 共享严格协议与 Zod schema
packages/harness-core/
                    Agent 主循环、Guardrail、HITL、文件工具、验证与记忆
examples/           固定 Node.js 与 Python 示例仓库
scripts/            机制演示和发布校验命令
docs/               规约、计划、任务卡、验证证据和过程记录
```

## 文档入口

- [产品规约](docs/SPEC.md)
- [执行计划](docs/PLAN.md)
- [规约形成过程](docs/SPEC_PROCESS.md)
- [Agent 协作与审查日志](docs/AGENT_LOG.md)
- [文档规约](docs/DOCS_CONVENTIONS.md)
- [架构决策](docs/adr/README.md)
- [任务卡](docs/task-cards/README.md)
- [验证证据](docs/verification/README.md)

## 已知限制

- 当前正式桌面发布仅面向 Windows x64；macOS 和 Linux 不在本版本发布范围内。
- `v0.1.0` 的安装版存在已确认的 Renderer 白屏问题；等待 `v0.1.1` 的 CI 和
  Release 完成后再进行桌面端安装验证。
- 已有 T-009 环境中曾记录 Electron 生命周期/关闭阶段的 `0xC0000005`；它不应
  被解释为模型、凭据或工具执行成功/失败的证据。
- 本项目不是自治执行器。任何真实模型、凭据、文件写入或命令执行都应在桌面端
  的受治理流程和用户可见审批下进行。
