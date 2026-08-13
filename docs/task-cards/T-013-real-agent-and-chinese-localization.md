# T-013: 真实桌面 Agent 与中文适配

状态：integrated_pending_manual_acceptance

权威设计：[`2026-08-12-t-013-real-agent-and-chinese-localization-design.md`](../superpowers/specs/2026-08-12-t-013-real-agent-and-chinese-localization-design.md)。

## 目标

提供中文默认、可切换 English 的 Windows 桌面 Agent。用户能从 UI 选择任意本地
Node.js/Python 仓库、确认候选命令、配置 OpenAI Chat Completions 兼容模型，并在
既有 Guardrail、审批、trace 和验证反馈边界内运行真实任务。

## 不可违反的边界

- API Key 只能被 main process 的 Credential Manager 适配层读取；不得进入 Renderer、
  SQLite、trace、日志、导出、测试快照或错误文本。
- Renderer 只可调用白名单 IPC；不得访问 Node、文件系统、子进程或任意网络接口。
- 普通读/搜索/源码补丁可自动执行；每一次确认命令和高风险补丁必须审批。
- 绝不从模型的自然语言中猜测 Action。Action 非法时只能发起一次无权限格式修复，
  第二次非法即 `model_protocol_invalid`。
- Render Demo 仍为 Mock-only：不接收真实 Key、路径、命令、补丁、文件上传或模型 URL。

## 交付顺序

1. 中文化基础设施与 Desktop/Demo 文案。
2. 原生文件夹选择、探测与命令确认。
3. Chat Completions 客户端和模型凭据 UI。
4. 真实 WorkspaceFs/CommandRunner 与主进程 Run 编排。
5. 实时中文工作台、Mock HTTP E2E、文档与 Windows 人工验收。

## TDD 和验收

每一阶段必须先有聚焦 RED 测试，再有 GREEN 测试与提交。最终必须证明：

- 中文/English 切换不改变路径、命令、diff、JSON 或权限语义。
- 任意越界、敏感路径、复杂 shell 和未批准命令在 dispatcher/child process 前停止。
- 一次协议修复后可继续，二次非法输出停止；修复请求没有 Key 或原始敏感内容。
- 真实 IPC Run 投影显示 trace、diff、验证与审批，且不泄露 Key。
- Mock HTTP 服务能完成受控 Node/Python fixture 的完整闭环；真实模型人工验收必须是
  用户选择的非敏感仓库，并记录为范围有限的证据。

## 允许修改

`apps/desktop/**`、`apps/demo-web/src/App.tsx`、`apps/demo-web/test/App.spec.tsx`、
`packages/harness-core/**`（仅当实现缺少适配接口且由测试证明必要）、`README.md`、
`docs/PLAN.md`、`docs/AGENT_LOG.md`、`docs/task-cards/T-013-*`、
`docs/verification/*t-013*`。不得修改 Demo HTTP 安全边界以接收真实输入。

## 集成状态（2026-08-13）

- PR [#19](https://github.com/HrrToT/Todex/pull/19) 已合并到 `main`，合并提交为
  `f9dcd3a8368b32fb14418bb1e05dcdc1e20ada61`，其中包含已验证的 PR head
  `bc405e38b5220640d5fa92948ad0e90c527699f9`。
- 该 PR 的 GitHub Actions CI 已通过：
  https://github.com/HrrToT/Todex/actions/runs/31708987042
- 本卡不因此宣称最终发布或人工验收完成。Windows 已安装应用交互验收与在用户选择的
  非敏感仓库上进行真实模型验收仍是开放证据项；Render 公共 Demo 仍必须保持 Mock-only。
