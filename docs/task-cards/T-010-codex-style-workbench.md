# T-010: Codex-Style Workbench

Status: in progress
Branch: `feat/t-010-codex-style-workbench`
Authority: T-010 approved design and implementation plan.

Implement only the React/Vite desktop renderer, reusable execution/Inspector/approval components, deterministic Mock fixtures, and tests. Keep renderer isolated from Electron/SQLite/keytar/Node/Harness Core; use T-009 typed preload DTOs only. Do not implement real LLM, shell, patch, filesystem, credentials, multi-session, uploads, settings, demo-web, packaging, or release work. Follow every RED/GREEN step and do not push, PR, or merge.

Current evidence: the renderer baseline RED test failed because `App` was absent. Follow-up RED tests caught sensitive task-content echoing, a missing Inspector pin control, and a `window.toDex` typo that would bypass the lowercase `window.todex` preload surface. The focused renderer suite now covers the rail, idle state, collapsed Inspector trigger, composer, deterministic verification failure, typed approval payload, lower-case preload adaptation, Inspector pin state, focus return, and sensitive task-content suppression. Full-repository verification and review are next.
