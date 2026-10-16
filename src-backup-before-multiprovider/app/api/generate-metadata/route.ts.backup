import { randomUUID } from "node:crypto";
import { buildPrompt, normalizeMetadata } from "../../../lib/metadata/generation";
import {
  effectiveKeywordCount,
  getPlatformProfile,
  isPlatformId,
} from "../../../lib/platforms/profiles";
import { isKnownGeminiModel } from "../../../lib/providers/gemini-models";
import { getCurrentUser, saveHistory } from "../../../lib/server/history";
import { checkRateLimit } from "../../../lib/server/rateLimit";
import {
  cleanFileName,
  formField,
  isSameOrigin,
  jsonError,
  readUploadedImage,
} from "../../../lib/server/requestUtils";
import { runGeminiWithKeys } from "../../../lib/server/runGemini";

const RATE_LIMIT_PER_MINUTE = 120;

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  if (!isSameOrigin(request)) {
    return jsonError(403, "forbidden", "This request was not allowed.", false, requestId);
  }

  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = checkRateLimit(`generate:${client}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", true, requestId, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const who = await getCurrentUser();
  if (who.configured && !who.userId) {
    return jsonError(401, "unauthenticated", "Please sign in.", false, requestId);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_request", "The upload could not be read.", false, requestId);
  }

  const model = formField(form, "model");
  const platform = formField(form, "platform");
  const keywordCount = Number(formField(form, "keywordCount"));

  if (formField(form, "provider") !== "gemini") {
    return jsonError(400, "unsupported_provider", "Only Google Gemini is connected so far.", false, requestId);
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

  const upload = await readUploadedImage(form, requestId);
  if (!upload.ok) {
    return upload.response;
  }

  const profile = getPlatformProfile(platform);
  const count = effectiveKeywordCount(profile, keywordCount);

  const run = await runGeminiWithKeys({
    model,
    mimeType: upload.mimeType,
    base64: Buffer.from(upload.bytes).toString("base64"),
    prompt: buildPrompt(profile, count),
    keywordMax: count,
  });

  if (!run.ok) {
    return jsonError(
      run.status,
      run.code,
      run.message,
      run.retryable,
      requestId,
      run.retryAfterSeconds !== null ? { "Retry-After": String(run.retryAfterSeconds) } : undefined,
    );
  }

  const normalized = normalizeMetadata(run.raw, profile, count);
  if (!normalized.ok) {
    return jsonError(502, "bad_response", `${normalized.message} Try again.`, true, requestId);
  }

  let saved = false;
  if (who.userId) {
    saved = await saveHistory(who.userId, {
      kind: "metadata",
      fileName: cleanFileName(formField(form, "fileName")),
      provider: "gemini",
      model,
      platform: profile.id,
      result: { ...normalized.data, warnings: normalized.warnings },
    });
  }

  return Response.json(
    {
      success: true,
      data: { ...normalized.data, warnings: normalized.warnings },
      provider: "gemini",
      model,
      platform: profile.id,
      saved,
      requestId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}