import type { MemoryEntry } from "@todex/contracts";
import { memoryEntrySchema } from "@todex/contracts";
import type { Clock } from "./llm.js";

export interface MemoryRepository {
  insert(entry: MemoryEntry): void;
  listActive(projectId: string): readonly MemoryEntry[];
  delete(projectId: string, memoryId: string, deletedAt: string): boolean;
}

const SENSITIVE_CONTENT_PATTERN =
  /(?:api[_-]?key|apikey|secret|token|password|passwd|credential|private[_-]?key)\s*[=:]\s*[^\s]/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z ]*)?PRIVATE KEY-----/;

export function isSensitiveContent(content: string): boolean {
  return SENSITIVE_CONTENT_PATTERN.test(content) || PRIVATE_KEY_PATTERN.test(content);
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private entries: MemoryEntry[] = [];

  insert(entry: MemoryEntry): void {
    this.entries.push({ ...entry, sourceTraceIds: [...entry.sourceTraceIds] });
  }

  listActive(projectId: string): readonly MemoryEntry[] {
    return this.entries
      .filter((e) => e.projectId === projectId && e.deletedAt === undefined)
      .map((e) => ({ ...e, sourceTraceIds: [...e.sourceTraceIds] }));
  }

  delete(projectId: string, memoryId: string, deletedAt: string): boolean {
    const index = this.entries.findIndex(
      (e) =>
        e.projectId === projectId &&
        e.memoryId === memoryId &&
        e.deletedAt === undefined,
    );
    if (index === -1) return false;
    this.entries[index] = { ...this.entries[index], deletedAt };
    return true;
  }

  all(): readonly MemoryEntry[] {
    return this.entries.map((e) => ({ ...e, sourceTraceIds: [...e.sourceTraceIds] }));
  }
}

export interface MemoryStoreDeps {
  readonly repository: MemoryRepository;
  readonly clock: Clock;
  readonly memoryIdFactory: () => string;
}

export class MemoryStore {
  private readonly repository: MemoryRepository;
  private readonly clock: Clock;
  private readonly memoryIdFactory: () => string;

  constructor(deps: MemoryStoreDeps) {
    this.repository = deps.repository;
    this.clock = deps.clock;
    this.memoryIdFactory = deps.memoryIdFactory;
  }

  remember(
    entry: Omit<MemoryEntry, "memoryId" | "createdAt" | "updatedAt" | "deletedAt">,
  ): MemoryEntry {
    if (isSensitiveContent(entry.content)) {
      throw new Error("sensitive_content");
    }

    const now = this.clock.now().toISOString();
    const fullEntry: MemoryEntry = {
      ...entry,
      memoryId: this.memoryIdFactory(),
      createdAt: now,
      updatedAt: now,
      sourceTraceIds: [...entry.sourceTraceIds],
    };

    const result = memoryEntrySchema.safeParse(fullEntry);
    if (!result.success) {
      throw new Error(
        `invalid memory entry: ${result.error.issues.map((i) => i.message).join("; ")}`,
      );
    }

    this.repository.insert(result.data as MemoryEntry);
    return { ...result.data, sourceTraceIds: [...result.data.sourceTraceIds] } as MemoryEntry;
  }

  list(projectId: string): readonly MemoryEntry[] {
    return this.repository.listActive(projectId);
  }

  delete(projectId: string, memoryId: string): boolean {
    return this.repository.delete(projectId, memoryId, this.clock.now().toISOString());
  }
}
