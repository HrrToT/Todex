export interface DirectoryDialog {
  showOpenDialog(options: { properties: ["openDirectory"] }): Promise<{
    canceled: boolean;
    filePaths: readonly string[];
  }>;
}

export interface WorkspaceSelectorDependencies {
  readonly showOpenDialog: DirectoryDialog["showOpenDialog"];
  readonly realpath: (path: string) => Promise<string>;
}

export interface WorkspaceSelection {
  readonly workspaceRoot: string;
  readonly displayName: string;
}

export class WorkspaceSelector {
  constructor(private readonly dependencies: WorkspaceSelectorDependencies) {}

  async choose(): Promise<WorkspaceSelection | undefined> {
    const selection = await this.dependencies.showOpenDialog({ properties: ["openDirectory"] });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return undefined;

    const workspaceRoot = await this.dependencies.realpath(selectedPath);
    return { workspaceRoot, displayName: displayNameForPath(workspaceRoot) };
  }
}

function displayNameForPath(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}
