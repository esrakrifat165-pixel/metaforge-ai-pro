import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "../../../components/EmptyState";
import { HistoryList } from "../../../components/history/HistoryList";
import { getCurrentUser } from "../../../lib/server/history";
import "./history.css";

export const metadata: Metadata = {
  title: "History",
};

export default async function HistoryPage() {
  const who = await getCurrentUser();

  if (!who.configured) {
    return (
      <div className="page">
        <EmptyState
          icon="history"
          title="History needs sign-in and the database"
          description="History is saved per signed-in user in Supabase. Sign-in and the database are not configured, so nothing is saved or shown here."
          action={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }

  if (!who.userId) {
    redirect("/login");
  }

  return <HistoryList />;
}