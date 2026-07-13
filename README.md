# Todex

状态：draft
最后更新：2026-07-13

Todex 是一个面向小型 Node.js 与 Python 仓库的轻量 coding agent harness。它让用户在本地选择代码仓库、输入修复或改动任务，并在确定性的工具、治理护栏、人工审批和测试反馈闭环中驱动模型完成工作。

## 项目简介

Todex 将 LLM 的单步决策封装进自研 Harness：结构化动作、工具分发、工作区边界、危险动作审批、测试反馈、自修复、项目级记忆和可审计 trace 都由仓库代码实现。它不建立在现成 agent 编排框架的高层循环之上。

## 当前阶段

项目正在完成 Superpowers brainstorming 规约。尚未开始实现，因此目前没有可运行的安装或启动命令。

## 文档入口

- [产品与系统规约](docs/SPEC.md)
- [实现计划](docs/PLAN.md)
- [规约过程](docs/SPEC_PROCESS.md)
- [Agent 开发日志](docs/AGENT_LOG.md)
- [统一文档规约](docs/DOCS_CONVENTIONS.md)
- [架构决策](docs/adr/README.md)
- [辅助模型任务卡](docs/task-cards/README.md)
- [验证证据](docs/verification/README.md)

## 计划中的交付形态

- Windows Electron 安装包：用于在本地仓库中使用真实模型和 Windows Credential Manager。
- 公网 Mock WebUI：用于展示可重复的机制行为，不接收真实 API Key。

## 安装

实现尚未开始，暂无可验证的安装命令。完成 Windows Electron 打包并在干净机器验证后，本节将提供下载方式、目标 Windows 版本/CPU 架构、签名状态和首次运行系统提示的处理方式。

## 安全配置 API Key

桌面端计划使用 Windows Credential Manager 保存 API Key。首次运行会以隐藏输入引导录入，并支持查看“已配置/未配置”状态、更新和清除；界面、日志、数据库和 Git 历史均不得显示明文 Key。公网 Mock Demo 不接收真实 Key。

## 运行

实现尚未开始，暂无可验证的运行命令。发布前将只写入经实际测试的桌面端启动、开发模式、测试和 Demo 访问命令。

## 分发

V1.0 的正式分发目标是 Windows Electron 安装包，并通过 GitHub Release 提供。线上 Mock WebUI 的公网 URL、部署平台和已知限制将在部署验收后补充。

## 目录结构

```text
docs/                 课程规约、计划、过程、日志和架构证据的权威正文
docs/adr/             架构决策记录
docs/task-cards/      辅助模型任务卡
docs/verification/    冷启动、测试、审查、构建和部署证据
packages/             后续共享 Harness Core、协议和 UI 包
apps/                 后续 Electron 桌面端与公网 Mock Demo
examples/             后续 Node.js/Python 示例仓库
```

## 安全边界

- 真实 API Key 只存在 Windows Credential Manager，不写入源码、日志、Git、SQLite 或 trace。
- 所有工具动作必须经过结构校验、工作区边界检查和治理护栏。
- 敏感文件、工作区外访问、提权、动态/混淆 shell 与无法确定目标的破坏性操作直接拒绝。
- 删除、依赖安装、网络、Git 变更和自由 shell 必须经人工审批；公网 Demo 不开放真实 Key 或自由 shell。

## CI 与开发流程

GitHub Actions 是唯一实际 CI 平台。实现阶段会按 Superpowers 工作流使用 `writing-plans`、worktree、subagent、TDD、代码审查和分支收尾；每个独立任务将有可追溯的任务卡、测试证据、PR 和人工验收记录。

## 已知限制

- 当前仍处于规约阶段，尚无可运行代码、安装包或公网 Demo URL。
- V1.0 目标平台是 Windows，不承诺 macOS/Linux 桌面版本。
- V1.0 只完整支持 Node.js 与 Python 小型仓库。
- V1.0 不支持云端访问用户真实本地仓库、团队协作或运行时多 agent 编排。
