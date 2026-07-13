# Todex 文档规约

状态：approved
最后更新：2026-07-13

## 1. 目的与范围

本目录是 Todex 的课程交付文档中心。`SPEC.md`、`PLAN.md`、`SPEC_PROCESS.md`、`AGENT_LOG.md` 和 `REFLECTION.md` 的权威版本均放在本目录。`README.md` 是例外：它的权威版本位于仓库根目录，作为 GitHub 仓库首页与使用者入口。

仓库根目录还保留与课程交付物同名的 Markdown 入口文件。它们只链接到本目录的权威正文，不复制内容；这样既保持单一事实来源，也让助教能从仓库根目录直接定位交付物。

## 2. 事实来源

| 文档 | 是什么的唯一事实来源 | 不应承担的内容 |
| --- | --- | --- |
| `SPEC.md` | 产品边界、行为、架构、风险和验收标准 | 逐任务执行记录 |
| `PLAN.md` | 可执行任务、依赖、验证步骤和完成状态 | 架构决策的完整论证 |
| `SPEC_PROCESS.md` | brainstorming 与冷启动验证的过程和规约修订 | 日常开发流水账 |
| `AGENT_LOG.md` | 按时间追加的技能、模型协作、审查和人工干预证据 | 事后重写的设计说明 |
| 根目录 `README.md` | 使用者可验证的安装、运行、分发和安全说明 | 未实现的命令或猜测性承诺 |
| `REFLECTION.md` | 学生本人的期末反思 | AI 代写内容 |
| `adr/` | 重大且难逆转技术决策的原因与后果 | 小型实现细节 |
| `task-cards/` | 单个辅助模型任务的范围、TDD 要求和验收标准 | 修改主规约的权限 |
| `verification/` | 冷启动、测试、审查、构建、发布和部署的可复查证据 | 设计原文的重复 |

## 3. 文档状态与命名

普通扩展文档在标题下声明以下状态之一：`draft`、`proposed`、`approved`、`implemented`、`verified`、`superseded`。

- 架构决策使用 `ADR-NNN-short-kebab-case.md`。
- 辅助模型任务卡使用 `T-NNN-short-kebab-case.md`。
- 验证记录使用 `YYYY-MM-DD-short-kebab-case.md`。
- 文档引用任务、ADR、PR、commit 或测试命令时，使用可检索的精确编号或 hash。

## 4. 安全与可追溯性

- 任何 Markdown、截图、测试输出和日志都不得包含真实 API Key、密码、token、私有 URL、用户目录中的敏感信息或凭据管理器内容。
- `AGENT_LOG.md` 只追加，不删除失败记录；需要更正时新增一条勘误。
- 需求、接口或安全边界的重大变更必须先更新 `SPEC.md`，必要时新增 ADR，再进入实现任务。
- 每张任务卡必须在完成后补充实际分支、PR、commit、验收命令和审查结论。

## 5. 周期性更新规则

| 触发事件 | 必须更新的文档 |
| --- | --- |
| 完成关键 brainstorming 决策 | `SPEC_PROCESS.md`、`SPEC.md`，必要时 ADR |
| 决定新的长期架构或安全取舍 | `SPEC.md`、新的 ADR |
| 生成或调整实现任务 | `PLAN.md`、相应任务卡 |
| 派发或验收一个辅助模型任务 | `AGENT_LOG.md`、任务卡、`PLAN.md` |
| 运行冷启动、单测、审查、构建或部署 | `verification/`、`AGENT_LOG.md`，必要时 `PLAN.md` |
| 新增可真实运行的命令或发布方式 | `README.md` |
| 期末复盘 | `REFLECTION.md`，由学生本人撰写 |

## 6. CI 平台决定

Todex 的实际 CI/CD 平台是 GitHub Actions，配置放在 `.github/workflows/`。本项目不建立 GitLab 项目，也不维护 GitLab pipeline；所有 CI 证据以 GitHub Actions 的 push、PR 和 Release 工作流为准。
