import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "../../../lib/supabase/env";

// Signs the person out. The redirect response is created first and the cookie
// removals are written onto it directly, so the browser always receives them.

export async function POST(request: NextRequest): Promise<Response> {
  const origin = new URL(request.url).origin;
  const response = NextResponse.redirect(`${origin}/login`, 303);
  response.headers.set("Cache-Control", "no-store");

  const env = getSupabaseEnv();
  if (env) {
    const supabase = createServerClient(env.url, env.publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    try {
      // Revokes the session on Supabase and queues the cookie removal.
      await supabase.auth.signOut();
    } catch {
      // The safety net below still clears the browser's cookies.
    }
  }

  // Safety net: expire every Supabase session cookie, including chunked ones.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}