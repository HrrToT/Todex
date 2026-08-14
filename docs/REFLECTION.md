# Todex 课程反思报告（由学生本人撰写）

状态：待项目负责人填写

字数要求：中文正文 1500--2500 字。课程明确禁止 AI 代写反思；本文件只提供问题框架、可核查证据入口和提交前检查项。请用第一人称补全每一节的真实经历、判断和改进方案。若使用 AI 进行语言润色，请在文末如实说明其范围。

## 1. 项目目标与个人决策

请说明 Todex 要解决的用户问题、目标用户、你为何选择 Coding Agent Harness 路线，以及你亲自作出的关键产品边界决策。

可引用证据：[产品规约](SPEC.md)、[架构决策](adr/README.md)、[任务计划](PLAN.md)。

## 2. Superpowers 工作流的实际作用

请结合本项目说明 brainstorming、writing-plans、using-git-worktrees、subagent-driven-development、TDD、两阶段 review、finishing-a-development-branch 分别在何处帮助了你。不要只罗列技能名称，要写出一次具体决策如何被改变或澄清。

可引用证据：[规约形成过程](SPEC_PROCESS.md)、[Agent 日志](AGENT_LOG.md)、`docs/superpowers/`。

## 3. 规约和计划质量如何影响实现

请选择至少一个“规约不够清楚或任务边界过宽/过窄”的真实例子，说明 subagent 或实现如何偏离预期、你怎样发现问题、怎样修订 SPEC/PLAN/任务卡，以及修订后的验证结果。

可引用证据：[任务卡目录](task-cards/README.md)、[验证记录](verification/README.md)。

## 4. TDD 与验证纪律

请分析红--绿--重构在 AI 协作下是阻碍还是放大器。结合真实测试，说明哪些测试最有效、哪些测试虽然通过但后来仍被 review 发现不足，以及你如何区分“测试通过”和“功能已验收”。

可引用证据：`packages/harness-core/test/`、`apps/desktop/test/`、[CI 工作流](../.github/workflows/ci.yml)。

## 5. Subagent 协作、任务粒度与审查

请说明什么样的任务粒度最适合独立 subagent，哪些任务必须由你本人做架构选择或最终审查；至少写一个审查发现 P1/P2 问题并返工的实例。说明你如何避免把 agent 输出未经判断直接提交。

可引用证据：[Agent 日志](AGENT_LOG.md)、提交历史、PR 讨论与验证记录。

## 6. 安全、凭据与治理边界

请说明 API Key 为什么不能进入 Git、SQLite、trace、日志或 Renderer；介绍 Windows Credential Manager、主进程边界、Guardrail、审批与受控命令在本项目中的取舍。还应诚实说明尚未完成的人工真实模型验收边界。

可引用证据：[安全规约](SPEC.md)、[T-013 任务卡](task-cards/T-013-real-agent-and-chinese-localization.md)、[T-013 验证记录](verification/2026-08-12-t-013-real-agent-and-localization.md)。

## 7. 分发、CI 与证据治理

请说明 Render Mock Demo、GitHub Actions、Windows Electron 发布分别证明了什么，又没有证明什么。解释为什么公开 Demo 保持 Mock-only，以及为什么安装包、CI 和一次真实人工交互验收不能互相替代。

可引用证据：[README](../README.md)、[v0.1.2 Release](https://github.com/HrrToT/Todex/releases/tag/v0.1.2)、[发布验证](verification/)。

## 8. 对 Agentic SE 方法论的批判与下一步

请评价 Superpowers 方法论在本项目中的假设、局限和适用条件：哪些流程容易形式化，哪些仍需要工程师承担判断责任；若重新开始，你会如何调整任务拆分、上下文提供、测试、审查或人工验收。

## 提交前自检

- [ ] 正文由学生本人完成，中文正文在 1500--2500 字范围内。
- [ ] 八个问题均以本项目的真实经历回答，至少引用三个可核查仓库证据。
- [ ] 明确写出 AI 参与的实际范围；如做过 AI 润色，已在文末标注。
- [ ] 不包含 API Key、个人绝对路径、真实用户仓库内容或其他敏感信息。
- [ ] 不把 CI、打包、Mock Demo 或静态检查误写成未发生的真实模型/人工验收。

## AI 润色声明（如适用）

请由学生本人填写：

> 本反思正文由我独立撰写。AI 仅在以下范围参与：________。我已核对并对全部内容负责。
