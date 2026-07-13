# Todex 规约过程（SPEC_PROCESS）

状态：in progress
最后更新：2026-07-13

## 目的

本文件记录使用 Superpowers 从初始方向到规约和计划的过程。它将保存关键追问、项目负责人的决定、被推翻的方案、冷启动验证暴露的歧义以及由此产生的 SPEC/PLAN 修订。

## 已记录的关键迭代

### 2026-07-13：从课程方向到产品边界

初始方向是“Todex：小型代码仓库的轻量 coding agent harness”，能力包括读写文件、执行测试、接收反馈和自我修正。

决定：选择真实开发者导向而非单纯机制演示；产品以本地 WebUI 为主，并最终交付 Windows Electron 安装包。

### 2026-07-13：项目探测、模型和治理

决定：不要求用户预先声明仓库类型。Todex 自动探测项目，再向用户展示候选测试命令并要求确认。

决定：只实现一个 OpenAI-compatible LLMClient，支持 GLM、DeepSeek、Qwen 等兼容供应商；API Key 使用 Windows Credential Manager。

决定：采用类似 Codex 的治理方式，安全操作默认允许，高风险操作必须经过一次、本轮或同命令前缀粒度的审批，并记录在 trace 中。

### 2026-07-13：范围、测试与分发

决定：V1 对 Node.js 与 Python 都提供完整的探测和反馈闭环支持。

决定：核心机制的自动化验收使用确定性的 Mock LLM，不依赖网络或真实模型；真实模型是桌面产品功能，不是课程测试前提。

决定：采用共享 `harness-core` 的 TypeScript monorepo。Windows Electron 是真实本地产品宿主；公网 WebUI 是不接收真实 Key、仅运行内置示例仓库和 Mock LLM 的演示宿主。

## 尚未完成的过程证据

- [ ] 记录至少 3 轮关键迭代的更完整对话节选与采纳/推翻理由。
- [ ] 完成设计后，使用不同类型的陌生 agent，只提供 SPEC + PLAN 执行 1--2 个任务。
- [ ] 记录该 agent 的停顿问题、错误解读和修订前后关键 diff。
- [ ] 完成对 brainstorming 技能的批判性反思。

