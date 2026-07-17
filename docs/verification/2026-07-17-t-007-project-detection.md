# T-007 Project Detection and Safe Verification Candidates Verification

Status: verified
Verification date: 2026-07-17
Verification branch: `feat/t-007-project-detection`
Base: `main` at `c2338cb`

## Scope

This record verifies the injected, read-only `ProjectDetector` that recognizes Node.js, Python, and mixed repositories from bounded metadata files and returns immutable, unconfirmed verification-command candidates. It covers Node script-name candidate generation, package-manager precedence, dangerous-script exclusion, fixed-argv templates, Python pytest/ruff/mypy textual marker detection, requirements-only no-guess behavior, mixed-project detection, malformed/unreadable metadata degradation, zero command execution, runtime immutability, and two deliberately failing example repositories. It does not claim candidate confirmation, persistence, real process execution, Electron, SQLite, or network coverage; those are T-006, T-009, and later tasks.

## Implementation and review chain

| Commit | Purpose |
| --- | --- |
| `830f32d` | `feat: add safe Node project detection` — `ProjectMetadataReader`, `DetectedCommandCandidate`, `DetectedProjectProfile`, `ProjectDetector` with Node rules, package-manager precedence, malformed JSON notices, immutable snapshots; public exports in `index.ts` |
| `ddc570d` | `feat: add Python project detection` — bounded textual marker regexes for pytest/ruff/mypy, `pytest.ini` presence rule, requirements-only no-guess notice, mixed-project kinds, per-file read-failure degradation with no content leakage |
| `b41ac16` | `test: add Node and Python detector examples` — `examples/node-bug-repo` and `examples/python-bug-repo` with intentional arithmetic defects, detector-fixture assertions for all four Node candidates and the Python pytest candidate |

## Red-green evidence

| Stage | Command | Result |
| --- | --- | --- |
| Task 1 RED | `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts` | 0 tests collected; `Failed to load url ../src/project-detector.js` |
| Task 1 GREEN | Same | 18/18 passed |
| Task 2 RED | Same | 13 failed / 18 passed (31 total); Python kinds and candidates absent |
| Task 2 GREEN | Same | 31/31 passed |
| Task 3 RED (Node) | `node --test examples/node-bug-repo/test/price.test.js` | 1 fail; `ERR_MODULE_NOT_FOUND` for absent `src/price.js` |
| Task 3 RED (Python) | `python -m pytest examples/python-bug-repo/tests/test_calculator.py` | `No module named pytest` (environment blocker; not installed) |
| Task 3 GREEN (Node arithmetic defect) | `node --test examples/node-bug-repo/test/price.test.js` | 1 fail; `AssertionError: -1 !== 5` (intentional `left - right` defect) |
| Task 3 GREEN (detector fixtures) | `pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts` | 34/34 passed |
| Full suite | `pnpm.cmd test --run` | 361/361 passed across 11 test files |
| Type safety | `pnpm.cmd typecheck` | Exit code 0 |
| Lint | `pnpm.cmd lint` | Exit code 0 |
| Build | `pnpm.cmd build` | Exit code 0; contracts TypeScript build executed |
| Whitespace | `git diff --check` | No whitespace errors |
| Status | `git status --short` | Clean working tree after final commit |

Test file breakdown:
- `contracts.test.ts`: 37 tests
- `agent-runner.test.ts`: 36 tests
- `guardrail.test.ts`: 75 tests
- `file-tools.test.ts`: 50 tests
- `memory-store.test.ts`: 28 tests
- `approval-state-machine.test.ts`: 42 tests
- `trace-store.test.ts`: 4 tests
- `smoke.test.ts`: 1 test
- `verification-runner.test.ts`: 33 tests
- `repair-loop.test.ts`: 21 tests
- `project-detector.test.ts`: 34 tests

## Node package-manager precedence proof

The `selectManager` method checks lockfiles in fixed order and returns the first match:

| Lockfile present | Expected manager | Test |
| --- | --- | --- |
| `pnpm-lock.yaml` | `pnpm` | `detects exact Node verification scripts with pnpm argv templates` — `argv: ["pnpm", "test"]` |
| `package-lock.json` | `npm` | `selects the expected manager for lockfile package-lock.json` — `argv: ["npm", "test"]` |
| `yarn.lock` | `yarn` | `selects the expected manager for lockfile yarn.lock` — `argv: ["yarn", "test"]` |
| none | `npm` | `selects the expected manager for lockfile undefined` — `argv: ["npm", "test"]` |
| pnpm + npm lockfile | `pnpm` | `prefers pnpm over npm lockfile` — `argv: ["pnpm", "test"]` |
| npm + yarn lockfile | `npm` | `prefers npm lockfile over yarn lockfile` — `argv: ["npm", "test"]` |

