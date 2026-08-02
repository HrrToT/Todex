import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { createDemoSession, type DemoSession, type DemoSnapshot } from "./demo-session.js";

const MAX_BODY_BYTES = 8 * 1024;
const RESTRICTED_KEYS = new Set(["command", "apiKey", "path", "patch"]);

type SafeError = "demo_restricted" | "demo_invalid_request";
type JsonRecord = Record<string, unknown>;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, error: SafeError): void {
  sendJson(response, status, { error });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasRestrictedKey(value: JsonRecord): boolean {
  return Object.keys(value).some((key) => RESTRICTED_KEYS.has(key));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    let body = "";
    let byteCount = 0;
    let tooLarge = false;

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      byteCount += Buffer.byteLength(chunk);
      if (byteCount > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body) as unknown);
      } catch {
        resolve(undefined);
      }
    });
    request.on("error", () => resolve(undefined));
  });
}

async function handlePost(
  response: ServerResponse,
  path: string,
  body: unknown,
  session: DemoSession,
): Promise<DemoSnapshot | undefined> {
  if (!isRecord(body)) {
    sendError(response, 400, "demo_invalid_request");
    return;
  }
  if (hasRestrictedKey(body)) {
    sendError(response, 400, "demo_restricted");
    return;
  }

  try {
    if (path === "/api/scenario") {
      if (!hasExactlyKeys(body, ["scenarioId"]) || typeof body.scenarioId !== "string") {
        sendError(response, 400, "demo_invalid_request");
        return;
      }
      const snapshot = await session.selectScenario(body.scenarioId);
      sendJson(response, 200, snapshot);
      return snapshot;
    }
    if (path === "/api/run") {
      if (!hasExactlyKeys(body, [])) {
        sendError(response, 400, "demo_invalid_request");
        return;
      }
      const snapshot = await session.run();
      sendJson(response, 200, snapshot);
      return snapshot;
    }
    if (path === "/api/approval") {
      if (
        !hasExactlyKeys(body, ["approvalId", "decision"]) ||
        typeof body.approvalId !== "string" ||
        typeof body.decision !== "string"
      ) {
        sendError(response, 400, "demo_invalid_request");
        return;
      }
      const snapshot = await session.decideApproval({
        approvalId: body.approvalId,
        decision: body.decision as "allow" | "deny",
      });
      sendJson(response, 200, snapshot);
      return snapshot;
    }
    if (path === "/api/reset") {
      if (!hasExactlyKeys(body, [])) {
        sendError(response, 400, "demo_invalid_request");
        return;
      }
      const snapshot = await session.reset();
      sendJson(response, 200, snapshot);
      return snapshot;
    }
    sendError(response, 404, "demo_invalid_request");
  } catch {
    sendError(response, 400, "demo_restricted");
  }
}

export function createDemoServer(): Server {
  const session = createDemoSession();
  let latest: DemoSnapshot = {
    status: "idle",
    runs: [],
    trace: [],
    verification: [],
    dispatcherCalls: 0,
  };

  return createServer(async (request, response) => {
    const method = request.method;
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    if (method === "GET" && path === "/api/session") {
      sendJson(response, 200, latest);
      return;
    }
    if (method !== "POST") {
      sendError(response, path.startsWith("/api/") ? 405 : 404, "demo_invalid_request");
      return;
    }
    const snapshot = await handlePost(response, path, await readJsonBody(request), session);
    if (snapshot !== undefined) {
      latest = snapshot;
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createDemoServer().listen(3000, "0.0.0.0");
}
