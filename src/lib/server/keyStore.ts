import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_KEYS_PER_PROVIDER, PROVIDERS, type ProviderId } from "../providers/catalog";
import type { LastResult, PublicKey, StorageState } from "../keys/shared";

// SERVER ONLY. Never import this file from a client component.
//
// LOCAL DEVELOPMENT KEY STORE
// Keys are encrypted with AES-256-GCM and saved in .data/api-keys.json.
// The encryption key is derived from KEY_ENCRYPTION_SECRET in .env.local.
// There is no sign-in yet, so this is for one person on one computer only.
// It is switched off in production builds unless ALLOW_LOCAL_KEY_STORE=true.

type EncryptedSecret = { iv: string; tag: string; data: string };

type StoredKey = {
  id: string;
  provider: ProviderId;
  label: string;
  last4: string;
  enabled: boolean;
  createdAt: string;
  lastResult: LastResult;
  lastUsedAt: string | null;
  secret: EncryptedSecret;
};

type Store = { version: 1; salt: string; keys: StoredKey[] };

export type KeyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; status: number };

export type Candidate = { id: string; label: string; apiKey: string };

export type CandidateResult =
  | { ok: true; source: "store" | "env"; candidates: Candidate[] }
  | { ok: false; code: "no_enabled_key" | "not_configured" | "key_store_error"; message: string };

export class KeyStoreError extends Error {}

const STORE_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(STORE_DIR, "api-keys.json");
const ENV_NAMES: Partial<Record<ProviderId, string[]>> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};
const RECENT_FAILURE_MS = 2 * 60 * 1000;

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

function isStoredKey(value: unknown): value is StoredKey {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    PROVIDERS.some((provider) => provider.id === value.provider) &&
    typeof value.label === "string" &&
    typeof value.last4 === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.createdAt === "string" &&
    (value.lastUsedAt === null || typeof value.lastUsedAt === "string") &&
    (value.lastResult === null ||
      value.lastResult === "ok" ||
      value.lastResult === "rejected" ||
      value.lastResult === "rate_limited") &&
    isEncrypted(value.secret)
  );
}

function isStore(value: unknown): value is Store {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.salt === "string" &&
    Array.isArray(value.keys) &&
    value.keys.every(isStoredKey)
  );
}

/* ---------- Storage state ---------- */

function getSecret(): string | null {
  const value = (process.env.KEY_ENCRYPTION_SECRET ?? "").trim();
  return value.length >= 32 ? value : null;
}

export function getStorageState(): StorageState {
  const isHosted = Boolean(process.env.VERCEL);
  const isProduction = process.env.NODE_ENV === "production";
  if (isHosted || (isProduction && process.env.ALLOW_LOCAL_KEY_STORE !== "true")) {
    return {
      state: "unavailable",
      message:
        "Local encrypted key storage is only enabled while developing on your own computer (npm run dev). Hosted storage arrives with sign-in and a database in a later phase.",
    };
  }
  if (!getSecret()) {
    return {
      state: "missing_secret",
      message:
        "KEY_ENCRYPTION_SECRET is not set. Add a random value of at least 32 characters to .env.local, then restart the dev server.",
    };
  }
  return {
    state: "ready",
    message:
      "Local encrypted storage is active. Keys are encrypted on this computer and are never sent back to the browser.",
  };
}

/* ---------- Encryption ---------- */

let keyCache: { secret: string; salt: string; key: Buffer } | null = null;

