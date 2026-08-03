import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, type DemoClient } from "./App.js";
import type { DemoScenarioId, DemoSnapshot } from "./demo-session.js";

async function readJson(response: Response): Promise<DemoSnapshot> {
  if (!response.ok) throw new Error("demo_unavailable");
  const value: unknown = await response.json();
  if (!isDemoSnapshot(value)) throw new Error("demo_unavailable");
  return value;
}

function isDemoSnapshot(value: unknown): value is DemoSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.status === "idle" || record.status === "awaiting_approval" || record.status === "completed") &&
    Array.isArray(record.runs) &&
    Array.isArray(record.trace) &&
    Array.isArray(record.verification) &&
    typeof record.dispatcherCalls === "number"
  );
}

const client: DemoClient = {
  readSession: () => fetch("/api/session").then(readJson),
  selectScenario: (scenarioId: DemoScenarioId) => fetch("/api/scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  }).then(readJson),
  run: () => fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(readJson),
  decideApproval: ({ approvalId, decision }) => fetch("/api/approval", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalId, decision }),
  }).then(readJson),
  reset: () => fetch("/api/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(readJson),
};

const root = document.getElementById("root");
if (!root) throw new Error("renderer_root_missing");

createRoot(root).render(<StrictMode><App client={client} /></StrictMode>);
