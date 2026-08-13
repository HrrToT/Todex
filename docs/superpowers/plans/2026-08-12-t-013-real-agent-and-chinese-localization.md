# T-013 Real Desktop Agent And Chinese Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Chinese-first Windows desktop workbench that can govern real OpenAI Chat Completions Agent Runs for user-selected local Node.js and Python repositories.

**Architecture:** Keep all real credentials, network calls, workspace access and child processes in Electron main. The renderer receives only typed, redacted projections through preload IPC. Implement localization first, then project setup, model protocol, real host adapters, run orchestration, and the live workbench in separate red-green commits.

**Tech Stack:** TypeScript strict, Electron, React, Vite, Vitest, Zod, SQLite, keytar, Node fs/promises, child_process, OpenAI Chat Completions compatible HTTPS.

---

### Task 1: Localization Foundation And Chinese-First UI

**Files:**
- Create: `apps/desktop/src/renderer/i18n.ts`
- Create: `apps/desktop/test/i18n.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/run-controller.ts`
- Modify: `apps/desktop/test/workbench.spec.tsx`
- Modify: `apps/demo-web/src/App.tsx`
- Modify: `apps/demo-web/test/App.spec.tsx`

- [ ] **Step 1: Write failing locale and renderer tests**

```ts
expect(createLocaleState().locale).toBe("zh-CN");
expect(t("zh-CN", "workbench.run")).toBe("开始运行");
expect(t("en-US", "workbench.run")).toBe("Run");
expect(screen.getByRole("textbox", { name: "任务或继续说明" })).toBeVisible();
```

- [ ] **Step 2: Run focused tests and observe RED**

Run: `pnpm.cmd --filter @todex/desktop test --run i18n.test.ts workbench.spec.tsx`

Expected: fail because `i18n.ts` and Chinese accessible labels do not exist.

- [ ] **Step 3: Implement centralized immutable `zh-CN` and `en-US` message maps**

```ts
export type Locale = "zh-CN" | "en-US";
export type MessageKey = "workbench.run" | "workbench.task" | "phase.idle";
export function t(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
```

Move user-facing Desktop/Demo strings to keys. Preserve command, path, diff, JSON and trace raw values.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `pnpm.cmd --filter @todex/desktop test --run i18n.test.ts workbench.spec.tsx && pnpm.cmd --filter @todex/demo-web test --run App.spec.tsx`

Expected: pass with Chinese default and English override tests.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer apps/desktop/test apps/demo-web/src/App.tsx apps/demo-web/test/App.spec.tsx
git commit -m "feat: add Chinese-first workbench localization"
```

### Task 2: Native Workspace Selection And Project Detection

**Files:**
- Create: `apps/desktop/src/main/workspace-selector.ts`
- Create: `apps/desktop/test/workspace-selector.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/test/ipc.test.ts`
- Modify: `apps/desktop/src/renderer/bridge.ts`

- [ ] **Step 1: Write failing main-process selection tests**

```ts
await expect(selector.choose()).resolves.toEqual({ workspaceRoot: "C:\\fixtures\\node", displayName: "node" });
expect(ipc.handlers.has("workspace.choose")).toBe(true);
expect(ipc.handlers.has("filesystem.read")).toBe(false);
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/desktop test --run workspace-selector.test.ts ipc.test.ts`

Expected: fail because `workspace.choose` is absent.

- [ ] **Step 3: Implement native dialog-backed selector and narrow IPC**

The selector invokes Electron `dialog.showOpenDialog({ properties: ["openDirectory"] })`, returns undefined on cancel, canonicalizes only the selected directory in main, and never lets Renderer supply a direct filesystem operation.

- [ ] **Step 4: Run GREEN**

Run: `pnpm.cmd --filter @todex/desktop test --run workspace-selector.test.ts ipc.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/workspace-selector.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/preload.ts apps/desktop/src/renderer/bridge.ts apps/desktop/test
git commit -m "feat: add governed workspace selection"
```

### Task 3: OpenAI-Compatible Main-Process Client

**Files:**
- Create: `apps/desktop/src/main/openai-compatible-client.ts`
- Create: `apps/desktop/test/openai-compatible-client.test.ts`
- Modify: `apps/desktop/src/main/workspace-host.ts`

- [ ] **Step 1: Write failing HTTP protocol tests**

```ts
await expect(client.complete(context)).resolves.toBe('{"tool":"finish","summary":"done"}');
expect(request.headers.authorization).toBe("Bearer secret-value");
expect(JSON.stringify(result)).not.toContain("secret-value");
```

Include one abort/timeout test and one non-2xx redaction test.

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/desktop test --run openai-compatible-client.test.ts`

Expected: module missing.

- [ ] **Step 3: Implement Chat Completions-only client**

Use injected `fetch`, an AbortController, explicit response-size bound and a fixed request shape. The client receives a credential only from `WorkspaceHost`; it never exposes that credential through IPC or persistence.

- [ ] **Step 4: Run GREEN**

