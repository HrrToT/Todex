import { once } from "node:events";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { request as sendRequest, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDemoServer } from "../src/server.js";

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

interface SessionApiResponse extends ApiResponse {
  readonly cookie: string | undefined;
}

interface TextResponse {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: string;
}

const servers: Server[] = [];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(packageRoot, "dist");
const outsideFixture = resolve(packageRoot, "outside-static-fixture.txt");
const serverFactory = createDemoServer as unknown as (options?: {
  readonly distRoot?: string;
  readonly realpath?: (path: string) => Promise<string>;
  readonly now?: () => number;
  readonly sessionTtlMs?: number;
  readonly maxSessions?: number;
}) => Server;

let distExisted = false;
let outsideFixtureExisted = false;
let fixtureBackupRoot = "";
let distBackup = "";
let outsideFixtureBackup = "";

beforeAll(async () => {
  fixtureBackupRoot = await mkdtemp(join(tmpdir(), "todex-demo-fixture-backup-"));
  distBackup = join(fixtureBackupRoot, "dist");
  outsideFixtureBackup = join(fixtureBackupRoot, "outside-static-fixture.txt");
  distExisted = await pathExists(distRoot);
  outsideFixtureExisted = await pathExists(outsideFixture);
  if (distExisted) await cp(distRoot, distBackup, { recursive: true });
  if (outsideFixtureExisted) await cp(outsideFixture, outsideFixtureBackup);

  await mkdir(resolve(distRoot, "assets"), { recursive: true });
  await mkdir(resolve(distRoot, "api"), { recursive: true });
  await writeFile(resolve(distRoot, "index.html"), "<!doctype html><title>T-011 fixture</title>", "utf8");
  await writeFile(resolve(distRoot, "assets", "app.js"), "console.log('fixture');", "utf8");
  await writeFile(resolve(distRoot, "assets", "styles.css"), "body { color: black; }", "utf8");
  await writeFile(resolve(distRoot, "api", "session"), "static-api-sentinel", "utf8");
  await writeFile(outsideFixture, "outside-dist-secret", "utf8");
});

afterAll(async () => {
  await rm(distRoot, { recursive: true, force: true });
  if (distExisted) await cp(distBackup, distRoot, { recursive: true });
  await rm(outsideFixture, { force: true });
  if (outsideFixtureExisted) await cp(outsideFixtureBackup, outsideFixture);
  await rm(fixtureBackupRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.close();
      await once(server, "close");
    }),
  );
});

async function request(method: string, path: string, body?: string): Promise<ApiResponse> {
  const server = serverFactory();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }

  return new Promise<ApiResponse>((resolve, reject) => {
    const client = sendRequest(
      {
        host: "127.0.0.1",
        method,
        path,
        port: address.port,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) as unknown });
        });
      },
    );
    client.on("error", reject);
    client.end(body);
  });
}

async function requestText(method: string, path: string): Promise<TextResponse> {
  const server = serverFactory();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }

  return new Promise<TextResponse>((resolveResponse, reject) => {
    const client = sendRequest({ host: "127.0.0.1", method, path, port: address.port }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        text += chunk;
      });
      response.on("end", () => {
        resolveResponse({
          status: response.statusCode ?? 0,
          contentType: response.headers["content-type"],
          body: text,
        });
      });
    });
    client.on("error", reject);
    client.end();
  });
}

