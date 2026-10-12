// Server-side sign-in rules.
// If ALLOWED_EMAILS is empty, any email-confirmed Google account is allowed.
// If ALLOWED_EMAILS contains emails, only those emails are allowed.

export function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isEmailAllowed(
  email: string | null | undefined,
): boolean {
  if (!email || !email.trim()) {
    return false;
  }

  const allowedEmails = getAllowedEmails();

  // No allowlist configured: allow any account with a verified email.
  if (allowedEmails.length === 0) {
    return true;
  }

  // An explicitly configured allowlist still restricts access.
  return allowedEmails.includes(email.trim().toLowerCase());
}

export function safeNextPath(
  value: string | null | undefined,
): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.startsWith("/login") &&
    !value.startsWith("/auth")
  ) {
    return value;
  }

  return "/dashboard";
}