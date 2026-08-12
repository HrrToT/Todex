import { t, type Locale } from "./i18n.js";

export type RunPhase = "idle" | "running" | "awaiting_approval" | "failed" | "completed";
export type InspectorTab = "diff" | "approval" | "trace" | "memory";
export type ApprovalDecision = "once" | "run" | "command_prefix" | "deny";

export interface ApprovalDecisionInput {
  approvalId: string;
  decision: ApprovalDecision;
}

export interface StreamEvent {
  id: string;
  kind: "user" | "agent" | "tool" | "patch" | "verification" | "outcome";
  title: string;
  detail: string;
}

export interface WorkbenchSnapshot {
  phase: RunPhase;
  task: string;
  events: readonly StreamEvent[];
  inspectorTab: InspectorTab | null;
  approvalId?: string;
}

function idleEvents(locale: Locale): readonly StreamEvent[] {
  return [{ id: "idle", kind: "agent", title: t(locale, "demo.readyForTask"), detail: t(locale, "demo.streamWillAppear") }];
}

export interface LiveRunBridge {
  start(input: { projectId: string; task: string; modelConfigId: string; verificationCommandId?: string }): Promise<unknown>;
  snapshot(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
}

export class LiveRunController {
  private currentSnapshot: WorkbenchSnapshot = {
    phase: "idle",
    task: "",
    events: [],
    inspectorTab: null,
  };
  private runId: string | undefined;

  constructor(private readonly bridge: LiveRunBridge, private readonly locale: Locale = "zh-CN") {}

  current(): WorkbenchSnapshot { return this.currentSnapshot; }

  async start(task: string, input: { projectId: string; modelConfigId: string; verificationCommandId?: string }): Promise<WorkbenchSnapshot> {
    const result = await this.bridge.start({ ...input, task });
    this.currentSnapshot = this.fromResult(result, task);
    this.runId = this.readRunId(result);
    return this.currentSnapshot;
  }

  async decide(): Promise<WorkbenchSnapshot> {
    if (!this.runId) return this.currentSnapshot;
    const result = await this.bridge.snapshot(this.runId);
    this.currentSnapshot = this.fromResult(result, this.currentSnapshot.task);
    return this.currentSnapshot;
  }

  async cancel(): Promise<void> {
    if (this.runId) await this.bridge.cancel(this.runId);
  }

  private fromResult(raw: unknown, task: string): WorkbenchSnapshot {
    const result = raw as { status?: string; pendingApproval?: { approvalId: string }; trace?: Array<{ eventId: string; type: string; payloadSummary: string }> };
    const phase: RunPhase = result.status === "awaiting_approval" ? "awaiting_approval" : result.status === "completed" || result.status === "completed_unverified" ? "completed" : result.status?.startsWith("failed") || result.status === "cancelled" ? "failed" : "running";
    const events = (result.trace ?? []).map((event) => ({
      id: event.eventId,
      kind: traceKind(event.type),
      title: event.type,
      detail: event.payloadSummary,
    }));
    return { phase, task, events, inspectorTab: phase === "awaiting_approval" ? "approval" : "trace", approvalId: result.pendingApproval?.approvalId };
  }

  private readRunId(raw: unknown): string | undefined { return (raw as { run?: { runId?: string } }).run?.runId; }
}

function traceKind(type: string): StreamEvent["kind"] {
  if (type === "tool_completed") return "tool";
  if (type === "verification_completed") return "verification";
  if (type === "action_requested" || type === "action_rejected") return "agent";
  if (type === "run_completed" || type === "run_failed" || type === "run_cancelled") return "outcome";
  return "agent";
}

function visibleTask(task: string, locale: Locale): string {
  return /(?:api[_-]?key|token|credentialref)\s*=/i.test(task)
    ? t(locale, "demo.withheldTask")
    : task;
}

export class DemoRunController {
  private snapshot: WorkbenchSnapshot;

  constructor(private readonly locale: Locale = "zh-CN") {
    this.snapshot = { phase: "idle", task: "", events: idleEvents(locale), inspectorTab: null };
  }

  current(): WorkbenchSnapshot {
    return this.snapshot;
  }

  start(task: string): WorkbenchSnapshot {
    const rawTask = task.trim() || t(this.locale, "demo.defaultTask");
    const normalizedTask = visibleTask(rawTask, this.locale);
    const requestsApproval = /install|approve|permission/i.test(rawTask);
    const baseEvents: StreamEvent[] = [
      { id: "task", kind: "user", title: "You", detail: normalizedTask },
      { id: "plan", kind: "agent", title: "Todex", detail: t(this.locale, "demo.plan") },
      { id: "read", kind: "tool", title: "read_file", detail: "src/calculator.ts" },
    ];

    if (requestsApproval) {
      this.snapshot = {
        phase: "awaiting_approval",
        task: normalizedTask,
        events: [...baseEvents, { id: "approval", kind: "outcome", title: t(this.locale, "demo.approvalRequired"), detail: t(this.locale, "demo.scopedCommandNeedsDecision") }],
        inspectorTab: "approval",
        approvalId: "approval-demo-1",
      };
      return this.snapshot;
    }

    this.snapshot = {
      phase: "failed",
      task: normalizedTask,
      events: [
        ...baseEvents,
        { id: "patch", kind: "patch", title: t(this.locale, "demo.patchPrepared"), detail: "src/calculator.ts (+1 -1)" },
        { id: "verify", kind: "verification", title: t(this.locale, "demo.verificationFailed"), detail: t(this.locale, "demo.testFeedback") },
      ],
      inspectorTab: "diff",
    };
    return this.snapshot;
  }

  decide(input: ApprovalDecisionInput): WorkbenchSnapshot {
    if (this.snapshot.phase !== "awaiting_approval" || input.approvalId !== this.snapshot.approvalId) {
      return this.snapshot;
    }
    const denied = input.decision === "deny";
    this.snapshot = {
      ...this.snapshot,
      phase: denied ? "completed" : "running",
      inspectorTab: "approval",
      events: [
        ...this.snapshot.events,
        {
          id: "decision",
          kind: "outcome",
          title: denied ? t(this.locale, "demo.approvalDenied") : t(this.locale, "demo.approvalRecorded"),
          detail: denied ? t(this.locale, "demo.commandNotDispatched") : t(this.locale, "demo.scopedActionMayContinue"),
        },
      ],
    };
    return this.snapshot;
  }
}
