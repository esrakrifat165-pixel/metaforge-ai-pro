import { GeminiError, generateRawMetadata, type GeminiErrorCode } from "./gemini";
import { getCandidates, recordKeyResult } from "./keyStore";

// SERVER ONLY. Picks enabled saved keys (or the environment key), calls Gemini,
// and tries at most MAX_KEY_ATTEMPTS keys when a key is rejected or rate-limited.
// Disabled keys are never returned by getCandidates(), so they are never used.

const MAX_KEY_ATTEMPTS = 3;

const STATUS_BY_CODE: Record<GeminiErrorCode, number> = {
  invalid_key: 401,
  unsupported_model: 400,
  rate_limited: 429,
  provider_unavailable: 503,
  timeout: 504,
  blocked: 422,
  bad_response: 502,
  bad_request: 502,
};

export type GeminiRunInput = {
  model: string;
  mimeType: string;
  base64: string;
  prompt: string;
  schema?: Record<string, unknown>;
  keywordMax: number;
};

export type GeminiRunResult =
  | { ok: true; raw: unknown }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      retryable: boolean;
      retryAfterSeconds: number | null;
    };

function failure(status: number, code: string, message: string, retryable: boolean): GeminiRunResult {
  return { ok: false, status, code, message, retryable, retryAfterSeconds: null };
}

export async function runGeminiWithKeys(input: GeminiRunInput): Promise<GeminiRunResult> {
  const resolved = await getCandidates("gemini");
  if (!resolved.ok) {
    if (resolved.code === "key_store_error") {
      return failure(500, "key_store_error", resolved.message, false);
    }
    // Reported as "not_configured" so the browser stops a whole batch instead of repeating the failure.
    return failure(503, "not_configured", resolved.message, false);
  }

  const attempts = resolved.candidates.slice(0, MAX_KEY_ATTEMPTS);

  for (let index = 0; index < attempts.length; index += 1) {
    const candidate = attempts[index];
    try {
      const raw = await generateRawMetadata({
        apiKey: candidate.apiKey,
        model: input.model,
        mimeType: input.mimeType,
        base64: input.base64,
        prompt: input.prompt,
        keywordMax: input.keywordMax,
        schema: input.schema,
      });
      await recordKeyResult(candidate.id, "ok");
      return { ok: true, raw };
    } catch (error) {
      if (error instanceof GeminiError) {
        if (error.code === "invalid_key") {
          await recordKeyResult(candidate.id, "rejected");
        } else if (error.code === "rate_limited") {
          await recordKeyResult(candidate.id, "rate_limited");
        }

        const keySpecific = error.code === "invalid_key" || error.code === "rate_limited";
        if (keySpecific && index < attempts.length - 1) {
          continue;
        }

        return {
          ok: false,
          status: STATUS_BY_CODE[error.code],
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          retryAfterSeconds: error.retryAfterMs !== null ? Math.ceil(error.retryAfterMs / 1000) : null,
        };
      }

      console.error("[gemini-run] unexpected failure");
      return failure(500, "internal_error", "Something went wrong on the server. Please try again.", true);
    }
  }

  return failure(500, "internal_error", "No key could be used. Please try again.", true);
}