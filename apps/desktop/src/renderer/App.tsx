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
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DemoRunController,
  type ApprovalDecision,
  type InspectorTab,
  type StreamEvent,
  type WorkbenchSnapshot,
} from "./run-controller.js";
import { preloadRunBridge, type ApprovalBridge, type DesktopCommandCandidate, type DesktopConfiguredCommand, type DesktopProjectProjection } from "./bridge.js";
import { t, type Locale, type MessageKey } from "./i18n.js";
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
  const [activeLocale, setActiveLocale] = useState<Locale>(locale);
  useEffect(() => {
    void window.todex?.settings?.getLocale().then((result) => setActiveLocale(result.locale)).catch(() => undefined);
  }, []);
  const toggleLocale = useCallback(() => {
    const next = activeLocale === "zh-CN" ? "en-US" : "zh-CN";
    setActiveLocale(next);
    void window.todex?.settings?.setLocale(next).catch(() => setActiveLocale(activeLocale));
  }, [activeLocale]);
  return preloadRunBridge()
    ? <LiveWorkbenchApp locale={activeLocale} onToggleLocale={toggleLocale} />
    : <DemoWorkbenchApp approvalBridge={approvalBridge} onApprovalDecision={onApprovalDecision} locale={activeLocale} />;
}

function DemoWorkbenchApp({ approvalBridge, onApprovalDecision, locale = "zh-CN" }: WorkbenchAppProps): JSX.Element {
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

type DesktopProject = DesktopProjectProjection;
interface DesktopModel { readonly configId: string; readonly baseUrl: string; readonly model: string; }
interface LiveSnapshot { readonly run: { readonly runId: string; readonly status: string }; readonly trace: readonly { readonly eventId: string; readonly type: string; readonly payloadSummary: string }[]; readonly pendingApproval?: { readonly approvalId: string }; }

function livePhase(status: string | undefined): { readonly className: string; readonly labelKey: MessageKey } {
  switch (status) {
    case "created":
    case "running":
    case "dispatching": return { className: "running", labelKey: "phase.running" };
    case "awaiting_approval": return { className: "awaiting_approval", labelKey: "phase.awaitingApproval" };
    case "completed": return { className: "completed", labelKey: "phase.completed" };
    case "completed_unverified": return { className: "completed", labelKey: "phase.completedUnverified" };
    case "failed_repair_limit": return { className: "failed", labelKey: "phase.failedRepairLimit" };
    case "failed_environment": return { className: "failed", labelKey: "phase.failedEnvironment" };
    case "cancelled": return { className: "failed", labelKey: "phase.cancelled" };
    default: return { className: "failed", labelKey: "phase.failed" };
  }
}

function LiveWorkbenchApp({ locale, onToggleLocale }: { locale: Locale; onToggleLocale: () => void }): JSX.Element {
  const surface = window.todex!;
  const [projects, setProjects] = useState<readonly DesktopProject[]>([]);
  const [project, setProject] = useState<DesktopProject>();
  const [candidates, setCandidates] = useState<readonly DesktopCommandCandidate[]>([]);
  const [commands, setCommands] = useState<readonly DesktopConfiguredCommand[]>([]);
  const [models, setModels] = useState<readonly DesktopModel[]>([]);
  const [model, setModel] = useState<DesktopModel>();
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [credentialAvailable, setCredentialAvailable] = useState(true);
  const [credentialEditorOpen, setCredentialEditorOpen] = useState(false);
  const [task, setTask] = useState("");
  const [snapshot, setSnapshot] = useState<LiveSnapshot>();
  const [noticeKey, setNoticeKey] = useState<"live.notice.chooseWorkspaceAndModel" | "live.notice.modelReady" | "live.notice.enterApiKey" | "live.notice.credentialSaveFailed" | "live.notice.commandConfirmed" | "live.notice.completeSetup" | "live.notice.runUpdated">("live.notice.chooseWorkspaceAndModel");
  const notice = t(locale, noticeKey);
  const phase = livePhase(snapshot?.run.status);

  useEffect(() => {
    if (!snapshot?.run.runId || !surface.run?.subscribe) return undefined;
    return surface.run.subscribe(snapshot.run.runId, (next) => {
      if (next && typeof next === "object" && "run" in next) setSnapshot(next as LiveSnapshot);
    });
  }, [snapshot?.run.runId, surface.run]);

  const chooseModel = useCallback(async (next: DesktopModel): Promise<void> => {
    setModel(next); setBaseUrl(next.baseUrl); setModelName(next.model);
    setApiKey("");
    const status = await surface.credential?.status(next.configId);
    setCredentialConfigured(status?.configured ?? false);
    setCredentialAvailable(status?.availability !== "unavailable");
    setCredentialEditorOpen(!status?.configured);
    setNoticeKey(status?.configured ? "live.notice.modelReady" : "live.notice.enterApiKey");
  }, [surface]);
  const chooseProject = useCallback(async (next: DesktopProject): Promise<void> => {
    const profile = next.profile ?? { kinds: [], candidates: [], notices: [] };
    setProject({ ...next, profile }); setCandidates(profile.candidates); setCommands(await surface.command?.list(next.projectId) ?? []); setModel(undefined); setApiKey(""); setCredentialConfigured(false); setCredentialEditorOpen(false); setSnapshot(undefined);
    const found = await surface.model?.list(next.projectId) ?? [];
    setModels(found); if (found[0]) await chooseModel(found[0]);
  }, [chooseModel, surface]);
  const refreshProjects = useCallback(async (): Promise<void> => {
    const next = await surface.project?.list() ?? [];
    setProjects(next);
    if (!project && next[0]) await chooseProject(next[0]);
  }, [chooseProject, project, surface]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  async function importWorkspace(): Promise<void> {
    const imported = await surface.project?.importSelectedWorkspace();
    if (!imported) return;
    await refreshProjects();
    await chooseProject(imported);
  }
  async function saveModel(): Promise<void> {
    if (!project || !baseUrl || !modelName) return;
    const saved = await surface.model?.save({ projectId: project.projectId, baseUrl, model: modelName });
    if (!saved) return;
    await chooseModel(saved); await chooseProject(project);
  }
  async function saveCredential(): Promise<void> {
    if (!model || !apiKey.trim() || !surface.credential?.save) return;
    const value = apiKey;
    setApiKey("");
    try {
      const saved = await surface.credential.save(model.configId, value);
      if (saved.configured) {
        setCredentialConfigured(true);
        setCredentialEditorOpen(false);
        setNoticeKey("live.notice.modelReady");
      }
    } catch {
      setCredentialConfigured(false);
      setCredentialEditorOpen(true);
      setNoticeKey("live.notice.credentialSaveFailed");
    }
  }
  async function clearCredential(): Promise<void> {
    if (!model || !surface.credential?.clear) return;
    await surface.credential.clear(model.configId);
    setApiKey("");
    setCredentialConfigured(false);
    setCredentialEditorOpen(true);
    setNoticeKey("live.notice.enterApiKey");
  }
  async function confirmCandidate(candidateId: string): Promise<void> {
    if (!project) return;
    await surface.command?.confirm(project.projectId, candidateId);
    setCandidates((items) => items.filter((candidate) => candidate.candidateId !== candidateId));
    setCommands(await surface.command?.list(project.projectId) ?? []);
    setNoticeKey("live.notice.commandConfirmed");
  }
  async function start(): Promise<void> {
    if (!project || !model || !task.trim()) { setNoticeKey("live.notice.completeSetup"); return; }
    const selectedCommand = commands.find((command) => command.confirmedByUser && command.purpose === "test")
      ?? commands.find((command) => command.confirmedByUser);
    const result = await surface.run?.start({ projectId: project.projectId, modelConfigId: model.configId, task, verificationCommandId: selectedCommand?.commandId });
    if (result && typeof result === "object" && "run" in result) setSnapshot(result as LiveSnapshot);
    setNoticeKey("live.notice.runUpdated");
  }
  async function decide(decision: ApprovalDecision): Promise<void> {
    if (!snapshot?.pendingApproval || !surface.approval) return;
    const result = await surface.approval.decide({ runId: snapshot.run.runId, approvalId: snapshot.pendingApproval.approvalId, decision });
    if (result && typeof result === "object" && "run" in result) setSnapshot(result as LiveSnapshot);
  }

  return <main className="workbench-shell">
    <aside className="workspace-rail" aria-label={t(locale, "workbench.workspaceNavigation")}><div className="brand-mark"><Command size={18} /><span>Todex</span><button type="button" onClick={onToggleLocale}>{locale === "zh-CN" ? "English" : "Chinese"}</button></div>
      <button className="project-switcher" type="button" onClick={() => void importWorkspace()}><FolderKanban size={16} /><span>{project?.displayName ?? t(locale, "live.selectWorkspace")}</span><ChevronRight size={14} /></button>
      <section className="rail-section"><p>{t(locale, "live.modelConfiguration")}</p><label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></label><label>{t(locale, "live.model")}<input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="model-name" /></label><button className="run-row selected" type="button" onClick={() => void saveModel()}>{t(locale, "live.saveModelConfiguration")}</button>{model ? (!credentialAvailable ? <p>{t(locale, "live.credentialUnavailable")}</p> : credentialConfigured && !credentialEditorOpen ? <div><p>{t(locale, "live.credentialConfigured")}</p><button type="button" onClick={() => { setApiKey(""); setCredentialEditorOpen(true); }}>{t(locale, "live.updateApiKey")}</button><button type="button" onClick={() => void clearCredential()}>{t(locale, "live.clearApiKey")}</button></div> : <div><label>{t(locale, "live.apiKey")}<input aria-label={t(locale, "live.apiKey")} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label><button type="button" onClick={() => void saveCredential()}>{t(locale, "live.saveApiKey")}</button></div>) : <p>{t(locale, "live.apiKeyPlaceholder")}</p>}</section>
      <nav className="rail-nav">{projects.map((item) => <button key={item.projectId} type="button" onClick={() => void chooseProject(item)}><FolderKanban size={16} /><span>{item.displayName}</span></button>)}{models.map((item) => <button key={item.configId} type="button" onClick={() => void chooseModel(item)}><Command size={16} /><span>{item.model}</span></button>)}</nav>
    </aside>
    <section className="execution-area"><header className="stream-header"><div><span className="eyebrow">{t(locale, "workbench.workspace")}</span><h1>{project?.displayName ?? t(locale, "live.noWorkspaceSelected")}</h1></div><div className={`phase phase-${phase.className}`}><span />{t(locale, phase.labelKey)}</div>{snapshot && (snapshot.run.status === "running" || snapshot.run.status === "awaiting_approval" || snapshot.run.status === "dispatching") ? <button className="icon-button" type="button" aria-label={t(locale, "live.stopRun")} title={t(locale, "live.stopRun")} onClick={() => void surface.run?.cancel(snapshot.run.runId)}><X size={17} aria-hidden="true" /></button> : null}</header>
      <div className="stream-scroll"><div className="execution-stream"><p className="inspector-kicker">{notice}</p>{candidates.map((candidate) => <section className="stream-event" key={candidate.candidateId}><span className="event-icon">{eventIcon("tool")}</span><span className="event-content"><strong>{candidate.purpose}</strong><span>{candidate.argv.join(" ")}</span></span><button type="button" onClick={() => void confirmCandidate(candidate.candidateId)}>{t(locale, "live.confirmCandidate")}</button></section>)}{snapshot?.trace.map((event) => <div className="stream-event" key={event.eventId}><span className="event-icon">{eventIcon("agent")}</span><span className="event-content"><strong>{event.type}</strong><span>{event.payloadSummary}</span></span></div>)}</div></div>
      {snapshot?.pendingApproval ? <section className="approval-actions"><button type="button" onClick={() => void decide("once")}>{t(locale, "workbench.allowOnce")}</button><button type="button" onClick={() => void decide("run")}>{t(locale, "workbench.allowRun")}</button><button className="danger" type="button" onClick={() => void decide("deny")}>{t(locale, "workbench.deny")}</button></section> : null}
      <form className="task-composer" onSubmit={(event) => { event.preventDefault(); void start(); }}><label htmlFor="live-task">{t(locale, "workbench.task")}</label><textarea id="live-task" value={task} onChange={(event) => setTask(event.target.value)} rows={2} /><button className="send-button" type="submit" aria-label={t(locale, "workbench.run")}><Play size={15} /></button></form>
    </section>
  </main>;
}
