import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

// For use in client components only.
export function createClient() {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error("Supabase is not configured.");
  }
  return createBrowserClient(env.url, env.publishableKey);
}