
import { NextResponse } from "next/server";
import { getAccess } from "../../../../lib/auth/session";
import type { ProviderId } from "../../../../lib/providers/catalog";
import { getCandidates } from "../../../../lib/server/keyStore";

export const dynamic = "force-dynamic";

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: "gemini", name: "Google Gemini" },
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "xai", name: "xAI Grok" },
  { id: "groq", name: "Groq" },
];

export async function GET() {
  const access = await getAccess();

  if (!access.ok) {
    return NextResponse.json(
      {
        success: false,
        code: access.code,
        message: access.message,
      },
      {
        status: access.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const providers = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const result = await getCandidates(access.userId, provider.id);

      // Only expose a boolean; never return keys, IDs, or secrets.
      const configured =
        result.ok || result.code === "no_enabled_key";

      return {
        id: provider.id,
        name: provider.name,
        configured,
      };
    }),
  );

  return NextResponse.json(
    { success: true, providers },
    { headers: { "Cache-Control": "no-store" } },
  );
}
