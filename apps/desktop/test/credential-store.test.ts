import { describe, expect, it } from "vitest";

import {
  CredentialStore,
  type CredentialAdapter,
} from "../src/main/credential-store.js";

const API_KEY_SEED = "secret-value";

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

describe("CredentialStore", () => {
  it("returns only redacted lifecycle DTOs", async () => {
    const store = new CredentialStore({ adapter: new InMemoryCredentialAdapter() });

    const before = await store.status();
    const saved = await store.save(API_KEY_SEED);
    const after = await store.status();
    const cleared = await store.clear();

    expect(before).toEqual({ configured: false, availability: "available" });
    expect(saved).toEqual({ configured: true });
    expect(after).toEqual({ configured: true, availability: "available" });
    expect(cleared).toEqual({ configured: false });
    expect(JSON.stringify([before, saved, after, cleared])).not.toContain(API_KEY_SEED);
  });

  it("fails closed without exposing adapter errors", async () => {
    const store = new CredentialStore({ adapter: new FailingCredentialAdapter() });

    await expect(store.save(API_KEY_SEED)).rejects.toThrow("credential_unavailable");
    await expect(store.clear()).rejects.toThrow("credential_unavailable");
    await expect(store.status()).resolves.toEqual({
      configured: false,
      availability: "unavailable",
    });
    await expect(store.save(API_KEY_SEED)).rejects.not.toThrow("private adapter detail");
  });
});
