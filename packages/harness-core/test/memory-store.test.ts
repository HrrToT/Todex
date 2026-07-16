import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "@todex/contracts";
import { MemoryStore, InMemoryMemoryRepository } from "../src/memory-store.js";
import { ContextBuilder, EMPTY_MEMORY_CONTEXT, type SelectionReason } from "../src/context-builder.js";
import type { Clock } from "../src/llm.js";

class FakeClock implements Clock {
  private current: Date;
  private counter = 0;
  constructor(initial: Date = new Date("2026-01-01T00:00:00Z")) {
    this.current = initial;
  }
  now(): Date {
    const result = new Date(this.current.getTime() + this.counter * 1000);
    this.counter++;
    return result;
  }
}

function createMonotonicIdFactory(): () => string {
  let n = 0;
  return () => `mem-${++n}`;
}

function makeStore() {
  const repository = new InMemoryMemoryRepository();
  const clock = new FakeClock();
  const store = new MemoryStore({
    repository,
    clock,
    memoryIdFactory: createMonotonicIdFactory(),
  });
  return { store, repository, clock };
}

function verifiedEntry(
  overrides: Partial<Omit<MemoryEntry, "memoryId" | "createdAt" | "updatedAt" | "deletedAt">> = {},
): Omit<MemoryEntry, "memoryId" | "createdAt" | "updatedAt" | "deletedAt"> {
  return {
    projectId: "p1",
    kind: "project_profile",
    trustLevel: "verified",
    content: "test content",
    sourceTraceIds: [],
    ...overrides,
  };
}

function agentObserved(
  overrides: Partial<Omit<MemoryEntry, "memoryId" | "createdAt" | "updatedAt" | "deletedAt">> = {},
): Omit<MemoryEntry, "memoryId" | "createdAt" | "updatedAt" | "deletedAt"> {
  return verifiedEntry({
    trustLevel: "agent_observed",
    sourceTraceIds: ["trace-1"],
    ...overrides,
  });
}

describe("MemoryStore trust validation", () => {
  it("rejects agent-observed memory without trace evidence", () => {
    const { store } = makeStore();
    expect(() =>
      store.remember(agentObserved({ sourceTraceIds: [] })),
    ).toThrow();
  });

  it("accepts verified memory without trace IDs", () => {
    const { store } = makeStore();
    const entry = store.remember(verifiedEntry({ sourceTraceIds: [] }));
    expect(entry.memoryId).toBeDefined();
    expect(entry.trustLevel).toBe("verified");
  });
});

