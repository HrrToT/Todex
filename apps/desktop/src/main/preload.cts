// Electron executes sandbox preload scripts as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel: string, input: unknown) => ipcRenderer.invoke(channel, input);

contextBridge.exposeInMainWorld("todex", {
  workspace: {
    choose: () => invoke("workspace.choose", {}),
  },
  project: {
    importSelectedWorkspace: () => invoke("project.importSelectedWorkspace", {}),
    list: () => invoke("project.list", {}),
    get: (projectId: string) => invoke("project.get", { projectId }),
    delete: (projectId: string) => invoke("project.delete", { projectId }),
  },
  model: {
    list: (projectId: string) => invoke("model.list", { projectId }),
    save: (input: unknown) => invoke("model.save", input),
  },
  command: {
    list: (projectId: string) => invoke("command.list", { projectId }),
    confirm: (projectId: string, candidateId: string) => invoke("command.confirm", { projectId, candidateId }),
    remove: (commandId: string) => invoke("command.remove", { commandId }),
  },
  run: {
    start: (input: unknown) => invoke("run.start", input),
    list: (projectId: string) => invoke("run.list", { projectId }),
    get: (runId: string) => invoke("run.get", { runId }),
    snapshot: (runId: string) => invoke("run.snapshot", { runId }),
    cancel: (runId: string) => invoke("run.cancel", { runId }),
    subscribe: (runId: string, listener: (snapshot: unknown) => void) => {
      const handler = (_event: unknown, snapshot: unknown) => {
        if (typeof snapshot === "object" && snapshot !== null && "run" in snapshot) {
          const run = (snapshot as { run?: unknown }).run;
          if (typeof run === "object" && run !== null && (run as { runId?: unknown }).runId === runId) listener(snapshot);
        }
      };
      ipcRenderer.on("run.update", handler);
      void invoke("run.subscribe", { runId });
      return () => { ipcRenderer.removeListener("run.update", handler); void invoke("run.unsubscribe", { runId }); };
    },
  },
  approval: {
    listPending: (projectId: string) => invoke("approval.listPending", { projectId }),
    decide: (input: unknown) => invoke("approval.decide", input),
  },
  memory: {
    list: (projectId: string) => invoke("memory.list", { projectId }),
    delete: (memoryId: string) => invoke("memory.delete", { memoryId }),
  },
  credential: {
    status: (configId: string) => invoke("credential.status", { configId }),
    save: (configId: string, apiKey: string) => invoke("credential.save", { configId, apiKey }),
    clear: (configId: string) => invoke("credential.clear", { configId }),
  },
  settings: {
    getLocale: () => invoke("settings.getLocale", {}),
    setLocale: (locale: "zh-CN" | "en-US") => invoke("settings.setLocale", { locale }),
  },
});
