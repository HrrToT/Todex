# T-007 Project Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect small Node.js, Python, and mixed repositories from bounded metadata and return safe, unconfirmed verification-command candidates without executing a command.

**Architecture:** A `ProjectDetector` receives an injected read-only metadata reader and produces immutable `DetectedProjectProfile` snapshots. It reads only named root metadata files, converts recognized signals into Todex-owned fixed argv templates, and treats malformed or unreadable metadata as bounded notices. It never invokes `AgentRunner`, `ToolDispatcher`, `CommandRunner`, a shell, or a process.

**Tech Stack:** TypeScript strict, Vitest, existing `ConfiguredCommand` purpose union, Node built-in test runner in the Node example, Python pytest fixture, no new dependency.

---

## Frozen Constraints

- Authority: `docs/SPEC.md` sections 5, 7, 8, and 12; `docs/superpowers/specs/2026-07-17-t-007-project-detection-design.md`; `docs/PLAN.md` T-007.
- Implementation branch: `feat/t-007-project-detection`, based on `main` after the T-007 design/plan documentation commits are included.
- Only detection happens here. Candidate confirmation, persistence, real process execution, desktop host adapters, UI, model calls, network access, SQLite, Electron, and package installation are out of scope.
- All candidates are Todex-generated argv arrays with `confirmedByUser: false`; arbitrary `package.json` script bodies never become argv.
- Node candidates are limited to exact script names `test`, `lint`, `typecheck`, and `build`. Python candidates require explicit pytest, ruff, or mypy evidence. Do not infer install, deploy, publish, prepare, release, or arbitrary scripts.
- The implementation uses no dependency beyond the existing workspace. Do not add a TOML parser; T-007 uses bounded textual marker checks.
- Use `pnpm.cmd` in PowerShell. Do not push, create a PR, merge, or start T-008.

## File Map

| File | Responsibility |
| --- | --- |
| `packages/harness-core/src/project-detector.ts` | Read-only metadata interfaces, immutable profile/candidate types, Node/Python rules, notices, and fixed argv templates. |
| `packages/harness-core/src/index.ts` | Public export for detector types and `ProjectDetector`. |
| `packages/harness-core/test/project-detector.test.ts` | Fake metadata reader and all unit/integration assertions for detection, safety, degradation, and immutability. |
| `examples/node-bug-repo/package.json` | Minimal Node example metadata with recognized verification script names. |
| `examples/node-bug-repo/src/price.js` | Intentional arithmetic defect. |
| `examples/node-bug-repo/test/price.test.js` | Node built-in test that fails before the demonstration patch. |
| `examples/python-bug-repo/pyproject.toml` | Minimal Python/pytest metadata. |
| `examples/python-bug-repo/src/calculator.py` | Intentional arithmetic defect. |
| `examples/python-bug-repo/tests/test_calculator.py` | Pytest test that fails before the demonstration patch. |
| `docs/PLAN.md`, `docs/AGENT_LOG.md`, task card, verification record | Completion evidence only after all implementation verification is green. |

### Task 1: Define the Detector Contract and Node.js Candidate Rules

**Files:** Create `packages/harness-core/src/project-detector.ts`, `packages/harness-core/test/project-detector.test.ts`; modify `packages/harness-core/src/index.ts`.

- [ ] **Step 1: Write failing Node detector tests**

