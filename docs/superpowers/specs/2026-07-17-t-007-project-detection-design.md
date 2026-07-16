# T-007 Project Detection and Verification Candidate Design

**Status:** approved for specification writing; implementation requires a separate plan and task card.

## Goal

Make Todex feel like a coding agent that understands a small repository without asking the user to declare its stack or manually type a test command. Given a selected workspace, T-007 identifies Node.js, Python, or mixed repositories and returns safe verification-command candidates for later user confirmation.

T-007 is discovery only. It never runs a candidate, installs a dependency, writes a project file, calls an LLM, persists data, or opens a UI.

## User Experience

After the user selects a workspace, Todex scans a small set of project metadata files and can report results such as:

- "Node.js project detected; found test, lint, typecheck, and build scripts."
- "Python project detected; pytest and ruff configuration found."
- "Node.js and Python project detected."

Each suggested command has a human-readable reason and is initially unconfirmed. A later host/UI task presents the candidates to the user. Only a user-confirmed candidate may become the fixed `ConfiguredCommand` consumed by T-006 verification.

The user never needs to preconfigure the project type or type a verification command merely to start using Todex.

## Scope and Non-goals

### In scope

- Read bounded Node.js and Python project metadata.
- Detect Node.js, Python, and mixed repositories.
- Generate structured, non-executing candidates for recognized verification purposes.
- Select the Node package-manager command prefix from a lockfile.
- Create deterministic, deliberately failing Node and Python example repositories for later Mock-agent demonstrations.
- Test all detection behavior using injected filesystem data or deterministic fixtures.

### Out of scope

- Executing, installing, updating, or approving commands.
- Creating persisted projects or `ConfiguredCommand` records.
- Real process spawning, shell strings, network access, Electron, WebUI, SQLite, credential storage, or LLM integration.
- Supporting ecosystems other than Node.js and Python.
- Guessing arbitrary package scripts or Python commands.

T-006 remains the verification/repair owner. T-009 owns persistence and host adapters. T-010 and later own UI confirmation and Electron presentation.

## Architecture

`ProjectDetector` receives a workspace root and an injected read-only metadata filesystem. It attempts to read only the following paths at that root:

- Node.js: `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`.
- Python: `pyproject.toml`, `pytest.ini`, `requirements.txt`.

It returns a `DetectedProjectProfile` containing:

- `kinds`: zero, one, or both of `node` and `python`.
- `candidates`: immutable structured verification suggestions.
- `notices`: deterministic non-sensitive explanations for malformed metadata or recognized-but-not-recommended scripts.

Each candidate contains a deterministic candidate ID, purpose (`test`, `lint`, `typecheck`, or `build`), an argv array, a workspace-relative working directory, a timeout, an `unconfirmed` state, and a detection reason. It is not a `ConfiguredCommand` yet because the user has not confirmed it and T-009 does not yet persist projects or commands.

The detector's filesystem boundary exposes only `exists(path)` and bounded `readText(path)` behavior. It cannot dispatch actions or invoke a command runner. This makes zero command execution structural rather than conventional.

## Node.js Detection Rules

`package.json` identifies a Node.js project when it is a valid object. The detector reads `scripts` only when it is an object whose relevant values are strings.

Only these exact script names become candidates:

| Script | Candidate purpose | argv form |
| --- | --- | --- |
| `test` | `test` | `<manager> test` |
| `lint` | `lint` | `<manager> run lint` |
| `typecheck` | `typecheck` | `<manager> run typecheck` |
| `build` | `build` | `<manager> run build` |

`<manager>` is selected in this fixed order: `pnpm` when `pnpm-lock.yaml` exists; otherwise `npm` when `package-lock.json` exists; otherwise `yarn` when `yarn.lock` exists; otherwise `npm`.

Scripts such as `install`, `prepare`, `postinstall`, `prepublishOnly`, `deploy`, `release`, `publish`, and every unrecognized script remain visible only through an informational notice. They never become verification candidates. The detector does not parse, validate, interpolate, or execute a script's shell text; it emits only its fixed package-manager argv template.

Malformed JSON, non-object JSON, a non-object `scripts` field, or non-string relevant script values create notices but do not stop Python detection or other valid Node candidates.

## Python Detection Rules

