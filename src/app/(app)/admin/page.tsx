import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { getAccess } from "../../../lib/auth/session";
import { getAdminOverview } from "../../../lib/server/adminData";
import { getCandidates, getStorageState } from "../../../lib/server/keyStore";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin",
};

function fmtDate(value: string | null): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? "-" : new Date(time).toISOString().slice(0, 10);
}

function fmtTime(value: string | null): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? "Never" : `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function count(value: number | null): string {
  return value === null ? "Unavailable" : String(value);
}

async function AdminContent() {
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

  const [overview, gemini] = await Promise.all([
    getAdminOverview(),
    getCandidates(access.userId, "gemini"),
  ]);
  const storage = getStorageState();
  const geminiText = gemini.ok
    ? gemini.source === "store"
      ? "Available (your saved key)"
      : "Available (environment key, admin only)"
    : gemini.message;

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Administration</span>
        <h1>Admin Control Panel</h1>
        <p>
          Real status only. If something is not measured, it says so instead of showing a made-up
          number.
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
            <span className="ad-value">{access.fullName ?? access.email}</span>
            <span className="status-detail">{access.email}. Confirmed by Supabase on the server.</span>
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

      {!overview.ok ? (
        <section aria-labelledby="ad-error-heading">
          <div className="section-head">
            <h2 id="ad-error-heading" className="section-title">
              Account and usage figures
            </h2>
          </div>
          <EmptyState icon="admin" title="Figures unavailable" description={overview.message} />
        </section>
      ) : (
        <>
          <section aria-labelledby="ad-accounts-heading">
            <div className="section-head">
              <h2 id="ad-accounts-heading" className="section-title">
                Accounts
              </h2>
            </div>
            <div className="status-grid">
              <div className="card status-card">
                <span className="status-label">Total accounts</span>
                <span className="ad-value">{overview.data.totalUsers}</span>
                <span className="status-detail">Google accounts registered in Supabase Auth.</span>
              </div>
              <div className="card status-card">
                <span className="status-label">Administrators</span>
                <span className="ad-value">{overview.data.admins}</span>
                <span className="status-detail">Accounts with the admin role.</span>
              </div>
              <div className="card status-card">
                <span className="status-label">New in the last 7 days</span>
                <span className="ad-value">{overview.data.newLast7Days}</span>
                <span className="status-detail">Counted from account creation dates.</span>
              </div>
              <div className="card status-card">
                <span className="status-label">Signed in during the last 7 days</span>
                <span className="ad-value">{overview.data.signedInLast7Days}</span>
                <span className="status-detail">Counted from last sign-in times.</span>
              </div>
            </div>
            {overview.data.truncated ? (
              <p className="section-note">
                Figures cover the first {overview.data.users.length} of {overview.data.totalUsers} accounts.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="ad-users-heading">
            <div className="section-head">
              <h2 id="ad-users-heading" className="section-title">
                Users
              </h2>
            </div>
            <div className="card ad-scroll">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.users.map((user) => (
                    <tr key={user.id}>
                      <th scope="row">{user.name ?? "-"}</th>
                      <td>{user.email}</td>
                      <td>{user.role === "admin" ? "Administrator" : "User"}</td>
                      <td>{user.status}</td>
                      <td>{fmtDate(user.createdAt)}</td>
                      <td>{fmtTime(user.lastSignInAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="section-note">
              Dates are in UTC. Status is read from the database. Suspension is not enforced by the
              app yet, so changing a status does not block anyone.
            </p>
          </section>

          <section aria-labelledby="ad-results-heading">
            <div className="section-head">
              <h2 id="ad-results-heading" className="section-title">
                Saved results
              </h2>
            </div>
            <div className="status-grid">
              <div className="card status-card">
                <span className="status-label">Metadata results saved</span>
                <span className="ad-value">{count(overview.data.history.metadataTotal)}</span>
                <span className="status-detail">
                  {count(overview.data.history.metadataWeek)} in the last 7 days.
                </span>
              </div>
              <div className="card status-card">
                <span className="status-label">Image prompts saved</span>
                <span className="ad-value">{count(overview.data.history.promptTotal)}</span>
                <span className="status-detail">
                  {count(overview.data.history.promptWeek)} in the last 7 days.
                </span>
              </div>
            </div>
            <p className="section-note">
              These count successful results saved to History. Total requests and error rates are not
              recorded, because no usage tracking table exists.
            </p>
          </section>
        </>
      )}

      <section aria-labelledby="ad-setup-heading">
        <div className="section-head">
          <h2 id="ad-setup-heading" className="section-title">
            Setup status
          </h2>
        </div>
        <div className="status-grid">
          <div className="card status-card">
            <span className="status-label">Key storage</span>
            <span className={`status-pill ${storage.state === "ready" ? "ad-ok" : ""}`}>
              <span className="status-dot" aria-hidden="true" />
              {storage.state === "ready" ? "Ready" : "Not ready"}
            </span>
            <span className="status-detail">{storage.message}</span>
          </div>
          <div className="card status-card">
            <span className="status-label">Your Gemini key</span>
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
        {overview.ok && overview.data.providers ? (
          <div className="card ad-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Saved keys (all users)</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Last request worked</th>
                  <th scope="col">Users with a key</th>
                  <th scope="col">Used by tools</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.providers.map((provider) => (
                  <tr key={provider.provider}>
                    <th scope="row">{provider.name}</th>
                    <td>{provider.saved}</td>
                    <td>{provider.enabled}</td>
                    <td>{provider.lastOk}</td>
                    <td>{provider.owners}</td>
                    <td>{provider.provider === "gemini" ? "Metadata Generator, Image-to-Prompt" : "Not connected yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="key"
            title="Key counts unavailable"
            description="The saved key counts could not be read. Check SUPABASE_SERVICE_ROLE_KEY and the api_keys table."
          />
        )}
        <p className="section-note">
          Counts only. Key values are never shown, and each user manages only their own keys. A saved
          key is not proof that it works: &quot;Last request worked&quot; comes from real requests.
        </p>
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <p role="status">Loading the admin panel...</p>
        </div>
      }
    >
      <AdminContent />
    </Suspense>
  );
}
