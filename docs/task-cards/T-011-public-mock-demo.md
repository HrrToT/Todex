# T-011: Restricted Public Mock Demo

Status: implementation and local verification completed; PR, CI, Render deployment,
and independent code-quality review are not recorded.

Branch: `feat/t-011-public-mock-demo`

Authority: [approved design](../superpowers/specs/2026-08-01-t-011-public-mock-demo-design.md) (`88f1dea`) and
[implementation plan](../superpowers/plans/2026-08-01-t-011-public-mock-demo.md) (`9813f20`).

## Scope and boundary

T-011 provides only three server-owned, resettable fixture scenarios:
`workspace-escape`, `repair-feedback`, and `approval-isolation`. It must reject
visitor-controlled model settings, credentials, workspace paths, uploads, shell
commands, patches, unknown scenarios, and malformed API requests. The public
server serves only the built demo assets from its fixed `dist` root.

Do not add a real model call, credential field or persistence, file picker,
upload route, arbitrary command/patch endpoint, multi-user session, Electron
behavior, packaging, deployment credential, CI, or release change.

## TDD Requirements

Tasks 1 through 3 require a focused RED test before each implementation and
the matching GREEN run afterward. The required behaviors are fixed scenario
restriction/reset, exact HTTP/static-serving boundaries, and accessible
scenario/run/approval/reset flows. Each test must exercise the real session,
HTTP server, or React component rather than a mock of its own implementation.

Task 4 changes configuration and documents evidence only. Its planned YAML
assertion would require modifying `apps/demo-web/test/server.test.ts`, which is
outside this task's allowed files. No new test was added and no Task 4 RED/GREEN
claim is made. Configuration validation is therefore limited to YAML inspection
and executing the existing package build/start commands.

## Allowed Files

- `render.yaml`
- `docs/verification/2026-08-05-t-011-public-mock-demo.md`
- `docs/task-cards/T-011-public-mock-demo.md`
- `docs/PLAN.md`
- `docs/AGENT_LOG.md`

No application source, package manifest, lockfile, server, UI, or test file may
be changed by Task 4.

## Acceptance

- `render.yaml` declares a Render Node web service with the root-monorepo build
  command `pnpm install --frozen-lockfile && pnpm --filter @todex/demo-web build`
  and start command `pnpm --filter @todex/demo-web start`.
- The current root `package.json` verifies Node `>=20` and the pnpm package
  manager; no `rootDir` is assumed because both configured commands run from
  the monorepo root.
- Existing demo tests, full root tests, typecheck, lint, and build have fresh
  passing evidence; the production service returns the built `/` HTML.
- The production workbench has fresh browser evidence at `1440x900` and
  `390x844`, with the narrow approval controls confirmed after ordinary page
  scrolling.
- The dated verification record states the absence of deployment and review
  evidence rather than inferring either one.

## Actual Delivery Record

Design and plan commits are `88f1dea` and `9813f20`.

| Work | Commits | Factual result |
| --- | --- | --- |
| Task 1: restricted session | `47d7956`, `533539e`, `b218681` | Added the session/test package, then froze the scenario allowlist and closed state gaps. |
| Task 2: fixed API and static serving | `fd38bae`, `721bba4`, `8fe6c6d` | Added exact API routing, then hardened built-asset and canonical static containment. |
| Task 3: React workbench | `773adff` | Added the fixed-scenario React workbench and its declared package/test dependencies. |
| Review follow-ups | `107dae6`, `66f60ae` | Added server-owned approval reason/run identity with natural Tab/Space/Enter coverage, then prevented an older session read from overwriting newer UI state. |
| Task 4: configuration and evidence | `d6b2483`, `a060720` | Added the Render blueprint and dated verification record; the latter commit only corrected plan whitespace. |

The dependency scope expanded during Task 3 because the demo package needed to
declare its own React, React DOM, React type, Testing Library, and jsdom
dependencies; `773adff` also updated the workspace lockfile. Task 4 does not
expand that scope.

The Task 3 specification re-review after `107dae6` is recorded as approved.
There is no recorded independent code-quality review, T-011 pull request,
GitHub Actions run, or Render deployment. See the dated
[verification record](../verification/2026-08-05-t-011-public-mock-demo.md)
for fresh local command and browser evidence.

## Post-8c2a718 Review Verification (2026-08-06)

This follow-up is limited to `apps/demo-web/src/server.ts`,
`apps/demo-web/test/server.test.ts`, and this task card plus the dated
verification record. The cookie-policy P2 is fixed: `createDemoServer` accepts
the narrow `secureCookies?: boolean` option; its default is exactly
`NODE_ENV === "production"`; and no request header, including
`X-Forwarded-Proto`, can change the selection. The cookie remains
`Path=/; HttpOnly; SameSite=Lax`, with `Secure` added only when the server
policy is enabled.

The focused TDD cycle was recorded from the real HTTP server:

- RED: `pnpm.cmd --filter @todex/demo-web test --run server.test.ts` exited 1
  with 20 tests, 19 passed and 1 failed. The failing forged
  `X-Forwarded-Proto: https` case received a cookie ending in `; Secure`.
- GREEN: the same command exited 0 with 1 file and 20 tests passed. It now
  proves both that the untrusted header does not add `Secure` under the
  nonproduction default and that `secureCookies: true` does add it while
  preserving `HttpOnly`, `SameSite=Lax`, and `Path=/`.

The fresh package run was `pnpm.cmd --filter @todex/demo-web test --run`: exit
0, 3 files and 35 tests passed. This includes the terminal deny semantics
(`status: "denied"`, a denied `run-1`, an `approval_denied` trace, no pending
approval, and `dispatcherCalls: 0`), opaque server-issued per-cookie session
isolation across two clients, and bounded session retention. The session tests
advance a controlled clock past a 10 ms TTL and verify expiration, and use a
`maxSessions: 1` store to verify oldest-session eviction; cookie access moves a
live entry to the newest position for the bounded LRU behavior.

The fresh root commands also passed: `pnpm.cmd test --run` exited 0 with 23
files and 446 tests; `pnpm.cmd typecheck` exited 0; `pnpm.cmd lint` exited 0;
and `pnpm.cmd build` exited 0, including the production `apps/demo-web`
bundle. No fresh browser, HTTP service, Render, pull-request, CI, deployment,
or release verification was performed for this follow-up.
