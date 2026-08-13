import { useEffect, useRef, useState } from "react";

import { DEMO_SCENARIOS, type DemoScenarioId, type DemoSnapshot, type DemoTraceEvent } from "./demo-session.js";
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
  readonly locale?: Locale;
}

export type Locale = "zh-CN" | "en-US";

interface DemoMessages {
  readonly demoTitle: string;
  readonly scenarios: string;
  readonly scenarioLabels: Readonly<Record<DemoScenarioId, string>>;
  readonly scenarioDescriptions: Readonly<Record<DemoScenarioId, string>>;
  readonly selected: string;
  readonly reset: string;
  readonly fixedFixtures: string;
  readonly executionStream: string;
  readonly chooseScenario: string;
  readonly runScenario: string;
  readonly runOnlySelected: string;
  readonly runUpdated: string;
  readonly executionTrace: string;
  readonly noTrace: string;
  readonly details: string;
  readonly runEvidence: string;
  readonly sanitized: string;
  readonly verification: string;
  readonly fixtureChecks: string;
  readonly noVerification: string;
  readonly diffSummary: string;
  readonly repairResult: string;
  readonly noRepairDiff: string;
  readonly approval: string;
  readonly scopedDecision: string;
  readonly noPendingApproval: string;
  readonly allowOnce: string;
  readonly deny: string;
  readonly approvalRecorded: string;
  readonly unavailable: string;
  readonly statusIdle: string;
  readonly readyToRun: (scenario: string) => string;
  readonly statusAwaitingApproval: string;
  readonly statusDenied: string;
  readonly statusCompleted: string;
  readonly traceLabels: Readonly<Record<DemoTraceEvent["type"], string>>;
  readonly traceDetails: Readonly<Record<DemoTraceEvent["type"], (runId: string) => string>>;
  readonly approvalReason: string;
  readonly affectedRun: (runId: string) => string;
}

const messages: Readonly<Record<Locale, DemoMessages>> = Object.freeze({
  "zh-CN": Object.freeze({
    demoTitle: "受限演示", scenarios: "场景", selected: "已选择", reset: "重置演示",
    fixedFixtures: "仅提供固定演示，不接收访客代码或凭据。", executionStream: "执行流", chooseScenario: "选择一个场景",
    runScenario: "运行场景", runOnlySelected: "仅运行已选的命名场景，演示可重置。", runUpdated: "场景运行已更新",
    executionTrace: "执行追踪", noTrace: "选择一个场景后运行固定演示，以查看脱敏后的证据。", details: "详情", runEvidence: "运行证据",
    sanitized: "已脱敏", verification: "验证", fixtureChecks: "演示检查", noVerification: "尚无验证结果。", diffSummary: "差异摘要",
    repairResult: "修复结果", noRepairDiff: "本次运行没有修复差异。", approval: "审批", scopedDecision: "受限决定",
    noPendingApproval: "当前没有待审批请求。", allowOnce: "仅允许一次", deny: "拒绝", approvalRecorded: "已记录审批", unavailable: "演示暂时不可用",
    statusIdle: "空闲", readyToRun: (scenario) => `准备运行 ${scenario}`, statusAwaitingApproval: "此运行需要审批后才能继续", statusDenied: "场景已拒绝", statusCompleted: "场景已完成",
    scenarioLabels: { "workspace-escape": "工作区越界", "repair-feedback": "修复反馈", "approval-isolation": "审批隔离" },
    scenarioDescriptions: { "workspace-escape": "路径越界会在分发前被拒绝。", "repair-feedback": "失败检查会被修复并再次验证。", "approval-isolation": "受限审批每次只暂停一个运行。" },
    traceLabels: { action_rejected: "操作已拒绝", repair_started: "开始修复", verification_completed: "验证已完成", approval_requested: "已请求审批", approval_allowed: "审批已允许", approval_denied: "审批已拒绝" },
    traceDetails: {
      action_rejected: () => "工作区边界阻止了所请求的操作。", repair_started: () => "已将脚本化修复反馈应用到演示。", verification_completed: () => "修复后的演示已完成验证。",
      approval_requested: (runId) => `运行 ${runId} 正在等待一次性决定。`, approval_allowed: (runId) => `运行 ${runId} 已获得一次性允许。`, approval_denied: (runId) => `运行 ${runId} 已被拒绝且未执行。`,
    },
    approvalReason: "审批隔离会将这次一次性决定绑定到受影响的运行。", affectedRun: (runId) => `受影响的运行：${runId}`,
  }),
  "en-US": Object.freeze({
    demoTitle: "Mock Demo", scenarios: "Scenarios", selected: "Selected", reset: "Reset demo",
    fixedFixtures: "Fixed fixtures only. No visitor code or credentials are accepted.", executionStream: "Execution stream", chooseScenario: "Choose a scenario",
    runScenario: "Run scenario", runOnlySelected: "Run only the selected named scenario. The fixture is resettable.", runUpdated: "Scenario run updated",
    executionTrace: "Execution trace", noTrace: "Choose a scenario, then run its fixed fixture to see sanitized evidence.", details: "Details", runEvidence: "Run evidence",
    sanitized: "Sanitized", verification: "Verification", fixtureChecks: "Fixture checks", noVerification: "No verification results yet.", diffSummary: "Diff summary",
    repairResult: "Repair result", noRepairDiff: "No repair diff in this run.", approval: "Approval", scopedDecision: "Scoped decision",
    noPendingApproval: "No pending approval.", allowOnce: "Allow once", deny: "Deny", approvalRecorded: "Approval recorded", unavailable: "Demo is temporarily unavailable",
    statusIdle: "Choose a scenario to begin", readyToRun: (scenario) => `Ready to run ${scenario}`, statusAwaitingApproval: "Approval required before this run can continue", statusDenied: "Scenario denied", statusCompleted: "Scenario complete",
    scenarioLabels: { "workspace-escape": "Workspace escape", "repair-feedback": "Repair feedback", "approval-isolation": "Approval isolation" },
    scenarioDescriptions: { "workspace-escape": "A path escape is rejected before dispatch.", "repair-feedback": "A failed check is repaired and verified again.", "approval-isolation": "A scoped approval pauses one run at a time." },
    traceLabels: { action_rejected: "Action rejected", repair_started: "Repair started", verification_completed: "Verification completed", approval_requested: "Approval requested", approval_allowed: "Approval allowed", approval_denied: "Approval denied" },
    traceDetails: {
      action_rejected: () => "Workspace boundary stopped the requested action.", repair_started: () => "Scripted repair feedback was applied to the fixture.", verification_completed: () => "The repaired fixture completed verification.",
      approval_requested: (runId) => `Run ${runId} is waiting for a once-only decision.`, approval_allowed: (runId) => `Run ${runId} was allowed for this once-only decision.`, approval_denied: (runId) => `Run ${runId} was denied and did not execute.`,
    },
    approvalReason: "Approval isolation keeps this once-only decision bound to its affected run.", affectedRun: (runId) => `Affected run: ${runId}`,
  }),
});

