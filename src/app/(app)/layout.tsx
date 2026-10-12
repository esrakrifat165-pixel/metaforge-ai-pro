import type { ReactNode } from "react";
import { AppShell } from "../../components/AppShell";
import { getAccess } from "../../lib/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const access = await getAccess();
  const user = access.ok
    ? { email: access.email, role: access.role, fullName: access.fullName }
    : null;

  return <AppShell user={user}>{children}</AppShell>;
}