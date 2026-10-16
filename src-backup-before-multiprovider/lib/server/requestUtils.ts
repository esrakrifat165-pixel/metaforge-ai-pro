// SERVER ONLY. Shared checks for routes that receive an uploaded image.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export function jsonError(
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

export function isSameOrigin(request: Request): boolean {
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

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...Array.from(bytes.slice(start, end)));
}

// Decide the real image type from the file's first bytes, not from its name or the browser's claim.
export function detectImageType(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function formField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function cleanFileName(raw: string): string {
  const cleaned = Array.from(raw)
    .filter((character) => character !== "/" && character !== "\\" && character.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : "image";
}

export type UploadResult =
  | { ok: true; bytes: Uint8Array; mimeType: ImageMime }
  | { ok: false; response: Response };

export async function readUploadedImage(form: FormData, requestId: string): Promise<UploadResult> {
  const image = form.get("image");
  if (image === null || typeof image === "string") {
    return { ok: false, response: jsonError(400, "invalid_request", "No image was uploaded.", false, requestId) };
  }
  if (image.size === 0) {
    return { ok: false, response: jsonError(400, "invalid_request", "The image file is empty.", false, requestId) };
  }
  if (image.size > MAX_UPLOAD_BYTES) {
    return { ok: false, response: jsonError(413, "payload_too_large", "The image is too large to upload.", false, requestId) };
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const mimeType = detectImageType(bytes);
  if (!mimeType) {
    return {
      ok: false,
      response: jsonError(400, "invalid_request", "The file is not a JPG, PNG or WEBP image.", false, requestId),
    };
  }
  return { ok: true, bytes, mimeType };
}