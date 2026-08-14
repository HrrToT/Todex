# T-014 Live Agent Release Candidate Verification

**Status:** `automatic_evidence_recorded_manual_acceptance_and_integration_pending`

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

## Still Required

The following have not occurred and must not be inferred from this document:

1. A controlled installed-app run using a temporary non-sensitive Node or Python
   fixture.
2. A user-configured real OpenAI-compatible provider, a safe patch, pending
   command approval with zero pre-approval execution, one approved command,
   verification, and a terminal result.
3. A pushed candidate PR, fresh Node 20 CI for the candidate SHA, review,
   merge to `main`, tag, GitHub Release, and installer release evidence.

This is therefore an automatic-evidence checkpoint, not a final release or
course-submission completion claim.
