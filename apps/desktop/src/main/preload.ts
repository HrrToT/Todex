import { contextBridge, ipcRenderer } from "electron";

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
    confirm: (input: unknown) => invoke("command.confirm", input),
    remove: (commandId: string) => invoke("command.remove", { commandId }),
  },
  run: {
    start: (input: unknown) => invoke("run.start", input),
    list: (projectId: string) => invoke("run.list", { projectId }),
    get: (runId: string) => invoke("run.get", { runId }),
    snapshot: (runId: string) => invoke("run.snapshot", { runId }),
    cancel: (runId: string) => invoke("run.cancel", { runId }),
  },
  approval: {
    listPending: (projectId: string) => invoke("approval.listPending", { projectId }),
    decide: (input: unknown) => invoke("approval.decide", input),
  },
  memory: {
    list: (projectId: string) => invoke("memory.list", { projectId }),
    save: (input: unknown) => invoke("memory.save", input),
    delete: (memoryId: string) => invoke("memory.delete", { memoryId }),
  },
  credential: {
    status: (configId: string) => invoke("credential.status", { configId }),
    save: (configId: string, apiKey: string) => invoke("credential.save", { configId, apiKey }),
    clear: (configId: string) => invoke("credential.clear", { configId }),
  },
});
