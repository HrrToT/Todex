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
  async save(): Promise<void> {}
  async read(): Promise<string | undefined> {
    return undefined;
  }
  async remove(): Promise<void> {}
}

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
    const host = await WorkspaceHost.open({
      userDataPath,
      credentialAdapter: new InMemoryCredentialAdapter(),
    });

    await host.credentials.save(API_KEY_SEED);
    host.close();

    expect(readFileSync(join(userDataPath, "todex.sqlite")).toString("utf8")).not.toContain(API_KEY_SEED);
  });
});
