# T-011 Public Mock Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a resettable public React and Node Mock Demo that demonstrates Todex governance and repair without accepting visitor-controlled execution inputs.

**Architecture:** `DemoSession` owns fixed fixture scenarios, sanitized snapshots, approvals, and reset. A small Node HTTP server validates exact request shapes before delegating to that session. React renders only safe DTOs through a Codex-style execution workbench.

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest 2, Testing Library, Node HTTP, `@todex/harness-core`, and `@todex/contracts`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/demo-web/package.json` | Workspace scripts and dependencies. |
| `apps/demo-web/tsconfig.json` | Strict demo package TypeScript settings. |
| `apps/demo-web/vite.config.ts` | React build and jsdom test configuration. |
| `apps/demo-web/src/demo-session.ts` | Fixed scenario state, restrictions, snapshot and reset. |
| `apps/demo-web/src/server.ts` | Exact HTTP routing and safe public errors. |
| `apps/demo-web/src/App.tsx` | Accessible scenario, run, approval and reset workbench. |
| `apps/demo-web/src/main.tsx` | React bootstrap and fixed API client. |
| `apps/demo-web/src/styles.css` | Responsive dark execution-workbench styling. |
| `apps/demo-web/test/*.test.ts(x)` | Session, server and component TDD coverage. |
| `render.yaml` | Render Node service configuration. |

### Task 1: Add the Package and Restricted Demo Session

**Files:**
- Create: `apps/demo-web/package.json`
- Create: `apps/demo-web/tsconfig.json`
- Create: `apps/demo-web/vite.config.ts`
- Create: `apps/demo-web/src/demo-session.ts`
- Create: `apps/demo-web/test/demo-session.test.ts`
- Modify: `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `pnpm-lock.yaml`

- [ ] **Step 1: Write failing restriction, scenario, and reset tests**

```ts
it("rejects real model settings and arbitrary workspace paths", async () => {
  const session = createDemoSession();
  await expect(session.configureRealModel("not-a-key")).rejects.toThrow("demo_restricted");
  await expect(session.openWorkspace("C:/Users/private")).rejects.toThrow("demo_restricted");
});

it("rejects free shell, patches and unknown scenarios without echoing input", async () => {
  const session = createDemoSession();
  await expect(session.runShell("curl secret.invalid")).rejects.toThrow("demo_restricted");
  await expect(session.applyPatch("visitor patch")).rejects.toThrow("demo_restricted");
  await expect(session.selectScenario("visitor-input")).rejects.toThrow("demo_restricted");
});

it("resets runs, traces, diffs and approvals", async () => {
  const session = createDemoSession();
  await session.selectScenario("approval-isolation");
  await session.run();
  expect(await session.reset()).toMatchObject({ runs: [], trace: [], pendingApproval: undefined });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/demo-web test --run demo-session.test.ts`

Expected: FAIL because the package and `createDemoSession` do not exist.

- [ ] **Step 3: Add package configuration and session contracts**

```ts
export const DEMO_SCENARIOS = ["workspace-escape", "repair-feedback", "approval-isolation"] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIOS)[number];
export interface DemoSession {
  selectScenario(id: string): Promise<DemoSnapshot>;
  run(): Promise<DemoSnapshot>;
  decideApproval(input: { approvalId: string; decision: "allow" | "deny" }): Promise<DemoSnapshot>;
  reset(): Promise<DemoSnapshot>;
  configureRealModel(value: string): Promise<never>;
  openWorkspace(path: string): Promise<never>;
  runShell(command: string): Promise<never>;
  applyPatch(patch: string): Promise<never>;
}
```

Implement all scenario fixtures on the server side. Invalid scenarios and each restricted method throw `new Error("demo_restricted")` while discarding the received value. Reset replaces the entire internal state object.

- [ ] **Step 4: Implement deterministic scenario evidence**

```ts
workspaceEscape: { traceType: "action_rejected", reason: "workspace_escape", dispatcherCalls: 0 }
repairFeedback: { verification: ["test_failure", "passed"], status: "completed" }
approvalIsolation: { status: "awaiting_approval", scope: "once" }
```

Use existing harness-core Mock collaborators where their API fits. Otherwise expose only precomputed sanitized event types, fixed reasons, bounded diff summaries, verification classification, and booleans; never create a visitor-controlled dispatch path.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm.cmd --filter @todex/demo-web test --run demo-session.test.ts`

Expected: PASS, including the absence of rejected input from every snapshot.

```powershell
git add apps/demo-web pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts pnpm-lock.yaml
git commit -m "feat: add restricted demo session"
```

### Task 2: Add Exact HTTP API Routing

**Files:**
- Create: `apps/demo-web/src/server.ts`
- Create: `apps/demo-web/test/server.test.ts`
- Modify: `apps/demo-web/package.json`

- [ ] **Step 1: Write failing routing and redaction tests**

```ts
it("selects a known scenario and returns sanitized evidence", async () => {
  const response = await request(app, "POST", "/api/scenario", { scenarioId: "workspace-escape" });
  expect(response.status).toBe(200);
  expect(response.body.trace[0]).toMatchObject({ type: "action_rejected", reason: "workspace_escape" });
});

it("rejects extra execution fields without echoing them", async () => {
  const response = await request(app, "POST", "/api/run", { command: "curl secret.invalid", apiKey: "secret" });
  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).toContain("demo_restricted");
  expect(JSON.stringify(response.body)).not.toContain("secret");
  expect(JSON.stringify(response.body)).not.toContain("curl");
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/demo-web test --run server.test.ts`

Expected: FAIL because the server module does not exist.

- [ ] **Step 3: Implement fixed routes**

```text
GET  /api/session
POST /api/scenario  exactly { scenarioId }
POST /api/run       exactly {}
POST /api/approval  exactly { approvalId, decision }
POST /api/reset     exactly {}
```

Reject unknown routes, invalid JSON, unknown properties, invalid IDs and invalid decisions. Map errors only to `demo_restricted` or `demo_invalid_request`; do not serialize error messages. Serve built static assets after API routing from a fixed directory and return fixed 404 responses for unknown assets.

- [ ] **Step 4: Run GREEN and commit**

Run: `pnpm.cmd --filter @todex/demo-web test --run server.test.ts`

Expected: PASS.

```powershell
git add apps/demo-web/src/server.ts apps/demo-web/test/server.test.ts apps/demo-web/package.json
git commit -m "feat: add fixed public demo API"
```

### Task 3: Build the Accessible Demo Workbench

**Files:**
- Create: `apps/demo-web/src/App.tsx`
- Create: `apps/demo-web/src/main.tsx`
- Create: `apps/demo-web/src/styles.css`
- Create: `apps/demo-web/test/App.spec.tsx`
- Create: `apps/demo-web/test/setup.ts`
- Modify: `apps/demo-web/vite.config.ts`

- [ ] **Step 1: Write failing component-flow tests**

```tsx
it("labels Mock Demo and renders repair feedback", async () => {
  render(<App client={client} />);
  await user.click(screen.getByRole("button", { name: "Repair feedback" }));
  await user.click(screen.getByRole("button", { name: "Run scenario" }));
  expect(await screen.findByText("Mock Demo")).toBeVisible();
  expect(await screen.findByText("test_failure")).toBeVisible();
  expect(await screen.findByText("passed")).toBeVisible();
});

it("allows keyboard approval and reset", async () => {
  render(<App client={approvalClient} />);
  await user.tab();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("button", { name: "Allow once" })).toBeVisible();
  await user.keyboard("{Tab}{Enter}");
  await user.click(screen.getByRole("button", { name: "Reset demo" }));
  expect(await screen.findByText("Choose a scenario to begin")).toBeVisible();
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/demo-web test --run App.spec.tsx`

Expected: FAIL because `App` does not exist.

- [ ] **Step 3: Implement a fixed client and UI**

```ts
export interface DemoClient {
  readSession(): Promise<DemoSnapshot>;
  selectScenario(scenarioId: DemoScenarioId): Promise<DemoSnapshot>;
  run(): Promise<DemoSnapshot>;
  decideApproval(input: { approvalId: string; decision: "allow" | "deny" }): Promise<DemoSnapshot>;
  reset(): Promise<DemoSnapshot>;
}
```

Render only three named scenario buttons, `Run scenario`, `Reset demo`, a chronological sanitized stream, verification/diff details and a conditional approval panel. There is no model setting, Key input, local file picker, upload, command input, patch editor or raw trace display. Use semantic headings, buttons, live status text, visible focus and labels beyond color.

- [ ] **Step 4: Implement responsive dark styling**

Use a compact scenario rail, central execution stream and detail panel. At widths under `700px`, stack these areas without hiding Run, Reset or approval controls. Use stable action dimensions and avoid visible-text overflow and nested decorative cards.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm.cmd --filter @todex/demo-web test --run App.spec.tsx`

Expected: PASS.

```powershell
git add apps/demo-web/src/App.tsx apps/demo-web/src/main.tsx apps/demo-web/src/styles.css apps/demo-web/test apps/demo-web/vite.config.ts
git commit -m "feat: add public mock demo workbench"
```

### Task 4: Configure Render and Record Evidence

**Files:**
- Create: `render.yaml`
- Create: `docs/verification/2026-08-01-t-011-public-mock-demo.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/AGENT_LOG.md`
- Modify: `docs/task-cards/T-011-public-mock-demo.md`

- [ ] **Step 1: Write a failing Render configuration assertion**

```ts
it("contains the demo package build and start commands", () => {
  const config = readFileSync("render.yaml", "utf8");
  expect(config).toContain("pnpm --filter @todex/demo-web build");
  expect(config).toContain("pnpm --filter @todex/demo-web start");
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/demo-web test --run server.test.ts`

Expected: FAIL because `render.yaml` does not exist.

- [ ] **Step 3: Add configuration and documentation**

```yaml
services:
  - type: web
    name: todex-mock-demo
    env: node
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter @todex/demo-web build
    startCommand: pnpm --filter @todex/demo-web start
```

Record actual RED/GREEN output, screenshot/browser checks, branch, commits, PR/CI evidence and deployment limitations. Update the task card with actual scope and commands. Update `PLAN.md` with T-011 evidence and correct the stale T-010 review status to its factual merged state. Append a new entry to `AGENT_LOG.md`; do not rewrite its history.

- [ ] **Step 4: Run final verification**

Run: `pnpm.cmd --filter @todex/demo-web test --run`

Run: `pnpm.cmd --filter @todex/demo-web build`

Run: `pnpm.cmd test --run; pnpm.cmd typecheck; pnpm.cmd lint; pnpm.cmd build; git diff --check`

Expected: each command succeeds.

- [ ] **Step 5: Check wide and narrow layouts then commit**

Run the local service and inspect `1440x900` and `390x844`. Confirm Mock Demo label, scenario selection, trace evidence, Run/Reset and approval controls are visible, keyboard reachable and non-overlapping.

```powershell
git add render.yaml docs/verification/2026-08-01-t-011-public-mock-demo.md docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-011-public-mock-demo.md
git commit -m "docs: record public mock demo verification"
```

## Plan Self-Review

- Spec coverage: Tasks 1, 2, 3 and 4 respectively implement the fixture/restriction boundary, server enforcement, accessible workbench and delivery evidence.
- Placeholder scan: each task names its files, public types, test behavior and command. Actual evidence is intentionally collected in Task 4, not fabricated.
- Type consistency: `DemoScenarioId`, `DemoSnapshot`, `DemoSession`, `{ approvalId, decision }` and `DemoClient` retain the same meaning in every task.

