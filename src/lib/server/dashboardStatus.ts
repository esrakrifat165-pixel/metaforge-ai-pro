import { getAccess } from "../auth/session";
import { getSupabaseEnv } from "../supabase/env";
import { createClient } from "../supabase/server";
import { getCandidates } from "./keyStore";

// SERVER ONLY. Real Dashboard status for the signed-in user. Nothing here returns a key,
// a secret, an environment value or another user's information. Every check runs with the
// server-verified user id (getAccess), never an id from the browser.

export type StatusTone = "ok" | "warn" | "off";

export type DashboardStatusItem = {
  id: "providers" | "signin" | "history";
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
};

type SignInOutcome = { item: DashboardStatusItem; userId: string | null };

async function signInStatus(): Promise<SignInOutcome> {
  const base = { id: "signin" as const, label: "Sign-in" };

  if (!getSupabaseEnv()) {
    return {
      item: {
        ...base,
        value: "Not configured",
        detail: "The Supabase sign-in settings are missing on the server.",
        tone: "off",
      },
      userId: null,
    };
  }

  const access = await getAccess();
  if (!access.ok) {
    return {
      item: { ...base, value: "Unable to verify", detail: access.message, tone: "warn" },
      userId: null,
    };
  }

  return {
    item: {
      ...base,
      value: "Active",
      detail: "Your session is verified by Supabase on the server.",
      tone: "ok",
    },
    userId: access.userId,
  };
}

async function providerStatus(userId: string | null): Promise<DashboardStatusItem> {
  const base = { id: "providers" as const, label: "AI providers" };

  if (!userId) {
    return {
      ...base,
      value: "Unable to verify",
      detail: "Your keys can only be checked while you are signed in.",
      tone: "warn",
    };
  }

  try {
    const result = await getCandidates("gemini", userId);
    if (result.ok) {
      return {
        ...base,
        value: "Gemini available",
        detail:
          result.source === "store"
            ? "One of your saved Gemini keys is enabled."
            : "The shared environment key is available to your account.",
        tone: "ok",
      };
    }
    if (result.code === "key_store_error") {
      return {
        ...base,
        value: "Unable to verify",
        detail: "Your saved keys could not be read.",
        tone: "warn",
      };
    }
    return {
      ...base,
      value: "No Gemini key",
      detail: "Add or enable a Gemini key in the API Key Manager.",
      tone: "off",
    };
  } catch {
    return {
      ...base,
      value: "Unable to verify",
      detail: "Your saved keys could not be checked.",
      tone: "warn",
    };
  }
}

async function historyStatus(userId: string | null): Promise<DashboardStatusItem> {
  const base = { id: "history" as const, label: "Database and history" };

  if (!userId) {
    return {
      ...base,
      value: "Unable to verify",
      detail: "History can only be checked while you are signed in.",
      tone: "warn",
    };
  }

  try {
    // Same table and column the History page uses (public.history, user_id), read with the
    // user's own session so row-level security applies. Count only, no rows are returned.
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      return {
        ...base,
        value: "Unable to verify",
        detail: "The history table could not be read. Check that the history SQL was run in Supabase.",
        tone: "warn",
      };
    }
    return {
      ...base,
      value: "Connected",
      detail:
        count === null
          ? "The history table is readable."
          : `${count} saved result${count === 1 ? "" : "s"} in your history.`,
      tone: "ok",
    };
  } catch {
    return {
      ...base,
      value: "Unable to verify",
      detail: "The database could not be reached.",
      tone: "warn",
    };
  }
}

export async function getDashboardStatus(): Promise<DashboardStatusItem[]> {
  const signIn = await signInStatus();
  const [providers, history] = await Promise.all([
    providerStatus(signIn.userId),
    historyStatus(signIn.userId),
  ]);
  return [providers, signIn.item, history];
}