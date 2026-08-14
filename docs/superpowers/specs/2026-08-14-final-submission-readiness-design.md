# Final Submission Readiness Design

**Date:** 2026-08-14

## Goal

Close the remaining course-delivery gaps without weakening Todex's existing
desktop security boundary. The result must support a real, user-completable
Windows Credential Manager lifecycle, a literal CI compatibility artifact,
release-document reconciliation, and an honest final-submission checklist.

## Scope

This work has four deliverables:

1. A desktop credential lifecycle: first entry, status, replacement, and
   clear. An API key is accepted only by a password input, sent once through a
   narrow typed IPC channel, and immediately stored by the Electron main
   process in Windows Credential Manager.
2. A minimal `.gitlab-ci.yml` containing a `unit-test` job. GitHub Actions
   remains the actual CI and release platform.
3. Documentation synchronized with `v0.1.2`, including the exact distinction
   between implemented, CI-verified, released, and manually accepted claims.
4. A student-owned `docs/REFLECTION.md` completion checklist. This task never
   fabricates the required personal reflection.

## Credential Lifecycle

### Renderer

The workbench displays a labeled password input only while the selected model
is not configured, plus an explicit save/update command. The field is cleared
immediately after the request settles and never appears in run snapshots,
trace, exported state, model configuration lists, or React state intended for
display. It is not prefilled after configuration and no value is returned by
the bridge.

When a model is configured, the workbench displays only configured status and
an explicit clear command. Updating follows the same password-input path and
replaces the old Credential Manager entry atomically from the user's point of
view.

### Preload and IPC

`credential.save` is an intention-level channel with a strict payload of
`configId` and non-empty `apiKey`. Its response is a redacted lifecycle DTO:
`{ configured: true }`. It never returns a key or credential reference.
`credential.status` and `credential.clear` retain their existing redacted
responses. Renderer code cannot invoke generic credential, filesystem, SQL,
or process APIs.

### Main Process and Persistence

`WorkspaceHost.saveCredential` generates an opaque credential reference,
writes the supplied key to `keytar`, then stores only that reference in SQLite.
If database persistence fails, the newly written credential is removed. If a
replacement succeeds, the prior reference is cleared through the existing
pending-clear recovery path. Reads remain main-process-only and all status
queries discard secret values.

## Safety Invariants

- An API key is never committed, logged, traced, exported, rendered after
  submission, returned through IPC, or stored in SQLite.
- A failed save leaves no new SQLite reference and attempts key cleanup.
- A model cannot claim configured status unless its stored opaque reference is
  readable from the Credential Manager adapter.
- The public Render Demo remains Mock-only and has no live credential route.
- Clear and update are covered by deterministic unit/UI tests using fake
  credential adapters; no test needs a real API key or Windows credential.

## CI and Documentation

The GitLab compatibility job installs with the repository's pinned pnpm
version and invokes the one-command test suite under the literal job name
`unit-test`. The existing GitHub Actions workflow is not removed or renamed.

README, PLAN, AGENT_LOG, the T-013 task card, and its verification record must
describe `v0.1.2` accurately. They must not convert CI/release evidence into a
claim of completed human-installed or real-provider acceptance. The reflection
file remains explicitly student-authored and must be completed by the project
owner before submission.

## Verification

The implementation will use RED-GREEN tests for:

- first-time secure save, redacted bridge result, update, and clear;
- rejection of malformed credential IPC input and absence of generic IPC;
- no secret in renderer-visible snapshots, trace, SQLite projections, and
  serialized test values;
- GitLab CI syntax and the required `unit-test` job;
- existing desktop, harness, lint, typecheck, build, and release-verification
  commands where the local native-module environment permits them.

The final audit will explicitly record any test that can only be proven on the
Windows Node 20 CI runner and will not represent an ABI-limited local run as a
pass.
