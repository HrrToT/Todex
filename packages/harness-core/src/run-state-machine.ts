export type RunState =
  | "running"
  | "dispatching"
  | "awaiting_approval"
  | "completed"
  | "completed_unverified"
  | "failed"
  | "cancelled";

const VALID_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  running: [
    "dispatching",
    "awaiting_approval",
    "completed",
    "completed_unverified",
    "failed",
    "cancelled",
  ],
  dispatching: ["running"],
  awaiting_approval: ["dispatching", "running", "cancelled"],
  completed: [],
  completed_unverified: [],
  failed: [],
  cancelled: [],
};

export interface RunTransition {
  readonly from: RunState;
  readonly to: RunState;
}

export class RunStateMachine {
  private currentState: RunState = "running";
  private transitionLog: RunTransition[] = [];

  getCurrentState(): RunState {
    return this.currentState;
  }

  transition(to: RunState): RunTransition {
    const from = this.currentState;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error("invalid_run_transition");
    }
    const entry: RunTransition = { from, to };
    this.transitionLog.push(entry);
    this.currentState = to;
    return entry;
  }

  canTransition(to: RunState): boolean {
    return VALID_TRANSITIONS[this.currentState].includes(to);
  }

  getTransitions(): readonly RunTransition[] {
    return [...this.transitionLog];
  }
}
