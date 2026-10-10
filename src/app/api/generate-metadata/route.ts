import { randomUUID } from "node:crypto";
import { buildPrompt, normalizeMetadata } from "../../../lib/metadata/generation";
import {
  effectiveKeywordCount,
  getPlatformProfile,
  isPlatformId,
} from "../../../lib/platforms/profiles";
import { isKnownGeminiModel } from "../../../lib/providers/gemini-models";
import { checkRateLimit } from "../../../lib/server/rateLimit";
import { GeminiError, generateRawMetadata, type GeminiErrorCode } from "../../../lib/server/gemini";

// Keep uploads under the 4.5 MB request limit that Vercel applies to serverless functions.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 120;

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

function jsonError(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  requestId: string,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { success: false, code, message, retryable, requestId },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...Array.from(bytes.slice(start, end)));
}

// Decide the real image type from the file's first bytes, not from the name or the browser's claim.
function detectImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return host === null ? true : new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  if (!isSameOrigin(request)) {
    return jsonError(403, "forbidden", "This request was not allowed.", false, requestId);
  }

  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = checkRateLimit(`generate:${client}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return jsonError(
      429,
      "rate_limited",
      "Too many requests. Please wait a moment and try again.",
      true,
      requestId,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_request", "The upload could not be read.", false, requestId);
  }

  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };

  const provider = field("provider");
  const model = field("model");
  const platform = field("platform");
  const keywordCount = Number(field("keywordCount"));

  if (provider !== "gemini") {
    return jsonError(
      400,
      "unsupported_provider",
      "Only Google Gemini is connected so far.",
      false,
      requestId,
    );
  }
  if (!isKnownGeminiModel(model)) {
    return jsonError(400, "unsupported_model", "That model is not in the supported list.", false, requestId);
  }
  if (!isPlatformId(platform)) {
    return jsonError(400, "invalid_request", "Unknown platform.", false, requestId);
  }
  if (!Number.isInteger(keywordCount) || keywordCount < 1 || keywordCount > 50) {
    return jsonError(400, "invalid_request", "The keyword count must be a whole number from 1 to 50.", false, requestId);
  }

  const image = form.get("image");
  if (image === null || typeof image === "string") {
    return jsonError(400, "invalid_request", "No image was uploaded.", false, requestId);
  }
  if (image.size === 0) {
    return jsonError(400, "invalid_request", "The image file is empty.", false, requestId);
  }
  if (image.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, "payload_too_large", "The image is too large to upload.", false, requestId);
  }

  const apiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
  if (!apiKey) {
    return jsonError(
      503,
      "not_configured",
      "No Gemini API key was found on the server. Add GEMINI_API_KEY to .env.local and restart the dev server.",
      false,
      requestId,
    );
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const mimeType = detectImageType(bytes);
  if (!mimeType) {
    return jsonError(400, "invalid_request", "The file is not a JPG, PNG or WEBP image.", false, requestId);
  }

  const profile = getPlatformProfile(platform);
  const count = effectiveKeywordCount(profile, keywordCount);

  try {
    const raw = await generateRawMetadata({
      apiKey,
      model,
      mimeType,
      base64: Buffer.from(bytes).toString("base64"),
      prompt: buildPrompt(profile, count),
      keywordMax: count,
    });

    const normalized = normalizeMetadata(raw, profile, count);
    if (!normalized.ok) {
      return jsonError(502, "bad_response", `${normalized.message} Try again.`, true, requestId);
    }

    return Response.json(
      {
        success: true,
        data: { ...normalized.data, warnings: normalized.warnings },
        provider: "gemini",
        model,
        platform: profile.id,
        requestId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GeminiError) {
      const headers =
        error.retryAfterMs !== null
          ? { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) }
          : undefined;
      return jsonError(
        STATUS_BY_CODE[error.code],
        error.code,
        error.message,
        error.retryable,
        requestId,
        headers,
      );
    }
    console.error(`[generate-metadata] ${requestId} unexpected failure`);
    return jsonError(500, "internal_error", "Something went wrong on the server. Please try again.", true, requestId);
  }
}