The presence of at least one of `pyproject.toml`, `pytest.ini`, or `requirements.txt` identifies a Python project.

The detector uses textual, non-executing marker checks:

| Evidence | Candidate | Purpose |
| --- | --- | --- |
| `pytest.ini`, a pytest section/configuration in `pyproject.toml`, or a pytest dependency/marker in `requirements.txt` | `python -m pytest` | `test` |
| a ruff section/configuration in `pyproject.toml` or ruff dependency/marker in `requirements.txt` | `python -m ruff check .` | `lint` |
| a mypy section/configuration in `pyproject.toml` or mypy dependency/marker in `requirements.txt` | `python -m mypy .` | `typecheck` |

The detector never recommends dependency installation merely because `requirements.txt` exists. A Python marker file without pytest, ruff, or mypy evidence yields a Python kind and a notice, but no guessed verification candidate.

Unreadable or malformed metadata yields a notice and leaves independently discovered candidates intact.

## Safety and Confirmation Boundary

All candidate command values are created by Todex from fixed argv templates, never copied from arbitrary project script strings. Candidates are marked unconfirmed and cannot be passed directly to T-006.

A later confirmation flow must create a project-scoped `ConfiguredCommand` with `confirmedByUser: true`. It must preserve the selected fixed argv, working directory, purpose, and timeout. T-006 then independently verifies project ID, command ID, and confirmation before dispatching its injected `CommandRunner`.

This division gives the user Codex-like automatic project recognition without allowing an LLM or arbitrary repository metadata to choose an executable command.

## Example Repositories

T-007 creates two small deterministic examples:

- `examples/node-bug-repo`: Node test project with `test`, `lint`, `typecheck`, and `build` scripts, plus an intentional arithmetic defect that causes its test to fail before a patch.
- `examples/python-bug-repo`: Python pytest project with an intentional arithmetic defect that causes its test to fail before a patch. It deliberately contains no ruff or mypy dependency; ruff/mypy discovery rules use textual detector fixtures so the example never requires an extra installation.

The examples contain no credentials, network behavior, package installation, or external services. Their role is to provide T-008 and later demo layers with reproducible repository inputs, not to become production dependencies.

## Error Handling

- Missing metadata files are normal and produce no error.
- Invalid or unreadable metadata produces a bounded, path-only notice with no raw file content.
- A failure reading one metadata file does not prevent detection from other metadata files.
- Candidate arrays, argv arrays, and returned profile containers are immutable snapshots.
- The detector must not surface absolute host paths or metadata contents in notices.

## Test Strategy and Acceptance Evidence

The GLM implementation must use TDD and first create failing tests for:

1. Node candidate discovery for exact `test`, `lint`, `typecheck`, and `build` scripts.
2. Package-manager selection for pnpm, npm, yarn, and no lockfile.
3. Dangerous/unrecognized Node scripts not becoming candidates.
4. Python discovery through `pyproject.toml`, `pytest.ini`, and `requirements.txt` markers.
5. Python projects with no supported verification markers producing no guessed command.
6. Mixed Node/Python detection.
7. Malformed metadata and read failures degrading to notices while other signals still work.
8. Fixed argv arrays, unconfirmed candidates, immutable snapshots, and zero command-runner/process invocation.
9. Native example tests failing before their demonstration patch.

The final T-007 evidence must include focused detector tests, the complete monorepo test/typecheck/lint/build commands, `git diff --check`, the exact example failure commands, and a record that no real command execution was introduced into Harness Core.

## Collaboration and Review

One GLM agent implements all Node and Python detection, examples, and tests in one isolated feature worktree. It must not push, create a PR, merge, or begin T-008.

Codex owns the implementation plan and frozen task card, performs independent specification review followed by code-quality/security review, requires fixes for all blocking findings, pushes the reviewed branch, creates the GitHub PR, checks CI, and waits for explicit user authorization before merge.

## Design Self-Review

- No placeholder behavior is delegated to an unnamed future task: command execution, persistence, and UI ownership are explicitly assigned to T-006, T-009, and T-010+.
- Candidate generation is deterministic and does not parse arbitrary script text into executable shell strings.
- Node and Python rules are bounded to named files and named verification purposes.
- The confirmation boundary is explicit: detection cannot create an executable verified command by itself.
