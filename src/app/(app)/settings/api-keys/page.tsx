
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
  // Check authentication and access permissions on the server.
  const access = await getAccess();

  if (!access.ok) {
    // Redirect users who are not signed in or are not allowed.
    if (access.status === 401 || access.code === "not_allowed") {
      redirect("/login");
    }

    return (
      <div className="page">
        <EmptyState
          icon="admin"
          title="API Key Manager unavailable"
          description={access.message}
          action={{
            href: "/dashboard",
            label: "Back to dashboard",
          }}
        />
      </div>
    );
  }

  // ApiKeyManager already contains its own page wrapper.
  // Return it directly to avoid nesting two .page containers.
  return <ApiKeyManager />;
}
