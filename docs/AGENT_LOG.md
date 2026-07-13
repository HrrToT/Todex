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
| 2026-07-13Ttime-not-captured+08:00 | S-006 用户体验规约 | `superpowers:brainstorming` | 将 Harness 内核转化为用户故事、模块 I/O 和工作台 UI 结构。 | 确认 US-01 至 US-07、八个功能模块、桌面端/Demo 权限差异和 Open Design 使用计划。 | 项目负责人确认完整用户故事和 UI 信息架构。 | 产品规约必须说明用户能完成什么，不应只描述内部 Agent 机制。 |
| 2026-07-13Ttime-not-captured+08:00 | S-007 安全与验收规约 | `superpowers:brainstorming` | 定义资产、威胁、非功能指标、Mock 机制验收、安装包和 Demo 验收。 | 确认 AC-01 至 AC-12、工作区级安全边界、Windows 10/11 x64 目标和未签名安装包策略。 | 项目负责人确认未签名安装包的透明分发策略。 | 安全边界、性能目标和“完成”的证据必须在实现前被写成可验证条件。 |
| 2026-07-13T17:03:37+08:00 | S-008 SPEC 自审 | `superpowers:brainstorming` | 对照课程 SPEC 清单检查章节、技术理由、凭据、分发、数据模型和过程证据。 | 补齐组件数据流、显式技术选型、Credential Manager 生命周期、Windows/Render 分发部署和主数据模型摘要。 | 无新增产品范围；项目负责人此前已确认这些架构方向。 | 最终 SPEC 不应仅靠散落段落暗示关键选型，必须有便于陌生 agent 和评阅者定位的显式章节。 |
| 2026-07-13Ttime-not-captured+08:00 | S-009 规约签字 | `superpowers:brainstorming` | 汇总全量 V1.0 设计，请项目负责人做最终签字确认。 | 项目负责人确认完整 Todex V1.0 设计；SPEC 状态转为 `approved`。 | 项目负责人授权进入 `writing-plans` 与后续冷启动验证，但尚未授权实现代码。 | 分段确认能收敛设计，最终签字让 PLAN 有稳定基线。 |
| 2026-07-13Ttime-not-captured+08:00 | V-001 冷启动 Round 1 | GLM 独立会话 | 仅给 SPEC/PLAN，要求尝试 T-001/T-002，遇歧义暂停。 | GLM 报告 CS-01 lint/pnpm/lockfile/CI 缺失与 CS-02 contracts 字段外置；无代码、无 commit。 | 项目负责人坚持不允许通过额外架构文档或口头猜测绕过缺陷。 | 冷启动的价值在于发现主导 agent 因共享上下文遗漏的实现前提。 |
| 2026-07-13Ttime-not-captured+08:00 | V-002 冷启动修订 | `superpowers:receiving-code-review` | 核验 GLM 的五项主张，按阻塞优先级更新权威 SPEC/PLAN。 | 冻结 ESLint、pnpm、Zod、安装/lockfile/CI 流程；内联 T-002 全部字段协议；新增 Round 1 验证证据。 | 不让 GLM 在有歧义时继续实现；要求新会话重新验证。 | 对冷启动问题的正确反应是修订规约并重新测试，而不是追加口头解释。 |
| 2026-07-13T19:08:46+08:00 | V-003 冷启动 Round 2 与 PR | GLM 独立会话、`receiving-code-review`、`finishing-a-development-branch` | 仅给更新后的 SPEC/PLAN 重试 T-001/T-002；人工审查其 P1 后选择推送分支并创建 PR。 | `d803fa2`、`a87325e`、`a04ad9f`；[PR #1](https://github.com/HrrToT/Todex/pull/1)；全仓 38 测试、typecheck、lint、build 通过。 | 冷启动分支未使用正式 worktree，作为规约验证偏离透明记录；后续任务强制 worktree + PR。 | 规约修订后重新冷启动，比主导 agent 自己宣称“已清楚”更能提供客观质量证据。 |
| 2026-07-13T23:45:55+08:00 | T-003 最小 Agent 主循环 | GLM 实现；Codex `receiving-code-review`、独立复验 | 在 `D:\Todex\.worktrees\t-003-agent-loop` 的 `feat/t-003-agent-loop` 分支中，按任务卡实现 Scripted Mock LLM、TraceStore 与 AgentRunner；复审只接受 `parseAction` 后调度、确定性停止与无真实运行时依赖。 | `03e9ac5` 实现；`f57dad1` 修复 P1。独立运行 Harness 17/17、全仓 54/54、typecheck、lint 均通过；验证记录 `verification/2026-07-13-t-003-agent-loop.md`。 | 主导审查要求修复 previousResults 快照泄漏，并将 maxSteps、脚本耗尽和 Dispatcher 异常从“存在事件”提升为精确 trace/副作用断言；保留 P2 重用/深度不可变性建议。 | 辅助模型的交付报告必须以本地复跑和 diff 审查为准；trace 类程序的测试应断言完整事件序列及外部副作用，而不只检查某事件是否出现。 |
