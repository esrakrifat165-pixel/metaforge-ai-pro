import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "../../../components/EmptyState";
import { Icon } from "../../../components/Icons";
import { NAV_ITEMS } from "../../../lib/navigation";

export const metadata: Metadata = {
  title: "Dashboard",
};

// These describe the project as it is right now. They become live checks
// in later phases once providers, sign-in and the database exist.
const SETUP_STATUS = [
  {
    label: "AI providers",
    value: "Not configured",
    detail: "The first provider is connected in Phase 2.",
  },
  {
    label: "Sign-in",
    value: "Not set up",
    detail: "Google sign-in is added in Phase 5.",
  },
  {
    label: "Database and history",
    value: "Not connected",
    detail: "Saved job history needs the Phase 5 database.",
  },
];

export default function DashboardPage() {
  const quickAccessItems = NAV_ITEMS.filter(
    (item) => item.href !== "/dashboard" && item.group !== "Account",
  );

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">METAFORGE AI PRO</span>
        <h1>Dashboard</h1>
        <p>
          A single place to run your stock content workflow. The tools below are
          being built one phase at a time, and none of them process files yet.
        </p>
      </header>

      <section aria-labelledby="setup-heading">
        <div className="section-head">
          <h2 id="setup-heading" className="section-title">
            Setup status
          </h2>
          <span className="section-note">What is connected right now</span>
        </div>
        <div className="status-grid">
          {SETUP_STATUS.map((entry) => (
            <div key={entry.label} className="card status-card">
              <span className="status-label">{entry.label}</span>
              <span className="status-pill">
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
          <span className="section-note">{quickAccessItems.length} tools planned</span>
        </div>
        <div className="tool-grid">
          {quickAccessItems.map((item) => (
            <Link key={item.href} href={item.href} className="tool-card">
              <span className="tool-icon">
                <Icon name={item.icon} />
              </span>
              <h3>{item.label}</h3>
              <p>{item.description}</p>
              <span className="badge">Planned: {item.phase}</span>
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
            title="No jobs yet"
            description="Jobs will appear here after the Metadata Generator is built and history saving is connected (Phase 5)."
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
            title="No activity yet"
            description="Activity will appear here once sign-in and the database are connected."
          />
        </section>
      </div>
    </div>
  );
}