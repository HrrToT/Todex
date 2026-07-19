import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, input: unknown) => ipcRenderer.invoke(channel, input);

contextBridge.exposeInMainWorld("todex", {
  project: {
    selectWorkspace: (input: unknown) => invoke("project.selectWorkspace", input),
    list: () => invoke("project.list", {}),
    get: (projectId: string) => invoke("project.get", { projectId }),
    save: (input: unknown) => invoke("project.save", input),
    delete: (projectId: string) => invoke("project.delete", { projectId }),
  },
  command: {
    list: (projectId: string) => invoke("command.list", { projectId }),
    confirm: (input: unknown) => invoke("command.confirm", input),
    remove: (commandId: string) => invoke("command.remove", { commandId }),
  },
  run: {
    list: (projectId: string) => invoke("run.list", { projectId }),
    get: (runId: string) => invoke("run.get", { runId }),
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
