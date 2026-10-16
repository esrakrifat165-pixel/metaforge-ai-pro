import { getAccess } from "../../../lib/auth/session";
import { getCandidates } from "../../../lib/server/keyStore";

// Returns only yes/no for the SIGNED-IN user. Never returns a key, a secret, a key id,
// a label, or anything about another user's keys.
// The user id comes only from the server-verified session (getAccess), never from the request.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  const access = await getAccess();

  if (!access.ok) {
    return Response.json(
      {
        success: false,
        code: access.code,
        message: access.message,
        gemini: { configured: false },
      },
      { status: access.status, headers: NO_STORE },
    );
  }

  const result = await getCandidates(access.userId, "gemini");

  // "All keys disabled" still counts as configured here, so the generators let the
  // request through and the server answers with the precise reason.
  const configured = result.ok || result.code === "no_enabled_key";

  return Response.json({ gemini: { configured } }, { headers: NO_STORE });
}