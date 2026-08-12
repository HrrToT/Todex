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
