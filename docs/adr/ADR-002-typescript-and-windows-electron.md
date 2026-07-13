# ADR-002：TypeScript 全栈与 Windows Electron

状态：approved
日期：2026-07-13

## 决定

使用 TypeScript 作为 Todex 的实现语言；使用 React/Vite 构建 WebUI，Electron 生成 Windows 桌面安装包。

## 理由

统一语言和 npm 工具链可以共享前后端类型、简化 Mock LLM 与测试开发，并使 Electron 打包、GitHub Actions 和辅助模型分工更直接。Windows 是正式分发目标，桌面端负责本地工作区与 Windows Credential Manager 集成。

## 后果

V1 不承诺 macOS 或 Linux 安装包；跨平台支持可在后续版本通过宿主适配层扩展。

