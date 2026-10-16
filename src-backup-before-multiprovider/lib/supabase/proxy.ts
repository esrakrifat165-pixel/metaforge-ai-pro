import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isEmailAllowed } from "../auth/guards";
import { getSupabaseEnv } from "./env";

// Runs before every page and API request (see src/proxy.ts).
// - Keeps the sign-in session fresh.
// - Sends signed-out visitors to /login, and answers API calls with 401.
// - Blocks signed-in accounts that are not on the ALLOWED_EMAILS list.
// If Supabase is not configured at all, everything passes through unchanged.

const PUBLIC_PREFIXES = ["/login", "/auth"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
}

function deny(
  request: NextRequest,
  response: NextResponse,
  reason: "login" | "not_allowed",
): NextResponse {
  const path = request.nextUrl.pathname;
  let result: NextResponse;

  if (path.startsWith("/api/")) {
    result =
      reason === "login"
        ? NextResponse.json(
            { success: false, code: "unauthenticated", message: "Please sign in." },
            { status: 401 },
          )
        : NextResponse.json(
            { success: false, code: "not_allowed", message: "This account is not allowed to use the app." },
            { status: 403 },
          );
  } else {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (reason === "login") {
      url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    } else {
      url.searchParams.set("error", "not_allowed");
    }
    result = NextResponse.redirect(url);
  }

  copyCookies(response, result);
  result.headers.set("Cache-Control", "no-store");
  return result;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getSupabaseEnv();
  if (!env) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers?: Record<string, string>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        if (headers) {
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        }
      },
    },
  });

  // Do not add code between createServerClient and getUser().
  // getUser() asks Supabase to confirm the session. The cookie alone is never trusted.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user) {
    return isPublic(path) ? response : deny(request, response, "login");
  }

  const allowed = Boolean(user.email_confirmed_at) && isEmailAllowed(user.email);
  if (!allowed) {
    return isPublic(path) ? response : deny(request, response, "not_allowed");
  }

  if (path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    copyCookies(response, redirect);
    return redirect;
  }

  return response;
}