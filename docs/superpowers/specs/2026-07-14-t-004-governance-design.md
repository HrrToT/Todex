# T-004 Governance and HITL Design

Status: approved by project owner, pending written-spec review
Date: 2026-07-14
Task: T-004
Branch: `feat/t-004-governance`

## Goal

Make Todex's governance path non-bypassable in the existing AgentRunner: every structurally valid action is classified before dispatch, hard-denied actions never reach a tool, and high-risk actions pause until one explicit human decision is applied.

## Scope

T-004 implements deterministic in-memory governance only. It uses injected clocks and dispatchers, does not start a real shell, access the network, perform real file edits, add SQLite persistence, or expose UI. T-005 will supply real file tools; T-009 will persist approvals in the desktop host.

## Execution Path

The Runner owns the only action-to-dispatch path. After `parseAction(raw)` and before any `dispatcher.dispatch(...)`, it calls:

```ts
governance.evaluate(action, {
  runId,
  projectId,
  workspaceRoot,
  actionId,
});
```

The result is one of:

```ts
type GovernanceDecision =
  | { decision: "allow"; reason: "safe_action" | "approved_scope" }
  | { decision: "require_approval"; request: ApprovalRequest }
  | { decision: "deny"; reason: DenyReason };
```

- `allow`: the Runner enters `dispatching`, calls the Dispatcher once, records `tool_completed`, and returns to `running`.
- `require_approval`: the Runner stores the pending action and ApprovalRequest, records `approval_requested`, returns RunStatus `awaiting_approval`, and performs zero dispatches.
- `deny`: the Runner records `action_rejected`, returns a rejected ToolResult to the next LLM turn, and does not call the Dispatcher. A hard denial cannot be overridden by any approval grant.

`RunResult` is extended with an optional `pendingApproval?: ApprovalRequest`. `RunnerOptions` gains required governance dependencies for T-004 tests: `governance`, `approvalStore`, and `clock`. There is no permissive default; callers must explicitly inject the deterministic governance implementation. This prevents a future host from silently skipping governance.

## Public Control Surface

```ts
interface ApprovalDecisionInput {
  readonly approvalId: string;
  readonly decision: ApprovalScope;
}

interface GovernanceRunner {
  decideApproval(input: ApprovalDecisionInput): Promise<RunResult>;
  cancel(runId: string): void;
}
```

`decideApproval` accepts exactly one decision for the current pending request. It rejects stale, unknown, expired, cancelled, or already-decided requests without dispatching. An approval changes the request state once and resumes the exact stored action; a denial creates a rejected result for the paused action and returns the Run to `running` without dispatch. The same approval button click cannot dispatch twice.

## Guardrail Rules

`Guardrail` receives a `workspaceRoot`, a host-independent path resolver, and an Action. All action paths are resolved to canonical absolute paths before classification.

Hard deny (`deny`) applies to:

