import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "../../../components/EmptyState";
import { getAllowedEmails } from "../../../lib/auth/guards";
import { getAccess } from "../../../lib/auth/session";
import type { PublicKey } from "../../../lib/keys/shared";
import { MAX_KEYS_PER_PROVIDER, PROVIDERS } from "../../../lib/providers/catalog";
import { getCandidates, getStorageState, listKeys } from "../../../lib/server/keyStore";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin",
};

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
      keys = await listKeys();
    } catch {
      keysError =
        "The saved keys could not be read. Check that the api_keys SQL was run and that SUPABASE_SERVICE_ROLE_KEY is correct.";
    }
  }

  // Only the yes/no result and its source are used. No key value is ever shown.
  const gemini = await getCandidates("gemini");
  const geminiText = gemini.ok
    ? gemini.source === "store"
      ? "Available (saved key)"
      : "Available (environment key)"
    : gemini.message;

  const keyCountsKnown = storage.state === "ready" && keysError === null;

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Administration</span>
        <h1>Admin Control Panel</h1>
        <p>
          Real status only. If something is not measured yet, it says so instead of showing a
          made-up number.
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
            Setup status
          </h2>
        </div>
        <div className="status-grid">
          <div className="card status-card">
            <span className="status-label">Allowed accounts</span>
            <span className="ad-value">{getAllowedEmails().length}</span>
            <span className="status-detail">Emails in ALLOWED_EMAILS who may sign in.</span>
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

      <section aria-labelledby="ad-providers-heading">
        <div className="section-head">
          <h2 id="ad-providers-heading" className="section-title">
            AI provider keys
          </h2>
          <Link href="/settings/api-keys" className="button">
            Open API Key Manager
          </Link>
        </div>
        <div className="card ad-scroll">
          <table className="ad-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Saved keys</th>
                <th scope="col">Enabled</th>
                <th scope="col">Used by tools</th>
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
                    <td>{provider.id === "gemini" ? "Metadata Generator" : "Not connected yet"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="section-note">
          Counts come from the saved keys. A saved key is not proof that it works. The key manager
          shows what the last real request did.
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
          title="No data yet"
          description="Job history is not recorded yet, so there are no job counts, errors or usage figures to show."
        />
      </section>
    </div>
  );
}