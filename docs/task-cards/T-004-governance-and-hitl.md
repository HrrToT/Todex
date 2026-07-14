# T-004: Governance, Workspace Boundary, and HITL

Status: verified
Responsible model: GLM
Lead review: Codex
Branch: `feat/t-004-governance`
Base: `main` at `34c7937`
Authority: `docs/SPEC.md` section 6; `docs/superpowers/specs/2026-07-14-t-004-governance-design.md`; `docs/PLAN.md` T-004

## Goal

Implement deterministic governance in the real AgentRunner dispatch path. Every raw LLM output must still pass `parseAction`; every parsed action must then pass GovernanceController before Dispatcher. No code path may dispatch an action after a deny or before an approval decision.

## Non-goals

No real shell, network, filesystem tool, patch application, SQLite, Electron, UI, persistent approval storage, contract schema edit, dependency edit, or CI edit. Use only injected fakes and temporary test fixtures.

## Allowed files

- Create `packages/harness-core/src/guardrail.ts`
- Create `packages/harness-core/src/approval-store.ts`
- Create `packages/harness-core/src/run-state-machine.ts`
- Modify `packages/harness-core/src/agent-runner.ts`, `src/llm.ts`, `src/index.ts`
- Create `packages/harness-core/test/guardrail.test.ts`, `test/approval-state-machine.test.ts`
- Modify existing `packages/harness-core/test/agent-runner.test.ts` only to supply newly required workspace/governance fixtures.

Stop and report before modifying any other file.

## Frozen API and semantics

Add a required `workspaceRoot: string` to RunInput. Add optional `pendingApproval?: ApprovalRequest` to RunResult. RunnerOptions requires a GovernanceController, ApprovalStore, and Clock; existing tests must inject deterministic fakes.

```ts
export interface Clock { now(): Date; }
export interface GovernanceContext {
  readonly runId: string;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly actionId: string;
}
export type GovernanceDecision =
  | { readonly decision: "allow"; readonly reason: "safe_action" | "approved_scope" }
  | { readonly decision: "require_approval"; readonly request: ApprovalRequest }
  | { readonly decision: "deny"; readonly reason: string };
export interface GovernanceController {
  evaluate(action: Action, context: GovernanceContext): GovernanceDecision;
}
export interface ApprovalStore {
  create(request: ApprovalRequest): ApprovalRequest;
  get(approvalId: string): ApprovalRequest | undefined;
  decide(approvalId: string, decision: ApprovalScope, now: Date): ApprovalRequest;
  matchesGrant(context: GovernanceContext, action: Action, now: Date): boolean;
}
```

Add `runner.decideApproval({ approvalId, decision }): Promise<RunResult>`. It operates only on a current pending request. `once` resumes exactly once. `run` never applies to a different runId. `command_prefix` expires after seven days and only matches safe normalized executable plus fixed subcommand tokens in the same project. `deny`, stale, duplicate, expired, and cancelled decisions never dispatch.

RunStateMachine permits only `running -> dispatching -> running`, `running -> awaiting_approval`, `awaiting_approval -> dispatching -> running` after an approved current request, `awaiting_approval -> running` on denial, and cancellation/terminal transitions specified in the design document. Illegal transitions throw `invalid_run_transition` before dispatch.

Hard-deny: workspace escape including symlink escape; sensitive paths `.env`/`.env.*` except `.env.example`, `.npmrc`, `.pypirc`, `.netrc`, credentials/secrets, pem/key, SSH/AWS material, `.git/config`; shell concatenation, pipe, redirect, substitution, dynamic or encoded PowerShell, elevation, system configuration, and Demo free shell. Approval is required for non-complex free shell, install, delete, Git, network, CI/deploy, and large patch metadata. Ordinary reads/searches/small patches/configured commands are allow.

## TDD and acceptance

1. Write `guardrail.test.ts` and `approval-state-machine.test.ts` first.
2. Run `pnpm.cmd --filter @todex/harness-core test --run guardrail.test.ts approval-state-machine.test.ts`; it must fail because modules are absent.
3. Implement the minimum code.
4. Add exact assertions for these cases: escape and sensitive path deny with Dispatcher 0; safe read allow; free shell awaits approval with Dispatcher 0; duplicate once approval dispatches once; run approval does not leak to new run; `npm test; curl x` is deny despite prior prefix grant; cancellation/expiry dispatches zero; denial produces rejected ToolResult for next LLM turn.
5. Run the focused command, then `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd build`.
6. Commit `feat: add governance and HITL state machine` and report red/green output, changed files, assumptions, commit hash, and self-review. Do not start T-005.

## Completion evidence

- Implementation and GLM repair commits: `430b77a`, `0ec7b07`, `0bc5767`, `d721397`, `4773476`.
- Codex independently reproduced and closed one final P1: `powershell "-e" <payload>` previously downgraded to `require_approval`; PowerShell strips that argument quoting before parsing it as the encoded-command alias. The regression test now requires hard deny.
- Final independent commands: `pnpm.cmd test --run` (153/153), `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd build`, all exit 0.
- Review conclusion: no remaining P0/P1 found within the frozen T-004 scope. Real shell/filesystem/network execution remains explicitly out of scope.
