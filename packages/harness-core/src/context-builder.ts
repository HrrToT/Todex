import type { MemoryEntry } from "@todex/contracts";
import type { MemoryRepository } from "./memory-store.js";

export type SelectionReason = "verified_fact" | "verification_context" | "agent_observed";

export interface SelectedMemoryContext {
  readonly entries: readonly MemoryEntry[];
  readonly reasons: ReadonlyMap<string, SelectionReason>;
  readonly totalCharacters: number;
}

export interface ContextBuilderDeps {
  readonly repository: MemoryRepository;
}

const MAX_CONTEXT_ENTRIES = 12;
const MAX_CONTEXT_CHARACTERS = 4096;

function getPriority(entry: MemoryEntry): number {
  if (entry.kind === "failure_resolution") return 1;
  if (entry.trustLevel === "verified") {
    if (entry.kind === "project_profile" || entry.kind === "verified_command") return 0;
    return 2;
  }
  return 3;
}

function getReason(entry: MemoryEntry): SelectionReason {
  if (entry.kind === "failure_resolution") return "verification_context";
  if (entry.trustLevel === "agent_observed") return "agent_observed";
  return "verified_fact";
}

function freezeEntry(entry: MemoryEntry): MemoryEntry {
  const copy: MemoryEntry = { ...entry, sourceTraceIds: [...entry.sourceTraceIds] };
  Object.freeze(copy);
  Object.freeze(copy.sourceTraceIds);
  return copy;
}

export const EMPTY_MEMORY_CONTEXT: SelectedMemoryContext = {
  entries: [],
  reasons: new Map(),
  totalCharacters: 0,
};

export class ContextBuilder {
  private readonly repository: MemoryRepository;

  constructor(deps: ContextBuilderDeps) {
    this.repository = deps.repository;
  }

  build(params: { projectId: string }): SelectedMemoryContext {
    const active = this.repository.listActive(params.projectId);

    const sorted = [...active].sort((a, b) => {
      const pa = getPriority(a);
      const pb = getPriority(b);
      if (pa !== pb) return pa - pb;
      if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return a.memoryId.localeCompare(b.memoryId);
    });

    const entries: MemoryEntry[] = [];
    const reasons = new Map<string, SelectionReason>();
    let totalCharacters = 0;

    for (const entry of sorted) {
      if (entries.length >= MAX_CONTEXT_ENTRIES) break;
      if (totalCharacters + entry.content.length > MAX_CONTEXT_CHARACTERS) continue;
      const frozen = freezeEntry(entry);
      entries.push(frozen);
      reasons.set(entry.memoryId, getReason(entry));
      totalCharacters += entry.content.length;
    }

    return { entries, reasons, totalCharacters };
  }
}
