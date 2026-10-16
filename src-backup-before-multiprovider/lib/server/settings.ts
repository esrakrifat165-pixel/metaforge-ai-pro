import {
  DEFAULT_SETTINGS,
  parseSettings,
  type RuntimeSettings,
} from "../settings/runtime";
import { getSupabaseEnv } from "../supabase/env";
import { createClient } from "../supabase/server";

// SERVER ONLY. If settings cannot be read, the app keeps running with defaults.

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  if (!getSupabaseEnv()) {
    return DEFAULT_SETTINGS;
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "runtime")
      .maybeSingle();
    if (error || !data) {
      return DEFAULT_SETTINGS;
    }
    return parseSettings(data.value);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Returns an error message, or null on success. The database policy only lets admins write. */
export async function saveRuntimeSettings(
  settings: RuntimeSettings,
  userId: string,
): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("app_settings").upsert({
      key: "runtime",
      value: settings,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    return error
      ? "The settings could not be saved. Check that the app_settings SQL was run and you are an admin."
      : null;
  } catch {
    return "The settings could not be saved.";
  }
}