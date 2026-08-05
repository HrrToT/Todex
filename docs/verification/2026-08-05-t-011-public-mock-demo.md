# T-011 Public Mock Demo Verification

Status: local configuration and implementation verification completed on
`feat/t-011-public-mock-demo`; deployment is not verified.

## Scope

Task 4 changed only `render.yaml` and documentation. No application source,
package manifest, lockfile, server, UI, or test file was changed.

The configuration is a root-monorepo Render Node web service. Root
`package.json` declares `node >=20` and `pnpm@10.12.1`; no `rootDir` is set
because the configured build and start commands are verified root commands.

```yaml
services:
  - type: web
    name: todex-mock-demo
    runtime: node
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter @todex/demo-web build
    startCommand: pnpm --filter @todex/demo-web start
```

`Get-Content -Raw -Encoding utf8 render.yaml` inspected these exact fields.
No YAML parser test was added because the only existing server-test scope is
outside the allowed Task 4 files.

## Existing Implementation Evidence

| Stage | Commits | Evidence |
| --- | --- | --- |
| Approved design and plan | `88f1dea`, `9813f20` | Restricted fixed-scenario boundary and four-task plan. |
| Task 1 session | `47d7956`, `533539e`, `b218681` | Session implementation, frozen allowlist, and state-gap repair. |
| Task 2 server | `fd38bae`, `721bba4`, `8fe6c6d` | Fixed API, safe static asset serving, and further static-serving hardening. |
| Task 3 workbench | `773adff` | React workbench plus package-local frontend/test dependency declarations and lockfile update. |
| Review follow-ups | `107dae6`, `66f60ae` | Server-generated `approval_isolation` reason/run ID with natural keyboard coverage; latest-session preservation regression. |

The Task 3 specification re-review after `107dae6` is recorded as approved.
No independent code-quality review is recorded for T-011.

## Fresh Commands

| Command | Result |
| --- | --- |
| `pnpm.cmd --filter @todex/demo-web test --run` | Exit 0: 3 files, 28 tests passed. The server suite includes built-root static serving, body-limit, encoded-separator, canonical-containment, and fixture-cleanup coverage. |
| `pnpm.cmd test --run` | Exit 0: 23 files, 439 tests passed. |
| `pnpm.cmd typecheck` | Exit 0. |
| `pnpm.cmd lint` | Exit 0. |
| `pnpm.cmd build` | Exit 0. `apps/demo-web` emitted `dist/index.html`, CSS, and JavaScript production assets. |
| `pnpm.cmd --filter @todex/demo-web start` | Started as the production service from the worktree for the local checks below. |
| `curl.exe -s -o NUL -w "%{http_code} %{content_type}" http://127.0.0.1:3000/` | `200 text/html; charset=utf-8`. |
| `git diff --check` | Exit 0 after the documentation write. |

The first PowerShell `Start-Process` attempt did not start the service because
the current shell environment has duplicate `Path`/`PATH` keys. A noninteractive
`cmd.exe /c start /b` launch ran the same pnpm start command; the HTTP and
browser checks above are the service evidence. This host-shell condition is not
a T-011 application result.

## Browser Evidence

The production service at `http://127.0.0.1:3000/` was inspected in the
in-app browser after the production build.

- At `1440x900`, the browser showed `Mock Demo`, all three fixed scenarios,
  the execution trace, Reset, Run, and the pending approval actions without
  horizontal overflow (`documentWidth: 1440`).
- At `390x844`, the document width was `375` CSS pixels. The initial viewport
  showed the product label, fixed scenario selector, Reset, trace, and Run;
  after one ordinary scroll, `Allow once` and `Deny` were fully inside the
  viewport at horizontal bounds `29..346`. This is single-column scrolling,
  not an overlap claim.
- The active local process held an `approval-isolation` fixture state, which
  exposed the approval panel for the visual check. Keyboard-only select/run/
  approve/reset behavior is covered by the passing `App.spec.tsx` test; the
  browser check confirms the built controls render.

The server test has a Windows `EPERM`/`EACCES` fallback when creating a real
filesystem symlink is unavailable. The passing test proves canonical-containment
coverage; this run does not claim that privileged symlink creation itself was
available.

## Limitations and Release Evidence

`render.yaml` is configuration only. No Render deploy, public URL, deployment
log, pull request, GitHub Actions run, release artifact, or T-011 merge is
claimed by this record.
