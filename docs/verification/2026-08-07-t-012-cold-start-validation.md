# T-012 冷启动验证

状态：implemented

## 范围

本记录覆盖 T-012 的本地发布门禁和工作流配置，不宣称已完成 Windows 安装、GitHub Release 上传或 Render 部署。

## RED/GREEN

- RED：`pnpm.cmd test --run scripts/test/verify-release.test.ts` 在 `scripts/verify-release.ts` 不存在时加载失败。
- GREEN：同一命令通过，4/4 测试通过。
- `pnpm.cmd typecheck`：exit 0。
- `pnpm.cmd lint`：exit 0。
- `pnpm.cmd build`：exit 0。

## 当前发布门禁

`pnpm.cmd verify:release` 当前返回失败，因为当前环境没有 `Todex-<version>-win-x64.exe` 和 `TODEX_DEMO_URL`。这是预期的 fail-closed 结果，而不是发布通过证据。
