# Todex 课程反思报告

## 1. 项目目标与个人决策

Todex 要解决的问题，是让编码 Agent 在真实项目中能够“做事”，同时让每一个动作都处在可解释、可限制、可回放的工程边界内。目标用户是希望使用 AI 辅助维护 Node.js 或 Python 项目的开发者，尤其是需要审批、证据和失败恢复能力的个人开发者或小团队。我选择 Coding Agent Harness，是因为它迫使我把“模型很聪明”与“系统可靠”分开：模型只负责提出下一步动作，工具、权限、反馈、记忆、停止和审计都必须由我设计的代码负责。

项目中最重要的产品边界是 Render 公共 Demo 永远 Mock-only，不接收访客 API Key、本地路径、任意命令或任意补丁；真实 Agent 放在 Electron 桌面端，只处理用户主动选择的本地工作区。另一个关键决策是 API Key 不经过 Renderer 可读取的持久化接口，而由 Main Process 写入 Windows Credential Manager。后来 review 发现并修正了 Renderer 异步选择的竞态：旧项目、旧模型和旧保存请求的结果不能覆盖用户当前选择。这些决策使产品从“能演示”变成“有治理边界的可用 Agent”。

## 2. Superpowers 工作流的实际作用

brainstorming 帮我把最初的“做一个类似 Codex 的工具”收敛为 harness 内核、桌面真实 Agent 和 Mock Demo 三个边界。writing-plans 将风险拆成 T-001 到 T-013 的任务卡，使主循环、治理、文件工具、反馈、项目检测、演示和桌面端可以分别验证。using-git-worktrees 让不同任务在隔离目录中完成，避免辅助 Agent 直接污染主分支。subagent-driven-development 适合执行边界清晰的任务，例如 T-003 的确定性 Agent loop、T-004 的 Guardrail 和 T-006 的 verification runner；架构取舍、任务卡、合并和最终判断仍由我负责。

TDD 是整个流程中最有价值的约束。每次返工都先用一个能准确复现问题的测试建立 RED，再实现最小修复，最后跑聚焦测试和全仓检查。两阶段 review 也改变了我的工作方式：我不再把“测试全绿”当作“行为已验收”，而是继续检查快照引用、异常分支、跨 Run 隔离、错误信息脱敏和文档事实。finishing-a-development-branch 则把“代码完成”和“是否应合并、是否需要 PR、是否仍缺人工证据”分开。

## 3. 规约和计划质量如何影响实现

一个典型例子是记忆证据边界。早期实现允许 `remember` 依据任意 trace ID 写入记忆，测试虽然通过，但 review 指出模型可以伪造、跨 Run 或重复引用证据。之后我把 TraceStore 注入 Dispatcher，只允许当前 Run 中存在的 `tool_completed` 或 `verification_completed` 事件，并拒绝混合、伪造、跨 Run 和重复 ID。对应测试证明拒绝时仓库不写入，真实事实型事件仍可跨后续 Run 复用。

另一个例子是 T-006 的验证反馈。最初只表达了“失败后修复”，没有把最大修复次数、环境错误、取消、反馈快照和异常收敛写得足够精确。实现后 review 补出了 registry 再验证、CommandRunner 抛异常、Unix 路径脱敏和 `failed_repair_limit`/`failed_environment` 状态等缺口。通过把这些边界补进任务卡和测试，最终形成了初始补丁加三次修复、环境故障不消耗修复次数、反馈不被后续轮次 mutation 污染的可验证行为。规约越接近状态、输入、输出和禁止条件，subagent 的自由解释空间就越小。

## 4. TDD 与验证纪律

在 AI 协作中，TDD 不是单纯的开发负担，而是放大器。比如 `previousResults` 的浅拷贝问题，功能测试并不能立即暴露历史上下文被后续 mutation 改写；新增“运行结束后检查第一轮和第二轮 context”的测试先红，再用快照修复，才证明每轮 LLM 看到的是当时的输入。类似地，dispatcher 抛异常、审批过期、PowerShell 编码别名、Windows 敏感路径大小写等问题，都是先由反例测试固定下来。

我也看到测试通过的局限：早期 maxSteps 和脚本耗尽测试只用 `some(run_failed)`，没有验证完整 trace 序列和 dispatcher 次数；review 后才补成严格序列断言。另一个边界是本机 Node 24 与 Electron 原生 `better-sqlite3` ABI 不匹配，导致 18 个 SQLite 相关测试在行为执行前失败。这个结果不能包装成全仓绿色；GitHub Actions 的 Node 20 CI 才提供了 hosted gate。由此我区分了测试通过、源码构建通过、CI 通过、安装包可启动和真实人工验收，它们分别需要不同证据。

