import { createClient } from "@supabase/supabase-js";
import { PROVIDERS, type ProviderId } from "../providers/catalog";
import { getSupabaseEnv } from "../supabase/env";

// SERVER ONLY. Read-only statistics for the Admin Panel. Call it only after the admin check.
// Reads counts and metadata. It never selects the encrypted secret column of api_keys.

const PER_PAGE = 100;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: "user" | "admin";
  status: string;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export type ProviderKeyStats = {
  provider: ProviderId;
  name: string;
  saved: number;
  enabled: number;
  lastOk: number;
  owners: number;
};

export type HistoryStats = {
  metadataTotal: number | null;
  promptTotal: number | null;
  metadataWeek: number | null;
  promptWeek: number | null;
};

export type AdminOverview = {
  users: AdminUser[];
  totalUsers: number;
  truncated: boolean;
  admins: number;
  newLast7Days: number;
  signedInLast7Days: number;
  history: HistoryStats;
  providers: ProviderKeyStats[] | null;
};

export type OverviewResult = { ok: true; data: AdminOverview } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function serviceClient() {
  const env = getSupabaseEnv();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "").trim();
  if (!env || !key) {
    return null;
  }
  return createClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Service = NonNullable<ReturnType<typeof serviceClient>>;

async function loadAuthUsers(
  client: Service,
): Promise<{ users: Record<string, unknown>[]; total: number } | null> {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: PER_PAGE });
  if (error) {
    return null;
  }
  const payload: unknown = data;
  if (!isRecord(payload) || !Array.isArray(payload.users)) {
    return null;
  }
  const users = payload.users.filter(isRecord);
  const total = typeof payload.total === "number" ? payload.total : users.length;
  return { users, total };
}

type ProfileInfo = { role: "user" | "admin"; status: string };

async function loadProfiles(client: Service): Promise<Map<string, ProfileInfo>> {
  const map = new Map<string, ProfileInfo>();
  let rows: unknown;
  let hasStatus = true;

  const full = await client.from("profiles").select("id,role,status");
  rows = full.data;
  if (full.error) {
    const basic = await client.from("profiles").select("id,role");
    if (basic.error) {
      return map;
    }
    rows = basic.data;
    hasStatus = false;
  }
  if (!Array.isArray(rows)) {
    return map;
  }

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const id = text(row.id);
    if (!id) {
      continue;
    }
    map.set(id, {
      role: row.role === "admin" ? "admin" : "user",
      status: hasStatus ? (text(row.status) ?? "active") : "active",
    });
  }
  return map;
}

async function countHistory(client: Service, kind: string, since: string | null): Promise<number | null> {
  try {
    let query = client.from("history").select("id", { count: "exact", head: true }).eq("kind", kind);
    if (since) {
      query = query.gte("created_at", since);
    }
    const { count, error } = await query;
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

async function loadKeyStats(client: Service): Promise<ProviderKeyStats[] | null> {
  try {
    // Metadata columns only. The secret column is never selected.
    const { data, error } = await client.from("api_keys").select("provider,owner_id,enabled,last_result");
    const rows: unknown = data;
    if (error || !Array.isArray(rows)) {
      return null;
    }

    const stats = new Map<string, { saved: number; enabled: number; lastOk: number; owners: Set<string> }>();
    for (const row of rows) {
      if (!isRecord(row) || typeof row.provider !== "string") {
        continue;
      }
      const entry = stats.get(row.provider) ?? { saved: 0, enabled: 0, lastOk: 0, owners: new Set<string>() };
      entry.saved += 1;
      if (row.enabled === true) {
        entry.enabled += 1;
      }
      if (row.last_result === "ok") {
        entry.lastOk += 1;
      }
      const owner = text(row.owner_id);
      if (owner) {
        entry.owners.add(owner);
      }
      stats.set(row.provider, entry);
    }

    return PROVIDERS.map((provider) => {
      const entry = stats.get(provider.id);
      return {
        provider: provider.id,
        name: provider.name,
        saved: entry?.saved ?? 0,
        enabled: entry?.enabled ?? 0,
        lastOk: entry?.lastOk ?? 0,
        owners: entry?.owners.size ?? 0,
      };
    });
  } catch {
    return null;
  }
}

export async function getAdminOverview(): Promise<OverviewResult> {
  const client = serviceClient();
  if (!client) {
    return {
      ok: false,
      message: "SUPABASE_SERVICE_ROLE_KEY or the Supabase URL is missing on the server.",
    };
  }

  try {
    const auth = await loadAuthUsers(client);
    if (!auth) {
      return {
        ok: false,
        message: "The account list could not be read. Check SUPABASE_SERVICE_ROLE_KEY.",
      };
    }

    const profiles = await loadProfiles(client);
    const sinceMs = Date.now() - WEEK_MS;
    const since = new Date(sinceMs).toISOString();

    const [metadataTotal, promptTotal, metadataWeek, promptWeek, providers] = await Promise.all([
      countHistory(client, "metadata", null),
      countHistory(client, "prompt", null),
      countHistory(client, "metadata", since),
      countHistory(client, "prompt", since),
      loadKeyStats(client),
    ]);

    const users: AdminUser[] = auth.users.map((raw) => {
      const id = text(raw.id) ?? "";
      const meta = isRecord(raw.user_metadata) ? raw.user_metadata : {};
      const profile = profiles.get(id);
      return {
        id,
        name: text(meta.full_name) ?? text(meta.name),
        email: text(raw.email) ?? "(no email)",
        role: profile?.role ?? "user",
        status: profile?.status ?? "active",
        createdAt: text(raw.created_at),
        lastSignInAt: text(raw.last_sign_in_at),
      };
    });

    users.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0);

    const within = (value: string | null) => value !== null && Date.parse(value) >= sinceMs;

    return {
      ok: true,
      data: {
        users,
        totalUsers: auth.total,
        truncated: auth.total > users.length,
        admins: users.filter((user) => user.role === "admin").length,
        newLast7Days: users.filter((user) => within(user.createdAt)).length,
        signedInLast7Days: users.filter((user) => within(user.lastSignInAt)).length,
        history: { metadataTotal, promptTotal, metadataWeek, promptWeek },
        providers,
      },
    };
  } catch {
    return { ok: false, message: "The admin figures could not be read. Try again." };
  }
}