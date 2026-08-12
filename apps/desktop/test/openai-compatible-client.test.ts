import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleClient,
  type FetchLike,
} from "../src/main/openai-compatible-client.js";

const API_KEY = "secret-value";
const CONFIG = {
  baseUrl: "https://models.example.invalid/v1/",
  model: "test-model",
  apiKey: API_KEY,
};

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

describe("OpenAiCompatibleClient", () => {
  it("uses the Chat Completions endpoint and returns only assistant content", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      response(JSON.stringify({ choices: [{ message: { content: '{"tool":"finish","summary":"done"}' } }] })),
    );
    const client = new OpenAiCompatibleClient({ ...CONFIG, fetchImpl });

    await expect(
      client.complete({ systemPrompt: "Return one JSON action.", userPrompt: "Fix the issue." }),
    ).resolves.toBe('{"tool":"finish","summary":"done"}');

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://models.example.invalid/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret-value" }),
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      model: "test-model",
      messages: [
        { role: "system", content: "Return one JSON action." },
        { role: "user", content: "Fix the issue." },
      ],
    });
  });

  it("redacts API keys from non-success HTTP errors", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      response(`upstream rejected Bearer ${API_KEY}`, { status: 401 }),
    );
    const client = new OpenAiCompatibleClient({ ...CONFIG, fetchImpl });

    const error = await client.complete({ systemPrompt: "system", userPrompt: "user" }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("llm_http_error");
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("aborts a timed out request with a stable error", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const client = new OpenAiCompatibleClient({ ...CONFIG, fetchImpl, timeoutMs: 1 });

    await expect(client.complete({ systemPrompt: "system", userPrompt: "user" })).rejects.toThrow("llm_timeout");
  });

  it("rejects responses above the configured bound without exposing their content", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(response("x".repeat(33)));
    const client = new OpenAiCompatibleClient({ ...CONFIG, fetchImpl, maxResponseBytes: 32 });

    await expect(client.complete({ systemPrompt: "system", userPrompt: "user" })).rejects.toThrow(
      "llm_response_too_large",
    );
  });
});
