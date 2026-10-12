import { getCurrentUser } from "../../../lib/server/history";
import { getCandidates } from "../../../lib/server/keyStore";

// Returns only yes/no for the signed-in user. Never returns a key.
export async function GET(): Promise<Response> {
  const who = await getCurrentUser();
  if (!who.userId) {
    return Response.json(
      { success: false, code: "unauthenticated", message: "Please sign in." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await getCandidates("gemini", who.userId);
  // "All keys disabled" still counts as configured here, so the Metadata Generator lets the
  // request through and the server answers with the precise reason.
  const configured = result.ok || result.code === "no_enabled_key";
  return Response.json({ gemini: { configured } }, { headers: { "Cache-Control": "no-store" } });
}