```ts
class FakeMetadataReader {
  private readonly failures = new Map<string, Error>();
  constructor(private readonly files: Record<string, string>) {}
  readText(relativePath: string): string | undefined {
    const failure = this.failures.get(relativePath);
    if (failure) throw failure;
    return this.files[relativePath];
  }
  throwOn(relativePath: string, error: Error): void {
    this.failures.set(relativePath, error);
  }
}

function fakeReader(files: Record<string, string>): FakeMetadataReader {
  return new FakeMetadataReader(files);
}

it("detects exact Node verification scripts with pnpm argv templates", () => {
  const detector = new ProjectDetector(fakeReader({
    "package.json": JSON.stringify({
      scripts: { test: "vitest", lint: "eslint .", typecheck: "tsc --noEmit", build: "vite build" },
    }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  }));

  expect(detector.detect()).toMatchObject({
    kinds: ["node"],
    candidates: [
      { candidateId: "node.test", purpose: "test", argv: ["pnpm", "test"], confirmedByUser: false },
      { candidateId: "node.lint", purpose: "lint", argv: ["pnpm", "run", "lint"], confirmedByUser: false },
      { candidateId: "node.typecheck", purpose: "typecheck", argv: ["pnpm", "run", "typecheck"], confirmedByUser: false },
      { candidateId: "node.build", purpose: "build", argv: ["pnpm", "run", "build"], confirmedByUser: false },
    ],
  });
});

it("does not turn install, deploy, prepare, or unknown scripts into candidates", () => {
  const profile = new ProjectDetector(fakeReader({
    "package.json": JSON.stringify({ scripts: { install: "npm i", deploy: "ship", prepare: "setup", custom: "echo x" } }),
  })).detect();
  expect(profile.candidates).toEqual([]);
  expect(profile.notices.join(" ")).toContain("install");
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts`

Expected: FAIL because `ProjectDetector` and its module do not exist.

- [ ] **Step 3: Implement the read-only contract and Node rules**

```ts
export interface ProjectMetadataReader {
  readText(relativePath: string): string | undefined;
}

export type ProjectKind = "node" | "python";

export interface DetectedCommandCandidate {
  readonly candidateId: string;
  readonly purpose: "test" | "lint" | "typecheck" | "build";
  readonly argv: readonly string[];
  readonly workingDirectory: ".";
  readonly timeoutMs: 120_000;
  readonly confirmedByUser: false;
  readonly reason: string;
}

export interface DetectedProjectProfile {
  readonly kinds: readonly ProjectKind[];
  readonly candidates: readonly DetectedCommandCandidate[];
  readonly notices: readonly string[];
}
```

Implement `detect()` by reading `package.json` and the three Node lockfile paths separately. Parse JSON only in a `try/catch`; a malformed file must add the fixed notice `package.json could not be parsed` and let Python detection continue. Select the manager in this order: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, then `npm`. Generate only the four exact script-name templates, with reason `package.json script: <name>`. Freeze the returned profile, candidate array, each candidate, and every argv array.

- [ ] **Step 4: Add package-manager, malformed-metadata, and immutable snapshot tests**

```ts
it.each([
  ["package-lock.json", ["npm", "test"]],
  ["yarn.lock", ["yarn", "test"]],
  [undefined, ["npm", "test"]],
])("selects the expected manager", (lockfile, argv) => {
  const files = { "package.json": JSON.stringify({ scripts: { test: "x" } }) } as Record<string, string>;
  if (lockfile) files[lockfile] = "present";
  expect(new ProjectDetector(fakeReader(files)).detect().candidates[0]?.argv).toEqual(argv);
});

it("returns a notice instead of throwing for invalid package JSON", () => {
  const profile = new ProjectDetector(fakeReader({ "package.json": "{" })).detect();
  expect(profile.kinds).toEqual([]);
  expect(profile.notices).toContain("package.json could not be parsed");
});
```

Assert `Object.isFrozen(profile)`, `Object.isFrozen(profile.candidates)`, and `Object.isFrozen(profile.candidates[0]!.argv)`; mutation through a cast must throw `TypeError` in the ESM test runtime.

