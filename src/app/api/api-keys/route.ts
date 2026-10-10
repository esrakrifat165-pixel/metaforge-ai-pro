import { MAX_KEYS_PER_PROVIDER, PROVIDERS, type ProviderId } from "../../../lib/providers/catalog";
import { validateApiKey, validateLabel } from "../../../lib/keys/shared";
import { addKey, getStorageState, listKeys, removeKey, setEnabled } from "../../../lib/server/keyStore";
import { checkRateLimit } from "../../../lib/server/rateLimit";

// Responses NEVER include a saved secret. Only masked values are returned.

const ID_PATTERN = /^[0-9a-fA-F-]{36}$/;

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(status: number, code: string, message: string): Response {
  return reply({ success: false, code, message }, status);
}

function isLocalHost(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const host = request.headers.get("host");
    return host === null ? false : new URL(origin).host === host;
  } catch {
    return false;
  }
}

function guard(request: Request): Response | null {
  if (!isLocalHost(request)) {
    return fail(403, "forbidden", "The API Key Manager can only be used from this computer (localhost).");
  }
  if (!isSameOrigin(request)) {
    return fail(403, "forbidden", "This request was not allowed.");
  }
  const limit = checkRateLimit("api-keys:local", 120, 60_000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many requests. Please wait a moment.");
  }
  return null;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asProviderId(value: unknown): ProviderId | null {
  return typeof value === "string" && PROVIDERS.some((provider) => provider.id === value)
    ? (value as ProviderId)
    : null;
}

export async function GET(request: Request): Promise<Response> {
  const blocked = guard(request);
  if (blocked) {
    return blocked;
  }

  const storage = getStorageState();
  if (storage.state !== "ready") {
    return reply({ success: true, storage, limit: MAX_KEYS_PER_PROVIDER, keys: [] });
  }

  try {
    const keys = await listKeys();
    return reply({ success: true, storage, limit: MAX_KEYS_PER_PROVIDER, keys });
  } catch {
    return reply({
      success: true,
      storage: {
        state: "error",
        message: "The saved key file could not be read. Check the .data folder.",
      },
      limit: MAX_KEYS_PER_PROVIDER,
      keys: [],
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const blocked = guard(request);
  if (blocked) {
    return blocked;
  }

  const body = await readBody(request);
  if (!body) {
    return fail(400, "invalid_request", "The request could not be read.");
  }

  const provider = asProviderId(body.provider);
  if (!provider) {
    return fail(400, "invalid_request", "Unknown provider.");
  }
  if (typeof body.label !== "string" || typeof body.apiKey !== "string") {
    return fail(400, "invalid_request", "A label and an API key are required.");
  }

  const problem = validateLabel(body.label) ?? validateApiKey(body.apiKey);
  if (problem) {
    return fail(400, "validation_failed", problem);
  }

  try {
    const result = await addKey({
      provider,
      label: body.label.trim(),
      apiKey: body.apiKey.trim(),
    });
    if (!result.ok) {
      return fail(result.status, result.code, result.message);
    }
    return reply({ success: true, key: result.value }, 201);
  } catch {
    return fail(500, "storage_error", "The key could not be saved. Check the .data folder and try again.");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const blocked = guard(request);
  if (blocked) {
    return blocked;
  }

  const body = await readBody(request);
  if (!body || typeof body.id !== "string" || !ID_PATTERN.test(body.id) || typeof body.enabled !== "boolean") {
    return fail(400, "invalid_request", "A key id and an enabled value are required.");
  }

  try {
    const result = await setEnabled(body.id, body.enabled);
    if (!result.ok) {
      return fail(result.status, result.code, result.message);
    }
    return reply({ success: true, key: result.value });
  } catch {
    return fail(500, "storage_error", "The key could not be updated. Try again.");
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const blocked = guard(request);
  if (blocked) {
    return blocked;
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID_PATTERN.test(id)) {
    return fail(400, "invalid_request", "A valid key id is required.");
  }

  try {
    const result = await removeKey(id);
    if (!result.ok) {
      return fail(result.status, result.code, result.message);
    }
    return reply({ success: true });
  } catch {
    return fail(500, "storage_error", "The key could not be removed. Try again.");
  }
}