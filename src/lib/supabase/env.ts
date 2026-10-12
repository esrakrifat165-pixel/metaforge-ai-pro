
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

  if (!/^https?:\/\/.+/.test(url) || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}
