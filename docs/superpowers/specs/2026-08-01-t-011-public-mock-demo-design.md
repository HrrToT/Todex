# T-011 Public Mock Demo Design

**Status:** approved for implementation planning.

## Goal

Build a publicly reachable Todex demonstration that makes governance and repair
mechanisms reproducible without accepting a visitor's credentials, local files,
uploaded code, arbitrary commands, or live model input.

## Product Shape

The demo uses the same compact, dark execution-workbench language as T-010, but
opens on a fixed scenario selector rather than local-workspace or model controls.
It offers three repeatable scenarios:

- `workspace-escape`: an attempted `../.ssh/id_rsa` read is rejected before a
  dispatcher is invoked.
- `repair-feedback`: a deterministic failed verification is fed back into a
  scripted repair, then the repaired fixture verifies successfully.
- `approval-isolation`: one run pauses for a constrained approval; allowing it
  affects only that run, while a second run requires its own decision.

The workbench presents scenario progress, trace events, verification summaries,
diff summaries, and approval choices. A Reset command replaces all temporary
scenario state and returns the selected scenario to its initial state.

## Architecture

`apps/demo-web` is a Node-hosted React/Vite application. Its server owns an
in-memory `DemoSession` facade that starts only named fixture scenarios and uses
T-008-style deterministic Mock LLM and in-memory workspace collaborators. The
React app consumes only limited DTOs and invokes fixed server operations.

The session boundary deliberately differs from the desktop host: it has no
credential store, model configuration, file picker, upload route, project path
parameter, or arbitrary command/patch endpoint. State is process-local and is
discarded on reset or service restart. The server is the enforcement point;
removing a control in React is never treated as a security boundary.

```text
React workbench -> fixed demo API -> temporary DemoSession -> harness fixtures
                                                |                 |
                                                +-> trace/diff/verification DTOs
```

## Fixed Operations

The server exposes only these semantic operations:

| Operation | Accepted input | Result |
| --- | --- | --- |
| select scenario | one known `scenarioId` | initial safe snapshot |
| run | current session only | updated run snapshot |
| decide approval | pending `approvalId` and allow/deny value | updated run snapshot |
| reset | current session only | new initial snapshot |

Any request to configure a real model or key, open a non-fixture workspace,
upload source, execute a free shell command, or invoke an unknown scenario is
rejected with the stable `demo_restricted` error. The server does not echo the
rejected value in its response, trace, or logs.

## UI and Accessibility

The first viewport contains a clear `Mock Demo` label, three named scenario
buttons, the chronological execution stream, and a reset action. The selected
scenario describes its safe fixture rather than marketing product capability.
Approval actions use labeled buttons and show the affected run identifier and
risk reason. Trace, diff, and verification panels use readable code-oriented
text but never render raw sensitive fixture contents.

The layout remains usable at narrow widths: the scenario selector becomes a
horizontal or stacked compact control, and detail panels become a drawer or
single-column section. Keyboard users can select a scenario, run it, reset it,
and make an approval decision without pointer-only interactions.

## Safety and Error Handling

- The server constructs fixture workspaces internally; client input cannot name
  a filesystem path.
- Mock scripts, commands, patches, and verification results are selected by
  scenario ID, not submitted by the client.
- Approval choices operate on the currently pending, server-owned request only.
- Public DTOs use sanitized summaries and bounded collections. They never
  include API keys, credential references, absolute visitor paths, raw command
  output, or arbitrary rejected input.
- Reset replaces the session's run, approvals, traces, and diff data. No grant
  or approval may survive into the new run.

## Testing

Unit tests prove that real model configuration, arbitrary workspace paths, free
shell, unknown scenarios, and invalid approval IDs are rejected as
`demo_restricted` without dispatcher execution. Scenario tests assert the
expected guardrail, repair-feedback, and per-run approval-isolation outcomes,
then prove Reset removes all prior trace and approval state.

Component tests cover scenario selection, run and reset controls, surfaced
restricted errors, approval keyboard reachability, and clear Mock Demo status.
The final task verification includes the demo package test/build commands and a
local browser check of wide and narrow layouts. Render configuration supplies a
Node build/start command for the same restricted service.

## Out of Scope

Real OpenAI-compatible model calls, API-key fields, credential persistence,
local-workspace selection, uploads, user-supplied patches, arbitrary shell,
multi-user durable sessions, deployment credentials, Electron behavior,
release packaging, and changes to Harness Core governance policy are outside
T-011.