describe("MemoryStore sensitive content rejection", () => {
  it("rejects sensitive content before repository insertion", () => {
    const { store, repository } = makeStore();
    expect(() =>
      store.remember(agentObserved({ content: "TOKEN=secret-value" })),
    ).toThrow("sensitive_content");
    expect(repository.all()).toEqual([]);
  });

  it("rejects content with API key pattern", () => {
    const { store, repository } = makeStore();
    expect(() =>
      store.remember(agentObserved({ content: "api_key=abc123" })),
    ).toThrow("sensitive_content");
    expect(repository.all()).toEqual([]);
  });

  it("rejects content with private key block", () => {
    const { store, repository } = makeStore();
    expect(() =>
      store.remember(
        agentObserved({ content: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----" }),
      ),
    ).toThrow("sensitive_content");
    expect(repository.all()).toEqual([]);
  });

  it("does not store a hash or redacted copy of rejected content", () => {
    const { store, repository } = makeStore();
    expect(() =>
      store.remember(agentObserved({ content: "PASSWORD=hunter2" })),
    ).toThrow("sensitive_content");
    const allEntries = repository.all();
    expect(allEntries).toHaveLength(0);
    const allText = JSON.stringify(allEntries);
    expect(allText).not.toContain("hunter2");
  });
});

describe("MemoryStore project isolation", () => {
  it("isolates memory by project", () => {
    const { store } = makeStore();
    store.remember(verifiedEntry({ projectId: "p1", content: "p1 profile" }));
    store.remember(verifiedEntry({ projectId: "p2", content: "p2 profile" }));

    const p1 = store.list("p1");
    const p2 = store.list("p2");

    expect(p1).toHaveLength(1);
    expect(p1[0].content).toBe("p1 profile");
    expect(p2).toHaveLength(1);
    expect(p2[0].content).toBe("p2 profile");
  });
});

describe("MemoryStore deletion", () => {
  it("removes deleted memory from list", () => {
    const { store } = makeStore();
    const entry = store.remember(verifiedEntry({ content: "to delete" }));

    expect(store.list("p1")).toHaveLength(1);
    store.delete("p1", entry.memoryId);
    expect(store.list("p1")).toHaveLength(0);
  });

  it("does not delete memory from a different project", () => {
    const { store } = makeStore();
    const entry = store.remember(verifiedEntry({ projectId: "p1", content: "p1 entry" }));

    expect(store.delete("p2", entry.memoryId)).toBe(false);
    expect(store.list("p1")).toHaveLength(1);
  });
});

describe("MemoryStore immutability", () => {
  it("returns immutable copies from list", () => {
    const { store } = makeStore();
    store.remember(verifiedEntry({ content: "immutable test" }));

    const list1 = store.list("p1");
    const list2 = store.list("p1");

    expect(list1).not.toBe(list2);
    expect(list1[0]).not.toBe(list2[0]);
    expect(list1[0]).toEqual(list2[0]);
  });

  it("returns immutable copies from remember", () => {
    const { store, repository } = makeStore();
    const entry = store.remember(verifiedEntry({ content: "test", sourceTraceIds: ["e1"] }));

    entry.sourceTraceIds.push("e2");
    const stored = repository.all();
    expect(stored[0].sourceTraceIds).toEqual(["e1"]);
  });
});

describe("ContextBuilder selection", () => {
  it("prioritizes verified facts over agent observations", () => {
    const { store, repository } = makeStore();
    store.remember(agentObserved({ content: "agent observation" }));
    store.remember(verifiedEntry({ kind: "project_profile", content: "verified profile" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(2);
    expect(context.entries[0].content).toBe("verified profile");
    expect(context.entries[1].content).toBe("agent observation");
  });

  it("prioritizes failure resolution over remaining verified", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ kind: "project_convention", content: "convention" }));
    store.remember(verifiedEntry({ kind: "failure_resolution", content: "failure fix" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries[0].content).toBe("failure fix");
    expect(context.entries[1].content).toBe("convention");
  });

  it("selects at most 12 entries", () => {
    const { store, repository } = makeStore();
    for (let i = 0; i < 15; i++) {
      store.remember(verifiedEntry({ kind: "project_convention", content: `convention ${i}` }));
    }

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(12);
    expect(context.totalCharacters).toBeLessThanOrEqual(4096);
  });

  it("respects the 4096 character budget", () => {
    const { store, repository } = makeStore();
    for (let i = 0; i < 5; i++) {
      store.remember(verifiedEntry({ kind: "project_convention", content: "x".repeat(1000) }));
    }

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.totalCharacters).toBeLessThanOrEqual(4096);
    expect(context.entries.length).toBeLessThanOrEqual(12);
  });

  it("omits deleted entries from context", () => {
    const { store, repository } = makeStore();
    const entry = store.remember(verifiedEntry({ content: "to delete" }));
    store.remember(verifiedEntry({ content: "keep" }));

    store.delete("p1", entry.memoryId);

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(1);
    expect(context.entries[0].content).toBe("keep");
  });

  it("omits cross-project entries from context", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ projectId: "p1", content: "p1 entry" }));
    store.remember(verifiedEntry({ projectId: "p2", content: "p2 entry" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(1);
    expect(context.entries[0].content).toBe("p1 entry");
  });

  it("provides selection reasons for each entry", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ kind: "project_profile", content: "profile" }));
    store.remember(verifiedEntry({ kind: "failure_resolution", content: "fix" }));
    store.remember(agentObserved({ content: "observation" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.reasons.get(context.entries[0].memoryId)).toBe("verified_fact");
    expect(context.reasons.get(context.entries[1].memoryId)).toBe("verification_context");
    expect(context.reasons.get(context.entries[2].memoryId)).toBe("agent_observed");
  });

  it("returns immutable entries", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ content: "test", sourceTraceIds: ["e1"] }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    const entry = context.entries[0];
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

describe("ContextBuilder seeded secret absence", () => {
  it("does not include rejected sensitive content in context", () => {
    const { store, repository } = makeStore();
    expect(() =>
      store.remember(agentObserved({ content: "TOKEN=secret-value" })),
    ).toThrow("sensitive_content");

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(0);
    const allText = JSON.stringify(context);
    expect(allText).not.toContain("secret-value");
  });
});

describe("ContextBuilder overflow continuation", () => {
  it("skips an over-budget entry and includes smaller subsequent entries", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ kind: "project_profile", content: "x".repeat(5000) }));
    store.remember(verifiedEntry({ kind: "project_convention", content: "small1" }));
    store.remember(verifiedEntry({ kind: "project_convention", content: "small2" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(2);
    const contents = context.entries.map((e) => e.content);
    expect(contents).toContain("small1");
    expect(contents).toContain("small2");
    expect(context.totalCharacters).toBeLessThanOrEqual(4096);
  });

  it("still respects the 12-entry limit after skipping over-budget entries", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ kind: "project_profile", content: "x".repeat(5000) }));
    for (let i = 0; i < 15; i++) {
      store.remember(verifiedEntry({ kind: "project_convention", content: `entry${i}` }));
    }

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(context.entries).toHaveLength(12);
    expect(context.totalCharacters).toBeLessThanOrEqual(4096);
  });
});

describe("ContextBuilder container immutability", () => {
  it("freezes the entries array so callers cannot push", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ content: "frozen test" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(Object.isFrozen(context.entries)).toBe(true);
    expect(() => (context.entries as MemoryEntry[]).push(context.entries[0])).toThrow();
  });

  it("freezes the reasons Map so callers cannot set", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ content: "frozen reasons" }));

    const builder = new ContextBuilder({ repository });
    const context = builder.build({ projectId: "p1" });

    expect(Object.isFrozen(context.reasons)).toBe(true);
    expect(() => (context.reasons as Map<string, SelectionReason>).set("fake-id", "agent_observed")).toThrow();
  });

  it("freezes EMPTY_MEMORY_CONTEXT entries and reasons", () => {
    expect(Object.isFrozen(EMPTY_MEMORY_CONTEXT.entries)).toBe(true);
    expect(Object.isFrozen(EMPTY_MEMORY_CONTEXT.reasons)).toBe(true);
    expect(() => (EMPTY_MEMORY_CONTEXT.entries as MemoryEntry[]).push({} as MemoryEntry)).toThrow();
    expect(() => (EMPTY_MEMORY_CONTEXT.reasons as Map<string, SelectionReason>).set("x", "agent_observed")).toThrow();
  });

  it("does not let mutating one context affect a later context", () => {
    const { store, repository } = makeStore();
    store.remember(verifiedEntry({ content: "entry one" }));

    const builder = new ContextBuilder({ repository });
    const context1 = builder.build({ projectId: "p1" });

    store.remember(verifiedEntry({ content: "entry two" }));
    const context2 = builder.build({ projectId: "p1" });

    expect(context1.entries).toHaveLength(1);
    expect(context2.entries).toHaveLength(2);
    expect(context1.entries[0].content).toBe("entry one");
  });
});