## 5. Subagent 协作、任务粒度与审查

最适合独立 subagent 的任务，是一个清楚的输入输出边界、允许修改文件有限、可以用确定性测试验收的模块。例如 T-003 AgentRunner、T-005 文件工具与记忆、T-006 verification/repair loop 都能通过任务卡交给独立工作树完成。涉及产品边界、凭据威胁模型、公共 Demo 是否 Mock-only、真实 Agent 是否允许哪些能力，以及最终 PR 合并的任务，必须由我本人作判断。

我不会直接提交 subagent 的结果，而是要求它提供红绿证据、完整提交、修改文件和假设，再进行规范审查与代码安全审查。审查发现的 P1/P2 返工包括 `previousResults` 可变引用、审批 store 放宽 command prefix、Shell PowerShell 路径绕过、验证反馈快照 mutation，以及 T-013 的旧异步保存结果覆盖当前模型。修复过程都保留了失败测试和成功验证。这个流程的代价是提交数量和文档工作增加，但它使每次修改都有原因、边界和回归证据。

## 6. 安全、凭据与治理边界

API Key 不能进入 Git、SQLite、trace、日志或 Renderer，因为这些位置都可能被提交、导出、调试工具或其他窗口读取。Todex 让 Renderer 只暂时持有密码输入值，保存前清空；Main Process 通过严格的 `credential.save` IPC 调用 Windows Credential Manager，并只返回配置状态，不返回 Key 或 opaque credential reference。读取状态只返回是否已配置，清除操作失败时保持一致状态并显示固定的中英文提示，底层错误详情不回显。

Harness 的治理顺序是动作解析、工作区边界、敏感路径与命令分类、审批策略、再到 Dispatcher。越界路径、凭据文件、复杂或危险 Shell 被硬拒绝；普通读文件和受控补丁可以自动执行；需要外部命令的固定配置命令必须经过人工批准。审批按 Run 隔离，trace 记录请求、决定、工具结果和终止状态，便于解释“为什么执行或为什么拒绝”。目前仍未完成真实外部模型和安装版本地仓库的人工验收，因此我不会把 Mock、CI 或打包证据写成真实 Agent 已被验证。

## 7. 分发、CI 与证据治理

Render Demo 证明的是公网 WebUI 可访问，并能重复展示工作区越界、修复反馈和审批隔离三种固定机制；它不证明访客可以运行真实 Agent。保持 Mock-only 是为了防止公开服务接触 Key、任意文件、Shell、Patch 或用户代码。GitHub Actions 证明提交在托管环境中通过了 CI；`.gitlab-ci.yml` 的 `unit-test` job 是课程兼容层，不替代 GitHub Actions。Windows Electron Release 证明目标平台的构建、安装包和启动路径可交付，但不自动证明用户在安装窗口中完成了真实任务。

本次最终收口 PR #22 已合并，GitHub Actions run `31785166883` 通过，合并提交为 `dfcaf5d`。我在证据文档中保留了本机 SQLite ABI 限制、Node 20 action runtime 警告和仍待人工验收的事项。这样的记录比把所有检查写成“全绿”更可信，也让助教能区分可复现的自动证据和尚未发生的人工作业。

## 8. 对 Agentic SE 方法论的批判与下一步

Superpowers 最适合约束可重复的工程动作：先澄清问题、写规约和计划、隔离工作树、TDD、review、再合并。它不能替工程师决定产品边界，也不能替人判断一个安全策略是否符合真实风险。流程容易形式化，判断责任却不能外包；如果任务卡写得含糊，subagent 可能生成看似合理但不可验收的实现；如果 review 只看测试数量，也会漏掉快照 mutation、错误泄露和跨 Run 污染。

如果重新开始，我会更早建立“已实现、已测试、已推送、已通过 CI、已安装、已真实人工验收”的证据矩阵，并在 T-013 开始前固定 Windows 原生依赖的 Node/Electron ABI 方案。我也会把审批恢复、错误脱敏和异步 generation 作为一开始的验收条件，而不是等 review 发现后补强。下一步不是继续堆功能，而是由我完成反思的事实核对，并用不含敏感信息的 Node/Python 仓库和真实 OpenAI-compatible 配置完成受控人工验收，再把结果追加到 verification 文档。



