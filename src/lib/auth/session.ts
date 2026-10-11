import { createClient } from "../supabase/server";
import { getSupabaseEnv } from "../supabase/env";
import { isEmailAllowed } from "./guards";

// SERVER ONLY. Decides who is signed in and whether they are an admin.
// The role comes from public.profiles, which the browser cannot change.

export type AccessResult =
  | { ok: true; userId: string; email: string; role: "user" | "admin" }
  | { ok: false; status: 401 | 403 | 503; code: string; message: string };

export async function getAccess(): Promise<AccessResult> {
  if (!getSupabaseEnv()) {
    return {
      ok: false,
      status: 503,
      code: "auth_not_configured",
      message: "Sign-in is not configured on the server.",
    };
  }

  try {
    const supabase = await createClient();

    // getUser() asks Supabase to confirm the session. Cookies alone are never trusted.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, status: 401, code: "unauthenticated", message: "Please sign in." };
    }
    if (!user.email_confirmed_at || !isEmailAllowed(user.email)) {
      return {
        ok: false,
        status: 403,
        code: "not_allowed",
        message: "This account is not allowed to use the app.",
      };
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        status: 503,
        code: "profile_unavailable",
        message: "Your profile could not be read. Check that the profiles SQL was run in Supabase.",
      };
    }

    return {
      ok: true,
      userId: user.id,
      email: user.email ?? "",
      role: data?.role === "admin" ? "admin" : "user",
    };
  } catch {
    return {
      ok: false,
      status: 503,
      code: "auth_unavailable",
      message: "Could not check your sign-in. Try again.",
    };
  }
}

/** Returns an error Response if the caller is not a signed-in admin, or null if they are. */
export async function adminApiGuard(): Promise<Response | null> {
  const access = await getAccess();

  if (!access.ok) {
    return Response.json(
      { success: false, code: access.code, message: access.message },
      { status: access.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (access.role !== "admin") {
    return Response.json(
      { success: false, code: "forbidden", message: "Only an admin can do this." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  return null;
}