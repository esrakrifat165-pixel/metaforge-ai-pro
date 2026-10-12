import { createClient } from "@supabase/supabase-js";
import { isEmailAllowed } from "../auth/guards";
import { getAccess } from "../auth/session";
import { getSupabaseEnv } from "../supabase/env";

// SERVER ONLY. Read-only login statistics for the Admin Panel.
// Source: Supabase Auth's own record (auth.users.last_sign_in_at). Nothing is written here
// and nothing from the browser is trusted. The caller is re-verified as an admin below.
// An account counts only if it has signed in, has a confirmed email and is on ALLOWED_EMAILS,
// the same rule getAccess() and proxy.ts use for a successful login. Counted by user id.

export type LoginAccount = { email: string; lastSignInAt: string };

export type LoginStats =
  | {
      ok: true;
      count: number;
      lastLoginAt: string | null;
      accounts: LoginAccount[];
      truncated: boolean;
    }
  | { ok: false; message: string };

const PER_PAGE = 200;
const MAX_PAGES = 25; // reads at most 5,000 accounts

function getServiceKey(): string | null {
  const value = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "").trim();
  return value.length > 0 ? value : null;
}

export async function getLoginStats(): Promise<LoginStats> {
  const access = await getAccess();
  if (!access.ok || access.role !== "admin") {
    return { ok: false, message: "Only an administrator can view login statistics." };
  }

  const env = getSupabaseEnv();
  const serviceKey = getServiceKey();
  if (!env || !serviceKey) {
    return { ok: false, message: "Login statistics need SUPABASE_SERVICE_ROLE_KEY on the server." };
  }

  const client = createClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const byId = new Map<string, { email: string; lastSignInAt: string; time: number }>();
  let truncated = false;

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) {
        return { ok: false, message: "Login statistics could not be read from Supabase Auth." };
      }

      for (const user of data.users) {
        const email = (user.email ?? "").trim().toLowerCase();
        const time = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : Number.NaN;
        if (!email || !Number.isFinite(time) || !user.email_confirmed_at || !isEmailAllowed(email)) {
          continue;
        }
        byId.set(user.id, { email, lastSignInAt: new Date(time).toISOString(), time });
      }

      if (data.users.length < PER_PAGE) {
        break;
      }
      if (page === MAX_PAGES) {
        truncated = true;
      }
    }
  } catch {
    return { ok: false, message: "Login statistics could not be read from Supabase Auth." };
  }

  const sorted = [...byId.values()].sort((a, b) => b.time - a.time);
  return {
    ok: true,
    count: sorted.length,
    lastLoginAt: sorted[0]?.lastSignInAt ?? null,
    accounts: sorted.map(({ email, lastSignInAt }) => ({ email, lastSignInAt })),
    truncated,
  };
}