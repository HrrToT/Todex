import { randomUUID } from "node:crypto";

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
  readonly credentialRef?: string;
  readonly createCredentialRef?: () => string;
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
  private credentialRef: string | undefined;
  private readonly createCredentialRef: () => string;

  constructor(private readonly options: CredentialStoreOptions) {
    this.credentialRef = options.credentialRef;
    this.createCredentialRef = options.createCredentialRef ?? randomUUID;
  }

  async status(): Promise<CredentialStatus> {
    try {
      // This probes the provider but deliberately discards every secret value.
      await this.options.adapter.read(this.credentialRef ?? "todex-status-probe");
      return {
        configured: this.credentialRef !== undefined,
        availability: "available",
      };
    } catch {
      return { configured: false, availability: "unavailable" };
    }
  }

  async save(apiKey: string): Promise<{ readonly configured: true }> {
    const credentialRef = this.credentialRef ?? this.createCredentialRef();
    try {
      await this.options.adapter.save(credentialRef, apiKey);
    } catch {
      throw new Error("credential_unavailable");
    }
    this.credentialRef = credentialRef;
    return { configured: true };
  }

  async clear(): Promise<{ readonly configured: false }> {
    if (!this.credentialRef) {
      try {
        await this.options.adapter.read("todex-status-probe");
      } catch {
        throw new Error("credential_unavailable");
      }
      return { configured: false };
    }
    try {
      await this.options.adapter.remove(this.credentialRef);
    } catch {
      throw new Error("credential_unavailable");
    }
    this.credentialRef = undefined;
    return { configured: false };
  }
}
