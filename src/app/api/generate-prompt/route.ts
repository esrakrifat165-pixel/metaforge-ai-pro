import { randomUUID } from "node:crypto";
import {
  buildPromptRequest,
  buildPromptSchema,
  getPromptDetail,
  getPromptStyle,
  isPromptDetailId,
  isPromptStyleId,
  normalizePrompt,
} from "../../../lib/prompt/generation";
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
  const styleId = formField(form, "style");
  const detailId = formField(form, "detail");

  if (formField(form, "provider") !== "gemini") {
    return jsonError(400, "unsupported_provider", "Only Google Gemini is connected so far.", false, requestId);
  }
  if (!isKnownGeminiModel(model)) {
    return jsonError(400, "unsupported_model", "That model is not in the supported list.", false, requestId);
  }
  if (!isPromptStyleId(styleId) || !isPromptDetailId(detailId)) {
    return jsonError(400, "invalid_request", "Unknown prompt style or detail level.", false, requestId);
  }

  const upload = await readUploadedImage(form, requestId);
  if (!upload.ok) {
    return upload.response;
  }

  const style = getPromptStyle(styleId);
  const detail = getPromptDetail(detailId);

  const run = await runGeminiWithKeys({
    model,
    mimeType: upload.mimeType,
    base64: Buffer.from(upload.bytes).toString("base64"),
    prompt: buildPromptRequest(style, detail),
    schema: buildPromptSchema(),
    keywordMax: 1,
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

  const normalized = normalizePrompt(run.raw, detail);
  if (!normalized.ok) {
    return jsonError(502, "bad_response", `${normalized.message} Try again.`, true, requestId);
  }

  let saved = false;
  if (who.userId) {
    saved = await saveHistory(who.userId, {
      kind: "prompt",
      fileName: cleanFileName(formField(form, "fileName")),
      provider: "gemini",
      model,
      platform: null,
      result: { prompt: normalized.prompt, style: style.id, detail: detail.id },
    });
  }

  return Response.json(
    {
      success: true,
      data: { prompt: normalized.prompt, warnings: normalized.warnings },
      provider: "gemini",
      model,
      saved,
      requestId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}