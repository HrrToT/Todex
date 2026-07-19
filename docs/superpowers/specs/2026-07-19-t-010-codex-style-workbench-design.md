# T-010 Codex-Style Workbench Design

**Status:** approved for implementation planning.

## Goal

Build Todex's first usable desktop workbench: a dark, Codex-style execution-flow UI that reads T-009's typed host boundary and presents deterministic Mock-run fixtures without introducing real LLM, shell, file-write, or installer behavior.

## Confirmed Product Shape

- The center of the product is an execution stream, not a dashboard grid: user task, Agent message, tool event, patch summary, verification feedback, and terminal outcome appear in causal order.
- A narrow left rail contains workspace/project summary, recent Runs, and fixed Trace/Memory/Settings navigation.
- The right Inspector is collapsed by default. It opens for approval, patch, verification failure, or selected trace, and can be manually pinned or closed.
- The bottom TaskComposer is the single task/continuation input. T-010 does not add multi-session, uploads, image input, slash-command systems, or a full settings workflow.
- Dark visual language, restrained dividers, compact controls, fixed tool surfaces, and code-oriented typography should feel close to Codex rather than a card-heavy operations dashboard.

## Architecture

`apps/desktop/src/renderer` owns React UI only. It receives project, Run, approval, memory, and credential-status DTOs through T-009's preload bridge; it imports neither Electron, SQLite, keytar, Node `fs`, nor Harness Core.

A renderer `RunController` interface supplies either deterministic fixtures in Mock mode or a later host event adapter. Fixtures demonstrate `running -> verification failure -> awaiting approval -> completed` without invoking a model, project command, patch, or shell. The UI is therefore usable and testable now without claiming real execution.

## Components

| Component | Responsibility |
| --- | --- |
| `WorkbenchApp` | Own layout state, selected Run, Inspector state, and bridge reads. |
| `WorkspaceRail` | Project summary, recent Runs, compact navigation. |
| `ExecutionStream` | Chronological user/agent/tool/verification/terminal events. |
| `TaskComposer` | Bottom task or continuation input. |
| `InspectorPanel` | Collapsible tabs: Diff, Approval, Trace, Memory. |
| `ApprovalCard` | Risk reasons and explicit typed decision buttons only. |
| `DiffPanel` | Render host-provided patch summary/diff; never parse/apply a patch. |
| `TraceTimeline` | Select events and focus Inspector without exposing secret/raw error text. |

## Interaction and Safety

Run states are explicit (`idle`, `running`, `awaiting_approval`, `completed`, `failed`, `cancelled`) through text, icons, and accessible labels, never color alone. Approval opens Inspector but does not steal composer focus. Approval decisions carry only `approvalId` and fixed scope/deny values to typed IPC. Renderer text must exclude API keys, credential references, sensitive file content, and raw unredacted failures.

On narrow screens, the rail becomes icon-oriented and Inspector becomes a right drawer; the execution stream and composer remain readable. Text must not overflow, and fixed tool controls must not shift layout when state changes.

## Testing

Component/flow tests cover Inspector automatic/manual behavior, trace-to-tab selection, approval payload shape, fixture state progression, Run selection, redaction, and keyboard reachability. Browser/Playwright screenshots are required only in an environment that can complete Electron lifecycle. The known local `app.whenReady()` access-violation exception is recorded rather than reported as a passing Electron UI test; T-012 covers installer/environment validation.

## Out of Scope

Real LLM execution, arbitrary shell, real patch/file operations, full settings UI, file-tree IDE behavior, multi-session/history product features, demo-web, packaging, and release distribution are not T-010 work.
