// Small helpers for sign-in rules. Server-side use only for the email list.

/** Emails allowed to use the app. Server-only setting. Empty means NOBODY is allowed. */
export function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return getAllowedEmails().includes(email.trim().toLowerCase());
}

/** Only allows internal paths, so a login link can never send someone to another website. */
export function safeNextPath(value: string | null | undefined): string {
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