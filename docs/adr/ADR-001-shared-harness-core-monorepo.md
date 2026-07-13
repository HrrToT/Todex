# ADR-001：共享 Harness Core 的 Monorepo

状态：approved
日期：2026-07-13

## 决定

采用 TypeScript monorepo，以不依赖宿主平台的 `packages/harness-core` 为自研 harness 内核；桌面端和线上演示站均复用该内核。

## 理由

本地 Electron 产品和公网 Mock WebUI 需要展示相同的主循环、工具分发、治理、反馈与 Mock LLM 机制。共享内核避免两套逻辑分叉，并直接支撑“移除真实 LLM 后核心机制仍可被确定性测试”的课程要求。

## 后果

需要明确宿主适配层与核心层之间的接口；但 Node/Python 探测器、Mock 场景和单元测试可独立分派给辅助模型开发。

