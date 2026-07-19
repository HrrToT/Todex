import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

  async credentialStatus(configId: string): Promise<{
    readonly configured: boolean;
    readonly availability: "available" | "unavailable";
  }> {
    return this.credentials.status(this.requireModelConfig(configId).credentialRef);
  }

  async saveCredential(configId: string, apiKey: string): Promise<{ readonly configured: true }> {
    const config = this.requireModelConfig(configId);
    const credentialRef = config.credentialRef ?? randomUUID();
    const result = await this.credentials.save(credentialRef, apiKey);
    this.store.saveModelConfig({
      ...config,
      credentialRef,
      updatedAt: new Date().toISOString(),
    });
    return result;
  }

  async clearCredential(configId: string): Promise<{ readonly configured: false }> {
    const config = this.requireModelConfig(configId);
    if (!config.credentialRef) {
      const status = await this.credentials.status(undefined);
      if (status.availability === "unavailable") {
        throw new Error("credential_unavailable");
      }
      return { configured: false };
    }
    const result = await this.credentials.clear(config.credentialRef);
    this.store.saveModelConfig({
      ...config,
      credentialRef: undefined,
      updatedAt: new Date().toISOString(),
    });
    return result;
  }

  private requireModelConfig(configId: string) {
    const config = this.store.getModelConfig(configId);
    if (!config) {
      throw new Error("credential_config_not_found");
    }
    return config;
  }
}
