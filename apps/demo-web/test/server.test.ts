import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { request as sendRequest, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDemoServer } from "../src/server.js";

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
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

beforeAll(async () => {
  await mkdir(resolve(distRoot, "assets"), { recursive: true });
  await writeFile(resolve(distRoot, "index.html"), "<!doctype html><title>T-011 fixture</title>", "utf8");
  await writeFile(resolve(distRoot, "assets", "app.js"), "console.log('fixture');", "utf8");
  await writeFile(resolve(distRoot, "assets", "styles.css"), "body { color: black; }", "utf8");
  await writeFile(outsideFixture, "outside-dist-secret", "utf8");
});

afterAll(async () => {
  await rm(resolve(distRoot, "assets"), { recursive: true, force: true });
  await rm(outsideFixture, { force: true });
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
  const server = createDemoServer();
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
  const server = createDemoServer();
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

function expectSafeError(response: ApiResponse, error: "demo_restricted" | "demo_invalid_request") {
  expect(response.body).toEqual({ error });
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

  it("returns the initial session for GET /api/session", async () => {
    const response = await request("GET", "/api/session");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "idle", runs: [], trace: [], verification: [] });
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
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test_server_address_unavailable");

    const send = (path: string, body: string) => new Promise<ApiResponse>((resolve, reject) => {
      const client = sendRequest({ host: "127.0.0.1", method: "POST", path, port: address.port, headers: { "content-type": "application/json" } }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) as unknown }));
      });
      client.on("error", reject);
      client.end(body);
    });

    await send("/api/scenario", '{"scenarioId":"approval-isolation"}');
    const pending = await send("/api/run", "{}");
    const approvalId = (pending.body as { pendingApproval: { approvalId: string } }).pendingApproval.approvalId;
    const response = await send("/api/approval", JSON.stringify({ approvalId, decision: "allow" }));

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