function scenarios(locale: Locale): ReadonlyArray<{
  readonly id: DemoScenarioId;
  readonly label: string;
  readonly description: string;
}> {
  const copy = messages[locale];
  return DEMO_SCENARIOS.map((id) => ({ id, label: copy.scenarioLabels[id], description: copy.scenarioDescriptions[id] }));
}

const initialSnapshot: DemoSnapshot = {
  status: "idle",
  runs: [],
  trace: [],
  verification: [],
  dispatcherCalls: 0,
};

function scenarioLabel(locale: Locale, id: DemoScenarioId | undefined): string {
  return id === undefined ? messages[locale].chooseScenario : messages[locale].scenarioLabels[id];
}

function traceLabel(locale: Locale, event: DemoTraceEvent): string {
  return messages[locale].traceLabels[event.type];
}

function traceDetail(locale: Locale, event: DemoTraceEvent): string {
  return messages[locale].traceDetails[event.type](event.runId ?? "current");
}

function statusText(locale: Locale, snapshot: DemoSnapshot): string {
  const copy = messages[locale];
  if (snapshot.status === "idle") {
    return snapshot.selectedScenario === undefined ? copy.statusIdle : copy.readyToRun(scenarioLabel(locale, snapshot.selectedScenario));
  }
  if (snapshot.status === "awaiting_approval") return copy.statusAwaitingApproval;
  if (snapshot.status === "denied") return copy.statusDenied;
  return copy.statusCompleted;
}

