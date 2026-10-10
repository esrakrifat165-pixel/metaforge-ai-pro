// Reads the public Supabase settings. These two values are safe for browsers by design.
// NEVER put a Supabase secret key (or service-role key) in a NEXT_PUBLIC_ variable.

export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const publishableKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();

  if (!/^https?:\/\//.test(url) || publishableKey.length === 0) {
    return null;
  }
  return { url, publishableKey };
}