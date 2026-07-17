# T-007: Project Detection and Safe Verification Candidates

Status: ready
Responsible model: GLM
Lead review: Codex
Branch: `feat/t-007-project-detection`
Base: current `main` plus T-007 design/plan documentation commits
Authority: `docs/SPEC.md` sections 5, 7, 8, and 12; `docs/superpowers/specs/2026-07-17-t-007-project-detection-design.md`; `docs/superpowers/plans/2026-07-17-t-007-project-detection.md`; `docs/PLAN.md` T-007.

## Goal

Implement an injected, read-only detector that recognizes Node.js, Python, and mixed repositories and produces immutable unconfirmed verification-command candidates. Add deterministic, intentionally failing Node and Python example repositories.

## Allowed Files

- Create `packages/harness-core/src/project-detector.ts`.
- Modify `packages/harness-core/src/index.ts`.
- Create `packages/harness-core/test/project-detector.test.ts`.
- Create files only under `examples/node-bug-repo/` and `examples/python-bug-repo/` specified by the implementation plan.
- Modify `docs/PLAN.md`, `docs/AGENT_LOG.md`, and this task card only when final evidence is ready; create `docs/verification/2026-07-17-t-007-project-detection.md`.

Stop and report before changing contracts, dependencies, package manifests outside the two examples, CI, Electron, apps, persistence, Guardrail, AgentRunner, file tools, or unrelated documentation.

## Frozen Rules

- The detector reads only `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `pyproject.toml`, `pytest.ini`, and `requirements.txt` through an injected reader. It never executes a command or invokes a process, shell, network, LLM, ToolDispatcher, AgentRunner, or CommandRunner.
- Node emits candidates only for exact `test`, `lint`, `typecheck`, and `build` script keys. `install`, `prepare`, `postinstall`, `deploy`, `release`, `publish`, and every other script never become candidates.
- Node manager precedence is pnpm lockfile, npm lockfile, yarn lockfile, then npm fallback. Candidates use Todex-owned fixed argv templates, never the script body.
- Python emits pytest, ruff, or mypy candidates only from explicit textual markers. A Python marker file without one of those tools creates no guessed candidate and a bounded notice.
- Every candidate is unconfirmed, uses `workingDirectory: "."`, `timeoutMs: 120000`, fixed argv, a deterministic ID/reason, and an immutable returned profile. T-007 does not create `ConfiguredCommand` records.
- Invalid/unreadable metadata returns a fixed path-only notice and does not prevent detection from another metadata file. No raw metadata content or absolute path may enter a notice.
- Examples deliberately fail their arithmetic test before a later repair patch. Do not install pytest if it is missing; record that environment fact instead.

## TDD and Final Report

1. Follow the implementation plan task by task. Write and run a failing test before each production behavior change.
2. Use `pnpm.cmd`; run every focused and full command from the plan before documenting final evidence.
3. Commit Node detector, Python detector, examples, and documentation evidence separately where the plan specifies.
4. Do not push, create a PR, merge main, or start T-008.
5. Report changed files, full commit hashes, all RED/GREEN evidence, candidate command/manager proof, ignored-script proof, Python marker/no-marker proof, zero-execution proof, immutability proof, example native-test results, assumptions, environment observations, and controlled exceptions.
