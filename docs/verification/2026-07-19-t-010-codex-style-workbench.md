# T-010 Codex-Style Workbench Verification

Status: implementation verified; review, PR, CI, and merge remain pending.

## Implemented boundary

- The renderer is a React/Vite workbench with a narrow project rail, causal execution stream, bottom task composer, and initially closed Inspector.
- The deterministic `DemoRunController` produces only fixture states. It does not invoke a model, shell, file operation, patch application, credential store, Electron API, SQLite, keytar, Node filesystem API, or Harness Core.
- The Inspector opens for fixture verification feedback and approval. It has keyboard-reachable close and pin controls, and its approval callback receives only `{ approvalId, decision }`.
- `bridge.ts` adapts only the existing lowercase `window.todex.approval.decide` preload surface. The renderer has no Electron, SQLite, keytar, Node filesystem, or Harness Core import.
- A task that contains likely credential markers is represented as `Sensitive task content withheld`; raw values and `credentialRef` text do not enter the visible stream.

## RED/GREEN evidence recorded so far

| Stage | Command | Result |
| --- | --- | --- |
| RED baseline | `pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx` | Failed because `../src/renderer/App.js` did not exist. |
| GREEN baseline | Same command | Passed after the initial renderer implementation. |
| RED safety flow | Same command after secret-redaction test | Failed because `secret-value` and `credentialRef` appeared in the stream and composer. |
| GREEN safety flow | Same command | Passed: 4 tests cover baseline layout, deterministic Diff Inspector, typed approval decision plus composer focus, and sensitive-task suppression. |
| RED Inspector/bridge | Same command after pin and lowercase preload tests | Failed because the Inspector had no pin button and the adapter looked for `window.toDex`. |
| GREEN Inspector/bridge | Same command | Passed: 6 tests cover the typed `window.todex` approval bridge and Inspector pin state in addition to the earlier flows. |

## Verification

| Command | Result |
| --- | --- |
| `pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx` | 6 passed |
| `pnpm.cmd test --run` | 411 passed across 20 test files |
| `pnpm.cmd typecheck` | exit 0 |
| `pnpm.cmd lint` | exit 0 |
| `pnpm.cmd build` | exit 0; Vite renderer bundle generated |
| `git diff --check` | exit 0 |

The initial offline install could not find `jsdom@25.0.1` in the local store. A normal `pnpm install --force --ignore-scripts --node-linker=hoisted` downloaded that one missing tarball and restored the worktree links. The install scripts remained disabled. The Node/Vitest ABI for `better-sqlite3` was then rebuilt before complete Node tests; Electron ABI rebuilding was not run.

The T-009 Electron lifecycle `0xC0000005` limitation remains separate: no Electron BrowserWindow screenshot test is claimed here. The component suite verifies the renderer behavior in jsdom; interactive Electron lifecycle and window visual validation remain deferred to an environment where lifecycle startup is stable.

## Browser rendering evidence

The Vite renderer was served locally and checked in headless Chrome through Playwright. At `1440 x 900`, the rail, execution stream, composer, and compact icon-only Run control were visible without overlap. At `390 x 844`, the rail collapsed to its icon layout and the Inspector opened as a right-side drawer; the composer measured 312 CSS pixels and remained within the viewport. This is renderer-level browser evidence only, not a successful Electron lifecycle claim.
