import { randomUUID } from "node:crypto";
import { getAccess } from "../../../lib/auth/session";
import {
  effectiveKeywordCount,
  getPlatformProfile,
  isPlatformId,
} from "../../../lib/platforms/profiles";
import { isKnownGeminiModel } from "../../../lib/providers/gemini-models";
import { generateStrictMetadata } from "../../../lib/server/generateStrictMetadata";
import { saveHistory } from "../../../lib/server/history";
import { checkRateLimit } from "../../../lib/server/rateLimit";
import {
  cleanFileName,
  formField,
  isSameOrigin,
  jsonError,
  readUploadedImage,
} from "../../../lib/server/requestUtils";

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

  // The user id comes only from the server-verified session, never from the request.
  const access = await getAccess();
  if (!access.ok) {
    return jsonError(access.status, access.code, access.message, access.status === 503, requestId);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_request", "The upload could not be read.", false, requestId);
  }

  const model = formField(form, "model");
  const platform = formField(form, "platform");
  const requested = Number(formField(form, "keywordCount"));

  if (formField(form, "provider") !== "gemini") {
    return jsonError(400, "unsupported_provider", "Only Google Gemini is connected so far.", false, requestId);
  }
  if (!isKnownGeminiModel(model)) {
    return jsonError(400, "unsupported_model", "That model is not in the supported list.", false, requestId);
  }
  if (!isPlatformId(platform)) {
    return jsonError(400, "invalid_request", "Unknown platform.", false, requestId);
  }
  if (!Number.isInteger(requested) || requested < 1 || requested > 50) {
    return jsonError(400, "invalid_request", "The keyword count must be a whole number from 1 to 50.", false, requestId);
  }

  const upload = await readUploadedImage(form, requestId);
  if (!upload.ok) {
    return upload.response;
  }

  const profile = getPlatformProfile(platform);
  const count = effectiveKeywordCount(profile, requested);

  const generated = await generateStrictMetadata({
    userId: access.userId,
    model,
    mimeType: upload.mimeType,
    base64: Buffer.from(upload.bytes).toString("base64"),
    count,
  });

  if (!generated.ok) {
    return jsonError(
      generated.status,
      generated.code,
      generated.message,
      generated.retryable,
      requestId,
      generated.retryAfterSeconds !== null
        ? { "Retry-After": String(generated.retryAfterSeconds) }
        : undefined,
    );
  }

  const { title, description, keywords } = generated.data;
  const warnings = generated.warnings;

  const saved = await saveHistory(access.userId, {
    kind: "metadata",
    fileName: cleanFileName(formField(form, "fileName")),
    provider: "gemini",
    model,
    platform: profile.id,
    result: { title, description, keywords, warnings },
  });

  return Response.json(
    {
      success: true,
      data: {
        title,
        description,
        keywords: keywords.join(", "), // CHECK: use `keywords` (array) if the UI expects an array
        warnings,
      },
      keywordTarget: count,
      provider: "gemini",
      model,
      platform: profile.id,
      saved,
      requestId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}