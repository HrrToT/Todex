# T-014: Live Desktop Agent Release and Acceptance

Status: in_progress

Authoritative plan: [`2026-08-14-t-014-live-agent-release.md`](../superpowers/plans/2026-08-14-t-014-live-agent-release.md)

## Objective

Close the remaining release boundary for Todex as a real Windows Coding Agent: an installed Electron build must visibly enter the governed live workbench, support a user-selected non-sensitive Node/Python workspace and a real OpenAI-compatible model configuration, protect credentials, require command approval, and produce evidence from an actual controlled run.

## Hard Boundaries

- The public Render application remains fixed-scenario Mock-only. It must not accept API keys, arbitrary workspaces, arbitrary patches, model URLs, file upload, or command execution.
- A desktop Electron renderer without `window.todex.run` must never silently render the Demo workbench. It may show only a fixed diagnostic state.
- API keys stay in the password input only until the main-process `credential.save` call. They must not enter SQLite, trace, logs, docs, tests, project exports, Renderer query data, commits, or release artifacts.
- Local filesystem access, model HTTP requests, and child-process execution remain main-process capabilities. All commands remain user-confirmed and approval-gated.
- Manual acceptance uses a temporary non-sensitive fixture. It must not disclose user paths, code, provider URL, model output, key, or raw trace.

## Allowed Files

- `apps/desktop/**`
- `scripts/verify-desktop-package.ts`
- `scripts/test/verify-desktop-package.test.ts`
- `package.json`
- `README.md`
- `docs/PLAN.md`
- `docs/AGENT_LOG.md`
- `docs/task-cards/T-014-live-agent-release.md`
- `docs/verification/2026-08-14-t-014-live-agent-release.md`
- `docs/superpowers/plans/2026-08-14-t-014-live-agent-release.md`

No other package, contract, harness, public Demo, CI workflow, dependency range, or course-requirement file may change without an explicitly recorded review decision.

## Controlled Exception

- The root development dependency `@electron/asar@3.4.1` may be added for the release-package verifier. It is already lockfile-resolved through the Electron packaging toolchain, is used only by `scripts/verify-desktop-package.ts` and its temporary-archive tests, and is not shipped as an Electron runtime capability.

## Acceptance Criteria

1. A browser/test environment without preload retains the deterministic Demo surface.
2. An Electron user agent without the required `run` preload bridge renders `desktop_bridge_unavailable`, not Demo content.
3. The release package verifier confirms the exact main/preload/renderer files needed for the live workbench, without reading application data or any credential.
4. The installed candidate shows the live setup surface rather than `calculator-lab` Demo content.
5. A temporary Node/Python fixture completes the observed chain: workspace selection, model setup, one safe patch, pending configured-command approval with zero pre-approval dispatch, one approved command, verification, and terminal result.
6. The manual evidence contains no key, URL, absolute path, raw fixture content, model response, or raw trace payload.
7. `test`, `typecheck`, `lint`, `build`, `git diff --check`, package verification, PR CI, merge and release facts are reported separately. The known Node 24 SQLite ABI limitation remains explicit if present.

## Required Delivery Record

On completion add: RED/GREEN commands, exact package checks, manual acceptance facts, remaining limitations, commit IDs, PR URL, CI run, merge commit, tag/release URL, and installer version. Do not mark this card complete from source, test, static archive, or process evidence alone.
