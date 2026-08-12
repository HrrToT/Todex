import {
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Command,
  FileDiff,
  FolderKanban,
  PanelRight,
  Pin,
  Play,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  DemoRunController,
  type ApprovalDecision,
  type InspectorTab,
  type StreamEvent,
  type WorkbenchSnapshot,
} from "./run-controller.js";
import type { ApprovalBridge } from "./bridge.js";
import { t, type Locale } from "./i18n.js";
import "./styles.css";

function tabs(locale: Locale): ReadonlyArray<{ id: InspectorTab; label: string }> {
  return [
    { id: "diff", label: t(locale, "workbench.diff") },
    { id: "approval", label: t(locale, "workbench.approval") },
    { id: "trace", label: t(locale, "workbench.trace") },
    { id: "memory", label: t(locale, "workbench.memory") },
  ];
}

function phaseLabel(snapshot: WorkbenchSnapshot, locale: Locale): string {
  const keys = {
    idle: "phase.idle",
    running: "phase.running",
    awaiting_approval: "phase.awaitingApproval",
    failed: "phase.failed",
    completed: "phase.completed",
  } as const;
  return t(locale, keys[snapshot.phase]);
}

function eventIcon(kind: StreamEvent["kind"]) {
  const iconProps = { size: 15, "aria-hidden": true };
  if (kind === "tool") return <TerminalSquare {...iconProps} />;
  if (kind === "patch") return <FileDiff {...iconProps} />;
  if (kind === "verification") return <ShieldAlert {...iconProps} />;
  if (kind === "outcome") return <CheckCircle2 {...iconProps} />;
  return <CircleDot {...iconProps} />;
}

export interface WorkbenchAppProps {
  approvalBridge?: ApprovalBridge;
  onApprovalDecision?: (input: { approvalId: string; decision: ApprovalDecision }) => void;
  locale?: Locale;
}

