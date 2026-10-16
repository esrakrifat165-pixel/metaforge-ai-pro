// METAFORGE-ADOBE-KEYWORDS-SEARCH
import { randomUUID } from "node:crypto";
import { getAccess } from "../../../lib/auth/session";
import { isKnownGeminiModel } from "../../../lib/providers/gemini-models";
import { generateStrictMetadata } from "../../../lib/server/generateStrictMetadata";
import { saveHistory } from "../../../lib/server/history";
import { checkRateLimit } from "../../../lib/server/rateLimit";
import { cleanFileName, formField, isSameOrigin, jsonError, readUploadedImage } from "../../../lib/server/requestUtils";

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "This request was not allowed.", false, requestId);
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = checkRateLimit(`adobe-keywords:${client}`, 30, 60_000);
  if (!limit.allowed) return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", true, requestId, { "Retry-After": String(limit.retryAfterSeconds) });

  // The user id comes only from the server-verified session, never from the request.
  const access = await getAccess();
  if (!access.ok) return jsonError(access.status, access.code, access.message, access.status === 503, requestId);

  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError(400, "invalid_request", "The upload could not be read.", false, requestId); }
  const model = formField(form, "model");
  if (!isKnownGeminiModel(model)) return jsonError(400, "unsupported_model", "Choose a supported Gemini model.", false, requestId);
  const upload = await readUploadedImage(form, requestId);
  if (!upload.ok) return upload.response;
  const generated = await generateStrictMetadata({ userId: access.userId, model, mimeType: upload.mimeType, base64: Buffer.from(upload.bytes).toString("base64"), count: 50 });
  if (!generated.ok) return jsonError(generated.status, generated.code, generated.message, generated.retryable, requestId, generated.retryAfterSeconds !== null ? { "Retry-After": String(generated.retryAfterSeconds) } : undefined);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of generated.data.keywords) { const word = raw.trim(); const key = word.toLocaleLowerCase(); if (word && !seen.has(key)) { seen.add(key); keywords.push(word); } }
  if (keywords.length !== 50) return jsonError(502, "keyword_validation_failed", `The model returned ${keywords.length} unique keywords instead of 50. Please try again.`, true, requestId);
  const data = { title: generated.data.title, description: generated.data.description, keywords, warnings: generated.warnings };
  const saved = await saveHistory(access.userId, { kind: "metadata", fileName: cleanFileName(formField(form, "fileName")), provider: "gemini", model, platform: "adobe-stock", result: data });
  return Response.json({ success: true, data, provider: "gemini", model, saved, requestId }, { headers: { "Cache-Control": "no-store" } });
}