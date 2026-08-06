import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createDemoSession, type DemoSession, type DemoSnapshot } from "./demo-session.js";

const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_COOKIE_NAME = "todex_demo_session";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;
const RESTRICTED_KEYS = new Set(["command", "apiKey", "path", "patch"]);
const DIST_ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

type SafeError = "demo_restricted" | "demo_invalid_request";
type JsonRecord = Record<string, unknown>;
type DemoServerOptions = {
  readonly distRoot?: string;
  readonly realpath?: (path: string) => Promise<string>;
  readonly now?: () => number;
  readonly sessionTtlMs?: number;
  readonly maxSessions?: number;
  readonly secureCookies?: boolean;
};

interface StoredSession {
  readonly session: DemoSession;
  latest: DemoSnapshot;
  expiresAt: number;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, error: SafeError): void {
  sendJson(response, status, { error });
}

function containsEncodedSeparator(requestUrl: string): boolean {
  const rawPath = requestUrl.split(/[?#]/, 1)[0] ?? "/";
  return /%2f|%5c/i.test(rawPath);
}

async function staticFilePath(
  requestUrl: string,
  distRoot: string,
  resolveTargetRealpath: (path: string) => Promise<string>,
): Promise<string | undefined> {
  const rawPath = requestUrl.split(/[?#]/, 1)[0] ?? "/";
  let decodedPath: string;

  if (containsEncodedSeparator(requestUrl)) {
    return undefined;
  }

  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }

  if (
    !decodedPath.startsWith("/") ||
    decodedPath.includes("\0") ||
    decodedPath.includes("\\") ||
    decodedPath.split("/").includes("..")
  ) {
    return undefined;
  }

  const requestedFile = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  if (isAbsolute(requestedFile)) {
    return undefined;
  }

  const target = resolve(distRoot, requestedFile);
  const targetRelativePath = relative(distRoot, target);
  if (targetRelativePath === "" || targetRelativePath === ".." || targetRelativePath.startsWith(`..${sep}`) || isAbsolute(targetRelativePath)) {
    return undefined;
  }

  try {
    const [canonicalDistRoot, canonicalTarget] = await Promise.all([realpath(distRoot), resolveTargetRealpath(target)]);
    const canonicalRelativePath = relative(canonicalDistRoot, canonicalTarget);
    if (
      canonicalRelativePath === "" ||
      canonicalRelativePath === ".." ||
      canonicalRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(canonicalRelativePath)
    ) {
      return undefined;
    }
    return canonicalTarget;
  } catch {
    return undefined;
  }
}

function staticContentType(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf("."));
  return STATIC_CONTENT_TYPES[extension] ?? "application/octet-stream";
}

async function serveStatic(
  response: ServerResponse,
  requestUrl: string,
  distRoot: string,
  resolveTargetRealpath: (path: string) => Promise<string>,
): Promise<void> {
  const target = await staticFilePath(requestUrl, distRoot, resolveTargetRealpath);
  if (target === undefined) {
    sendError(response, 404, "demo_invalid_request");
    return;
  }

  try {
    const content = await readFile(target);
    response.writeHead(200, { "content-type": staticContentType(target) });
    response.end(content);
  } catch {
    sendError(response, 404, "demo_invalid_request");
  }
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
    let settled = false;

    const finish = (value: unknown | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (settled) return;
      byteCount += Buffer.byteLength(chunk);
      if (byteCount > MAX_BODY_BYTES) {
        request.resume();
        finish(undefined);
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (settled) return;
      try {
        finish(JSON.parse(body) as unknown);
      } catch {
        finish(undefined);
      }
    });
    request.on("error", () => finish(undefined));
    request.on("aborted", () => finish(undefined));
  });
}

function contentLengthExceedsLimit(request: IncomingMessage): boolean {
  const value = request.headers["content-length"];
  if (typeof value !== "string") return false;
  const contentLength = Number(value);
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES;
}

function initialSnapshot(): DemoSnapshot {
  return {
    status: "idle",
    runs: [],
    trace: [],
    verification: [],
    dispatcherCalls: 0,
  };
}

function cookieValue(request: IncomingMessage): string | undefined {
  const cookie = request.headers.cookie;
  if (cookie === undefined) return undefined;

  for (const part of cookie.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name === SESSION_COOKIE_NAME && value !== undefined && /^[A-Za-z0-9_-]+$/.test(value)) return value;
  }
  return undefined;
}

function sessionCookie(id: string, secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
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

export function createDemoServer(options: DemoServerOptions = {}): Server {
  const distRoot = options.distRoot ?? DIST_ROOT;
  const resolveTargetRealpath = options.realpath ?? realpath;
  const now = options.now ?? Date.now;
  const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
  const maxSessions = options.maxSessions ?? MAX_SESSIONS;
  const sessions = new Map<string, StoredSession>();

  function removeExpiredSessions(currentTime: number): void {
    for (const [id, stored] of sessions) {
      if (stored.expiresAt <= currentTime) sessions.delete(id);
    }
  }

  function evictOldestSession(): void {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }

  function shouldUseSecureCookies(request: IncomingMessage): boolean {
    const forwardedProto = request.headers["x-forwarded-proto"];
    return options.secureCookies ?? (process.env.NODE_ENV === "production" || forwardedProto === "https");
  }

  function sessionFor(request: IncomingMessage, response: ServerResponse): StoredSession {
    const currentTime = now();
    removeExpiredSessions(currentTime);
    const cookie = cookieValue(request);
    const existing = cookie === undefined ? undefined : sessions.get(cookie);
    if (existing !== undefined) {
      existing.expiresAt = currentTime + sessionTtlMs;
      sessions.delete(cookie ?? "");
      sessions.set(cookie ?? "", existing);
      return existing;
    }

    if (sessions.size >= maxSessions) evictOldestSession();
    const id = randomBytes(24).toString("base64url");
    const stored: StoredSession = {
      session: createDemoSession(),
      latest: initialSnapshot(),
      expiresAt: currentTime + sessionTtlMs,
    };
    sessions.set(id, stored);
    response.setHeader("set-cookie", sessionCookie(id, shouldUseSecureCookies(request)));
    return stored;
  }

  const server = createServer(async (request, response) => {
    const method = request.method;
    const requestUrl = request.url ?? "/";
    const path = new URL(requestUrl, "http://localhost").pathname;

    if (containsEncodedSeparator(requestUrl)) {
      sendError(response, 404, "demo_invalid_request");
      return;
    }
    const stored = sessionFor(request, response);
    if (method === "GET" && path === "/api/session") {
      sendJson(response, 200, stored.latest);
      return;
    }
    if (method === "POST") {
      if (contentLengthExceedsLimit(request)) {
        request.resume();
        sendError(response, 400, "demo_invalid_request");
        return;
      }
      const snapshot = await handlePost(response, path, await readJsonBody(request), stored.session);
      if (snapshot !== undefined) {
        stored.latest = snapshot;
      }
      return;
    }
    if (path.startsWith("/api/")) {
      sendError(response, 405, "demo_invalid_request");
      return;
    }
    if (method === "GET") {
      await serveStatic(response, requestUrl, distRoot, resolveTargetRealpath);
      return;
    }
    sendError(response, 404, "demo_invalid_request");
  });
  if ("requestTimeout" in server) {
    server.requestTimeout = REQUEST_TIMEOUT_MS;
  }
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createDemoServer().listen(3000, "0.0.0.0");
}
