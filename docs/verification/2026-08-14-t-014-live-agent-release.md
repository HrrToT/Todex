# T-014 Live Agent Release Candidate Verification

**Status:** `release_published_manual_acceptance_pending`

## Candidate

- Branch: `codex/t-014-live-agent-release`
- Candidate version: `0.1.4`
- Candidate head: `30db539ab241a7551e1e84e8c988a7d64d654db0`
- Candidate commits: `06488c9`, `e5cd852`, `57b1753`, `89dff45`, `30db539`

The candidate makes the Electron renderer fail closed when the live preload run
bridge is absent, loads the sandbox preload as CommonJS, and checks the built
archive rather than assuming that a successful source build contains the live
desktop surface. The package verifier checks: `main-preload`,
`main-run-service`, `renderer-document`, `renderer-live-workbench`, and
`preload-run-bridge`.

## Automatic Evidence

The following commands were re-run locally against this candidate:

```powershell
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd demo:mechanisms
pnpm.cmd --filter @todex/desktop smoke:preload
pnpm.cmd verify:desktop-package
```

All six commands exited successfully. The mechanism command reported all three
required scenarios as passed: `workspace-escape`, `repair-feedback`, and
`approval-isolation`. `verify:desktop-package` reported all five named checks
as passed.

`smoke:preload` completed successfully and proves that the packaged CommonJS
preload can load under Electron. Host cache, GPU, and OS credential-cache
warnings were emitted by the restricted local environment; this smoke result is
not evidence of a completed installed-app acceptance.

## Full Test Boundary

`pnpm.cmd test --run` was also re-run. It is non-green: 18 desktop tests in
`sqlite-store.test.ts` and `workspace-host.test.ts` fail before their business
assertions because the locally installed `better-sqlite3` native binary exposes
Node ABI 135 while the active Node 24 runtime requires ABI 137. This is a local
native-module compatibility limitation, not 18 demonstrated application logic
regressions. It must remain explicit until a fresh candidate SHA is tested by
the repository's Node 20 CI.

## Data Boundary

This record contains no API key, provider URL, absolute workspace path, fixture
source text, model output, or raw trace payload. No real model or user workspace
was used during the automatic checks.

## Release Completion Evidence

PR #23 integrated the original release candidate. PR #26, PR #27, and PR #28
then corrected Windows workspace-path canonicalization false positives. PR #28
merged as `c005b00615f7d7bbeb9eb0c7160d454d5ac58cc8`.

The final Windows Release workflow completed successfully:
https://github.com/HrrToT/Todex/actions/runs/31824988791. It ran frozen-lockfile
installation, lint, the full test suite, typecheck, build, Windows packaging,
release verification, and asset upload.

The published release is https://github.com/HrrToT/Todex/releases/tag/v0.1.4.
It contains:

1. `Todex-0.1.4-win-x64.exe`, 98,936,198 bytes, SHA-256
   `28493310a46eb0a8b617465ecc0d0c3e56f1dd0ff2ac359b25a6715796962b4e`.
2. `latest.yml`, 342 bytes, SHA-256
   `4b841144f4a6d6aeba8b4383f081f636b6e5541b7407dca1f1995a5959dc438f`.

## Still Required

The following remain unrecorded and must not be inferred from the release:

1. A controlled installed-app run using a temporary non-sensitive Node or Python
   fixture.
2. A user-configured real OpenAI-compatible provider run demonstrating a safe
   patch, the approval boundary, an approved command, verification, and a
   terminal result.

The local Node 24 / `better-sqlite3` ABI limitation remains environment-specific.
The clean Windows CI evidence above is not evidence of either remaining manual
acceptance item.
