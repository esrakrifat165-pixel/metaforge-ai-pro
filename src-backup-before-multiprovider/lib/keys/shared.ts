import type { ProviderId } from "../providers/catalog";

// Types and validation shared by the browser and the server.
// This file must never contain secrets or server-only code.

export type LastResult = "ok" | "rejected" | "rate_limited" | null;

/** What the browser is allowed to see about a saved key. The secret is never included. */
export type PublicKey = {
  id: string;
  provider: ProviderId;
  label: string;
  masked: string;
  enabled: boolean;
  createdAt: string;
  lastResult: LastResult;
  lastUsedAt: string | null;
};

export type StorageState = {
  state: "ready" | "missing_secret" | "unavailable" | "error";
  message: string;
};

export const LABEL_MAX = 40;
export const API_KEY_MIN = 16;
export const API_KEY_MAX = 512;

const LABEL_PATTERN = /^[A-Za-z0-9 _.()-]+$/;
const API_KEY_PATTERN = /^[\x21-\x7E]+$/;

export function validateLabel(raw: string): string | null {
  const label = raw.trim();
  if (!label) {
    return "Enter a label, for example Gemini Primary.";
  }
  if (label.length > LABEL_MAX) {
    return `The label can have at most ${LABEL_MAX} characters.`;
  }
  if (!LABEL_PATTERN.test(label)) {
    return "The label can only use letters, numbers, spaces and - _ . ( ).";
  }
  return null;
}

export function validateApiKey(raw: string): string | null {
  const key = raw.trim();
  if (!key) {
    return "Paste the API key.";
  }
  if (key.length < API_KEY_MIN) {
    return `That key looks too short. API keys have at least ${API_KEY_MIN} characters.`;
  }
  if (key.length > API_KEY_MAX) {
    return `That key looks too long. The limit is ${API_KEY_MAX} characters.`;
  }
  if (!API_KEY_PATTERN.test(key)) {
    return "The key must not contain spaces or special characters. Paste only the key itself.";
  }
  return null;
}