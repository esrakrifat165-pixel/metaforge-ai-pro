import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "../../../components/EmptyState";
import { getAccess } from "../../../lib/auth/session";
import type { PublicKey } from "../../../lib/keys/shared";
import { MAX_KEYS_PER_PROVIDER, PROVIDERS } from "../../../lib/providers/catalog";
import { getCandidates, getStorageState, listKeys } from "../../../lib/server/keyStore";
import { getLoginStats } from "../../../lib/server/loginStats";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin",
};

// Local helper. Not exported, so the page only has valid Next.js page exports.
function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const text = date.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${text} UTC`;
}

export default async function AdminPage() {
  const access = await getAccess();

  if (!access.ok) {
    if (access.status === 401 || access.code === "not_allowed") {
      redirect("/login");
    }
    return (
      <div className="page">
        <EmptyState
          icon="admin"
          title="Admin panel unavailable"
          description={`${access.message} The admin panel needs sign-in and the profiles table to check who is an administrator.`}
          action={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }

  if (access.role !== "admin") {
    return (
      <div className="page">
        <EmptyState
          icon="admin"
          title="Admins only"
          description="Your account does not have the admin role. Only an administrator can open this page."
          action={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }

  const storage = getStorageState();
  let keys: PublicKey[] = [];
  let keysError: string | null = null;

  if (storage.state === "ready") {
    try {
      // Only the signed-in admin's OWN keys. The id comes from the verified session.
      keys = await listKeys(access.userId);
    } catch {
      keysError =
        "The saved keys could not be read. Check that the api_keys SQL was run and that SUPABASE_SERVICE_ROLE_KEY is correct.";
    }
  }

  // Only the yes/no result and its source are used. No key value is ever shown.
  const gemini = await getCandidates("gemini", access.userId);
  const geminiText = gemini.ok
    ? gemini.source === "store"
      ? "Available (saved key)"
      : "Available (environment key)"
    : gemini.message;

  const keyCountsKnown = storage.state === "ready" && keysError === null;

  // Real sign-in records from Supabase Auth. Admin-only, read on the server.
  const loginStats = await getLoginStats();
  const loginCount = loginStats.ok ? String(loginStats.count) : "Unknown";
  const latestLogin = !loginStats.ok
    ? "Unknown"
    : loginStats.lastLoginAt
      ? formatUtc(loginStats.lastLoginAt)
      : "None recorded";
  const loginDetail = !loginStats.ok
    ? loginStats.message
    : loginStats.count === 0
      ? "No successful sign-ins are recorded yet."
      : "Distinct accounts, counted by account rather than by sign-in.";

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Administration</span>
        <h1>Admin Control Panel</h1>
        <p>
          Sign-in activity, key storage and AI provider setup. Every figure comes from live server
          data. Anything that is not measured is shown as unknown or empty, never estimated.
        </p>
      </header>

      <section aria-labelledby="ad-session-heading">
        <div className="section-head">
          <h2 id="ad-session-heading" className="section-title">
            Your session
          </h2>
        </div>
        <div className="status-grid">
          <div className="card status-card">
            <span className="status-label">Signed in as</span>
            <span className="ad-value">{access.email}</span>
            <span className="status-detail">Confirmed by Supabase on the server.</span>
          </div>
          <div className="card status-card">
            <span className="status-label">Role</span>
            <span className="status-pill ad-ok">
              <span className="status-dot" aria-hidden="true" />
              Administrator
            </span>
            <span className="status-detail">Read from the profiles table. Browsers cannot change it.</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="ad-setup-heading">
        <div className="section-head">
          <h2 id="ad-setup-heading" className="section-title">
            Overview
          </h2>
        </div>
        <div className="status-grid">
          <div className="card status-card">
            <span className="status-label">Accounts with recorded login activity</span>
            <span className="ad-value">{loginCount}</span>
            <span className="status-detail">{loginDetail}</span>
          </div>
          <div className="card status-card">
            <span className="status-label">Most recent sign-in</span>
            <span className="ad-value">{latestLogin}</span>
            <span className="status-detail">
              Latest time across all counted accounts. Supabase keeps no login history.
            </span>
          </div>
          <div className="card status-card">
            <span className="status-label">Key storage</span>
            <span className={`status-pill ${storage.state === "ready" ? "ad-ok" : ""}`}>
              <span className="status-dot" aria-hidden="true" />
              {storage.state === "ready" ? "Ready" : "Not ready"}
            </span>
            <span className="status-detail">{keysError ?? storage.message}</span>
          </div>
          <div className="card status-card">
            <span className="status-label">Gemini key for generation</span>
            <span className={`status-pill ${gemini.ok ? "ad-ok" : ""}`}>
              <span className="status-dot" aria-hidden="true" />
              {gemini.ok ? "Available" : "Not available"}
            </span>
            <span className="status-detail">{geminiText}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="ad-logins-heading">
        <div className="section-head">
          <h2 id="ad-logins-heading" className="section-title">
            Accounts with recorded sign-ins
          </h2>
        </div>
        {loginStats.ok && loginStats.accounts.length > 0 ? (
          <div
            className="card ad-scroll"
            role="region"
            aria-label="Accounts with recorded sign-ins"
            tabIndex={0}
          >
            <table className="ad-table" aria-label="Accounts with recorded sign-ins">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {loginStats.accounts.map((account) => (
                  <tr key={account.email}>
                    <th scope="row">{account.email}</th>
                    <td>{formatUtc(account.lastSignInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="admin"
            title={loginStats.ok ? "No login activity recorded" : "Login statistics unavailable"}
            description={
              loginStats.ok
                ? "No account has a recorded successful sign-in yet."
                : loginStats.message
            }
          />
        )}
        <p className="section-note">
          Counted once per account, not per sign-in. Each account shows only its latest sign-in,
          because Supabase does not keep a login history. Only accounts with a confirmed email that
          the app grants access to are counted.
          {loginStats.ok && loginStats.truncated ? " Only the first 5,000 accounts were read." : ""}
        </p>
      </section>

      <section aria-labelledby="ad-providers-heading">
        <div className="section-head">
          <h2 id="ad-providers-heading" className="section-title">
            AI provider keys
          </h2>
          <Link href="/settings/api-keys" className="button">
            Open API Key Manager
          </Link>
        </div>
        <div
          className="card ad-scroll"
          role="region"
          aria-label="AI provider keys"
          tabIndex={0}
        >
          <table className="ad-table" aria-label="AI provider keys">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Saved keys</th>
                <th scope="col">Enabled</th>
                <th scope="col">Integration</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((provider) => {
                const mine = keys.filter((key) => key.provider === provider.id);
                return (
                  <tr key={provider.id}>
                    <th scope="row">{provider.name}</th>
                    <td>
                      {keyCountsKnown ? `${mine.length} / ${MAX_KEYS_PER_PROVIDER}` : "Unknown"}
                    </td>
                    <td>
                      {keyCountsKnown ? mine.filter((key) => key.enabled).length : "Unknown"}
                    </td>
                    <td>
                      {provider.id === "gemini"
                        ? "Integrated: Metadata Generator, Image to Prompt, Adobe Keywords"
                        : "Not integrated yet"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="section-note">
          Counts are for the keys saved under your own account only. Each user has their own keys.
          A saved key is not proof that the provider works or is connected. The key manager shows
          what the last real request did.
        </p>
      </section>

      <section aria-labelledby="ad-data-heading">
        <div className="section-head">
          <h2 id="ad-data-heading" className="section-title">
            Jobs and usage
          </h2>
        </div>
        <EmptyState
          icon="history"
          title="Usage tracking is not set up"
          description="Requests, errors and quotas are not recorded, so there is nothing to show here. Saved results in History belong to each user and can be deleted, so they are not used as a usage measure."
        />
      </section>
    </div>
  );
}