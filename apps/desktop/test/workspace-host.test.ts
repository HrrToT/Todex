import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CredentialAdapter } from "../src/main/credential-store.js";
import { WorkspaceHost } from "../src/main/workspace-host.js";

const TEMP_DIRECTORIES: string[] = [];
const API_KEY_SEED = "secret-value";

function temporaryUserDataPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "todex-host-test-"));
  TEMP_DIRECTORIES.push(directory);
  return directory;
}

class InMemoryCredentialAdapter implements CredentialAdapter {
  private readonly values = new Map<string, string>();

  async save(credentialRef: string, apiKey: string): Promise<void> {
    this.values.set(credentialRef, apiKey);
  }
  async read(credentialRef: string): Promise<string | undefined> {
    return this.values.get(credentialRef);
  }
  async remove(credentialRef: string): Promise<void> {
    this.values.delete(credentialRef);
  }
}

class FailingCredentialAdapter implements CredentialAdapter {
  async save(): Promise<void> {
    throw new Error("private adapter detail");
  }
  async read(): Promise<string | undefined> {
    throw new Error("private adapter detail");
  }
  async remove(): Promise<void> {
    throw new Error("private adapter detail");
  }
}

const MODEL_CONFIG = {
  configId: "model-config-1",
  baseUrl: "https://model.invalid",
  model: "test-model",
  parametersJson: "{}",
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
};

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("WorkspaceHost", () => {
  it("opens the database below injected userData and owns its lifecycle", async () => {
    const userDataPath = temporaryUserDataPath();
    const host = await WorkspaceHost.open({
      userDataPath,
      credentialAdapter: new InMemoryCredentialAdapter(),
    });

    expect(host.databasePath).toBe(join(userDataPath, "todex.sqlite"));
    expect(host.store).toBe(host.store);
    expect(existsSync(host.databasePath)).toBe(true);
    host.close();
  });

  it("does not create a plaintext credential fallback in its SQLite database", async () => {
    const userDataPath = temporaryUserDataPath();
    const adapter = new InMemoryCredentialAdapter();
    const host = await WorkspaceHost.open({
      userDataPath,
      credentialAdapter: adapter,
    });
    host.store.saveModelConfig(MODEL_CONFIG);

    const saved = await host.saveCredential(MODEL_CONFIG.configId, API_KEY_SEED);
    expect(saved).toEqual({ configured: true });
    const savedConfig = host.store.getModelConfig(MODEL_CONFIG.configId);
    expect(savedConfig?.credentialRef).toMatch(/^[0-9a-f-]{36}$/);
    expect(savedConfig?.credentialRef).not.toContain(API_KEY_SEED);
    host.close();

    expect(readFileSync(join(userDataPath, "todex.sqlite")).toString("utf8")).not.toContain(API_KEY_SEED);

    const reopened = await WorkspaceHost.open({ userDataPath, credentialAdapter: adapter });
    expect(await reopened.credentialStatus(MODEL_CONFIG.configId)).toEqual({
      configured: true,
      availability: "available",
    });
    expect(reopened.store.listColumns("model_configs")).toContain("credential_ref");
    expect(reopened.store.listColumns("model_configs")).not.toContain("api_key");
    expect(reopened.store.listColumns("model_configs")).not.toContain("key");
    await expect(reopened.clearCredential(MODEL_CONFIG.configId)).resolves.toEqual({ configured: false });
    reopened.close();

    const cleared = await WorkspaceHost.open({ userDataPath, credentialAdapter: adapter });
    expect(await cleared.credentialStatus(MODEL_CONFIG.configId)).toEqual({
      configured: false,
      availability: "available",
    });
    expect(cleared.store.getModelConfig(MODEL_CONFIG.configId)?.credentialRef).toBeUndefined();
    cleared.close();
  });

  it("keeps a persisted credential reference unchanged when keytar fails", async () => {
    const userDataPath = temporaryUserDataPath();
    const host = await WorkspaceHost.open({
      userDataPath,
      credentialAdapter: new FailingCredentialAdapter(),
    });
    host.store.saveModelConfig({ ...MODEL_CONFIG, credentialRef: "existing-ref" });

    await expect(host.saveCredential(MODEL_CONFIG.configId, API_KEY_SEED)).rejects.toThrow(
      "credential_unavailable",
    );
    await expect(host.clearCredential(MODEL_CONFIG.configId)).rejects.toThrow("credential_unavailable");
    expect(host.store.getModelConfig(MODEL_CONFIG.configId)?.credentialRef).toBe("existing-ref");
    host.close();

    expect(readFileSync(join(userDataPath, "todex.sqlite")).toString("utf8")).not.toContain(API_KEY_SEED);
  });
});
