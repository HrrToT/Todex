# T-009: Desktop Persistence and Secure Host

Status: ready for plan review
Responsible model: implementation agent
Lead review: Codex
Branch: `feat/t-009-desktop-persistence`
Base: approved T-009 design and plan commits

## Goal

Implement SQLite persistence, Windows Credential Manager integration, a minimal secure Electron host, and narrow typed IPC without UI, real LLM, or project execution.

## Authority

- `docs/SPEC.md` sections 2-4 and AC-08/AC-09
- `docs/superpowers/specs/2026-07-18-t-009-desktop-persistence-design.md`
- `docs/superpowers/plans/2026-07-18-t-009-desktop-persistence.md`

## Allowed Scope

Only the desktop package, root workspace/typecheck/Vitest integration needed to include it, `pnpm-lock.yaml`, and T-009 completion evidence files named by the plan. Do not modify Harness Core, contracts, examples, CI, demo-web, release packaging, or existing T-001 to T-008 behavior.

## Non-Negotiable Rules

- Use `better-sqlite3 + keytar`; do not silently replace either when native loading fails.
- API keys never enter SQLite, JSON, `.env`, trace, logs, errors, IPC DTOs, or tests beyond in-memory seed values.
- Credential failure is `credential_unavailable` and has no persistence fallback.
- SQLite lives only below injected/Electron userData; never in a selected project workspace.
- Every trace is append-first with unique `(runId, sequence)`; schema versions above the supported maximum fail closed.
- Renderer receives only the frozen typed IPC allowlist; no arbitrary SQL, path, Node, or credential-read API.
- Electron window uses `contextIsolation: true` and `nodeIntegration: false`.
- Follow the plan's RED/GREEN order, commit per task, record actual evidence, and do not push/create a PR/merge main.
