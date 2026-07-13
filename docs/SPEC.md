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

## 5. 待完成章节

- 用户故事与完整功能规约
- 领域与机制设计：风险分类、审批粒度、HITL 状态机、反馈分类和记忆检索
- 数据模型、上下文构建与动作协议
- 完整安全威胁模型与非功能性需求
- WebUI 信息架构与 Open Design 使用说明
- 验收标准、风险和未决问题

## 6. 范围与演进路线图

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