## Dangerous and unrecognized Node scripts ignored proof

The test `does not turn install, deploy, prepare, or unknown scripts into candidates` provides `scripts: { install: "npm i", deploy: "ship", prepare: "setup", custom: "echo x" }` and asserts:

- `profile.candidates` is `[]` — no candidate generated.
- `profile.notices.join(" ")` contains `"install"` — the ignored script names appear in an informational notice only.

The `RECOGNIZED_NODE_SCRIPTS` set contains exactly `test`, `lint`, `typecheck`, `build`. Every other script key — including `install`, `prepare`, `postinstall`, `deploy`, `release`, `publish`, and arbitrary custom names — is collected into the notice `package.json scripts not used as verification candidates: <names>` and never becomes a candidate.

## Fixed argv templates, not script body proof

The test `uses fixed argv templates and never copies script body text` provides `scripts: { test: "vitest --reporter=verbose --coverage" }` and asserts:

- `profile.candidates[0].argv` is `["npm", "test"]` — the fixed template, not the script body.
- `JSON.stringify(profile)` does not contain `--reporter` or `--coverage` — no script text leaks into the profile.

The `NODE_SCRIPT_RULES` array builds argv from `(manager) => [manager, "test"]` or `(manager) => [manager, "run", name]`. The detector never reads, parses, interpolates, or copies the script value string; it only checks `typeof value === "string"` to confirm the script exists.

## Python pytest/ruff/mypy marker proof

| Marker source | Candidate | Test |
| --- | --- | --- |
| `pyproject.toml` with `[tool.pytest.ini_options]`, `[tool.ruff]`, `[tool.mypy]` | `python.pytest`, `python.ruff`, `python.mypy` | `detects pytest, ruff, and mypy only from explicit Python markers` |
| `pytest.ini` presence | `python.pytest` | `detects pytest from pytest.ini presence` |
| `requirements.txt` with `pytest==8.0` | `python.pytest` | `detects pytest and ruff from requirements.txt markers` |
| `requirements.txt` with `ruff==0.6.0` | `python.ruff` | same test |
| `requirements.txt` with `mypy==1.11.0` | `python.mypy` | `detects mypy from requirements.txt marker` |

Marker regexes (case-insensitive, multiline, no `g` flag):
- `PYTEST_MARKER`: `/\[tool\.pytest(?:\.ini_options)?\]|\[pytest\]|(?:^|\s)pytest(?:[<>=!~\s]|$)/im`
- `RUFF_MARKER`: `/\[tool\.ruff\]|(?:^|\s)ruff(?:[<>=!~\s]|$)/im`
- `MYPY_MARKER`: `/\[tool\.mypy\]|(?:^|\s)mypy(?:[<>=!~\s]|$)/im`

The `(?:^|\s)` prefix and `(?:[<>=!~\s]|$)` suffix prevent matching tool names embedded in other words (e.g., `somepytest` does not match).

## Requirements-only no-guess proof

The test `does not guess Python commands from requirements alone` provides `requirements.txt: "requests==2.0\nflask==1.0\n"` and asserts:

- `profile.kinds` is `["python"]` — the file establishes the Python kind.
- `profile.candidates` is `[]` — no guessed command.
- `profile.notices` contains `"python project detected but no supported verification command was found"`.

The mixed-repository test `detects a mixed repository and does not guess Python commands from requirements alone` provides both `package.json` (with `test` script) and `requirements.txt` (with `requests==2.0`) and asserts `kinds: ["node", "python"]` with only `["node.test"]` as a candidate — no Python candidate is guessed.

## Deduplication proof

The test `does not duplicate candidates when a tool is declared in multiple files` provides `pyproject.toml`, `pytest.ini`, and `requirements.txt` all containing pytest markers and asserts exactly one `python.pytest` candidate.

## Mixed-project proof

The test `detects a mixed Node and Python repository with candidates from both` provides `package.json` (with `test` and `lint` scripts) and `pyproject.toml` (with pytest and ruff markers) and asserts:

