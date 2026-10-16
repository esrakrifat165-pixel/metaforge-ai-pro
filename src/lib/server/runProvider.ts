
import "server-only";

import { getCandidates, recordKeyResult } from "./keyStore";
import { runGeminiWithKeys } from "./runGemini";
import type { ProviderId } from "../providers/catalog";

export type ProviderRunInput = {
  userId: string;
  provider: ProviderId;
  model: string;
  mimeType: string;
  base64: string;
  prompt: string;
  schema?: Record<string, unknown>;
  keywordMax: number;
};

export type ProviderRunResult =
  | { ok: true; raw: unknown }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      retryable: boolean;
      retryAfterSeconds: number | null;
    };

const MAX_KEY_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;


function failure(
  status: number,
  code: string,
  message: string,
  retryable = false,
  retryAfterSeconds: number | null = null,
): ProviderRunResult {
  return {
    ok: false,
    status,
    code,
    message,
    retryable,
    retryAfterSeconds,
  };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const choices = value.choices;
  if (Array.isArray(choices) && isRecord(choices[0])) {
    const message = choices[0].message;
    if (isRecord(message) && typeof message.content === "string") {
      return message.content;
    }
  }

  const content = value.content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is Record<string, unknown> =>
          isRecord(part) && part.type === "text" &&
          typeof part.text === "string",
      )
      .map((part) => part.text as string)
      .join("\n");
  }

  return null;
}

function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("The provider did not return valid JSON.");
  }
}

function endpoint(provider: ProviderId): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    default:
      throw new Error("Unsupported provider.");
  }
}

async function callProvider(
  input: ProviderRunInput,
  apiKey: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const imageUrl = `data:${input.mimeType};base64,${input.base64}`;

    let response: Response;

    if (input.provider === "anthropic") {
      response = await fetch(endpoint(input.provider), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: 4096,
          temperature: 0.2,
          system:
            "Return only valid JSON. Follow the user's requested JSON fields and rules.",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: input.mimeType,
                    data: input.base64,
                  },
                },
                {
                  type: "text",
                  text: input.prompt,
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } else {
      response = await fetch(endpoint(input.provider), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          temperature: 0.2,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Return only a valid JSON object. Follow the requested schema and rules.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: input.prompt },
                {
                  type: "image_url",
                  image_url: { url: imageUrl },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    }

    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      // Do not log API keys, image data, or full provider error bodies.
      console.error(
        `[provider-run] ${input.provider} request failed: ${response.status}`,
      );

      if (response.status === 401 || response.status === 403) {
        const error = new Error("The provider rejected this API key.") as Error & {
          status: number;
          code: string;
        };
        error.status = response.status;
        error.code = "invalid_key";
        throw error;
      }

      if (response.status === 429) {
        const error = new Error("The provider rate limit or quota was reached.") as Error & {
          status: number;
          code: string;
        };
        error.status = 429;
        error.code = "rate_limited";
        throw error;
      }

      if (response.status >= 500) {
        const error = new Error("The provider is temporarily unavailable.") as Error & {
          status: number;
          code: string;
        };
        error.status = response.status;
        error.code = "provider_unavailable";
        throw error;
      }

      const error = new Error(
        "The provider rejected the request. Check the model and image-input support.",
      ) as Error & { status: number; code: string };
      error.status = response.status;
      error.code = "bad_request";
      throw error;
    }

    const text = readText(data);
    if (!text) {
      throw new Error("The provider returned an empty response.");
    }

    return parseModelJson(text);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runProviderWithKeys(
  input: ProviderRunInput,
): Promise<ProviderRunResult> {
  if (input.provider === "gemini") {
    return runGeminiWithKeys({
      userId: input.userId,
      model: input.model,
      mimeType: input.mimeType,
      base64: input.base64,
      prompt: input.prompt,
      schema: input.schema,
      keywordMax: input.keywordMax,
    });
  }

  const resolved = await getCandidates(input.userId, input.provider);

  if (!resolved.ok) {
    return failure(
      resolved.code === "key_store_error" ? 500 : 503,
      resolved.code,
      resolved.message,
    );
  }

  const candidates = resolved.candidates.slice(0, MAX_KEY_ATTEMPTS);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];

    try {
      const raw = await callProvider(input, candidate.apiKey);
      await recordKeyResult(input.userId, candidate.id, "ok");
      return { ok: true, raw };
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };

      if (e.code === "invalid_key") {
        await recordKeyResult(input.userId, candidate.id, "rejected");

        if (index < candidates.length - 1) continue;

        return failure(401, "invalid_key", e.message);
      }

      if (e.code === "rate_limited") {
        await recordKeyResult(input.userId, candidate.id, "rate_limited");

        if (index < candidates.length - 1) continue;

        return failure(429, "rate_limited", e.message, true);
      }

      if (e.code === "provider_unavailable") {
        return failure(503, e.code, e.message, true);
      }

      
    if (e.name === "AbortError" || e.name === "TimeoutError") {
  return failure(
    504,
    "timeout",
    "The provider request timed out.",
    true,
  );
}  
      console.error(`[provider-run] ${input.provider} request failed.`);
      return failure(
        e.status ?? 502,
        e.code ?? "bad_response",
        e.message || "The provider returned an invalid response.",
      );
    }
  }

  return failure(503, "not_configured", "No usable API key was found.");
}
