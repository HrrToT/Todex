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

const idleEvents: readonly StreamEvent[] = [
  { id: "idle", kind: "agent", title: "Ready for a task", detail: "The run stream will appear here." },
];

function visibleTask(task: string): string {
  return /(?:api[_-]?key|token|credentialref)\s*=/i.test(task)
    ? "Sensitive task content withheld"
    : task;
}

export class DemoRunController {
  private snapshot: WorkbenchSnapshot = { phase: "idle", task: "", events: idleEvents, inspectorTab: null };

  current(): WorkbenchSnapshot {
    return this.snapshot;
  }

  start(task: string): WorkbenchSnapshot {
    const rawTask = task.trim() || "Inspect the current workspace";
    const normalizedTask = visibleTask(rawTask);
    const requestsApproval = /install|approve|permission/i.test(rawTask);
    const baseEvents: StreamEvent[] = [
      { id: "task", kind: "user", title: "You", detail: normalizedTask },
      { id: "plan", kind: "agent", title: "Todex", detail: "I will inspect the workspace and report the next safe step." },
      { id: "read", kind: "tool", title: "read_file", detail: "src/calculator.ts" },
    ];

    if (requestsApproval) {
      this.snapshot = {
        phase: "awaiting_approval",
        task: normalizedTask,
        events: [...baseEvents, { id: "approval", kind: "outcome", title: "Approval required", detail: "A scoped command needs your decision." }],
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
        { id: "patch", kind: "patch", title: "Patch prepared", detail: "src/calculator.ts (+1 -1)" },
        { id: "verify", kind: "verification", title: "Verification failed", detail: "Test feedback is available in Inspector." },
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
          title: denied ? "Approval denied" : "Approval recorded",
          detail: denied ? "The command was not dispatched." : "The scoped action may continue.",
        },
      ],
    };
    return this.snapshot;
  }
}