function getCryptoKey(salt: string): Buffer | null {
  const secret = getSecret();
  if (!secret) {
    return null;
  }
  if (keyCache && keyCache.secret === secret && keyCache.salt === salt) {
    return keyCache.key;
  }
  const key = scryptSync(secret, Buffer.from(salt, "base64"), 32);
  keyCache = { secret, salt, key };
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

/* ---------- File access ---------- */

async function readStore(): Promise<Store | null> {
  let text: string;
  try {
    text = await fs.readFile(STORE_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new KeyStoreError("The key file could not be read.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new KeyStoreError("The key file is damaged.");
  }
  if (!isStore(parsed)) {
    throw new KeyStoreError("The key file has an unexpected format.");
  }
  return parsed;
}

async function writeStore(store: Store): Promise<void> {
  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
    const temp = `${STORE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, STORE_FILE);
  } catch {
    throw new KeyStoreError("The key file could not be written.");
  }
}

function newStore(): Store {
  return { version: 1, salt: randomBytes(16).toString("base64"), keys: [] };
}

// One change at a time, even if several requests arrive together.
type LockHolder = typeof globalThis & { __metaforgeKeyLock?: Promise<unknown> };

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const holder = globalThis as LockHolder;
  const previous = holder.__metaforgeKeyLock ?? Promise.resolve();
  const run = previous.then(task, task);
  holder.__metaforgeKeyLock = run.catch(() => undefined);
  return run;
}

function toPublic(key: StoredKey): PublicKey {
  return {
    id: key.id,
    provider: key.provider,
    label: key.label,
    masked: "\u2022".repeat(12) + key.last4,
    enabled: key.enabled,
    createdAt: key.createdAt,
    lastResult: key.lastResult,
    lastUsedAt: key.lastUsedAt,
  };
}

function notReady(): { ok: false; code: string; message: string; status: number } {
  return {
    ok: false,
    code: "storage_unavailable",
    message: getStorageState().message,
    status: 503,
  };
}

/* ---------- Public operations ---------- */

export async function listKeys(): Promise<PublicKey[]> {
  if (getStorageState().state !== "ready") {
    return [];
  }
  const store = await readStore();
  return (store?.keys ?? []).map(toPublic);
}

export async function addKey(input: {
  provider: ProviderId;
  label: string;
  apiKey: string;
}): Promise<KeyResult<PublicKey>> {
  if (getStorageState().state !== "ready") {
    return notReady();
  }

  return withLock(async (): Promise<KeyResult<PublicKey>> => {
    const store = (await readStore()) ?? newStore();
    const cryptoKey = getCryptoKey(store.salt);
    if (!cryptoKey) {
      return notReady();
    }

    const sameProvider = store.keys.filter((key) => key.provider === input.provider);

    if (sameProvider.length >= MAX_KEYS_PER_PROVIDER) {
      return {
        ok: false,
        code: "limit_reached",
        status: 409,
        message: `You already have ${MAX_KEYS_PER_PROVIDER} keys for this provider. Remove one first.`,
      };
    }

    if (sameProvider.some((key) => key.label.toLowerCase() === input.label.toLowerCase())) {
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
    const stored: StoredKey = {
      id,
      provider: input.provider,
      label: input.label,
      last4: input.apiKey.slice(-4),
      enabled: true,
      createdAt: new Date().toISOString(),
      lastResult: null,
      lastUsedAt: null,
      secret: encrypt(input.apiKey, id, cryptoKey),
    };

    store.keys.push(stored);
    await writeStore(store);
    return { ok: true, value: toPublic(stored) };
  });
}

export async function setEnabled(id: string, enabled: boolean): Promise<KeyResult<PublicKey>> {
  if (getStorageState().state !== "ready") {
    return notReady();
  }

  return withLock(async (): Promise<KeyResult<PublicKey>> => {
    const store = await readStore();
    const entry = store?.keys.find((key) => key.id === id);
    if (!store || !entry) {
      return { ok: false, code: "not_found", status: 404, message: "That key no longer exists." };
    }
    entry.enabled = enabled;
    await writeStore(store);
    return { ok: true, value: toPublic(entry) };
  });
}

export async function removeKey(id: string): Promise<KeyResult<true>> {
  if (getStorageState().state !== "ready") {
    return notReady();
  }

  return withLock(async (): Promise<KeyResult<true>> => {
    const store = await readStore();
    if (!store || !store.keys.some((key) => key.id === id)) {
      return { ok: false, code: "not_found", status: 404, message: "That key no longer exists." };
    }
    store.keys = store.keys.filter((key) => key.id !== id);
    await writeStore(store);
    return { ok: true, value: true };
  });
}

/** Records what really happened the last time a stored key was used. */
export async function recordKeyResult(
  id: string,
  result: Exclude<LastResult, null>,
): Promise<void> {
  if (!id || getStorageState().state !== "ready") {
    return;
  }
  try {
    await withLock(async () => {
      const store = await readStore();
      const entry = store?.keys.find((key) => key.id === id);
      if (!store || !entry) {
        return;
      }
      entry.lastResult = result;
      entry.lastUsedAt = new Date().toISOString();
      await writeStore(store);
    });
  } catch {
    console.error("[key-store] could not record the result of a key");
  }
}

/* ---------- Choosing keys for an AI request ---------- */

function failureRank(key: StoredKey): number {
  if (key.lastResult === "rejected") {
    return 2;
  }
  if (
    key.lastResult === "rate_limited" &&
    key.lastUsedAt !== null &&
    Date.now() - Date.parse(key.lastUsedAt) < RECENT_FAILURE_MS
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
 * Keys the server may use for this provider, in the order to try them.
 * - If any keys are saved for the provider, only ENABLED saved keys are used.
 *   If all are disabled, nothing is used (the .env.local key is NOT a back door).
 * - If none are saved, the key from .env.local is used when it exists.
 */
export async function getCandidates(provider: ProviderId): Promise<CandidateResult> {
  const providerName = PROVIDERS.find((entry) => entry.id === provider)?.name ?? provider;

  if (getStorageState().state === "ready") {
    let store: Store | null;
    try {
      store = await readStore();
    } catch {
      return {
        ok: false,
        code: "key_store_error",
        message: "The saved key file could not be read. Check the .data folder.",
      };
    }

    const stored = (store?.keys ?? []).filter((key) => key.provider === provider);
    if (store && stored.length > 0) {
      const enabled = stored.filter((key) => key.enabled);
      if (enabled.length === 0) {
        return {
          ok: false,
          code: "no_enabled_key",
          message: `All saved ${providerName} keys are disabled. Enable one in the API Key Manager.`,
        };
      }

      const cryptoKey = getCryptoKey(store.salt);
      if (!cryptoKey) {
        return {
          ok: false,
          code: "key_store_error",
          message: "The key encryption secret is missing. Check KEY_ENCRYPTION_SECRET in .env.local.",
        };
      }

      const ordered = [...enabled].sort((a, b) => {
        const rank = failureRank(a) - failureRank(b);
        return rank !== 0 ? rank : Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });

      const candidates: Candidate[] = [];
      for (const key of ordered) {
        const apiKey = decrypt(key.secret, key.id, cryptoKey);
        if (apiKey) {
          candidates.push({ id: key.id, label: key.label, apiKey });
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

  const fromEnv = readEnvCandidates(provider);
  if (fromEnv.length > 0) {
    return { ok: true, source: "env", candidates: fromEnv };
  }

  return {
    ok: false,
    code: "not_configured",
    message: `No ${providerName} API key is available. Add one in the API Key Manager, or set it in .env.local and restart the dev server.`,
  };
}