- Paths outside the canonical workspace, including `..`, absolute outside paths, drive roots, and symbolic-link targets outside the workspace: `workspace_escape`.
- Sensitive paths: `.env` and `.env.*` except `.env.example`, `.npmrc`, `.pypirc`, `.netrc`, `credentials.*`, `secrets.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `.aws/**`, `.ssh/**`, and `.git/config`: `sensitive_path`.
- Free-shell text containing command concatenation, pipe, redirection, command substitution, backticks, dynamic PowerShell, encoded commands, elevation, or system configuration: `complex_shell` or `privilege_or_system_command`.
- The public Demo context requesting real model configuration or free shell: `demo_restricted`.

The classifier allows ordinary `list_files`, `read_file`, `search_text`, normal workspace-local `apply_patch`, `remember`, `finish`, and `run_configured_command`. It requires approval for free shell without a hard-deny pattern, dependency installation, deletion, Git modification, network command, CI/deployment configuration change, or a patch touching more than 20 files or 2,000 added/deleted lines.

T-004 treats patch size and path summaries as injected metadata. It does not parse or apply unified diffs; T-005 will provide exact patch file information through the same Guardrail input.

## Approval Store and Grants

`InMemoryApprovalStore` is the deterministic T-004 implementation. It stores ApprovalRequests by `approvalId`, creates IDs using an injected monotonic ID factory, and never mutates a returned request object.

Approval scopes are:

- `once`: consumes the current request only.
- `run`: permits matching approval-required actions only for the same `runId`; it is not visible to a later Run.
- `command_prefix`: only for a previously safe, free-shell command in the same project. The grant fingerprint contains `projectId`, `tool`, normalized executable, and fixed subcommand tokens. It expires at `clock.now() + 7 days`.
- `deny`: resolves the current request as denied and grants nothing.

No prefix grant is issued or honored for install, delete, network, elevation, system configuration, destructive Git, or any command that classifies as a hard deny. Classification always runs before grant matching, so a grant for `npm test` cannot permit `npm test; curl https://example.invalid`.

## Run State Machine

`RunStateMachine` owns legal RunStatus transitions and emits a transition record for trace construction:

```text
running -> dispatching -> running
running -> awaiting_approval -> dispatching -> running
awaiting_approval -> running       (human denies)
awaiting_approval -> cancelled     (human cancels or request expires)
running -> completed | completed_unverified | failed | cancelled
```

Illegal transitions throw `invalid_run_transition` before any dispatch. In particular, no transition from `awaiting_approval` directly to `dispatching` is allowed without an approved current request.

## Deterministic Tests

Tests use a FakeClock, temporary workspace fixtures, a controllable path resolver, a fake dispatcher, and ScriptedMockLlm. They must prove:

1. Workspace escape, symlink escape, `.env`, and `.git/config` return `deny` and make zero dispatcher calls.
2. Safe `read_file` reaches the dispatcher without an approval.
3. A free shell pauses in `awaiting_approval`, writes `approval_requested`, and makes zero dispatcher calls before approval.
4. `once` dispatches once only; a duplicate decision does not dispatch again.
5. A `run` approval can resume a matching action in its Run but not in a new Run.
6. A command-prefix approval cannot permit shell concatenation, network, deletion, or an expired grant.
7. Denial feeds a rejected ToolResult to the next LLM turn and does not dispatch.
8. Cancellation or expiry while awaiting approval cancels the Run and never dispatches the stored action.
9. Every raw LLM action still passes through parseAction before governance; malformed actions do not create approvals or dispatch.

## File Boundaries

- `packages/harness-core/src/guardrail.ts`: canonical path checks, sensitive-path checks, action risk classification, safe command fingerprinting.
- `packages/harness-core/src/approval-store.ts`: immutable request and grant storage, scope matching, expiry.
- `packages/harness-core/src/run-state-machine.ts`: legal transition validation and transition state.
- `packages/harness-core/src/agent-runner.ts`: the sole integration point before Dispatcher plus approval continuation.
- `packages/harness-core/src/llm.ts`: minimal public RunResult and GovernanceRunner types.
- `packages/harness-core/src/index.ts`: exports for the T-004 public API.
- `packages/harness-core/test/guardrail.test.ts`: path, sensitive file, risk, command-fingerprint tests.
- `packages/harness-core/test/approval-state-machine.test.ts`: pause/resume, scope, duplication, cancellation, and non-bypass tests.

No contract schema changes, external dependencies, Electron files, real filesystem tools, real shell runners, UI, SQLite, or CI changes are in scope.

## Self-Review

- No placeholder decisions remain: all action outcomes, grant scope boundaries, expiry, state transitions, and Runner integration point are specified.
- The design follows SPEC section 6: the Guardrail is evaluated before dispatch and hard denials cannot be granted.
- T-004 remains focused: actual file tools, patch parsing, persistent storage, UI, and verification/repair behavior stay in their planned tasks.
