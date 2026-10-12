import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MAX_KEYS_PER_PROVIDER, PROVIDERS, type ProviderId } from "../providers/catalog";
import type { LastResult, PublicKey, StorageState } from "../keys/shared";
import { getSupabaseEnv } from "../supabase/env";

// SERVER ONLY. Never import this file from a client component.
//
// Keys are encrypted with AES-256-GCM (secret: KEY_ENCRYPTION_SECRET) and stored in the
// Supabase table public.api_keys. The table has row-level security and no policies, so
// only the server, using SUPABASE_SERVICE_ROLE_KEY, can read or write it.
//
// Every operation takes the verified owner ID of the signed-in user and filters by
// owner_id. The caller must get that ID from the server-side session, never from the browser.

type EncryptedSecret = { iv: string; tag: string; data: string };

type PublicRow = {
  id: string;
  provider: ProviderId;
  label: string;
  last4: string;
  enabled: boolean;
  created_at: string;
  last_result: LastResult;
  last_used_at: string | null;
};

type SecretRow = PublicRow & { secret: EncryptedSecret };

export type KeyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; status: number };

export type Candidate = { id: string; label: string; apiKey: string };

export type CandidateResult =
  | { ok: true; source: "store" | "env"; candidates: Candidate[] }
  | {
      ok: false;
      code: "no_enabled_key" | "not_configured" | "key_store_error" | "unauthenticated";
      message: string;
    };

export class KeyStoreError extends Error {}

const TABLE = "api_keys";
const PUBLIC_COLUMNS = "id,provider,label,last4,enabled,created_at,last_result,last_used_at";
const ENV_NAMES: Partial<Record<ProviderId, string[]>> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};
const RECENT_FAILURE_MS = 2 * 60 * 1000;
const OWNER_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/* ---------- Guards ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncrypted(value: unknown): value is EncryptedSecret {
  return (
    isRecord(value) &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.data === "string"
  );
}

function isLastResult(value: unknown): value is LastResult {
  return value === null || value === "ok" || value === "rejected" || value === "rate_limited";
}

function isPublicRow(value: unknown): value is PublicRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    PROVIDERS.some((provider) => provider.id === value.provider) &&
    typeof value.label === "string" &&
    typeof value.last4 === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.created_at === "string" &&
    isLastResult(value.last_result) &&
    (value.last_used_at === null || typeof value.last_used_at === "string")
  );
}

function isSecretRow(value: unknown): value is SecretRow {
  return isRecord(value) && isEncrypted(value.secret) && isPublicRow(value);
}

function isOwnerId(value: unknown): value is string {
  return typeof value === "string" && OWNER_ID_PATTERN.test(value);
}

function notSignedIn(): { ok: false; code: string; message: string; status: number } {
  return { ok: false, code: "unauthenticated", message: "Please sign in.", status: 401 };
}

/* ---------- Configuration ---------- */

function getSecret(): string | null {
  const value = (process.env.KEY_ENCRYPTION_SECRET ?? "").trim();
  return value.length >= 32 ? value : null;
}

function getServiceKey(): string | null {
  const value = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    ""
  ).trim();
  return value.length > 0 ? value : null;
}

export function getStorageState(): StorageState {
  const missing: string[] = [];
  if (!getSupabaseEnv()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (!getServiceKey()) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!getSecret()) {
    missing.push("KEY_ENCRYPTION_SECRET (at least 32 characters)");
  }
  if (missing.length > 0) {
    return {
      state: "missing_secret",
      message: `Key storage is not configured. Missing: ${missing.join(", ")}. Add them to .env.local (local) or to Vercel Environment Variables (production), then restart or redeploy.`,
    };
  }
  return {
    state: "ready",
    message:
      "Keys are encrypted on the server and stored in your Supabase database. They are never sent back to the browser.",
  };
}

let cachedClient: SupabaseClient | null = null;

