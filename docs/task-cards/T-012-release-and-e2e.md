# T-012: 打包、CI、发布文档与端到端验收

状态：complete

## 范围

完成 Windows x64 unsigned NSIS 打包配置、GitHub Actions CI/release 工作流、发布验收脚本、README 分发说明和最终验证证据。公网 Demo 只能使用 T-011 的固定 Mock 场景；真实 Render URL、安装包下载和交互式 Electron 生命周期必须以实际外部证据为准。

## 验收要求

- `verify:release` 只在存在固定命名的 `Todex-<version>-win-x64.exe` 和 HTTPS Demo URL 时通过。
- CI 在 push/PR 上运行 `lint`、`test --run`、`typecheck` 和 `build`。
- tag release 在 Windows runner 构建 unsigned NSIS x64，并上传 `.exe` 到 GitHub Release。
- README 只记录实际运行过的命令、Credential Manager 边界、unsigned/SmartScreen 提示、Demo URL 状态、限制和目录结构。
- 发布/端到端缺失证据必须明确记录为未完成，不能用本地 build 替代真实安装或公网部署。

## 最终证据

- `scripts/test/verify-release.test.ts`：先红后绿，4/4 通过。
- GitHub Release workflow `31562649008` 在 `windows-2022` 完成 install、lint、test、typecheck、build、`package:win` 和 `verify:release`。
- `v0.1.0` / `edd996b78520b06ca6f6c9ee7f03d828efacaa08` 已发布，资产为 `Todex-0.1.0-win-x64.exe` 与 `latest.yml`。
- Render Demo 已上线：`https://todex-mock-demo.onrender.com`；三个固定场景均完成验收。
- 本机安装后的 Electron 生命周期与 BrowserWindow 交互没有在本次发布后重新验收；T-009 的 `0xC0000005` 环境限制仍单独保留。

## 允许修改

`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`apps/desktop/electron-builder.yml`、`apps/desktop/package.json`、`package.json`、`scripts/verify-release.ts`、对应测试、`README.md`、`docs/PLAN.md`、`docs/AGENT_LOG.md` 和 `docs/verification/` 中的 T-012 记录。
