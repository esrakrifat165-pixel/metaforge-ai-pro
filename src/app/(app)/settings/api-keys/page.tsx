import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiKeyManager } from "../../../../components/api-keys/ApiKeyManager";
import { EmptyState } from "../../../../components/EmptyState";
import { getAccess } from "../../../../lib/auth/session";
import "./keys.css";

export const metadata: Metadata = {
  title: "API Key Manager",
};

export default async function ApiKeysPage() {
  const access = await getAccess();

  // Sign-in not configured (local development): keep the page usable as before.
  if (!access.ok && access.code === "auth_not_configured") {
    return <ApiKeyManager />;
  }

  if (!access.ok) {
    if (access.status === 401 || access.code === "not_allowed") {
      redirect("/login");
    }
    return (
      <div className="page">
        <EmptyState
          icon="key"
          title="API Key Manager unavailable"
          description={access.message}
          action={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }

  if (access.role !== "admin") {
    return (
      <div className="page">
        <EmptyState
          icon="key"
          title="Admins only"
          description="Only an administrator can manage API keys."
          action={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }

  return <ApiKeyManager />;
}