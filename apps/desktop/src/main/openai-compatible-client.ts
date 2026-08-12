export interface OpenAiCompatibleRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface OpenAiCompatibleClientOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

export class OpenAiCompatibleClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly endpoint: string;

  constructor(private readonly options: OpenAiCompatibleClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.endpoint = new URL("chat/completions", ensureTrailingSlash(options.baseUrl)).toString();
  }

  async complete(request: OpenAiCompatibleRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("llm_http_error");
      }
      const body = await readBoundedText(response, this.maxResponseBytes);
      return parseAssistantContent(body);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("llm_timeout");
      }
      if (error instanceof Error && isStableError(error.message)) {
        throw error;
      }
      throw new Error("llm_network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("llm_response_too_large");
  }
  if (!response.body) {
    throw new Error("llm_response_invalid");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        return new TextDecoder().decode(concat(chunks, bytes));
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("llm_response_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function concat(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseAssistantContent(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("llm_response_invalid");
  }
  const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("llm_response_invalid");
  }
  return content;
}

function isStableError(message: string): boolean {
  return ["llm_http_error", "llm_response_too_large", "llm_response_invalid"].includes(message);
}