- `profile.kinds` is `["node", "python"]`.
- `profile.candidates.map(c => c.candidateId)` is `["node.test", "node.lint", "python.pytest", "python.ruff"]`.

Node candidates always precede Python candidates because `detect()` calls `detectNode` before `detectPython`.

## Malformed and unreadable metadata degradation proof

| Scenario | Test | Key assertions |
| --- | --- | --- |
| Invalid JSON `{` | `returns a notice instead of throwing for invalid package JSON` | `kinds: []`, notice `package.json could not be parsed` |
| Non-object JSON | `returns a notice for non-object package JSON` | same notice |
| Array JSON | `returns a notice for array package JSON` | same notice |
| `scripts` not an object | `returns a notice when scripts field is not an object` | `kinds: ["node"]`, `candidates: []`, notice `package.json scripts field is not an object` |
| Non-string script value | `returns a notice when a relevant script value is not a string` | `node.lint` candidate present; notice mentions `test` |
| `pyproject.toml` read throws | `keeps Node detection when a Python metadata read throws` | `node.test` candidate present; notice `pyproject.toml could not be read`; no `host path` in JSON |
| `pyproject.toml` throws, `requirements.txt` has pytest | `continues Python detection from requirements.txt when pyproject.toml throws` | `python.pytest` candidate present; notice for pyproject; no `D:\` in JSON |
| `pytest.ini` read throws | `does not leak raw error content when pytest.ini read throws` | `python.ruff` candidate present; notice `pytest.ini could not be read`; no `secret-value` or `permission denied` |
| `requirements.txt` read throws | `does not leak raw error content when requirements.txt read throws` | `python.pytest` candidate present; notice `requirements.txt could not be read`; no `/home/user` |

Each metadata file is read independently in a `try/catch`. A read failure adds the fixed notice `<filename> could not be read` and returns `undefined` for that file; it does not prevent detection from other files. The notice contains only the relative filename — no absolute path, no error message, and no raw file content.

## Zero command execution proof

The `ProjectDetector` class has no dependency on `AgentRunner`, `ToolDispatcher`, `CommandRunner`, `CommandExecution`, shell, process, network, LLM, SQLite, or Electron. Its constructor accepts only a `ProjectMetadataReader` with a single method:

```ts
export interface ProjectMetadataReader {
  readText(relativePath: string): string | undefined;
}
```

The `detect()` method calls `readText` for seven named paths (`package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `pyproject.toml`, `pytest.ini`, `requirements.txt`) and returns a `DetectedProjectProfile`. No method on `ProjectDetector` or `ProjectMetadataReader` can dispatch an action, spawn a process, or execute a command. The `DetectedCommandCandidate` type carries `confirmedByUser: false` as a literal type, making it structurally incompatible with `ConfiguredCommand` (which requires `confirmedByUser: boolean`) until a later confirmation flow explicitly converts it.

## Immutable return snapshot proof

| Test | Assertion |
| --- | --- |
| `freezes the returned profile, candidates, and argv arrays` | `Object.isFrozen(profile)` is `true`; `Object.isFrozen(profile.kinds)` is `true`; `Object.isFrozen(profile.candidates)` is `true`; `Object.isFrozen(profile.notices)` is `true`; `Object.isFrozen(candidate)` is `true`; `Object.isFrozen(candidate.argv)` is `true` for all candidates |
| `throws TypeError when mutating profile fields through a cast` | Pushing to `kinds`, `notices`, or `candidates` throws `TypeError` |
| `throws TypeError when mutating a candidate or its argv` | Setting `purpose`, pushing to `argv`, or setting `confirmedByUser` throws `TypeError` |

The `createCandidate` helper calls `Object.freeze` on the argv array and the candidate object. The `detect` method calls `Object.freeze` on the `kinds`, `candidates`, `notices` arrays and the outer profile object.

## Example repository native test results

### Node example (`examples/node-bug-repo`)

Command: `node --test examples/node-bug-repo/test/price.test.js`

The test file imports `add` from `../src/price.js` and asserts `add(2, 3) === 5`. The implementation returns `left - right`, so `add(2, 3)` returns `-1`.

Result: **FAIL** with arithmetic defect:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  -1 !== 5

    actual: -1
    expected: 5
    operator: 'strictEqual'
