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
