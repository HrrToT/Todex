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
- 修复版本：[`v0.1.1`](https://github.com/HrrToT/Todex/releases/tag/v0.1.1)
  已发布。它修复了打包 Renderer 的加载路径；发布页提供
  `Todex-0.1.1-win-x64.exe`、`latest.yml` 和校验信息。`v0.1.1` 的安装器已在
  本机完成完整性校验并安装，安装目录不再包含 `v0.1.0` 的空白 `data:` 页面入口。
- 当前桌面候选版：[`v0.1.2`](https://github.com/HrrToT/Todex/releases/tag/v0.1.2)
  已发布。它包含已合并的 T-013 受治理真实 Agent 路径，并提供
  `Todex-0.1.2-win-x64.exe`、`latest.yml` 和 blockmap。该版本已完成 CI、目标
  Electron smoke、打包和解包应用启动检查；真实外部模型与用户仓库的人工验收仍未完成。

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

### T-013 受治理真实 Agent（已集成，待人工验收）

T-013 已通过 [PR #19](https://github.com/HrrToT/Todex/pull/19) 合并到 `main`，其最终
CI [run 31708987042](https://github.com/HrrToT/Todex/actions/runs/31708987042) 已通过。
源码中的桌面端允许用户通过原生目录选择器导入本地 Node.js 或 Python 项目，并保存一个
OpenAI Chat Completions 兼容的 `baseUrl` 与模型名称。桌面端可通过一次性、受控的密码输入框
将 API Key 交给窄类型 `credential.save` IPC，由 Electron main process 写入 Windows Credential
Manager；界面不会回显或预填 API Key，IPC 也不会返回 API Key 或 credential reference。运行时仅由
Electron main process 读取，API Key 不会被写入 SQLite、trace、日志、导出数据或 Renderer 查询投影。

真实运行仍有明确治理边界：工作区内的读取、搜索和普通 unified diff 补丁可自动执行；
每次已确认命令都必须先经过人工审批，审批前不会启动子进程。目录逃逸、符号链接逃逸、
敏感文件、复杂 shell 与提权操作会在分发前被拒绝。模型必须返回完整 JSON Action；
首次非法响应只会得到一次 JSON-only 格式修复请求，第二次非法响应停止为
`model_protocol_invalid`。

这不是已发布的任意仓库 Agent 验收结论。T-013 仍待独立规约/安全审查、Windows 安装包
中的手工交互验收，以及在用户选择的非敏感仓库上的范围受控真实模型验收。Render Demo
继续严格为固定 Mock 场景，不能输入真实 API Key、本地路径、任意命令、补丁、文件上传
或模型 URL。

- 当前正式桌面发布仅面向 Windows x64；macOS 和 Linux 不在本版本发布范围内。
- `v0.1.0` 的安装版存在已确认的 Renderer 白屏问题；请使用已发布的
  `v0.1.1`。正式安装后的可见工作台内容仍应由使用者完成一次人工确认；安装文件
  与静态包内容核验不等同于完整交互式 Agent 验收。
- `v0.1.1` 早于 T-013 合并，因此不包含本节所述的真实 Agent 集成。`v0.1.2` 是包含
  该集成的 Windows x64 候选发布；每次确认命令与高风险补丁仍须人工审批，不能视为
  自治执行器。
- 已有 T-009 环境中曾记录 Electron 生命周期/关闭阶段的 `0xC0000005`；它不应
  被解释为模型、凭据或工具执行成功/失败的证据。
- 本项目不是自治执行器。任何真实模型、凭据、文件写入或命令执行都应在桌面端
  的受治理流程和用户可见审批下进行。
