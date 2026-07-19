# T-010: Codex-Style Workbench

Status: ready for plan review
Branch: `feat/t-010-codex-style-workbench`
Authority: T-010 approved design and implementation plan.

Implement only the React/Vite desktop renderer, reusable execution/Inspector/approval components, deterministic Mock fixtures, and tests. Keep renderer isolated from Electron/SQLite/keytar/Node/Harness Core; use T-009 typed preload DTOs only. Do not implement real LLM, shell, patch, filesystem, credentials, multi-session, uploads, settings, demo-web, packaging, or release work. Follow every RED/GREEN step and do not push, PR, or merge.
