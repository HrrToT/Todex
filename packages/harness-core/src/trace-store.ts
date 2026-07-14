import type { TraceEvent } from "@todex/contracts";

export type TraceEventType = TraceEvent["type"];

export interface TraceStore {
  append(event: {
    readonly runId: string;
    readonly type: TraceEventType;
    readonly payloadSummary: string;
  }): TraceEvent;
  list(runId: string): readonly TraceEvent[];
}

export class InMemoryTraceStore implements TraceStore {
  private readonly events: TraceEvent[] = [];
  private readonly sequences = new Map<string, number>();

  append(event: {
    readonly runId: string;
    readonly type: TraceEventType;
    readonly payloadSummary: string;
  }): TraceEvent {
    const sequence = this.sequences.get(event.runId) ?? 0;
    this.sequences.set(event.runId, sequence + 1);
    const full: TraceEvent = {
      eventId: `${event.runId}-${sequence}`,
      runId: event.runId,
      sequence,
      type: event.type,
      timestamp: new Date().toISOString(),
      payloadSummary: event.payloadSummary,
    };
    this.events.push(full);
    return full;
  }

  list(runId: string): readonly TraceEvent[] {
    return this.events.filter((event) => event.runId === runId);
  }
}
