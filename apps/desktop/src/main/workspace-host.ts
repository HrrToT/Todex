import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  CredentialStore,
  type CredentialAdapter,
} from "./credential-store.js";
import { SQLiteStore } from "./sqlite-store.js";

export interface WorkspaceHostOptions {
  readonly userDataPath: string;
  readonly credentialAdapter: CredentialAdapter;
}

export class WorkspaceHost {
  readonly databasePath: string;
  readonly store: SQLiteStore;
  readonly credentials: CredentialStore;

  private constructor(options: WorkspaceHostOptions) {
    mkdirSync(options.userDataPath, { recursive: true });
    this.databasePath = join(options.userDataPath, "todex.sqlite");
    this.store = SQLiteStore.open({ databasePath: this.databasePath });
    this.credentials = new CredentialStore({ adapter: options.credentialAdapter });
  }

  static async open(options: WorkspaceHostOptions): Promise<WorkspaceHost> {
    return new WorkspaceHost(options);
  }

  close(): void {
    this.store.close();
  }
}
