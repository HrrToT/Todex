import keytar from "keytar";

export interface CredentialAdapter {
  save(credentialRef: string, apiKey: string): Promise<void>;
  read(credentialRef: string): Promise<string | undefined>;
  remove(credentialRef: string): Promise<void>;
}

export interface CredentialStatus {
  readonly configured: boolean;
  readonly availability: "available" | "unavailable";
}

export interface CredentialStoreOptions {
  readonly adapter: CredentialAdapter;
}

export class KeytarCredentialAdapter implements CredentialAdapter {
  async save(credentialRef: string, apiKey: string): Promise<void> {
    await keytar.setPassword("Todex", credentialRef, apiKey);
  }

  async read(credentialRef: string): Promise<string | undefined> {
    return (await keytar.getPassword("Todex", credentialRef)) ?? undefined;
  }

  async remove(credentialRef: string): Promise<void> {
    await keytar.deletePassword("Todex", credentialRef);
  }
}

export class CredentialStore {
  constructor(private readonly options: CredentialStoreOptions) {}

  async status(credentialRef: string | undefined): Promise<CredentialStatus> {
    try {
      // This probes the provider but deliberately discards every secret value.
      const credential = await this.options.adapter.read(credentialRef ?? "todex-status-probe");
      return {
        configured: credentialRef !== undefined && credential !== undefined,
        availability: "available",
      };
    } catch {
      return { configured: false, availability: "unavailable" };
    }
  }

  async save(credentialRef: string, apiKey: string): Promise<{ readonly configured: true }> {
    try {
      await this.options.adapter.save(credentialRef, apiKey);
    } catch {
      throw new Error("credential_unavailable");
    }
    return { configured: true };
  }

  async clear(credentialRef: string): Promise<{ readonly configured: false }> {
    try {
      await this.options.adapter.remove(credentialRef);
    } catch {
      throw new Error("credential_unavailable");
    }
    return { configured: false };
  }
}