- [ ] **Step 5: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts`

Expected: PASS for Node scripts, all manager choices, unrecognized scripts, malformed JSON, and immutable snapshots.

Commit: `git add packages/harness-core/src/project-detector.ts packages/harness-core/src/index.ts packages/harness-core/test/project-detector.test.ts; git commit -m "feat: add safe Node project detection"`

### Task 2: Add Python and Mixed-Repository Detection

**Files:** Modify `packages/harness-core/src/project-detector.ts`, `packages/harness-core/test/project-detector.test.ts`.

- [ ] **Step 1: Write failing Python and mixed-repository tests**

```ts
it("detects pytest, ruff, and mypy only from explicit Python markers", () => {
  const profile = new ProjectDetector(fakeReader({
    "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n",
  })).detect();
  expect(profile).toMatchObject({
    kinds: ["python"],
    candidates: [
      { candidateId: "python.pytest", argv: ["python", "-m", "pytest"] },
      { candidateId: "python.ruff", argv: ["python", "-m", "ruff", "check", "."] },
      { candidateId: "python.mypy", argv: ["python", "-m", "mypy", "."] },
    ],
  });
});

it("detects a mixed repository and does not guess Python commands from requirements alone", () => {
  const profile = new ProjectDetector(fakeReader({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "requirements.txt": "requests==2.0\n",
  })).detect();
  expect(profile.kinds).toEqual(["node", "python"]);
  expect(profile.candidates.map((candidate) => candidate.candidateId)).toEqual(["node.test"]);
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts`

Expected: FAIL because Python marker rules and mixed kinds are absent.

- [ ] **Step 3: Implement bounded Python marker checks**

Use fixed case-insensitive marker regexes, not a TOML parser:

```ts
const PYTEST_MARKER = /\[tool\.pytest(?:\.ini_options)?\]|\[pytest\]|(?:^|\s)pytest(?:[<>=!~\s]|$)/im;
const RUFF_MARKER = /\[tool\.ruff\]|(?:^|\s)ruff(?:[<>=!~\s]|$)/im;
const MYPY_MARKER = /\[tool\.mypy\]|(?:^|\s)mypy(?:[<>=!~\s]|$)/im;
```

Treat any present `pytest.ini` as pytest evidence. Inspect `pyproject.toml` and `requirements.txt` only as text. A present Python metadata file establishes the `python` kind; no supported marker adds the fixed notice `python project detected but no supported verification command was found`. Emit `python.pytest`, `python.ruff`, and `python.mypy` candidates in that order with fixed argv and purpose `test`, `lint`, and `typecheck`.

- [ ] **Step 4: Add degradation tests**

```ts
it("keeps Node detection when a Python metadata read throws", () => {
  const reader = fakeReader({ "package.json": JSON.stringify({ scripts: { test: "x" } }) });
  reader.throwOn("pyproject.toml", new Error("host path must stay private"));
  const profile = new ProjectDetector(reader).detect();
  expect(profile.candidates[0]?.candidateId).toBe("node.test");
  expect(profile.notices).toContain("pyproject.toml could not be read");
  expect(JSON.stringify(profile)).not.toContain("host path");
});
```

Also test pytest detection through `pytest.ini` and requirements marker, ruff/mypy detection through requirements markers, and no duplicate candidate when a tool is declared in multiple files.

- [ ] **Step 5: Verify green and commit**

Run: `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts`

Expected: PASS for Python, mixed repositories, marker sources, missing markers, deduplication, and read-failure notices.

Commit: `git add packages/harness-core/src/project-detector.ts packages/harness-core/test/project-detector.test.ts; git commit -m "feat: add Python project detection"`

### Task 3: Add Deterministic Example Repositories

**Files:** Create all files under `examples/node-bug-repo/` and `examples/python-bug-repo/` named in the file map.

- [ ] **Step 1: Create failing example tests before the implementation files**

Create the test files so their imports reference absent `src/price.js` and `src/calculator.py`:

```js
// examples/node-bug-repo/test/price.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/price.js";

test("adds two prices", () => {
  assert.equal(add(2, 3), 5);
});
```

```python
# examples/python-bug-repo/tests/test_calculator.py
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from calculator import add


def test_adds_two_numbers() -> None:
    assert add(2, 3) == 5
```

- [ ] **Step 2: Verify red**

Run: `node --test examples/node-bug-repo/test/price.test.js`

Expected: FAIL because `examples/node-bug-repo/src/price.js` is absent.

Run: `python -m pytest examples/python-bug-repo/tests/test_calculator.py`

Expected: FAIL because `examples/python-bug-repo/src/calculator.py` is absent. If `pytest` itself is unavailable, stop and report the exact missing-environment output; do not install it or alter system dependencies.

- [ ] **Step 3: Add minimal intentionally buggy implementations and metadata**

Use the following deliberate defects:

```js
// examples/node-bug-repo/src/price.js
export function add(left, right) {
  return left - right;
}
```

```python
# examples/python-bug-repo/src/calculator.py
def add(left: int, right: int) -> int:
    return left - right
```

Create `examples/node-bug-repo/package.json` with this exact metadata:

```json
{
  "name": "todex-node-bug-repo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "lint": "node --check src/price.js",
    "typecheck": "node --check src/price.js",
    "build": "node --check src/price.js"
  }
}
```

Create `examples/python-bug-repo/pyproject.toml` with this exact metadata and no ruff/mypy dependency:

```toml
[project]
name = "todex-python-bug-repo"
version = "0.1.0"
dependencies = ["pytest"]

[tool.pytest.ini_options]
pythonpath = ["src"]
```

- [ ] **Step 4: Verify expected failing demonstrations**

Run: `node --test examples/node-bug-repo/test/price.test.js`

Expected: FAIL with an assertion showing the arithmetic defect.

Run: `python -m pytest examples/python-bug-repo/tests/test_calculator.py`

Expected: FAIL with an assertion showing the arithmetic defect, provided pytest is already installed. If unavailable, record the environment blocker without installing a package.

- [ ] **Step 5: Add detector-fixture assertions and commit**

Add tests that run the detector through the example metadata reader and assert `node.test`, `node.lint`, `node.typecheck`, `node.build`, and `python.pytest` candidates. Do not call the example scripts from a Harness test.

Run: `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts`

Expected: PASS while the two native example test commands remain intentionally failing.

Commit: `git add examples packages/harness-core/test/project-detector.test.ts; git commit -m "test: add Node and Python detector examples"`

### Task 4: Complete Evidence and Full Verification

**Files:** Modify `docs/PLAN.md`, `docs/AGENT_LOG.md`, `docs/task-cards/T-007-project-detection-and-examples.md`; create `docs/verification/2026-07-17-t-007-project-detection.md`.

- [ ] **Step 1: Run focused and complete verification**

Run: `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts`

Expected: PASS.

Run: `pnpm.cmd test --run`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, `git diff --check`, `git status --short`.

Expected: all commands pass, no whitespace error, no generated output or secret is untracked, and the only tracked change is the planned T-007 implementation/evidence.

- [ ] **Step 2: Record evidence and commit**

Record exact red/green commands and counts; package-manager precedence; ignored Node scripts; Python marker/no-marker behavior; zero command execution proof; native example failure output; environment observation for pytest; changed files; every commit; assumptions; and controlled exceptions.

Commit implementation evidence separately:

`git add packages/harness-core/src/project-detector.ts packages/harness-core/src/index.ts packages/harness-core/test/project-detector.test.ts examples; git commit -m "feat: add safe Node and Python project detection"`

`git add docs/PLAN.md docs/AGENT_LOG.md docs/task-cards/T-007-project-detection-and-examples.md docs/verification/2026-07-17-t-007-project-detection.md; git commit -m "docs: record T-007 verification"`

## Plan Self-Review

Task 1 defines the complete detector contract and Node-only rules. Task 2 adds Python, mixed-project, degradation, deduplication, and zero-leak behavior without changing the contract. Task 3 supplies two deliberately failing examples without making them runtime dependencies. Task 4 captures course evidence only after exact verification. No task executes a candidate command from the detector, persists a command, starts a real Harness process, adds a dependency, or touches later Electron/UI work.
