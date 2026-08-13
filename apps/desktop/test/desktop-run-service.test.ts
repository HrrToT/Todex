import { describe, expect, it } from "vitest";

import { createProtocolRepairingLlm, type CompletionClient } from "../src/main/desktop-run-service.js";

describe("desktop run protocol repair", () => {
  it("uses one no-tool format repair after an invalid model response", async () => {
    const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const client: CompletionClient = {
      complete: async (request) => {
        calls.push(request);
        return calls.length === 1 ? "I will inspect files first." : '{"tool":"finish","summary":"done"}';
      },
    };
    const llm = createProtocolRepairingLlm(client);

    await expect(
      llm.nextAction({
        runId: "r1", projectId: "p1", task: "fix", workspaceRoot: "C:\\fixture", previousResults: [], trace: [],
      }),
    ).resolves.toMatchObject({ tool: "finish", summary: "done" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.systemPrompt).toContain("valid Todex JSON Action");
    expect(calls[1]?.userPrompt).not.toContain("I will inspect files first.");
  });

  it("stops after the second invalid response without leaking raw model text", async () => {
    const client: CompletionClient = { complete: async () => "API_KEY=secret-value" };
    const llm = createProtocolRepairingLlm(client);

    const error = await llm.nextAction({
      runId: "r1", projectId: "p1", task: "fix", workspaceRoot: "C:\\fixture", previousResults: [], trace: [],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("model_protocol_invalid");
    expect(JSON.stringify(error)).not.toContain("secret-value");
  });
});

describe("desktop run safety projection", () => {
  it("never includes credentials in protocol errors or renderer-facing values", async () => {
    const client: CompletionClient = {
      complete: async () => {
        throw new Error("upstream rejected secret-value at C:\\Users\\Lenovo\\repo");
      },
    };
    const llm = createProtocolRepairingLlm(client);
    const error = await llm.nextAction({
      runId: "r1", projectId: "p1", task: "fix", workspaceRoot: "C:\\fixture", previousResults: [], trace: [],
    }).catch((reason: unknown) => reason);

    expect((error as Error).message).toBe("model_request_failed");
    expect(JSON.stringify(error)).not.toContain("secret-value");
    expect(JSON.stringify(error)).not.toContain("C:\\Users\\Lenovo");
  });
});
