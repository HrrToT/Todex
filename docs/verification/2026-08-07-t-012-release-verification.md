# T-012 Release Verification

Status: complete for the public Mock Demo and unsigned Windows release evidence.

## Release evidence

- Final main and tag commit: `edd996b78520b06ca6f6c9ee7f03d828efacaa08`.
- GitHub Release: https://github.com/HrrToT/Todex/releases/tag/v0.1.0
- Successful release workflow: https://github.com/HrrToT/Todex/actions/runs/31562649008
- The `windows-installer` job completed install, lint, test, typecheck, build,
  `package:win`, `verify:release`, and GitHub Release upload on `windows-2022`.

## Published assets

- `Todex-0.1.0-win-x64.exe`, 98,874,106 bytes:
  https://github.com/HrrToT/Todex/releases/download/v0.1.0/Todex-0.1.0-win-x64.exe
- `latest.yml`:
  https://github.com/HrrToT/Todex/releases/download/v0.1.0/latest.yml
- The published metadata declares `path: Todex-0.1.0-win-x64.exe` and a
  SHA-512 for that installer. This satisfies the release verifier's installer
  and update-metadata checks.

## Public Demo evidence

The Render deployment is live at https://todex-mock-demo.onrender.com. The
repository variable `TODEX_DEMO_URL` was set to that HTTPS URL for the release
workflow. The fixed public scenarios were exercised:

- `workspace-escape` is denied.
- `repair-feedback` progresses from `test_failure` to `passed`.
- `approval-isolation` pauses before execution and completes only after
  `Allow once`.

## Release repair history

PR #11 established the release path. The final release required four focused
repairs: PR #12 pinned the runner to `windows-2022` for node-gyp; PR #13 moved
Electron to desktop development dependencies; PR #14 used a lockfile-managed
`electron-builder`; and PR #15 generated and uploaded `latest.yml`.

## Remaining verification boundary

This record does not claim a fresh local post-install Electron lifecycle or
BrowserWindow interaction test. The pre-existing T-009 environment issue
(`0xC0000005` during Electron lifecycle/shutdown) remains recorded separately.
The successful hosted GitHub Windows workflow is the release-build evidence;
it is not evidence that the local native-module lifecycle limitation disappeared.

## v0.1.1 Renderer white-screen repair (pending publication)

The installed `v0.1.0` window was observed as a white page. Root-cause
inspection found that `createDesktopWindow()` loaded the literal empty page
`data:text/html,<main></main>` rather than the packaged React entry.

RED: the new desktop test expected a `file:` URL ending in
`renderer/index.html`; it received the empty `data:` URL. GREEN: the main
process loads the packaged renderer document and Vite emits `./assets/...`
references suitable for that `file:` document. Focused desktop tests passed
10/10 and `pnpm --filter @todex/desktop build` generated the expected HTML.

The local `0.1.1` NSIS package passed `verify:release` against the HTTPS Demo
URL. The non-installed `release/win-unpacked/Todex.exe` was launched with a
temporary user-data directory; the user confirmed the workbench rendered
instead of a white page. This is not yet GitHub Release evidence: publication
waits for the patch PR and its clean Windows Node 20 CI run.

The local root suite had 440 passing tests and 17 failures caused only by a
known native ABI mismatch: the locally rebuilt `better-sqlite3` uses Electron
ABI 135, while the available Node 24 process requires ABI 137. Typecheck,
lint, recursive build, and `git diff --check` passed. The hosted release
workflow remains the required complete-native test and package authority.
