export type Locale = "zh-CN" | "en-US";

export type MessageKey =
  | "workbench.workspaceNavigation"
  | "workbench.currentWorkspace"
  | "workbench.recentRuns"
  | "workbench.repairCalculation"
  | "workbench.inspectTests"
  | "workbench.views"
  | "workbench.trace"
  | "workbench.memory"
  | "workbench.workspace"
  | "workbench.openInspector"
  | "workbench.task"
  | "workbench.taskPlaceholder"
  | "workbench.run"
  | "workbench.inspector"
  | "workbench.pinInspector"
  | "workbench.closeInspector"
  | "workbench.inspectorTabs"
  | "workbench.diff"
  | "workbench.approval"
  | "workbench.approvalRequired"
  | "workbench.scopedCommandRequest"
  | "workbench.commandNeedsDecision"
  | "workbench.allowOnce"
  | "workbench.allowRun"
  | "workbench.deny"
  | "workbench.patchSummary"
  | "workbench.selectedMemory"
  | "workbench.noStoredContext"
  | "workbench.memorySafety"
  | "workbench.traceTimeline"
  | "live.modelConfiguration"
  | "live.model"
  | "live.apiKey"
  | "live.selectWorkspace"
  | "live.noWorkspaceSelected"
  | "live.saveModelConfiguration"
  | "live.apiKeyPlaceholder"
  | "live.confirmCandidate"
  | "live.notice.chooseWorkspaceAndModel"
  | "live.notice.modelReady"
  | "live.notice.enterApiKey"
  | "live.notice.commandConfirmed"
  | "live.notice.completeSetup"
  | "live.notice.runUpdated"
  | "live.stopRun"
  | "phase.idle"
  | "phase.running"
  | "phase.awaitingApproval"
  | "phase.failed"
  | "phase.completed"
  | "demo.readyForTask"
  | "demo.streamWillAppear"
  | "demo.withheldTask"
  | "demo.defaultTask"
  | "demo.plan"
  | "demo.approvalRequired"
  | "demo.scopedCommandNeedsDecision"
  | "demo.patchPrepared"
  | "demo.verificationFailed"
  | "demo.testFeedback"
  | "demo.approvalDenied"
  | "demo.commandNotDispatched"
  | "demo.approvalRecorded"
  | "demo.scopedActionMayContinue"
  | "technical.traceType";

type Messages = Readonly<Record<Exclude<MessageKey, "technical.traceType">, string>>;

