import { getCandidates } from "../../../lib/server/keyStore";

// Returns only yes/no. Never returns a key.
export async function GET(): Promise<Response> {
  const result = await getCandidates("gemini");
  // "All keys disabled" still counts as configured here, so the Metadata Generator lets the
  // request through and the server answers with the precise reason.
  const configured = result.ok || result.code === "no_enabled_key";
  return Response.json({ gemini: { configured } }, { headers: { "Cache-Control": "no-store" } });
}