export function WorkbenchApp({ approvalBridge, onApprovalDecision, locale = "zh-CN" }: WorkbenchAppProps): JSX.Element {
  const controllerRef = useRef<DemoRunController | null>(null);
  if (!controllerRef.current) controllerRef.current = new DemoRunController(locale);
  const controller = controllerRef.current;
  const inspectorTabs = tabs(locale);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>(() => controller.current());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>("trace");
  const [inspectorPinned, setInspectorPinned] = useState(false);
  const [task, setTask] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  function openInspector(tab: InspectorTab): void {
    setActiveTab(tab);
    setInspectorOpen(true);
  }

  function submitTask(): void {
    const next = controller.start(task);
    setSnapshot(next);
    setTask("");
    if (next.inspectorTab) openInspector(next.inspectorTab);
  }

  function decide(decision: ApprovalDecision): void {
    const approvalId = snapshot.approvalId;
    if (!approvalId) return;
    const input = { approvalId, decision };
    onApprovalDecision?.(input);
    void approvalBridge?.decide(input).catch(() => undefined);
    setSnapshot(controller.decide(input));
    composerRef.current?.focus();
  }

  return (
    <main className="workbench-shell">
      <aside className="workspace-rail" role="navigation" aria-label={t(locale, "workbench.workspaceNavigation")}>
        <div className="brand-mark" aria-label="Todex">
          <Command size={18} aria-hidden="true" />
          <span>Todex</span>
        </div>
        <button className="project-switcher" type="button" aria-label={t(locale, "workbench.currentWorkspace")}>
          <FolderKanban size={16} aria-hidden="true" />
          <span>calculator-lab</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <section className="rail-section" aria-label={t(locale, "workbench.recentRuns")}>
          <p>{t(locale, "workbench.recentRuns")}</p>
          <button className="run-row selected" type="button"><span className="run-dot" />{t(locale, "workbench.repairCalculation")}</button>
          <button className="run-row" type="button"><span className="run-dot muted" />{t(locale, "workbench.inspectTests")}</button>
        </section>
        <nav className="rail-nav" aria-label={t(locale, "workbench.views")}>
          <button type="button"><PanelRight size={16} aria-hidden="true" /><span>{t(locale, "workbench.trace")}</span></button>
          <button type="button"><BookOpenText size={16} aria-hidden="true" /><span>{t(locale, "workbench.memory")}</span></button>
        </nav>
      </aside>

      <section className="execution-area" aria-label="Execution stream">
        <header className="stream-header">
          <div><span className="eyebrow">{t(locale, "workbench.workspace")}</span><h1>calculator-lab</h1></div>
          <div className={`phase phase-${snapshot.phase}`}><span aria-hidden="true" />{phaseLabel(snapshot, locale)}</div>
          <button className="icon-button" type="button" title={t(locale, "workbench.openInspector")} aria-label={t(locale, "workbench.openInspector")} onClick={() => openInspector("trace")}>
            <PanelRight size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="stream-scroll" aria-live="polite">
          <div className="execution-stream">
            {snapshot.events.map((event) => (
              <button
                className={`stream-event ${event.kind}`}
                type="button"
                key={event.id}
                onClick={() => openInspector(event.kind === "patch" ? "diff" : "trace")}
              >
                <span className="event-icon">{eventIcon(event.kind)}</span>
                <span className="event-content"><strong>{event.title}</strong><span>{event.detail}</span></span>
              </button>
            ))}
          </div>
        </div>

        <form className="task-composer" onSubmit={(event) => { event.preventDefault(); submitTask(); }}>
          <label htmlFor="task-input">{t(locale, "workbench.task")}</label>
          <textarea
            ref={composerRef}
            id="task-input"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder={t(locale, "workbench.taskPlaceholder")}
            rows={2}
          />
          <button className="send-button" type="submit" aria-label={t(locale, "workbench.run")} title={t(locale, "workbench.run")}><Play size={15} aria-hidden="true" /></button>
        </form>
      </section>

      {inspectorOpen ? (
        <aside className="inspector" aria-label="Inspector">
          <header><div><span className="eyebrow">{t(locale, "workbench.inspector")}</span><h2>{inspectorTabs.find((tab) => tab.id === activeTab)?.label}</h2></div><button className="icon-button" type="button" aria-label={t(locale, "workbench.pinInspector")} title={t(locale, "workbench.pinInspector")} aria-pressed={inspectorPinned} onClick={() => setInspectorPinned((value) => !value)}><Pin size={17} aria-hidden="true" /></button><button className="icon-button" type="button" aria-label={t(locale, "workbench.closeInspector")} title={t(locale, "workbench.closeInspector")} onClick={() => setInspectorOpen(false)}><X size={17} aria-hidden="true" /></button></header>
          <div className="inspector-tabs" role="tablist" aria-label={t(locale, "workbench.inspectorTabs")}>
            {inspectorTabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeTab} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
          </div>
          <InspectorContent snapshot={snapshot} tab={activeTab} onDecision={decide} locale={locale} />
        </aside>
      ) : null}
    </main>
  );
}

function InspectorContent({ snapshot, tab, onDecision, locale }: { snapshot: WorkbenchSnapshot; tab: InspectorTab; onDecision: (decision: ApprovalDecision) => void; locale: Locale }): JSX.Element {
  if (tab === "approval" && snapshot.phase === "awaiting_approval") {
    return <section className="inspector-content"><p className="inspector-kicker">{t(locale, "workbench.approvalRequired")}</p><h3>{t(locale, "workbench.scopedCommandRequest")}</h3><p>{t(locale, "workbench.commandNeedsDecision")}</p><div className="approval-actions"><button type="button" onClick={() => onDecision("once")}>{t(locale, "workbench.allowOnce")}</button><button type="button" onClick={() => onDecision("run")}>{t(locale, "workbench.allowRun")}</button><button className="danger" type="button" onClick={() => onDecision("deny")}>{t(locale, "workbench.deny")}</button></div></section>;
  }
  if (tab === "diff") return <section className="inspector-content"><p className="inspector-kicker">{t(locale, "workbench.patchSummary")}</p><h3>src/calculator.ts</h3><pre aria-label={t(locale, "workbench.patchSummary")}><code>- return left - right{`\n`}+ return left + right</code></pre></section>;
  if (tab === "memory") return <section className="inspector-content"><p className="inspector-kicker">{t(locale, "workbench.selectedMemory")}</p><h3>{t(locale, "workbench.noStoredContext")}</h3><p>{t(locale, "workbench.memorySafety")}</p></section>;
  return <section className="inspector-content"><p className="inspector-kicker">{t(locale, "workbench.traceTimeline")}</p><ol className="trace-list">{snapshot.events.map((event, index) => <li key={event.id}><span>{index + 1}</span><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol></section>;
}
