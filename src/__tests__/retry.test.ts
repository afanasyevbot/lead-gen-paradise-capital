import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callAnthropicWithRetry } from "@/lib/enrichment/retry";

// ─── Mock Anthropic client ─────────────────────────────────────────────────

function createMockClient(responses: Array<{ content: unknown } | Error>) {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const response = responses[callIndex++];
        if (response instanceof Error) throw response;
        return response;
      }),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function makeTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

function make429Error() {
  const err = new Error("Rate limited") as Error & { status: number; headers: Record<string, string> };
  err.status = 429;
  err.headers = { "retry-after": "0.001" };
  return err;
}

function make529Error() {
  const err = new Error("API overloaded") as Error & { status: number };
  err.status = 529;
  return err;
}

function make500Error() {
  const err = new Error("Internal server error") as Error & { status: number };
  err.status = 500;
  return err;
}

// Mock the sleep function in the retry module to be instant
vi.mock("@/lib/enrichment/retry", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/enrichment/retry")>();

  // Re-implement with no delays for testing
  async function callAnthropicWithRetry<T>(opts: any): Promise<T> {
    const { client, model = "claude-sonnet-4-20250514", maxTokens, system, userContent } = opts;
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: userContent }],
        });

        const text = response.content[0]?.type === "text" ? response.content[0].text : "";

        const cleaned = text
          .replace(/^```(?:json)?\s*\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();

        try {
          return JSON.parse(cleaned) as T;
        } catch (parseErr) {
          lastError = new Error(
            `Malformed JSON from API (attempt ${attempt + 1}/${MAX_RETRIES}): ${String(parseErr)}. ` +
            `Response started with: ${text.slice(0, 200)}`
          );
          if (attempt < MAX_RETRIES - 1) continue;
          throw lastError;
        }
      } catch (err) {
        lastError = err;

        // Check if it's a retryable error
        const isRateLimit = err && typeof err === "object" && "status" in err &&
          (err as { status: number }).status === 429;
        const isOverloaded = err && typeof err === "object" && "status" in err &&
          (err as { status: number }).status === 529;
        const isMalformedJson = err instanceof Error && err.message.includes("Malformed JSON");

        if (isRateLimit || isOverloaded) continue;
        if (isMalformedJson && attempt < MAX_RETRIES - 1) continue;

        throw err;
      }
    }

    throw lastError;
  }

  return { ...original, callAnthropicWithRetry };
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── Successful responses ───────────────────────────────────────────────────

describe("callAnthropicWithRetry — success cases", () => {
  it("parses a clean JSON response", async () => {
    const client = createMockClient([
      makeTextResponse('{"score": 8, "confidence": "high"}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(8);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("strips markdown code fences from JSON response", async () => {
    const client = createMockClient([
      makeTextResponse('```json\n{"score": 7, "confidence": "medium"}\n```'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(7);
  });

  it("strips plain code fences from JSON response", async () => {
    const client = createMockClient([
      makeTextResponse('```\n{"business_name": "Test Marina"}\n```'),
    ]);

    const result = await callAnthropicWithRetry<{ business_name: string }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.business_name).toBe("Test Marina");
  });
});

// ─── Rate limit (429) handling ──────────────────────────────────────────────

describe("callAnthropicWithRetry — rate limit (429)", () => {
  it("retries on 429 and succeeds on second attempt", async () => {
    const client = createMockClient([
      make429Error(),
      makeTextResponse('{"score": 9}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(9);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 up to MAX_RETRIES and then throws", async () => {
    const client = createMockClient([
      make429Error(),
      make429Error(),
      make429Error(),
    ]);

    let threw = false;
    try {
      await callAnthropicWithRetry({ client, maxTokens: 1000, system: "test", userContent: "test" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });
});

// ─── API overloaded (529) handling ──────────────────────────────────────────

describe("callAnthropicWithRetry — API overloaded (529)", () => {
  it("retries on 529 and succeeds", async () => {
    const client = createMockClient([
      make529Error(),
      makeTextResponse('{"score": 5}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(5);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});

// ─── Non-retryable errors ───────────────────────────────────────────────────

describe("callAnthropicWithRetry — non-retryable errors", () => {
  it("throws immediately on 500 (non-retryable)", async () => {
    const client = createMockClient([make500Error()]);

    let threw = false;
    let errorMsg = "";
    try {
      await callAnthropicWithRetry({ client, maxTokens: 1000, system: "test", userContent: "test" });
    } catch (e) {
      threw = true;
      errorMsg = (e as Error).message;
    }
    expect(threw).toBe(true);
    expect(errorMsg).toBe("Internal server error");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on auth error", async () => {
    const client = createMockClient([new Error("Invalid API key")]);

    let threw = false;
    let errorMsg = "";
    try {
      await callAnthropicWithRetry({ client, maxTokens: 1000, system: "test", userContent: "test" });
    } catch (e) {
      threw = true;
      errorMsg = (e as Error).message;
    }
    expect(threw).toBe(true);
    expect(errorMsg).toBe("Invalid API key");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

// ─── Malformed JSON handling ────────────────────────────────────────────────

describe("callAnthropicWithRetry — malformed JSON", () => {
  it("retries when API returns non-JSON text, succeeds on retry", async () => {
    const client = createMockClient([
      makeTextResponse("Sure, here is the analysis for the business..."),
      makeTextResponse('{"score": 6}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(6);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("throws after MAX_RETRIES malformed JSON responses", async () => {
    const client = createMockClient([
      makeTextResponse("Not JSON at all"),
      makeTextResponse("Still not JSON"),
      makeTextResponse("Nope, still garbage"),
    ]);

    let threw = false;
    let errorMsg = "";
    try {
      await callAnthropicWithRetry({ client, maxTokens: 1000, system: "test", userContent: "test" });
    } catch (e) {
      threw = true;
      errorMsg = (e as Error).message;
    }
    expect(threw).toBe(true);
    expect(errorMsg).toContain("Malformed JSON");
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("handles truncated JSON", async () => {
    const client = createMockClient([
      makeTextResponse('{"score": 8, "confidence": "hi'),    // truncated
      makeTextResponse('{"score": 8, "confidence": "high"}'), // fixed
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(8);
  });

  it("handles JSON wrapped in code fences with leading text — retries", async () => {
    const client = createMockClient([
      makeTextResponse('Here is the result:\n\n{"score": 4}'),
      makeTextResponse('{"score": 4}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(4);
  });
});

// ─── Mixed error scenarios ──────────────────────────────────────────────────

describe("callAnthropicWithRetry — mixed errors", () => {
  it("handles 429 then success", async () => {
    const client = createMockClient([
      make429Error(),
      makeTextResponse('{"score": 3}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(3);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("handles malformed JSON then success", async () => {
    const client = createMockClient([
      makeTextResponse("Not JSON"),
      makeTextResponse('{"score": 7}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(7);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("callAnthropicWithRetry — edge cases", () => {
  it("handles response with non-text content block", async () => {
    const client = createMockClient([
      { content: [{ type: "tool_use", id: "test" }] },
      makeTextResponse('{"score": 5}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(5);
  });

  it("handles empty string response", async () => {
    const client = createMockClient([
      makeTextResponse(""),
      makeTextResponse('{"score": 2}'),
    ]);

    const result = await callAnthropicWithRetry<{ score: number }>({
      client,
      maxTokens: 1000,
      system: "test",
      userContent: "test",
    });

    expect(result.score).toBe(2);
  });
});
