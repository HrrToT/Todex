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
import "./styles.css";

const tabs: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: "diff", label: "Diff" },
  { id: "approval", label: "Approval" },
  { id: "trace", label: "Trace" },
  { id: "memory", label: "Memory" },
];

function phaseLabel(snapshot: WorkbenchSnapshot): string {
  return snapshot.phase.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
}

export function WorkbenchApp({ approvalBridge, onApprovalDecision }: WorkbenchAppProps): JSX.Element {
  const controllerRef = useRef<DemoRunController | null>(null);
  if (!controllerRef.current) controllerRef.current = new DemoRunController();
  const controller = controllerRef.current;
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
      <aside className="workspace-rail" role="navigation" aria-label="Workspace navigation">
        <div className="brand-mark" aria-label="Todex">
          <Command size={18} aria-hidden="true" />
          <span>Todex</span>
        </div>
        <button className="project-switcher" type="button" aria-label="Current workspace">
          <FolderKanban size={16} aria-hidden="true" />
          <span>calculator-lab</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <section className="rail-section" aria-label="Recent runs">
          <p>Recent runs</p>
          <button className="run-row selected" type="button"><span className="run-dot" />Repair calculation</button>
          <button className="run-row" type="button"><span className="run-dot muted" />Inspect tests</button>
        </section>
        <nav className="rail-nav" aria-label="Workbench views">
          <button type="button"><PanelRight size={16} aria-hidden="true" /><span>Trace</span></button>
          <button type="button"><BookOpenText size={16} aria-hidden="true" /><span>Memory</span></button>
        </nav>
      </aside>

      <section className="execution-area" aria-label="Execution stream">
        <header className="stream-header">
          <div><span className="eyebrow">Workspace</span><h1>calculator-lab</h1></div>
          <div className={`phase phase-${snapshot.phase}`}><span aria-hidden="true" />{phaseLabel(snapshot)}</div>
          <button className="icon-button" type="button" title="Open Inspector" aria-label="Open Inspector" onClick={() => openInspector("trace")}>
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
          <label htmlFor="task-input">Task or continuation</label>
          <textarea
            ref={composerRef}
            id="task-input"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Describe the next thing to inspect or change"
            rows={2}
          />
          <button className="send-button" type="submit" aria-label="Run" title="Run"><Play size={15} aria-hidden="true" /></button>
        </form>
      </section>

      {inspectorOpen ? (
        <aside className="inspector" aria-label="Inspector">
          <header><div><span className="eyebrow">Inspector</span><h2>{tabs.find((tab) => tab.id === activeTab)?.label}</h2></div><button className="icon-button" type="button" aria-label="Pin Inspector" title="Pin Inspector" aria-pressed={inspectorPinned} onClick={() => setInspectorPinned((value) => !value)}><Pin size={17} aria-hidden="true" /></button><button className="icon-button" type="button" aria-label="Close Inspector" title="Close Inspector" onClick={() => setInspectorOpen(false)}><X size={17} aria-hidden="true" /></button></header>
          <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">
            {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeTab} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
          </div>
          <InspectorContent snapshot={snapshot} tab={activeTab} onDecision={decide} />
        </aside>
      ) : null}
    </main>
  );
}

function InspectorContent({ snapshot, tab, onDecision }: { snapshot: WorkbenchSnapshot; tab: InspectorTab; onDecision: (decision: ApprovalDecision) => void }): JSX.Element {
  if (tab === "approval" && snapshot.phase === "awaiting_approval") {
    return <section className="inspector-content"><p className="inspector-kicker">Approval required</p><h3>Scoped command request</h3><p>A project command needs a decision before it can run.</p><div className="approval-actions"><button type="button" onClick={() => onDecision("once")}>Allow once</button><button type="button" onClick={() => onDecision("run")}>Allow run</button><button className="danger" type="button" onClick={() => onDecision("deny")}>Deny</button></div></section>;
  }
  if (tab === "diff") return <section className="inspector-content"><p className="inspector-kicker">Patch summary</p><h3>src/calculator.ts</h3><pre aria-label="Patch summary"><code>- return left - right{`\n`}+ return left + right</code></pre></section>;
  if (tab === "memory") return <section className="inspector-content"><p className="inspector-kicker">Selected memory</p><h3>No stored context selected</h3><p>Only verified, non-sensitive project facts will appear here.</p></section>;
  return <section className="inspector-content"><p className="inspector-kicker">Trace timeline</p><ol className="trace-list">{snapshot.events.map((event, index) => <li key={event.id}><span>{index + 1}</span><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol></section>;
}
