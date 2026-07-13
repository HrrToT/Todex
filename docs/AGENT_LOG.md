# Todex Agent 开发日志

状态：active
最后更新：2026-07-13

本日志按时间顺序追加。每条记录包含稳定阶段/任务编号、技能、关键 prompt 或上下文、辅助模型输出或 commit、项目负责人的介入和可复用的教训。早期 brainstorming 对话没有保留精确时分秒，历史记录如实标注 `time-not-captured`；从本次格式修订起，新记录必须使用 ISO 8601 时间戳。

| 时间戳 | 阶段 / 任务 | 触发技能 / 协作 | 关键 prompt / context | 输出、commit 或证据 | 人工介入 | 学到的教训 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-13Ttime-not-captured+08:00 | S-001 规约方向 | `superpowers:brainstorming` | 以“真实开发者导向的小仓库 coding agent”为方向，要求先澄清目标、用户、边界与测试。 | 确定自动探测加交互确认、Node.js/Python 双完整支持、OpenAI-compatible 接口、Windows Credential Manager、项目级轻量记忆和限次自修复。 | 项目负责人选择真实开发者导向，而非纯机制演示。 | 先区分“真实产品体验”和“课程可重复测试”，能避免后续架构混乱。 |
| 2026-07-13Ttime-not-captured+08:00 | S-002 产品宿主 | `superpowers:brainstorming` | 围绕 WebUI、Electron、真实本地仓库和线上访问要求收束。 | 确定 Electron 为本地真实产品，公网 WebUI 为内置示例和 Mock LLM 的受限演示宿主。 | 项目负责人要求最终必须能双击安装运行，并确认线上站不得触及本地仓库或真实 Key。 | 同一 Harness Core 可以被多个宿主复用，但宿主权限必须不同。 |
| 2026-07-13Ttime-not-captured+08:00 | S-003 架构与路线 | `superpowers:brainstorming` | 评估单体 Electron、共享核心 monorepo、服务端中心化三种路径。 | 确定 TypeScript monorepo、共享 `harness-core`、V1.0/V1.1/V1.2/V2.0 路线图；相关提交 `3b98a78`。 | 项目负责人选择共享核心方案，并把运行时多模型协作推迟到 V1.2。 | 开发阶段可使用多模型，但交付产品的运行时不必立刻变成多 agent。 |
| 2026-07-13Ttime-not-captured+08:00 | S-004 治理机制 | `superpowers:brainstorming` | 要求核心机制由确定性代码而非提示词实现，并采用类似 Codex 的审批体验。 | 确定工作区边界、敏感文件拒绝、三级风险分类、四种审批作用域、7 天前缀许可、HITL 状态机和 Mock/Fake Runner 测试；提交 `d2aa1be`。 | 项目负责人确认治理与 HITL 是主要深入机制。 | 审批“前缀”必须绑定规范化动作指纹，不能使用字符串前缀。 |
| 2026-07-13Ttime-not-captured+08:00 | S-005 反馈与记忆 | `superpowers:brainstorming` | 将测试失败作为客观传感器，并要求记忆可解释、可删除、无凭据泄露。 | 确定固定 `commandId`、3 次修复上限、失败分类、带 trace 证据的轻量记忆、SQLite 与 Credential Manager 数据边界；提交 `6cfd5b6`。 | 项目负责人确认 Node.js/Python 都进入 V1.0 完整支持范围。 | 只有带工具证据的 Agent 观察才可跨会话保存。 |
| 2026-07-13Ttime-not-captured+08:00 | D-001 文档与仓库 | Git / GitHub CLI | 初始化课程文档、建立公开仓库、保存过程证据。 | 初始化 `main`，创建公开仓库 `HrrToT/Todex`，提交 `6d29c62`、`d00ea57`。 | 项目负责人要求 README 留在根目录，其余权威过程文档集中在 `docs/`。 | 文档入口可在根目录，正文保持单一事实来源。 |
| 2026-07-13T16:48:54+08:00 | D-002 合规格式修订 | 文档审查 + 项目负责人指令 | 重新对照通用要求和项目 A，补齐日志字段、过程证据和根目录入口。 | 本次修订及后续 commit 将记录在 Git 历史；审查结论在当前对话中留痕。 | 项目负责人决定忽略 GitLab 配置要求，以 GitHub Actions 为唯一实际 CI。 | 对课程文本中的冲突或有意偏离，应明确记入过程文档，而不是隐式忽略。 |
