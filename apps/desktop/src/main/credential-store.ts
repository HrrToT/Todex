interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarModulePromise: Promise<KeytarModule> | undefined;

function loadKeytar(): Promise<KeytarModule> {
  keytarModulePromise ??= import("keytar").then((module) => {
    const imported = module as unknown as { readonly default?: KeytarModule };
    return imported.default ?? (module as unknown as KeytarModule);
  });
  return keytarModulePromise;
}

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
    const keytar = await loadKeytar();
    await keytar.setPassword("Todex", credentialRef, apiKey);
  }

  async read(credentialRef: string): Promise<string | undefined> {
    const keytar = await loadKeytar();
    return (await keytar.getPassword("Todex", credentialRef)) ?? undefined;
  }

  async remove(credentialRef: string): Promise<void> {
    const keytar = await loadKeytar();
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
