
import { getAccess } from "../../../lib/auth/session";
import type { ProviderId } from "../../../lib/providers/catalog";
import { getCandidates } from "../../../lib/server/keyStore";

const NO_STORE = { "Cache-Control": "no-store" };

const PROVIDER_IDS: ProviderId[] = [
  "gemini",
  "openai",
  "groq",
  "anthropic",
  "xai",
];

export async function GET(): Promise<Response> {
  const access = await getAccess();

  if (!access.ok) {
    return Response.json(
      {
        success: false,
        code: access.code,
        message: access.message,
        providers: {
          gemini: { configured: false },
          openai: { configured: false },
          groq: { configured: false },
          anthropic: { configured: false },
          xai: { configured: false },
        },
      },
      {
        status: access.status,
        headers: NO_STORE,
      },
    );
  }

  const entries = await Promise.all(
    PROVIDER_IDS.map(async (provider) => {
      const result = await getCandidates(access.userId, provider);

      // No key and all keys disabled are distinct states.
      // Both are safe to expose as a boolean status only.
      const configured =
        result.ok || result.code === "no_enabled_key";

      return [provider, { configured }] as const;
    }),
  );

  return Response.json(
    {
      success: true,
      providers: Object.fromEntries(entries),
    },
    {
      headers: NO_STORE,
    },
  );
}
