import { NextResponse } from "next/server";
import { getSupabaseEnv } from "../../../lib/supabase/env";
import { createClient } from "../../../lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;

  if (!getSupabaseEnv()) {
    return NextResponse.redirect(`${origin}/login?error=not_configured`, 303);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/login?error=oauth`, 303);
  }
  return NextResponse.redirect(data.url, 303);
}