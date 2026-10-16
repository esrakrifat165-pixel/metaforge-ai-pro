import { getAccess } from "../../../lib/auth/session";
import {
  MAX_KEYS_PER_PROVIDER,
  PROVIDERS,
  type ProviderId,
} from "../../../lib/providers/catalog";
import {
  validateApiKey,
  validateLabel,
} from "../../../lib/keys/shared";
import {
  addKey,
  getStorageState,
  listKeys,
  removeKey,
  setEnabled,
} from "../../../lib/server/keyStore";
import { checkRateLimit } from "../../../lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

function reply(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function fail(
  status: number,
  code: string,
  message: string,
): Response {
  return reply({ success: false, code, message }, status);
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");

  // Write requests must include a valid Origin header.
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();

    const requestHost =
      forwardedHost ||
      request.headers.get("host");

    if (!requestHost) return false;

    return (
      originUrl.host.toLowerCase() === requestHost.toLowerCase() &&
      (originUrl.protocol === "https:" ||
        originUrl.protocol === "http:")
    );
  } catch {
    return false;
  }
}

async function guard(
  request: Request,
  requireSameOrigin = false,
): Promise<GuardResult> {
  if (requireSameOrigin && !isSameOrigin(request)) {
    return {
      ok: false,
      response: fail(
        403,
        "forbidden",
        "This request was not allowed.",
      ),
    };
  }

  const client =
    request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() || "local";

  const limit = checkRateLimit(
    `api-keys:${client}`,
    120,
    60_000,
  );

  if (!limit.allowed) {
    return {
      ok: false,
      response: fail(
        429,
        "rate_limited",
        "Too many requests. Please wait a moment.",
      ),
    };
  }

  try {
    const access = await getAccess();

    if (!access.ok) {
      return {
        ok: false,
        response: fail(
          access.status,
          access.code,
          access.message,
        ),
      };
    }

    return { ok: true, userId: access.userId };
  } catch {
    return {
      ok: false,
      response: fail(
        500,
        "auth_error",
        "Authentication could not be verified. Please try again.",
      ),
    };
  }
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();

    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return null;
    }

    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asProviderId(
  value: unknown,
): ProviderId | null {
  if (typeof value !== "string") return null;

  const provider = PROVIDERS.find(
    (item) => item.id === value,
  );

  return provider ? (provider.id as ProviderId) : null;
}

export async function GET(
  request: Request,
): Promise<Response> {
  const checked = await guard(request);

  if (!checked.ok) return checked.response;

  const storage = getStorageState();

  if (storage.state !== "ready") {
    return reply({
      success: true,
      storage,
      limit: MAX_KEYS_PER_PROVIDER,
      keys: [],
    });
  }

  try {
    // Only the signed-in user's keys are returned.
    const keys = await listKeys(checked.userId);

    return reply({
      success: true,
      storage,
      limit: MAX_KEYS_PER_PROVIDER,
      keys,
    });
  } catch {
    return reply(
      {
        success: false,
        code: "storage_error",
        message:
          "Saved keys could not be loaded. Check the Supabase configuration and api_keys table.",
      },
      500,
    );
  }
}

export async function POST(
  request: Request,
): Promise<Response> {
  const checked = await guard(request, true);

  if (!checked.ok) return checked.response;

  const body = await readBody(request);

  if (!body) {
    return fail(
      400,
      "invalid_request",
      "The request body is invalid.",
    );
  }

  const provider = asProviderId(body.provider);

  if (!provider) {
    return fail(
      400,
      "invalid_request",
      "Unknown API provider.",
    );
  }

  if (
    typeof body.label !== "string" ||
    typeof body.apiKey !== "string"
  ) {
    return fail(
      400,
      "invalid_request",
      "A label and API key are required.",
    );
  }

  const label = body.label.trim();
  const apiKey = body.apiKey.trim();

  const problem =
    validateLabel(label) ??
    validateApiKey(apiKey);

  if (problem) {
    return fail(400, "validation_failed", problem);
  }

  try {
    const result = await addKey(checked.userId, {
      provider,
      label,
      apiKey,
    });

    if (!result.ok) {
      return fail(
        result.status,
        result.code,
        result.message,
      );
    }

    // Return only the public, masked key representation.
    return reply(
      { success: true, key: result.value },
      201,
    );
  } catch {
    return fail(
      500,
      "storage_error",
      "The API key could not be saved. Check the server configuration.",
    );
  }
}

export async function PATCH(
  request: Request,
): Promise<Response> {
  const checked = await guard(request, true);

  if (!checked.ok) return checked.response;

  const body = await readBody(request);

  if (
    !body ||
    typeof body.id !== "string" ||
    !ID_PATTERN.test(body.id) ||
    typeof body.enabled !== "boolean"
  ) {
    return fail(
      400,
      "invalid_request",
      "A valid key ID and enabled value are required.",
    );
  }

  try {
    const result = await setEnabled(
      checked.userId,
      body.id,
      body.enabled,
    );

    if (!result.ok) {
      return fail(
        result.status,
        result.code,
        result.message,
      );
    }

    return reply({
      success: true,
      key: result.value,
    });
  } catch {
    return fail(
      500,
      "storage_error",
      "The API key could not be updated.",
    );
  }
}

export async function DELETE(
  request: Request,
): Promise<Response> {
  const checked = await guard(request, true);

  if (!checked.ok) return checked.response;

  const id =
    new URL(request.url).searchParams.get("id") ?? "";

  if (!ID_PATTERN.test(id)) {
    return fail(
      400,
      "invalid_request",
      "A valid key ID is required.",
    );
  }

  try {
    const result = await removeKey(
      checked.userId,
      id,
    );

    if (!result.ok) {
      return fail(
        result.status,
        result.code,
        result.message,
      );
    }

    return reply({ success: true });
  } catch {
    return fail(
      500,
      "storage_error",
      "The API key could not be removed.",
    );
  }
}