// Small helpers for sign-in rules. The email list is server-side only.

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