Run: `pnpm.cmd --filter @todex/desktop test --run openai-compatible-client.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/openai-compatible-client.ts apps/desktop/src/main/workspace-host.ts apps/desktop/test/openai-compatible-client.test.ts
git commit -m "feat: add OpenAI-compatible desktop LLM client"
```

### Task 4: Real Workspace And Command Adapters

**Files:**
- Create: `apps/desktop/src/main/node-workspace-fs.ts`
- Create: `apps/desktop/src/main/node-command-runner.ts`
- Create: `apps/desktop/test/node-workspace-fs.test.ts`
- Create: `apps/desktop/test/node-command-runner.test.ts`

- [ ] **Step 1: Write failing adapter boundary tests**

```ts
await expect(fs.readText(".env")).rejects.toThrow("sensitive_path");
await expect(fs.readText("../outside.txt")).rejects.toThrow("workspace_escape");
await runner.run(confirmedCommand).then(expect).resolves.toMatchObject({ exitCode: 0 });
expect(spawned.argv).toEqual(["pnpm", "test"]);
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/desktop test --run node-workspace-fs.test.ts node-command-runner.test.ts`

- [ ] **Step 3: Implement adapters with injected fs/spawn seams**

`NodeWorkspaceFs` uses realpath containment and returns bounded results. `NodeCommandRunner` accepts only fixed argv/workingDirectory/timeout from a confirmed command and never uses shell mode.

- [ ] **Step 4: Run GREEN**

Run: `pnpm.cmd --filter @todex/desktop test --run node-workspace-fs.test.ts node-command-runner.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/node-workspace-fs.ts apps/desktop/src/main/node-command-runner.ts apps/desktop/test/node-workspace-fs.test.ts apps/desktop/test/node-command-runner.test.ts
git commit -m "feat: add bounded desktop workspace adapters"
```

### Task 5: Desktop Run Service And One-Time Protocol Repair

**Files:**
- Create: `apps/desktop/src/main/desktop-run-service.ts`
- Create: `apps/desktop/test/desktop-run-service.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/test/ipc.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

```ts
await service.start({ projectId: "p1", task: "修复计算" });
expect(client.calls).toHaveLength(2); // invalid action then format repair
expect(service.snapshot("r1")?.status).toBe("completed");
expect(commandRunner.calls).toHaveLength(0); // pending approval
```

Add a second-invalid-action test expecting `model_protocol_invalid`, plus cancellation and no-Key-leak assertions.

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/desktop test --run desktop-run-service.test.ts ipc.test.ts`

- [ ] **Step 3: Implement main-process orchestration**

Create one active Run per project; compose existing Harness services; persist and project redacted events; require an approval decision before every confirmed command; only request one protocol-repair completion after invalid action parsing.

- [ ] **Step 4: Run GREEN**

Run: `pnpm.cmd --filter @todex/desktop test --run desktop-run-service.test.ts ipc.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/desktop-run-service.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/preload.ts apps/desktop/src/main/index.ts apps/desktop/test
git commit -m "feat: orchestrate governed desktop agent runs"
```

### Task 6: Live Workbench, End-To-End Mock HTTP, And Evidence

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/bridge.ts`
- Modify: `apps/desktop/src/renderer/run-controller.ts`
- Modify: `apps/desktop/test/workbench.spec.tsx`
- Create: `apps/desktop/test/desktop-agent-e2e.test.ts`
- Create: `docs/task-cards/T-013-real-agent-and-chinese-localization.md`
- Create: `docs/verification/2026-08-12-t-013-real-agent-and-chinese-localization.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/AGENT_LOG.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing live-workbench tests**

```ts
await user.click(screen.getByRole("button", { name: "选择工作区" }));
await user.click(screen.getByRole("button", { name: "开始运行" }));
expect(screen.getByText("等待命令审批")).toBeVisible();
expect(screen.queryByText("secret-value")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @todex/desktop test --run workbench.spec.tsx desktop-agent-e2e.test.ts`

- [ ] **Step 3: Replace production DemoRunController with bridge-backed controller**

Render real workspace/profile/model/Run projection and approval cards. Keep DemoRunController available only as a test fixture; it must not be the default Electron runtime path.

- [ ] **Step 4: Run GREEN and full verification**

Run: `pnpm.cmd test --run`

Run: `pnpm.cmd typecheck`

Run: `pnpm.cmd lint`

Run: `pnpm.cmd build`

Expected: all Node-ABI-compatible tests pass. Record any Electron-native ABI limitation separately; do not hide it.

- [ ] **Step 5: Commit evidence**

```powershell
git add apps/desktop README.md docs
git commit -m "feat: connect real desktop agent workbench"
```

## Plan Self-Review

- Localization is covered by Task 1 and does not alter Demo restrictions.
- Native picker, project detection, model client, adapters, orchestration and UI are separated by process and trust boundary.
- Each real side effect has an explicit failing test, focused GREEN test and commit.
- Task 5 enforces the selected approval policy and one-time protocol repair.
- Task 6 binds UI evidence to real IPC projection and retains release/documentation evidence.