async function requestTextWithOptions(
  method: string,
  path: string,
  options: { readonly distRoot?: string; readonly realpath?: (path: string) => Promise<string> },
): Promise<TextResponse> {
  const server = serverFactory(options);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }

  return new Promise<TextResponse>((resolveResponse, reject) => {
    const client = sendRequest({ method, path, host: "127.0.0.1", port: address.port }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => {
        resolveResponse({
          status: response.statusCode ?? 0,
          contentType: response.headers["content-type"],
          body: text,
        });
      });
    });
    client.on("error", reject);
    client.end();
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function isWindowsSymlinkPrivilegeError(error: unknown): boolean {
  if (process.platform !== "win32" || typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "EPERM" || error.code === "EACCES";
}

async function requestBodyInChunks(body: string, contentLength?: number): Promise<ApiResponse> {
  const server = serverFactory();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }

  let client: ReturnType<typeof sendRequest> | undefined;
  try {
    const responsePromise = new Promise<ApiResponse>((resolveResponse, reject) => {
      client = sendRequest(
        {
          host: "127.0.0.1",
          method: "POST",
          path: "/api/run",
          port: address.port,
          headers: {
            "content-type": "application/json",
            ...(contentLength === undefined ? {} : { "content-length": contentLength }),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => { text += chunk; });
          response.on("end", () => resolveResponse({ status: response.statusCode ?? 0, body: JSON.parse(text) as unknown }));
        },
      );
      client.on("error", reject);
    });

    const activeClient = client;
    if (activeClient === undefined) throw new Error("test_client_unavailable");
    activeClient.write(body.slice(0, 4096));
    activeClient.write(body.slice(4096));
    return await Promise.race([
      responsePromise,
      new Promise<ApiResponse>((_, reject) => setTimeout(() => reject(new Error("body_limit_response_timeout")), 250)),
    ]);
  } finally {
    client?.destroy();
  }
}

function expectSafeError(response: ApiResponse, error: "demo_restricted" | "demo_invalid_request") {
  expect(response.body).toEqual({ error });
}

async function requestFromServer(
  server: Server,
  method: string,
  path: string,
  body?: string,
  cookie?: string,
): Promise<SessionApiResponse> {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }

  return new Promise<SessionApiResponse>((resolveResponse, reject) => {
    const client = sendRequest(
      {
        host: "127.0.0.1",
        method,
        path,
        port: address.port,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie === undefined ? {} : { cookie }),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { text += chunk; });
        response.on("end", () => {
          const setCookie = response.headers["set-cookie"];
          resolveResponse({
            status: response.statusCode ?? 0,
            body: JSON.parse(text) as unknown,
            cookie: Array.isArray(setCookie) ? setCookie[0] : setCookie,
          });
        });
      },
    );
    client.on("error", reject);
    client.end(body);
  });
}