export function App({ client, locale = "zh-CN" }: AppProps): JSX.Element {
  const copy = messages[locale];
  const scenarioOptions = scenarios(locale);
  const [snapshot, setSnapshot] = useState<DemoSnapshot>(initialSnapshot);
  const [message, setMessage] = useState(copy.statusIdle);
  const [busy, setBusy] = useState(false);
  const isMounted = useRef(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const request = ++latestRequest.current;
    setBusy(false);
    void client.readSession().then((next) => {
      if (active && isMounted.current && request === latestRequest.current) {
        setSnapshot(next);
        setMessage(statusText(locale, next));
      }
    }).catch(() => {
      if (active && isMounted.current && request === latestRequest.current) setMessage(copy.unavailable);
    });
    return () => {
      active = false;
    };
  }, [client, copy.unavailable, locale]);

  async function update(action: () => Promise<DemoSnapshot>, nextMessage?: string): Promise<void> {
    const request = ++latestRequest.current;
    setBusy(true);
    try {
      const next = await action();
      if (isMounted.current && request === latestRequest.current) {
        setSnapshot(next);
        setMessage(nextMessage ?? statusText(locale, next));
      }
    } catch {
      if (isMounted.current && request === latestRequest.current) setMessage(copy.unavailable);
    } finally {
      if (isMounted.current && request === latestRequest.current) setBusy(false);
    }
  }

  const selectedScenario = scenarioOptions.find((scenario) => scenario.id === snapshot.selectedScenario);
  return (
    <main className="workbench-shell">
      <aside className="scenario-rail" aria-label={copy.scenarios}>
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">T</span>
          <div>
            <p className="eyebrow">Todex</p>
            <h1>{copy.demoTitle}</h1>
          </div>
        </div>

        <section className="scenario-section" aria-labelledby="scenarios-heading">
          <h2 id="scenarios-heading">{copy.scenarios}</h2>
          <div className="scenario-list">
            {scenarioOptions.map((scenario) => (
              <button
                className="scenario-button"
                key={scenario.id}
                type="button"
                aria-label={scenario.label}
                aria-pressed={snapshot.selectedScenario === scenario.id}
                disabled={busy}
                onClick={() => void update(() => client.selectScenario(scenario.id), `${copy.selected} ${scenario.label}`)}
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
          <button className="secondary-button" type="button" onClick={() => void update(() => client.reset(), copy.statusIdle)} disabled={busy}>
            {copy.reset}
          </button>
          <p className="rail-note">{copy.fixedFixtures}</p>
        </div>
      </aside>

      <section className="execution-area" aria-labelledby="stream-heading">
        <header className="stream-header">
          <div>
            <p className="eyebrow">{copy.executionStream}</p>
            <h2 id="stream-heading">{selectedScenario?.label ?? copy.chooseScenario}</h2>
          </div>
          <div className={`status-chip status-${snapshot.status}`}>
            <span aria-hidden="true">{snapshot.status === "completed" ? "●" : snapshot.status === "awaiting_approval" ? "!" : snapshot.status === "denied" ? "!" : "○"}</span>
            <span>{snapshot.status.replaceAll("_", " ")}</span>
          </div>
        </header>

        <div className="stream-body" aria-live="polite">
          {snapshot.trace.length === 0 ? (
            <p className="empty-stream">{copy.noTrace}</p>
          ) : (
            <ol className="trace-list" aria-label={copy.executionTrace}>
              {snapshot.trace.map((event, index) => (
                <li className="trace-item" key={`${event.type}-${event.runId ?? "event"}-${index}`}>
                  <span className="trace-number" aria-hidden="true">{index + 1}</span>
                  <div>
                    <strong>{traceLabel(locale, event)}</strong>
                    <p>{traceDetail(locale, event)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="run-bar">
          <p>{copy.runOnlySelected}</p>
          <button className="primary-button" type="button" onClick={() => void update(() => client.run(), copy.runUpdated)} disabled={busy || snapshot.selectedScenario === undefined || snapshot.status === "awaiting_approval"}>
            {copy.runScenario}
          </button>
        </div>
      </section>

      <aside className="detail-panel" aria-label={copy.details}>
        <header className="detail-header">
          <div>
            <p className="eyebrow">{copy.details}</p>
            <h2>{copy.runEvidence}</h2>
          </div>
          <span className="safe-label">{copy.sanitized}</span>
        </header>

        <div className="detail-content">
          <section className="detail-section" aria-labelledby="verification-heading">
            <p className="section-label">{copy.verification}</p>
            <h3 id="verification-heading">{copy.fixtureChecks}</h3>
            {snapshot.verification.length === 0 ? <p className="muted">{copy.noVerification}</p> : (
              <ul className="result-list">
                {snapshot.verification.map((result, index) => <li key={`${result}-${index}`}><span className={`result-marker result-${result}`} aria-hidden="true">{result === "passed" ? "✓" : "!"}</span><code>{result}</code></li>)}
              </ul>
            )}
          </section>

          <section className="detail-section" aria-labelledby="diff-heading">
            <p className="section-label">{copy.diffSummary}</p>
            <h3 id="diff-heading">{copy.repairResult}</h3>
            <p className="summary-value">{snapshot.diff?.summary ?? copy.noRepairDiff}</p>
          </section>

          <section className="detail-section" aria-labelledby="approval-heading">
            <p className="section-label">{copy.approval}</p>
            <h3 id="approval-heading">{copy.scopedDecision}</h3>
            {snapshot.pendingApproval === undefined ? (
              <p className="muted">{copy.noPendingApproval}</p>
            ) : (
              <div className="approval-panel">
                <p>{copy.approvalReason}</p>
                <p>{copy.affectedRun(snapshot.pendingApproval.runId)}</p>
                <div className="approval-actions">
                  <button className="primary-button" type="button" onClick={() => void update(() => client.decideApproval({ approvalId: snapshot.pendingApproval!.approvalId, decision: "allow" }), copy.approvalRecorded)} disabled={busy}>{copy.allowOnce}</button>
                  <button className="danger-button" type="button" onClick={() => void update(() => client.decideApproval({ approvalId: snapshot.pendingApproval!.approvalId, decision: "deny" }))} disabled={busy}>{copy.deny}</button>
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