const messages: Readonly<Record<Locale, Messages>> = Object.freeze({
  "zh-CN": Object.freeze({
    "workbench.workspaceNavigation": "工作区导航",
    "workbench.currentWorkspace": "当前工作区",
    "workbench.recentRuns": "最近运行",
    "workbench.repairCalculation": "修复计算逻辑",
    "workbench.inspectTests": "检查测试",
    "workbench.views": "工作台视图",
    "workbench.trace": "追踪",
    "workbench.memory": "记忆",
    "workbench.workspace": "工作区",
    "workbench.openInspector": "打开检查器",
    "workbench.task": "任务或继续说明",
    "workbench.taskPlaceholder": "描述下一项要检查或修改的内容",
    "workbench.run": "开始运行",
    "workbench.inspector": "检查器",
    "workbench.pinInspector": "固定检查器",
    "workbench.closeInspector": "关闭检查器",
    "workbench.inspectorTabs": "检查器标签",
    "workbench.diff": "差异",
    "workbench.approval": "审批",
    "workbench.approvalRequired": "需要审批",
    "workbench.scopedCommandRequest": "受限命令请求",
    "workbench.commandNeedsDecision": "项目命令需要先经过你的决定才能运行。",
    "workbench.allowOnce": "仅允许一次",
    "workbench.allowRun": "允许本次运行",
    "workbench.deny": "拒绝",
    "workbench.patchSummary": "补丁摘要",
    "workbench.selectedMemory": "已选记忆",
    "workbench.noStoredContext": "未选择已存储的上下文",
    "workbench.memorySafety": "这里只会显示已经验证且不含敏感信息的项目事实。",
    "workbench.traceTimeline": "追踪时间线",
    "live.modelConfiguration": "模型配置",
    "live.model": "模型",
    "live.apiKey": "API Key",
    "live.selectWorkspace": "选择工作区",
    "live.noWorkspaceSelected": "未选择工作区",
    "live.saveModelConfiguration": "保存模型配置",
    "live.apiKeyPlaceholder": "仅保存到 Credential Manager",
    "live.confirmCandidate": "确认候选命令",
    "live.notice.chooseWorkspaceAndModel": "请选择工作区并配置模型",
    "live.notice.modelReady": "模型已配置，可以开始运行",
    "live.notice.enterApiKey": "请输入 API Key 后保存模型凭据",
    "live.notice.commandConfirmed": "已确认项目命令；每次执行仍需审批",
    "live.notice.completeSetup": "请先选择工作区、模型并填写任务",
    "live.notice.runUpdated": "运行状态已更新",
    "live.stopRun": "停止运行",
    "phase.idle": "空闲",
    "phase.running": "运行中",
    "phase.awaitingApproval": "等待审批",
    "phase.failed": "失败",
    "phase.completed": "已完成",
    "demo.readyForTask": "等待任务",
    "demo.streamWillAppear": "运行过程会显示在这里。",
    "demo.withheldTask": "已隐藏敏感任务内容",
    "demo.defaultTask": "检查当前工作区",
    "demo.plan": "我会检查工作区并报告下一步安全操作。",
    "demo.approvalRequired": "需要审批",
    "demo.scopedCommandNeedsDecision": "受限命令需要你的决定。",
    "demo.patchPrepared": "已准备补丁",
    "demo.verificationFailed": "验证失败",
    "demo.testFeedback": "检查器中提供了测试反馈。",
    "demo.approvalDenied": "审批已拒绝",
    "demo.commandNotDispatched": "该命令未被分发。",
    "demo.approvalRecorded": "已记录审批",
    "demo.scopedActionMayContinue": "受限操作可以继续。",
  }),
  "en-US": Object.freeze({
    "workbench.workspaceNavigation": "Workspace navigation",
    "workbench.currentWorkspace": "Current workspace",
    "workbench.recentRuns": "Recent runs",
    "workbench.repairCalculation": "Repair calculation",
    "workbench.inspectTests": "Inspect tests",
    "workbench.views": "Workbench views",
    "workbench.trace": "Trace",
    "workbench.memory": "Memory",
    "workbench.workspace": "Workspace",
    "workbench.openInspector": "Open Inspector",
    "workbench.task": "Task or continuation",
    "workbench.taskPlaceholder": "Describe the next thing to inspect or change",
    "workbench.run": "Run",
    "workbench.inspector": "Inspector",
    "workbench.pinInspector": "Pin Inspector",
    "workbench.closeInspector": "Close Inspector",
    "workbench.inspectorTabs": "Inspector tabs",
    "workbench.diff": "Diff",
    "workbench.approval": "Approval",
    "workbench.approvalRequired": "Approval required",
    "workbench.scopedCommandRequest": "Scoped command request",
    "workbench.commandNeedsDecision": "A project command needs a decision before it can run.",
    "workbench.allowOnce": "Allow once",
    "workbench.allowRun": "Allow run",
    "workbench.deny": "Deny",
    "workbench.patchSummary": "Patch summary",
    "workbench.selectedMemory": "Selected memory",
    "workbench.noStoredContext": "No stored context selected",
    "workbench.memorySafety": "Only verified, non-sensitive project facts will appear here.",
    "workbench.traceTimeline": "Trace timeline",
    "live.modelConfiguration": "Model configuration",
    "live.model": "Model",
    "live.apiKey": "API Key",
    "live.selectWorkspace": "Select workspace",
    "live.noWorkspaceSelected": "No workspace selected",
    "live.saveModelConfiguration": "Save model configuration",
    "live.apiKeyPlaceholder": "Saved only to Credential Manager",
    "live.confirmCandidate": "Confirm candidate command",
    "live.notice.chooseWorkspaceAndModel": "Select a workspace and configure a model",
    "live.notice.modelReady": "Model is configured and ready to run",
    "live.notice.enterApiKey": "Enter an API Key, then save the model credential",
    "live.notice.commandConfirmed": "Project command confirmed; each execution still requires approval",
    "live.notice.completeSetup": "Select a workspace and model, then enter a task",
    "live.notice.runUpdated": "Run status updated",
    "live.stopRun": "Stop run",
    "phase.idle": "Idle",
    "phase.running": "Running",
    "phase.awaitingApproval": "Awaiting approval",
    "phase.failed": "Failed",
    "phase.completed": "Completed",
    "demo.readyForTask": "Ready for a task",
    "demo.streamWillAppear": "The run stream will appear here.",
    "demo.withheldTask": "Sensitive task content withheld",
    "demo.defaultTask": "Inspect the current workspace",
    "demo.plan": "I will inspect the workspace and report the next safe step.",
    "demo.approvalRequired": "Approval required",
    "demo.scopedCommandNeedsDecision": "A scoped command needs your decision.",
    "demo.patchPrepared": "Patch prepared",
    "demo.verificationFailed": "Verification failed",
    "demo.testFeedback": "Test feedback is available in Inspector.",
    "demo.approvalDenied": "Approval denied",
    "demo.commandNotDispatched": "The command was not dispatched.",
    "demo.approvalRecorded": "Approval recorded",
    "demo.scopedActionMayContinue": "The scoped action may continue.",
  }),
});

export function createLocaleState(locale: Locale = "zh-CN"): Readonly<{ locale: Locale }> {
  return Object.freeze({ locale });
}

export function t(locale: Locale, key: MessageKey, params?: Readonly<{ value: string }>): string {
  if (key === "technical.traceType") return params?.value ?? "";
  return messages[locale][key];
}
