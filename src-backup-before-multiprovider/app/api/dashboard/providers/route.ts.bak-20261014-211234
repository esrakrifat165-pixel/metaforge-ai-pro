import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
 
export const dynamic = "force-dynamic";
 
const PROVIDERS = [
  { id: "gemini", name: "Google Gemini", envs: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { id: "openai", name: "OpenAI", envs: ["OPENAI_API_KEY"] },
  { id: "anthropic", name: "Anthropic Claude", envs: ["ANTHROPIC_API_KEY"] },
  { id: "xai", name: "xAI Grok", envs: ["XAI_API_KEY"] },
  { id: "groq", name: "Groq", envs: ["GROQ_API_KEY"] },
];
 
export async function GET(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Server not configured" }, { status: 500 });
 
  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 
  return NextResponse.json({
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      configured: p.envs.some((e) => !!process.env[e]),
    })),
  });
}
