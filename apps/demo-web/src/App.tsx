import { useEffect, useState } from "react";

import { DEMO_SCENARIOS, type DemoApproval, type DemoScenarioId, type DemoSnapshot, type DemoTraceEvent } from "./demo-session.js";
import "./styles.css";

export interface DemoClient {
  readSession(): Promise<DemoSnapshot>;
  selectScenario(scenarioId: DemoScenarioId): Promise<DemoSnapshot>;
  run(): Promise<DemoSnapshot>;
  decideApproval(input: { approvalId: string; decision: "allow" | "deny" }): Promise<DemoSnapshot>;
  reset(): Promise<DemoSnapshot>;
}

export interface AppProps {
  readonly client: DemoClient;
}

const SCENARIOS: ReadonlyArray<{
  readonly id: DemoScenarioId;
  readonly label: string;
  readonly description: string;
}> = [
  {
    id: "workspace-escape",
    label: "Workspace escape",
    description: "A path escape is rejected before dispatch.",
  },
  {
    id: "repair-feedback",
    label: "Repair feedback",
    description: "A failed check is repaired and verified again.",
  },
  {
    id: "approval-isolation",
    label: "Approval isolation",
    description: "A scoped approval pauses one run at a time.",
  },
];

const initialSnapshot: DemoSnapshot = {
  status: "idle",
  runs: [],
  trace: [],
  verification: [],
  dispatcherCalls: 0,
};

const APPROVAL_REASON_TEXT: Record<DemoApproval["reason"], string> = {
  approval_isolation: "Approval isolation keeps this once-only decision bound to its affected run.",
};

function scenarioLabel(id: DemoScenarioId | undefined): string {
  return SCENARIOS.find((scenario) => scenario.id === id)?.label ?? "No scenario selected";
}

function traceLabel(event: DemoTraceEvent): string {
  const labels: Record<DemoTraceEvent["type"], string> = {
    action_rejected: "Action rejected",
    repair_started: "Repair started",
    verification_completed: "Verification completed",
    approval_requested: "Approval requested",
    approval_decided: "Approval decided",
  };
  return labels[event.type];
}

function traceDetail(event: DemoTraceEvent): string {
  if (event.type === "action_rejected") return "Workspace boundary stopped the requested action.";
  if (event.type === "repair_started") return "Scripted repair feedback was applied to the fixture.";
  if (event.type === "verification_completed") return "The repaired fixture completed verification.";
  if (event.type === "approval_requested") return `Run ${event.runId ?? "current"} is waiting for a once-only decision.`;
  return `The approval decision was recorded for ${event.runId ?? "current"}.`;
}

function statusText(snapshot: DemoSnapshot): string {
  if (snapshot.status === "idle") {
    return snapshot.selectedScenario === undefined ? "Choose a scenario to begin" : `Ready to run ${scenarioLabel(snapshot.selectedScenario)}`;
  }
  if (snapshot.status === "awaiting_approval") return "Approval required before this run can continue";
  return "Scenario complete";
}

