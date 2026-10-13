import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "../../../components/EmptyState";
import { Icon } from "../../../components/Icons";
import { NAV_ITEMS } from "../../../lib/navigation";
import { getDashboardStatus } from "../../../lib/server/dashboardStatus";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  // Real checks, run on the server for the signed-in user. See dashboardStatus.ts.
  const setupStatus = await getDashboardStatus();

  const quickAccessItems = NAV_ITEMS.filter(
    (item) => item.href !== "/dashboard" && item.group !== "Account",
  );

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">METAFORGE AI PRO</span>
        <h1>Dashboard</h1>
        <p>
          A single place to run your stock content workflow. Use the cards below to open each
          tool, and the status cards to see what is connected for your account right now.
        </p>
      </header>

      <section aria-labelledby="setup-heading">
        <div className="section-head">
          <h2 id="setup-heading" className="section-title">
            Setup status
          </h2>
          <span className="section-note">Checked on the server for your account</span>
        </div>
        <div className="status-grid">
          {setupStatus.map((entry) => (
            <div key={entry.id} className="card status-card">
              <span className="status-label">{entry.label}</span>
              <span className="status-pill" data-tone={entry.tone}>
                <span className="status-dot" aria-hidden="true" />
                {entry.value}
              </span>
              <span className="status-detail">{entry.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="tools-heading">
        <div className="section-head">
          <h2 id="tools-heading" className="section-title">
            Quick access
          </h2>
          <span className="section-note">{quickAccessItems.length} tools</span>
        </div>
        <div className="tool-grid">
          {quickAccessItems.map((item) => (
            <Link key={item.href} href={item.href} className="tool-card">
              <span className="tool-icon">
                <Icon name={item.icon} />
              </span>
              <h3>{item.label}</h3>
              <p>{item.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section aria-labelledby="jobs-heading">
          <div className="section-head">
            <h2 id="jobs-heading" className="section-title">
              Recent jobs
            </h2>
          </div>
          <EmptyState
            icon="inbox"
            title="Saved results are in History"
            description="Results from the Metadata Generator and Image to Prompt are saved to your own history. Open History to review or delete them."
            action={{ href: "/history", label: "Open History" }}
          />
        </section>

        <section aria-labelledby="activity-heading">
          <div className="section-head">
            <h2 id="activity-heading" className="section-title">
              Recent activity
            </h2>
          </div>
          <EmptyState
            icon="history"
            title="Activity is not tracked yet"
            description="Account activity and usage are not recorded, so there is nothing to show here."
          />
        </section>
      </div>
    </div>
  );
}