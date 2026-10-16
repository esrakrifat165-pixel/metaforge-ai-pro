import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (url.searchParams.get("error") || !code) {
    return NextResponse.redirect(`${url.origin}/login?error=cancelled`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${url.origin}/login?error=oauth`);
  }
  // Fixed destination, so there is no open redirect.
  return NextResponse.redirect(`${url.origin}/dashboard`);
}