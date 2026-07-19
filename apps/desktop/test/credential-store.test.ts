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

  get(credentialRef: string): string | undefined {
    return this.values.get(credentialRef);
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
    const adapter = new InMemoryCredentialAdapter();
    const store = new CredentialStore({ adapter });
    const credentialRef = "opaque-credential-ref";

    const before = await store.status(credentialRef);
    const saved = await store.save(credentialRef, API_KEY_SEED);
    const after = await store.status(credentialRef);

    expect(before).toEqual({ configured: false, availability: "available" });
    expect(saved).toEqual({ configured: true });
    expect(after).toEqual({ configured: true, availability: "available" });
    expect(adapter.get(credentialRef)).toBe(API_KEY_SEED);
    const cleared = await store.clear(credentialRef);
    expect(cleared).toEqual({ configured: false });
    expect(adapter.get(credentialRef)).toBeUndefined();
    expect(JSON.stringify([before, saved, after, cleared])).not.toContain(API_KEY_SEED);
  });

  it("fails closed without exposing adapter errors", async () => {
    const store = new CredentialStore({ adapter: new FailingCredentialAdapter() });

    await expect(store.save("opaque-credential-ref", API_KEY_SEED)).rejects.toThrow("credential_unavailable");
    await expect(store.clear("opaque-credential-ref")).rejects.toThrow("credential_unavailable");
    await expect(store.status("opaque-credential-ref")).resolves.toEqual({
      configured: false,
      availability: "unavailable",
    });
    await expect(store.save("opaque-credential-ref", API_KEY_SEED)).rejects.not.toThrow(
      "private adapter detail",
    );
  });
});
