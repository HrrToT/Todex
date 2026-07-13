# 冷启动验证记录：Round 2

状态：passed with one review fix
日期：2026-07-13
验证智能体：GLM（全新会话，与主导 agent 类型不同）
允许材料：仅最新 `docs/SPEC.md` 和 `docs/PLAN.md`。
分支：`cold-start/T-001-T-002`
Pull Request：[PR #1](https://github.com/HrrToT/Todex/pull/1)

## 指派范围

独立执行 T-001 和 T-002，严格遵循红--绿--重构；不得读取 `docs/architecture/` 或使用此前冷启动会话上下文。

## 结果

- T-001 完成：commit `d803fa2a5ecb06e5e159c153663f04e9ca1ca30a`。
- T-002 完成：commit `a87325e562527a939780f910316f3db7d2a22dcb`。
- 红色证据：T-001 缺失 `HARNESS_VERSION` 时 smoke test 失败；T-002 缺失 contracts 时 31 个 schema 测试失败。
- 绿色证据：T-001/T-002 完成后全仓 35 个测试、typecheck 和 lint 通过。
- 人工代码审查发现 MemoryEntry 的 P1：原实现错误要求所有记忆均带 trace；GLM 在 commit `a04ad9f1abc5bec8840cdcfd02c003f2d9ffbeb8` 修复为仅 `agent_observed` 必须带 trace。
- 修复后人工复验：contracts 37 个测试通过；全仓 38 个测试通过；`pnpm.cmd typecheck`、`pnpm.cmd lint`、`pnpm.cmd build` 均通过。

## 冷启动结论

Round 1 暴露并促成修订的 CS-01（lint/pnpm/lockfile）与 CS-02（协议字段外置）在本轮不再阻塞实现。GLM 能仅凭更新后的 SPEC/PLAN 完成 T-001/T-002，说明规约的可执行性显著提升。

## 过程偏离

本冷启动分支直接在本地普通 Git 分支中完成，未通过正式 `git worktree` 创建。它属于课程要求的规约验证，而非后续常规开发任务；该偏离已在 AGENT_LOG 和 PR 描述中透明记录。后续 T-003 起必须使用独立 worktree 与对应 PR。