describe("public mock demo server", () => {
  it("serves the fixed dist index and known assets, while rejecting unsafe or unknown paths", async () => {
    const index = await requestText("GET", "/");
    const script = await requestText("GET", "/assets/app.js");
    const stylesheet = await requestText("GET", "/assets/styles.css");
    const traversal = await requestText("GET", "/%2e%2e/outside-static-fixture.txt");
    const unknown = await requestText("GET", "/assets/missing.js");

    expect(index).toMatchObject({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>T-011 fixture</title>" });
    expect(script).toMatchObject({ status: 200, contentType: "text/javascript; charset=utf-8", body: "console.log('fixture');" });
    expect(stylesheet).toMatchObject({ status: 200, contentType: "text/css; charset=utf-8", body: "body { color: black; }" });
    expect(traversal).toMatchObject({ status: 404, body: JSON.stringify({ error: "demo_invalid_request" }) });
    expect(unknown).toMatchObject({ status: 404, body: JSON.stringify({ error: "demo_invalid_request" }) });
    expect(traversal.body).not.toContain("outside-dist-secret");
  });

  it("rejects an oversized streamed body before the client finishes sending it", async () => {
    const body = `${"x".repeat(8192)}x`;
    const response = await requestBodyInChunks(body, Buffer.byteLength(body) + 1024);

    expect(response.status).toBe(400);
    expectSafeError(response, "demo_invalid_request");
  });

  it("rejects an oversized chunked body before the client finishes sending it", async () => {
    const body = `${"x".repeat(8192)}x`;
    const response = await requestBodyInChunks(body);

    expect(response.status).toBe(400);
    expectSafeError(response, "demo_invalid_request");
  });

  it("does not serve a symlinked static target outside the canonical dist root", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "todex-demo-static-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "todex-demo-outside-"));
    const outsideSentinel = join(outsideRoot, "secret.txt");
    const linkPath = join(fixtureRoot, "escape.txt");
    let linkCreated = false;
    const realpathCalls: string[] = [];

    try {
      await writeFile(outsideSentinel, "outside-sentinel", "utf8");
      try {
        await symlink(outsideSentinel, linkPath, "file");
        linkCreated = true;
      } catch (error) {
        if (!isWindowsSymlinkPrivilegeError(error)) throw error;
      }

      if (linkCreated) {
        const response = await requestTextWithOptions("GET", "/escape.txt", { distRoot: fixtureRoot });
        expect(response.status).toBe(404);
        expect(response.body).not.toContain("outside-sentinel");
      } else {
        await writeFile(join(fixtureRoot, "inside.txt"), "inside-sentinel", "utf8");
        const response = await requestTextWithOptions("GET", "/inside.txt", {
          distRoot: fixtureRoot,
          realpath: async (target) => {
            realpathCalls.push(target);
            return outsideSentinel;
          },
        });
        expect(response.status).toBe(404);
        expect(response.body).not.toContain("outside-sentinel");
        expect(realpathCalls).toEqual([join(fixtureRoot, "inside.txt")]);
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each(["/api%2fsession", "/api%5Csession"])(
    "never falls through to static assets for encoded API-like path %s",
    async (path) => {
      const response = await requestText("GET", path);

      expect(response.status).toBe(404);
      expect(response.body).toBe(JSON.stringify({ error: "demo_invalid_request" }));
      expect(response.body).not.toContain("static-api-sentinel");
    },
  );

  it("restores exact pre-test fixture paths instead of deleting pre-existing content", async () => {
    const fixturePath = resolve(distRoot, "pre-existing-fixture.txt");
    const existed = await pathExists(fixturePath);
    const original = existed ? await readFile(fixturePath, "utf8") : undefined;

    try {
      await writeFile(fixturePath, "temporary-test-fixture", "utf8");
    } finally {
      if (existed) {
        await writeFile(fixturePath, original ?? "", "utf8");
      } else {
        await rm(fixturePath, { force: true });
      }
    }

    expect(await pathExists(fixturePath)).toBe(existed);
    if (existed) expect(await readFile(fixturePath, "utf8")).toBe(original);
  });

  it("returns the initial session for GET /api/session", async () => {
    const response = await request("GET", "/api/session");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "idle", runs: [], trace: [], verification: [] });
  });

  it("isolates each cookie jar and does not accept a visitor-controlled session identity", async () => {
    const server = serverFactory();
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const firstInitial = await requestFromServer(server, "GET", "/api/session");
    expect(firstInitial.cookie).toMatch(/^todex_demo_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax$/);
    const firstCookie = firstInitial.cookie;
    const firstSelected = await requestFromServer(
      server,
      "POST",
      "/api/scenario",
      '{"scenarioId":"approval-isolation"}',
      firstCookie,
    );
    const firstPending = await requestFromServer(server, "POST", "/api/run", "{}", firstCookie);
    const approvalId = (firstPending.body as { pendingApproval: { approvalId: string } }).pendingApproval.approvalId;

    const secondInitial = await requestFromServer(server, "GET", "/api/session");
    const secondCookie = secondInitial.cookie;
    expect(secondInitial.body).toMatchObject({ status: "idle", runs: [], trace: [] });
    expect(secondCookie).not.toBe(firstCookie);

    const secondApproval = await requestFromServer(
      server,
      "POST",
      "/api/approval",
      JSON.stringify({ approvalId, decision: "allow" }),
      secondCookie,
    );
    expect(secondApproval).toMatchObject({ status: 400, body: { error: "demo_restricted" } });

    const secondQuery = await requestFromServer(server, "GET", "/api/session?sessionId=first-visitor", undefined, secondCookie);
    expect(secondQuery.body).toMatchObject({ status: "idle", runs: [], trace: [] });

    const secondReset = await requestFromServer(server, "POST", "/api/reset", "{}", secondCookie);
    expect(secondReset.body).toMatchObject({ status: "idle", runs: [], trace: [] });

    const firstVisible = await requestFromServer(server, "GET", "/api/session", undefined, firstCookie);
    expect(firstSelected.body).toMatchObject({ selectedScenario: "approval-isolation" });
    expect(firstVisible.body).toMatchObject({ status: "awaiting_approval", pendingApproval: { approvalId } });
  });

  it("lazily expires bounded server-side sessions", async () => {
    let now = 1_000;
    const server = serverFactory({ now: () => now, sessionTtlMs: 10, maxSessions: 1 });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const firstInitial = await requestFromServer(server, "GET", "/api/session");
    const firstCookie = firstInitial.cookie;
    await requestFromServer(server, "POST", "/api/scenario", '{"scenarioId":"repair-feedback"}', firstCookie);

    now += 11;
    const secondInitial = await requestFromServer(server, "GET", "/api/session");
    expect(secondInitial.body).toMatchObject({ status: "idle", runs: [], trace: [] });

    const expiredFirst = await requestFromServer(server, "GET", "/api/session", undefined, firstCookie);
    expect(expiredFirst.body).toMatchObject({ status: "idle", runs: [], trace: [] });
  });

  it("caps the number of live in-memory sessions", async () => {
    const server = serverFactory({ sessionTtlMs: 1_000, maxSessions: 1 });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const firstInitial = await requestFromServer(server, "GET", "/api/session");
    const firstCookie = firstInitial.cookie;
    await requestFromServer(server, "POST", "/api/scenario", '{"scenarioId":"repair-feedback"}', firstCookie);
    await requestFromServer(server, "GET", "/api/session");

    const evictedFirst = await requestFromServer(server, "GET", "/api/session", undefined, firstCookie);
    expect(evictedFirst.body).toMatchObject({ status: "idle", runs: [], trace: [] });
  });

  it("accepts exactly a known scenario ID", async () => {
    const response = await request("POST", "/api/scenario", '{"scenarioId":"workspace-escape"}');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ selectedScenario: "workspace-escape", status: "idle" });
  });

  it("runs only an empty command object", async () => {
    const response = await request("POST", "/api/run", "{}");

    expect(response.status).toBe(400);
    expectSafeError(response, "demo_restricted");
  });

  it("accepts exactly one valid approval decision", async () => {
    const server = createDemoServer();
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const initial = await requestFromServer(server, "GET", "/api/session");
    const cookie = initial.cookie;
    await requestFromServer(server, "POST", "/api/scenario", '{"scenarioId":"approval-isolation"}', cookie);
    const pending = await requestFromServer(server, "POST", "/api/run", "{}", cookie);
    const approvalId = (pending.body as { pendingApproval: { approvalId: string } }).pendingApproval.approvalId;
    const response = await requestFromServer(server, "POST", "/api/approval", JSON.stringify({ approvalId, decision: "allow" }), cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "completed" });
    expect(response.body).not.toHaveProperty("pendingApproval");
  });

  it("resets only with an empty object", async () => {
    const response = await request("POST", "/api/reset", "{}");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "idle", runs: [], trace: [] });
  });

  it("rejects malformed JSON, wrong methods, and unknown routes", async () => {
    const malformed = await request("POST", "/api/run", "{");
    const wrongMethod = await request("GET", "/api/run");
    const unknownRoute = await request("POST", "/api/unknown", "{}");

    expect(malformed.status).toBe(400);
    expectSafeError(malformed, "demo_invalid_request");
    expect(wrongMethod.status).toBe(405);
    expectSafeError(wrongMethod, "demo_invalid_request");
    expect(unknownRoute.status).toBe(404);
    expectSafeError(unknownRoute, "demo_invalid_request");
  });

  it("rejects restricted extra keys and never echoes submitted input", async () => {
    const rejected = [
      '{"command":"curl secret.invalid"}',
      '{"apiKey":"secret-value"}',
      '{"path":"C:/private"}',
      '{"patch":"visitor-patch"}',
    ];

    for (const body of rejected) {
      const response = await request("POST", "/api/run", body);
      expect(response.status).toBe(400);
      expectSafeError(response, "demo_restricted");
      expect(JSON.stringify(response.body)).not.toContain(body);
      expect(JSON.stringify(response.body)).not.toContain("secret");
      expect(JSON.stringify(response.body)).not.toContain("private");
      expect(JSON.stringify(response.body)).not.toContain("patch");
    }
  });

  it("rejects invalid scenario and approval fields with a safe fixed error", async () => {
    const invalidScenario = await request("POST", "/api/scenario", '{"scenarioId":"visitor-input"}');
    const invalidApproval = await request("POST", "/api/approval", '{"approvalId":"visitor-approval","decision":"maybe"}');

    expect(invalidScenario.status).toBe(400);
    expectSafeError(invalidScenario, "demo_restricted");
    expect(invalidApproval.status).toBe(400);
    expectSafeError(invalidApproval, "demo_restricted");
    expect(JSON.stringify(invalidScenario.body)).not.toContain("visitor-input");
    expect(JSON.stringify(invalidApproval.body)).not.toContain("visitor-approval");
  });
});