```

This is the intentional defect for later demonstration patch use. The test is not fixed by T-007.

### Python example (`examples/python-bug-repo`)

Command: `python -m pytest examples/python-bug-repo/tests/test_calculator.py`

Environment: Python 3.14.2 is installed at `C:\Users\Lenovo\AppData\Local\Programs\Python\Python314\python.exe`. The `pytest` module is not installed.

Result: **FAIL** — environment blocker:

```
C:\Users\Lenovo\AppData\Local\Programs\Python\Python314\python.exe: No module named pytest
```

Per the task card and plan, pytest was not installed and system dependencies were not altered. The detector still recognizes the `python.pytest` candidate from the `[tool.pytest.ini_options]` marker in `pyproject.toml` through textual detection, without requiring pytest to be present.

### Detector fixture assertions

The test suite includes three fixture-based tests that run the detector through `FakeMetadataReader` with the exact example metadata content:

- `detects all four Node verification candidates from the node-bug-repo metadata` — asserts `node.test`, `node.lint`, `node.typecheck`, `node.build` with `npm` manager (no lockfile in the example).
- `detects the pytest candidate from the python-bug-repo metadata` — asserts `python.pytest` with `["python", "-m", "pytest"]`.
- `does not detect ruff or mypy from the python-bug-repo metadata` — asserts no `python.ruff` or `python.mypy` candidates.

These tests do not call the example scripts; they verify only that the detector produces the expected candidates from the metadata.

## Full verification output summary

```
pnpm.cmd --filter @todex/harness-core test --run project-detector.test.ts  → 34/34 passed
pnpm.cmd test --run     → 361/361 passed (11 test files)
pnpm.cmd typecheck      → Exit code 0
pnpm.cmd lint           → Exit code 0
pnpm.cmd build          → Exit code 0
git diff --check        → No whitespace errors
git status --short      → Clean
```

## Assumptions and controlled exceptions

1. **No TOML parser dependency**: Per the frozen constraints, T-007 uses bounded textual marker regexes instead of a TOML parser. The regexes match `[tool.pytest]`, `[tool.pytest.ini_options]`, `[pytest]`, `[tool.ruff]`, `[tool.mypy]` section headers and bare dependency names with version specifiers. They do not interpret TOML semantics; a tool name in a comment could theoretically match, but this is acceptable for candidate suggestion (the user still confirms before execution).

2. **`pytest.ini` presence equals pytest evidence**: The design states "Treat any present `pytest.ini` as pytest evidence." The detector does not parse `pytest.ini` content; its mere presence (readText returns a non-undefined string) generates the `python.pytest` candidate.

3. **Node example ESM without lockfile**: The `examples/node-bug-repo/package.json` has `"type": "module"` and no lockfile. The detector selects `npm` as the manager and generates `["npm", "test"]`, `["npm", "run", "lint"]`, `["npm", "run", "typecheck"]`, `["npm", "run", "build"]`. The example does not install dependencies; `node --test` and `node --check` are built-in Node.js commands.

4. **Python example has no ruff or mypy**: The `examples/python-bug-repo/pyproject.toml` deliberately contains only `[tool.pytest.ini_options]` and no ruff or mypy configuration. This ensures the example never requires an extra installation for ruff or mypy detection.

5. **pytest environment blocker**: Python 3.14.2 is available but `pytest` is not installed. The plan explicitly requires recording this fact without installing pytest. The detector's textual marker check still identifies the `python.pytest` candidate from `pyproject.toml` without requiring pytest to be present in the environment.

6. **No candidate confirmation or persistence**: T-007 returns `DetectedCommandCandidate` with `confirmedByUser: false`. It does not create `ConfiguredCommand` records, persist to SQLite, or call any host adapter. Candidate confirmation and persistence are T-009 and T-010+.

7. **No real command execution**: The `ProjectDetector` reads only metadata files through the injected `ProjectMetadataReader`. It has no import of `child_process`, `CommandRunner`, `ToolDispatcher`, `AgentRunner`, or any network/LLM module. Zero command execution is structural, not conventional.

8. **Node.js v24.14.0**: The test environment uses Node.js v24.14.0, which treats `.js` files with `import` as ESM when `node --test` is used, even without a `package.json` with `"type": "module"` in the same directory. The example includes `package.json` with `"type": "module"` regardless for correctness in all Node.js versions.

## T-008 and T-009 deferral

T-007 produces unconfirmed candidates only. Mechanism demonstration scripts (T-008) and SQLite persistence with desktop host adapters (T-009) are out of scope. No real process execution, project persistence, Electron, or network call was introduced.
