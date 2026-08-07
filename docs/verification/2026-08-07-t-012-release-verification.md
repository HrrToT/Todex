# T-012 发布验证

状态：implemented

## 已实现

- `apps/desktop/electron-builder.yml` 固定 unsigned NSIS x64、artifact 名称和安装器选项。
- `.github/workflows/ci.yml` 在 push/PR 上运行 lint、test、typecheck 和 build。
- `.github/workflows/release.yml` 在 `v*` tag 的 Windows runner 上安装依赖、构建桌面端、运行发布门禁并上传 `.exe`。
- `scripts/verify-release.ts` 检查固定 Windows x64 NSIS artifact 和 HTTPS Demo URL，不访问 URL、不执行安装器。

## 未完成的外部证据

- 当前未运行 Windows runner 的真实 installer 构建。
- 当前未创建 GitHub Release artifact。
- 当前未配置或验证 Render 公网 URL。
- 当前未完成适合该环境的 Electron BrowserWindow/安装后生命周期验收；T-009 记录的 `0xC0000005` 环境限制仍然有效。