function db(): SupabaseClient {
  const env = getSupabaseEnv();
  const serviceKey = getServiceKey();
  if (!env || !serviceKey) {
    throw new KeyStoreError("Key storage is not configured.");
  }
  if (!cachedClient) {
    cachedClient = createClient(env.url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

/* ---------- Encryption ---------- */

let keyCache: { secret: string; key: Buffer } | null = null;

function getCryptoKey(): Buffer | null {
  const secret = getSecret();
  if (!secret) {
    return null;
  }
  if (keyCache && keyCache.secret === secret) {
    return keyCache.key;
  }
  const key = scryptSync(secret, "metaforge-api-keys-v1", 32);
  keyCache = { secret, key };
  return key;
}

function encrypt(plain: string, aad: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function decrypt(secret: EncryptedSecret, aad: string, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/* ---------- Helpers ---------- */

function toPublic(row: PublicRow): PublicKey {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    masked: "\u2022".repeat(12) + row.last4,
    enabled: row.enabled,
    createdAt: row.created_at,
    lastResult: row.last_result,
    lastUsedAt: row.last_used_at,
  };
}

function notReady(): { ok: false; code: string; message: string; status: number } {
  return { ok: false, code: "storage_unavailable", message: getStorageState().message, status: 503 };
}

async function fetchRows(provider: ProviderId, ownerId: string): Promise<SecretRow[]> {
  const { data, error } = await db()
    .from(TABLE)
    .select(`${PUBLIC_COLUMNS},secret`)
    .eq("owner_id", ownerId)
    .eq("provider", provider);
  const rows: unknown = data;
  if (error || !Array.isArray(rows) || !rows.every(isSecretRow)) {
    throw new KeyStoreError("The saved keys could not be read.");
  }
  return rows;
}

// Role comes from public.profiles, read here on the server. Never from the caller.
async function isAdminUser(ownerId: string): Promise<boolean> {
  try {
    const { data, error } = await db().from("profiles").select("role").eq("id", ownerId).maybeSingle();
    if (error) {
      return false;
    }
    const row: unknown = data;
    return isRecord(row) && row.role === "admin";
  } catch {
    return false;
  }
}

/* ---------- Public operations: all filtered by owner ---------- */

export async function listKeys(ownerId: string): Promise<PublicKey[]> {
  if (!isOwnerId(ownerId)) {
    throw new KeyStoreError("A signed-in user is required.");
  }
  if (getStorageState().state !== "ready") {
    return [];
  }
  const { data, error } = await db()
    .from(TABLE)
    .select(PUBLIC_COLUMNS)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  const rows: unknown = data;
  if (error || !Array.isArray(rows) || !rows.every(isPublicRow)) {
    throw new KeyStoreError("The saved keys could not be read.");
  }
  return rows.map(toPublic);
}

export async function addKey(
  ownerId: string,
  input: { provider: ProviderId; label: string; apiKey: string },
): Promise<KeyResult<PublicKey>> {
  if (!isOwnerId(ownerId)) {
    return notSignedIn();
  }
  if (getStorageState().state !== "ready") {
    return notReady();
  }
  const cryptoKey = getCryptoKey();
  if (!cryptoKey) {
    return notReady();
  }

  // Only this owner's keys are inspected. Another user's keys are never compared.
  const sameProvider = await fetchRows(input.provider, ownerId);

  if (sameProvider.length >= MAX_KEYS_PER_PROVIDER) {
    return {
      ok: false,
      code: "limit_reached",
      status: 409,
      message: `You already have ${MAX_KEYS_PER_PROVIDER} keys for this provider. Remove one first.`,
    };
  }
  if (sameProvider.some((row) => row.label.toLowerCase() === input.label.toLowerCase())) {
    return {
      ok: false,
      code: "duplicate_label",
      status: 409,
      message: "A key with this label already exists for this provider. Choose a different label.",
    };
  }
  for (const existing of sameProvider) {
    if (decrypt(existing.secret, existing.id, cryptoKey) === input.apiKey) {
      return {
        ok: false,
        code: "duplicate_key",
        status: 409,
        message: `This key is already saved as "${existing.label}".`,
      };
    }
  }

  const id = randomUUID();
  const { data, error } = await db()
    .from(TABLE)
    .insert({
      id,
      owner_id: ownerId,
      provider: input.provider,
      label: input.label,
      last4: input.apiKey.slice(-4),
      enabled: true,
      secret: encrypt(input.apiKey, id, cryptoKey),
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        code: "duplicate_label",
        status: 409,
        message: "A key with this label already exists for this provider. Choose a different label.",
      };
    }
    if (error.message.includes("KEY_LIMIT")) {
      return {
        ok: false,
        code: "limit_reached",
        status: 409,
        message: `You already have ${MAX_KEYS_PER_PROVIDER} keys for this provider. Remove one first.`,
      };
    }
    throw new KeyStoreError("The key could not be saved.");
  }

  const row: unknown = data;
  if (!isPublicRow(row)) {
    throw new KeyStoreError("The key was saved but the answer was unexpected.");
  }
  return { ok: true, value: toPublic(row) };
}

export async function setEnabled(
  ownerId: string,
  id: string,
  enabled: boolean,
): Promise<KeyResult<PublicKey>> {
  if (!isOwnerId(ownerId)) {
    return notSignedIn();
  }
  if (getStorageState().state !== "ready") {
    return notReady();
  }
  const { data, error } = await db()
    .from(TABLE)
    .update({ enabled })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select(PUBLIC_COLUMNS)
    .maybeSingle();
  if (error) {
    throw new KeyStoreError("The key could not be updated.");
  }
  const row: unknown = data;
  if (row === null || row === undefined) {
    return { ok: false, code: "not_found", status: 404, message: "That key no longer exists." };
  }
  if (!isPublicRow(row)) {
    throw new KeyStoreError("The update answer was unexpected.");
  }
  return { ok: true, value: toPublic(row) };
}

export async function removeKey(ownerId: string, id: string): Promise<KeyResult<true>> {
  if (!isOwnerId(ownerId)) {
    return notSignedIn();
  }
  if (getStorageState().state !== "ready") {
    return notReady();
  }
  const { data, error } = await db()
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id");
  if (error) {
    throw new KeyStoreError("The key could not be removed.");
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, code: "not_found", status: 404, message: "That key no longer exists." };
  }
  return { ok: true, value: true };
}

/** Records what really happened the last time one of this owner's keys was used. */
export async function recordKeyResult(
  ownerId: string,
  id: string,
  result: Exclude<LastResult, null>,
): Promise<void> {
  if (!id || !isOwnerId(ownerId) || getStorageState().state !== "ready") {
    return;
  }
  try {
    const { error } = await db()
      .from(TABLE)
      .update({ last_result: result, last_used_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", ownerId);
    if (error) {
      console.error("[key-store] could not record the result of a key");
    }
  } catch {
    console.error("[key-store] could not record the result of a key");
  }
}

/* ---------- Choosing keys for an AI request ---------- */

function failureRank(row: SecretRow): number {
  if (row.last_result === "rejected") {
    return 2;
  }
  if (
    row.last_result === "rate_limited" &&
    row.last_used_at !== null &&
    Date.now() - Date.parse(row.last_used_at) < RECENT_FAILURE_MS
  ) {
    return 1;
  }
  return 0;
}

function readEnvCandidates(provider: ProviderId): Candidate[] {
  for (const name of ENV_NAMES[provider] ?? []) {
    const value = (process.env[name] ?? "").trim();
    if (value) {
      return [{ id: "", label: `${name} (environment)`, apiKey: value }];
    }
  }
  return [];
}

/**
 * Keys this owner may use for this provider, in the order to try them.
 * - Saved keys of THIS owner only. Enabled ones are used. If all are disabled, nothing is used.
 * - With no saved key for the provider, the environment key is used only when the
 *   server confirms the owner is an admin. Ordinary users never get a shared key.
 */
export async function getCandidates(provider: ProviderId, ownerId: string): Promise<CandidateResult> {
  if (!isOwnerId(ownerId)) {
    return { ok: false, code: "unauthenticated", message: "Please sign in to use AI tools." };
  }

  const providerName = PROVIDERS.find((entry) => entry.id === provider)?.name ?? provider;

  if (getStorageState().state === "ready") {
    let stored: SecretRow[];
    try {
      stored = await fetchRows(provider, ownerId);
    } catch {
      return {
        ok: false,
        code: "key_store_error",
        message:
          "The saved keys could not be read. Check that the api_keys SQL was run and that SUPABASE_SERVICE_ROLE_KEY is correct.",
      };
    }

    if (stored.length > 0) {
      const enabled = stored.filter((row) => row.enabled);
      if (enabled.length === 0) {
        return {
          ok: false,
          code: "no_enabled_key",
          message: `All your saved ${providerName} keys are disabled. Enable one in the API Key Manager.`,
        };
      }

      const cryptoKey = getCryptoKey();
      if (!cryptoKey) {
        return {
          ok: false,
          code: "key_store_error",
          message: "KEY_ENCRYPTION_SECRET is missing on the server.",
        };
      }

      const ordered = [...enabled].sort((a, b) => {
        const rank = failureRank(a) - failureRank(b);
        return rank !== 0 ? rank : Date.parse(a.created_at) - Date.parse(b.created_at);
      });

      const candidates: Candidate[] = [];
      for (const row of ordered) {
        const apiKey = decrypt(row.secret, row.id, cryptoKey);
        if (apiKey) {
          candidates.push({ id: row.id, label: row.label, apiKey });
        }
      }

      if (candidates.length === 0) {
        return {
          ok: false,
          code: "key_store_error",
          message:
            "The saved keys could not be decrypted. KEY_ENCRYPTION_SECRET may have changed. Remove the keys and add them again.",
        };
      }
      return { ok: true, source: "store", candidates };
    }
  }

  if ((ENV_NAMES[provider] ?? []).length > 0 && (await isAdminUser(ownerId))) {
    const fromEnv = readEnvCandidates(provider);
    if (fromEnv.length > 0) {
      return { ok: true, source: "env", candidates: fromEnv };
    }
  }

  return {
    ok: false,
    code: "not_configured",
    message: `No ${providerName} API key is available. Add your own key in the API Key Manager.`,
  };
}