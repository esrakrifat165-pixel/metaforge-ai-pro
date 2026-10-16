
import { createClient } from "../supabase/server";
import { getSupabaseEnv } from "../supabase/env";
import { cleanFileName } from "./requestUtils";

// SERVER ONLY. History is read and written with the signed-in person's own session,
// so Supabase Row Level Security applies. Every query also filters by user_id.

export type HistoryKind = "metadata" | "prompt";

export type HistoryEntry = {
  id: string;
  kind: HistoryKind;
  fileName: string;
  provider: string;
  model: string;
  platform: string | null;
  result: Record<string, unknown>;
  createdAt: string;
};

export class HistoryError extends Error {}

export const HISTORY_PAGE_SIZE = 20;
const COLUMNS = "id,kind,file_name,provider,model,platform,result,created_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEntry(value: unknown): HistoryEntry | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.kind !== "metadata" && value.kind !== "prompt") ||
    typeof value.file_name !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.model !== "string" ||
    (value.platform !== null && typeof value.platform !== "string") ||
    !isRecord(value.result) ||
    typeof value.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    fileName: value.file_name,
    provider: value.provider,
    model: value.model,
    platform: value.platform,
    result: value.result,
    createdAt: value.created_at,
  };
}

/** Who is signed in. configured=false means sign-in is not set up (local development). */
export async function getCurrentUser(): Promise<{ configured: boolean; userId: string | null }> {
  if (!getSupabaseEnv()) {
    return { configured: false, userId: null };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { configured: true, userId: user?.id ?? null };
  } catch {
    return { configured: true, userId: null };
  }
}

export async function saveHistory(
  userId: string,
  entry: {
    kind: HistoryKind;
    fileName: string;
    provider: string;
    model: string;
    platform: string | null;
    result: Record<string, unknown>;
  },
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("history").insert({
      user_id: userId,
      kind: entry.kind,
      file_name: cleanFileName(entry.fileName),
      provider: entry.provider,
      model: entry.model,
      platform: entry.platform,
      result: entry.result,
    });
    if (error) {
      console.error("[history] could not save an entry");
      return false;
    }
    return true;
  } catch {
    console.error("[history] could not save an entry");
    return false;
  }
}

export async function listHistory(
  userId: string,
  options: { kind: HistoryKind | null; page: number },
): Promise<{ entries: HistoryEntry[]; total: number }> {
  const from = (options.page - 1) * HISTORY_PAGE_SIZE;
  const to = from + HISTORY_PAGE_SIZE - 1;

  try {
    const supabase = await createClient();
    let query = supabase
      .from("history")
      .select(COLUMNS, { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (options.kind) {
      query = query.eq("kind", options.kind);
    }

    const { data, error, count } = await query;
    const rows: unknown = data;
    if (error || !Array.isArray(rows)) {
      throw new HistoryError("History could not be read.");
    }

    const entries: HistoryEntry[] = [];
    for (const row of rows) {
      const entry = toEntry(row);
      if (entry) {
        entries.push(entry);
      }
    }
    return { entries, total: count ?? entries.length };
  } catch (error) {
    if (error instanceof HistoryError) {
      throw error;
    }
    throw new HistoryError("History could not be read.");
  }
}

export async function deleteHistory(userId: string, id: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("history")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) {
      throw new HistoryError("The entry could not be deleted.");
    }
    const rows: unknown = data;
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    if (error instanceof HistoryError) {
      throw error;
    }
    throw new HistoryError("The entry could not be deleted.");
  }
}