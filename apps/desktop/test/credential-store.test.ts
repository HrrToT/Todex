import { afterEach, describe, expect, it, vi } from "vitest";

import type { CredentialAdapter } from "../src/main/credential-store.js";

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

afterEach(() => {
  vi.doUnmock("keytar");
  vi.resetModules();
});

describe("CredentialStore", () => {
  it("uses an injected fake adapter without loading keytar", async () => {
    vi.doMock("keytar", () => {
      throw new Error("keytar must not load for a fake adapter");
    });
    const { CredentialStore } = await import("../src/main/credential-store.js");
    const adapter = new InMemoryCredentialAdapter();
    const store = new CredentialStore({ adapter });

    await expect(store.save("opaque-credential-ref", API_KEY_SEED)).resolves.toEqual({ configured: true });

    expect(adapter.get("opaque-credential-ref")).toBe(API_KEY_SEED);
  });

  it("loads keytar only for production adapter use and caches the module", async () => {
    const setPassword = vi.fn().mockResolvedValue(undefined);
    const getPassword = vi.fn().mockResolvedValue("secret-value");
    const deletePassword = vi.fn().mockResolvedValue(true);
    let keytarLoads = 0;
    vi.doMock("keytar", () => {
      keytarLoads += 1;
      return { default: { setPassword, getPassword, deletePassword } };
    });
    const { KeytarCredentialAdapter } = await import("../src/main/credential-store.js");
    const adapter = new KeytarCredentialAdapter();

    expect(keytarLoads).toBe(0);
    await adapter.save("credential-ref", API_KEY_SEED);
    await adapter.read("credential-ref");
    await adapter.remove("credential-ref");

    expect(keytarLoads).toBe(1);
    expect(setPassword).toHaveBeenCalledWith("Todex", "credential-ref", API_KEY_SEED);
    expect(getPassword).toHaveBeenCalledWith("Todex", "credential-ref");
    expect(deletePassword).toHaveBeenCalledWith("Todex", "credential-ref");
  });

  it("returns only redacted lifecycle DTOs", async () => {
    const { CredentialStore } = await import("../src/main/credential-store.js");
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
    const { CredentialStore } = await import("../src/main/credential-store.js");
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
