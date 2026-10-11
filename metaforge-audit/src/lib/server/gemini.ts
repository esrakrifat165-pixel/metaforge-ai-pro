import { buildResponseSchema } from "../metadata/generation";

// SERVER ONLY. Never import this file from a client component: it handles the API key.

export type GeminiErrorCode =
  | "invalid_key"
  | "unsupported_model"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "blocked"
  | "bad_response"
  | "bad_request";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    code: GeminiErrorCode,
    message: string,
    retryable: boolean,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

// Thrown internally when Google rejects the JSON-schema field. We then retry once without it.
class SchemaNotAccepted extends Error {}

export type GeminiRequest = {
  apiKey: string;
  model: string;
  mimeType: string;
  base64: string;
  prompt: string;
  keywordMax: number;
  schema?: Record<string, unknown>;
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = [1500, 4000];
const MAX_INLINE_WAIT_MS = 10_000;
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isNamed(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === name;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readRetryAfterMs(response: Response, detail: unknown): number | null {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }
  const details = (detail as { error?: { details?: unknown } } | null)?.error?.details;
  if (Array.isArray(details)) {
    for (const entry of details) {
      if (typeof entry === "object" && entry !== null) {
        const value = (entry as { retryDelay?: unknown }).retryDelay;
        if (typeof value === "string") {
          const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
          if (match) {
            return Math.round(Number(match[1]) * 1000);
          }
        }
      }
    }
  }
  return null;
}

function errorFromResponse(
  status: number,
  detail: unknown,
  usedSchema: boolean,
  retryAfterMs: number | null,
): GeminiError {
  const haystack = JSON.stringify(detail ?? {});

  if (status === 400) {
    if (/api key not valid|api_key_invalid/i.test(haystack)) {
      return new GeminiError(
        "invalid_key",
        "Google rejected the Gemini API key. Check that the key is correct and that the Gemini API is enabled for it.",
        false,
      );
    }
    if (usedSchema && /response_?json_?schema|unknown name|schema/i.test(haystack)) {
      throw new SchemaNotAccepted();
    }
    if (/model/i.test(haystack) && /not found|not supported|invalid/i.test(haystack)) {
      return new GeminiError(
        "unsupported_model",
        "Google does not accept this model name for image input. Choose a different model.",
        false,
      );
    }
    return new GeminiError(
      "bad_request",
      "Google rejected the request. Try a different model or a different image.",
      false,
    );
  }

  if (status === 401 || status === 403) {
    return new GeminiError(
      "invalid_key",
      "Google rejected the Gemini API key, or the Gemini API is not enabled for it.",
      false,
    );
  }

  if (status === 404) {
    return new GeminiError(
      "unsupported_model",
      "Google could not find this model. It may have been retired. Choose a different model.",
      false,
    );
  }

  if (status === 429) {
    return new GeminiError(
      "rate_limited",
      "Gemini says the rate limit or quota was reached. Free-tier limits are low. Wait a minute and use Retry failed, or check your quota in Google AI Studio.",
      true,
      retryAfterMs,
    );
  }

  if (status >= 500) {
    return new GeminiError(
      "provider_unavailable",
      "Gemini is temporarily unavailable. Try again in a moment.",
      true,
      retryAfterMs,
    );
  }

  return new GeminiError("bad_request", `Google answered with an unexpected error (${status}).`, false);
}

function extractText(data: unknown): string {
  const root = data as {
    promptFeedback?: { blockReason?: unknown };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    }>;
  } | null;

  if (root?.promptFeedback?.blockReason) {
    throw new GeminiError("blocked", "Google's safety filter blocked this image or request.", false);
  }

  const candidate = root?.candidates?.[0];
  if (!candidate) {
    throw new GeminiError("bad_response", "Gemini returned no answer. Try again.", true);
  }

  if (candidate.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
    throw new GeminiError("blocked", "Google's safety filter blocked this image or request.", false);
  }

  const parts = candidate.content?.parts ?? [];
  const text = parts
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text as string)
    .join("")
    .trim();

  if (!text) {
    const reason =
      candidate.finishReason === "MAX_TOKENS"
        ? "Gemini's answer was cut off. Try again."
        : "Gemini returned an empty answer. Try again.";
    throw new GeminiError("bad_response", reason, true);
  }

  return text;
}

function parseJsonText(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new GeminiError("bad_response", "Gemini did not return valid JSON. Try again.", true);
  }
}

async function requestText(args: GeminiRequest, useSchema: boolean): Promise<string> {
  const url = `${BASE_URL}/${encodeURIComponent(args.model)}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: 4096,
  };
  if (useSchema) {
    generationConfig.responseJsonSchema = args.schema ?? buildResponseSchema(args.keywordMax);
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: args.mimeType, data: args.base64 } },
          { text: args.prompt },
        ],
      },
    ],
    generationConfig,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (isNamed(error, "TimeoutError") || isNamed(error, "AbortError")) {
      throw new GeminiError("timeout", "Gemini took too long to answer. Try again.", true);
    }
    throw new GeminiError(
      "provider_unavailable",
      "Could not reach Google's servers. Check your internet connection and try again.",
      true,
    );
  }

  if (!response.ok) {
    const detail = await readJson(response);
    // Log only the status code. Never log the key, the image or Google's full message.
    console.error(`[gemini] request failed with status ${response.status}`);
    throw errorFromResponse(response.status, detail, useSchema, readRetryAfterMs(response, detail));
  }

  return extractText(await readJson(response));
}

/**
 * Calls Gemini and returns the parsed JSON.
 * Bounded: at most one schema fallback and at most MAX_RETRIES retries.
 */
export async function generateRawMetadata(args: GeminiRequest): Promise<unknown> {
  let useSchema = true;
  let attempt = 0;

  for (;;) {
    try {
      return parseJsonText(await requestText(args, useSchema));
    } catch (error) {
      if (error instanceof SchemaNotAccepted && useSchema) {
        useSchema = false;
        continue;
      }

      if (error instanceof GeminiError && error.retryable && attempt < MAX_RETRIES) {
        const wait = error.retryAfterMs ?? DEFAULT_BACKOFF_MS[attempt] ?? 4000;
        if (wait > MAX_INLINE_WAIT_MS) {
          throw error;
        }
        await sleep(wait);
        attempt += 1;
        continue;
      }

      if (error instanceof SchemaNotAccepted) {
        throw new GeminiError("bad_request", "Google rejected the request. Try a different model.", false);
      }

      throw error;
    }
  }
}