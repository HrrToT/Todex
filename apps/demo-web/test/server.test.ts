import { once } from "node:events";
import { request as sendRequest, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createDemoServer } from "../src/server.js";

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

const servers: Server[] = [];

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

function expectSafeError(response: ApiResponse, error: "demo_restricted" | "demo_invalid_request") {
  expect(response.body).toEqual({ error });
}

describe("public mock demo server", () => {
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