export function App({ client }: AppProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<DemoSnapshot>(initialSnapshot);
  const [message, setMessage] = useState("Choose a scenario to begin");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void client.readSession().then((next) => {
      if (active) {
        setSnapshot(next);
        setMessage(statusText(next));
      }
    }).catch(() => {
      if (active) setMessage("Demo is temporarily unavailable");
    });
    return () => {
      active = false;
    };
  }, [client]);

  async function update(action: () => Promise<DemoSnapshot>, nextMessage?: string): Promise<void> {
    setBusy(true);
    try {
      const next = await action();
      setSnapshot(next);
      setMessage(nextMessage ?? statusText(next));
    } catch {
      setMessage("Demo is temporarily unavailable");
    } finally {
      setBusy(false);
    }
  }

  const selectedScenario = SCENARIOS.find((scenario) => scenario.id === snapshot.selectedScenario);
  return (
    <main className="workbench-shell">
      <aside className="scenario-rail" aria-label="Demo scenarios">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">T</span>
          <div>
            <p className="eyebrow">Todex</p>
            <h1>Mock Demo</h1>
          </div>
        </div>

        <section className="scenario-section" aria-labelledby="scenarios-heading">
          <h2 id="scenarios-heading">Scenarios</h2>
          <div className="scenario-list">
            {SCENARIOS.map((scenario) => (
              <button
                className="scenario-button"
                key={scenario.id}
                type="button"
                aria-label={scenario.label}
                aria-pressed={snapshot.selectedScenario === scenario.id}
                disabled={busy}
                onClick={() => void update(() => client.selectScenario(scenario.id), `Selected ${scenario.label}`)}
              >
                <span className="scenario-indicator" aria-hidden="true">{snapshot.selectedScenario === scenario.id ? "●" : "○"}</span>
                <span>
                  <strong>{scenario.label}</strong>
                  <small>{scenario.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="rail-actions">
          <button className="secondary-button" type="button" onClick={() => void update(() => client.reset(), "Choose a scenario to begin")} disabled={busy}>
            Reset demo
          </button>
          <p className="rail-note">Fixed fixtures only. No visitor code or credentials are accepted.</p>
        </div>
      </aside>

      <section className="execution-area" aria-labelledby="stream-heading">
        <header className="stream-header">
          <div>
            <p className="eyebrow">Execution stream</p>
            <h2 id="stream-heading">{selectedScenario?.label ?? "Choose a scenario"}</h2>
          </div>
          <div className={`status-chip status-${snapshot.status}`}>
            <span aria-hidden="true">{snapshot.status === "completed" ? "●" : snapshot.status === "awaiting_approval" ? "!" : "○"}</span>
            <span>{snapshot.status.replaceAll("_", " ")}</span>
          </div>
        </header>

        <div className="stream-body" aria-live="polite">
          {snapshot.trace.length === 0 ? (
            <p className="empty-stream">Choose a scenario, then run its fixed fixture to see sanitized evidence.</p>
          ) : (
            <ol className="trace-list" aria-label="Execution trace">
              {snapshot.trace.map((event, index) => (
                <li className="trace-item" key={`${event.type}-${event.runId ?? "event"}-${index}`}>
                  <span className="trace-number" aria-hidden="true">{index + 1}</span>
                  <div>
                    <strong>{traceLabel(event)}</strong>
                    <p>{traceDetail(event)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="run-bar">
          <p>Run only the selected named scenario. The fixture is resettable.</p>
          <button className="primary-button" type="button" onClick={() => void update(() => client.run(), "Scenario run updated")} disabled={busy || snapshot.selectedScenario === undefined || snapshot.status === "awaiting_approval"}>
            Run scenario
          </button>
        </div>
      </section>

      <aside className="detail-panel" aria-label="Run details">
        <header className="detail-header">
          <div>
            <p className="eyebrow">Details</p>
            <h2>Run evidence</h2>
          </div>
          <span className="safe-label">Sanitized</span>
        </header>

        <div className="detail-content">
          <section className="detail-section" aria-labelledby="verification-heading">
            <p className="section-label">Verification</p>
            <h3 id="verification-heading">Fixture checks</h3>
            {snapshot.verification.length === 0 ? <p className="muted">No verification results yet.</p> : (
              <ul className="result-list">
                {snapshot.verification.map((result, index) => <li key={`${result}-${index}`}><span className={`result-marker result-${result}`} aria-hidden="true">{result === "passed" ? "✓" : "!"}</span><code>{result}</code></li>)}
              </ul>
            )}
          </section>

          <section className="detail-section" aria-labelledby="diff-heading">
            <p className="section-label">Diff summary</p>
            <h3 id="diff-heading">Repair result</h3>
            <p className="summary-value">{snapshot.diff?.summary ?? "No repair diff in this run."}</p>
          </section>

          <section className="detail-section" aria-labelledby="approval-heading">
            <p className="section-label">Approval</p>
            <h3 id="approval-heading">Scoped decision</h3>
            {snapshot.pendingApproval === undefined ? (
              <p className="muted">No pending approval.</p>
            ) : (
              <div className="approval-panel">
                <p>{APPROVAL_REASON_TEXT[snapshot.pendingApproval.reason]}</p>
                <p>Affected run: {snapshot.pendingApproval.runId}</p>
                <div className="approval-actions">
                  <button className="primary-button" type="button" onClick={() => void update(() => client.decideApproval({ approvalId: snapshot.pendingApproval!.approvalId, decision: "allow" }), "Approval recorded")} disabled={busy}>Allow once</button>
                  <button className="danger-button" type="button" onClick={() => void update(() => client.decideApproval({ approvalId: snapshot.pendingApproval!.approvalId, decision: "deny" }), "Approval denied")} disabled={busy}>Deny</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </aside>

      <p className="sr-only" role="status" aria-live="polite">{message}</p>
    </main>
  );
}

export { DEMO_SCENARIOS };
