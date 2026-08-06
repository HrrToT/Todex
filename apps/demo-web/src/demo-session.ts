export const DEMO_SCENARIOS = Object.freeze([
  "workspace-escape",
  "repair-feedback",
  "approval-isolation",
] as const);

export type DemoScenarioId = (typeof DEMO_SCENARIOS)[number];
export type DemoStatus = "idle" | "awaiting_approval" | "completed" | "denied";
export type VerificationClassification = "test_failure" | "passed";

export interface DemoTraceEvent {
  readonly type: "action_rejected" | "repair_started" | "verification_completed" | "approval_requested" | "approval_allowed" | "approval_denied";
  readonly reason?: "workspace_escape";
  readonly runId?: string;
}

export interface DemoApproval {
  readonly approvalId: string;
  readonly scope: "once";
  readonly reason: "approval_isolation";
  readonly runId: string;
}

export interface DemoRun {
  readonly id: string;
  readonly scenarioId: DemoScenarioId;
  readonly status: Exclude<DemoStatus, "idle">;
}

export interface DemoSnapshot {
  readonly selectedScenario?: DemoScenarioId;
  readonly status: DemoStatus;
  readonly runs: readonly DemoRun[];
  readonly trace: readonly DemoTraceEvent[];
  readonly verification: readonly VerificationClassification[];
  readonly diff?: { readonly summary: "scripted_repair" };
  readonly pendingApproval?: DemoApproval;
  readonly dispatcherCalls: number;
}

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

interface DemoState {
  selectedScenario?: DemoScenarioId;
  status: DemoStatus;
  runs: DemoRun[];
  trace: DemoTraceEvent[];
  verification: VerificationClassification[];
  diff?: { summary: "scripted_repair" };
  pendingApproval?: DemoApproval;
  dispatcherCalls: number;
  nextRun: number;
  nextApproval: number;
}

function createInitialState(): DemoState {
  return {
    status: "idle",
    runs: [],
    trace: [],
    verification: [],
    dispatcherCalls: 0,
    nextRun: 1,
    nextApproval: 1,
  };
}

function isDemoScenario(id: string): id is DemoScenarioId {
  return (DEMO_SCENARIOS as readonly string[]).includes(id);
}

function restricted(): never {
  throw new Error("demo_restricted");
}

function snapshot(state: DemoState): DemoSnapshot {
  return {
    selectedScenario: state.selectedScenario,
    status: state.status,
    runs: state.runs.map((run) => ({ ...run })),
    trace: state.trace.map((event) => ({ ...event })),
    verification: [...state.verification],
    diff: state.diff === undefined ? undefined : { ...state.diff },
    pendingApproval: state.pendingApproval === undefined ? undefined : { ...state.pendingApproval },
    dispatcherCalls: state.dispatcherCalls,
  };
}

export function createDemoSession(): DemoSession {
  let state = createInitialState();

  return {
    async selectScenario(id) {
      if (!isDemoScenario(id)) {
        return restricted();
      }
      if (state.pendingApproval !== undefined && id !== state.selectedScenario) {
        throw new Error("demo_approval_pending");
      }

      state.selectedScenario = id;
      return snapshot(state);
    },

    async run() {
      if (state.pendingApproval !== undefined) {
        throw new Error("demo_approval_pending");
      }
      const scenarioId = state.selectedScenario;
      if (scenarioId === undefined) {
        return restricted();
      }

      const runId = `run-${state.nextRun++}`;
      if (scenarioId === "workspace-escape") {
        state.runs.push({ id: runId, scenarioId, status: "completed" });
        state.status = "completed";
        state.trace.push({ type: "action_rejected", reason: "workspace_escape" });
      } else if (scenarioId === "repair-feedback") {
        state.runs.push({ id: runId, scenarioId, status: "completed" });
        state.status = "completed";
        state.trace.push({ type: "repair_started", runId }, { type: "verification_completed", runId });
        state.verification = ["test_failure", "passed"];
        state.diff = { summary: "scripted_repair" };
      } else {
        const pendingApproval = {
          approvalId: `approval-${state.nextApproval++}`,
          scope: "once",
          reason: "approval_isolation",
          runId,
        } as const;
        state.runs.push({ id: runId, scenarioId, status: "awaiting_approval" });
        state.status = "awaiting_approval";
        state.pendingApproval = pendingApproval;
        state.trace.push({ type: "approval_requested", runId });
      }

      return snapshot(state);
    },

    async decideApproval(input) {
      const pendingApproval = state.pendingApproval;
      if (
        pendingApproval === undefined ||
        input.approvalId !== pendingApproval.approvalId ||
        (input.decision !== "allow" && input.decision !== "deny")
      ) {
        return restricted();
      }

      const pendingRun = state.runs.at(-1);
      if (pendingRun === undefined || pendingRun.status !== "awaiting_approval") {
        return restricted();
      }

      const status = input.decision === "allow" ? "completed" : "denied";
      state.runs[state.runs.length - 1] = { ...pendingRun, status };
      state.status = status;
      state.pendingApproval = undefined;
      state.trace.push({
        type: input.decision === "allow" ? "approval_allowed" : "approval_denied",
        runId: pendingRun.id,
      });
      return snapshot(state);
    },

    async reset() {
      state = createInitialState();
      return snapshot(state);
    },

    async configureRealModel() {
      return restricted();
    },

    async openWorkspace() {
      return restricted();
    },

    async runShell() {
      return restricted();
    },

    async applyPatch() {
      return restricted();
    },
  };
}
