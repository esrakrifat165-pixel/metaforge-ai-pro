import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "../../components/BrandMark";
import { getSupabaseEnv } from "../../lib/supabase/env";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, string> = {
  not_configured: "Sign-in is not configured on this server.",
  cancelled: "Sign-in was cancelled or did not finish. Please try again.",
  oauth: "Google sign-in failed. Please try again.",
  not_allowed:
    "This Google account is not approved to use METAFORGE AI PRO yet. Sign in with an approved account or contact the administrator.",
};

async function LoginError({ params }: { params: Promise<{ error?: string }> }) {
  const { error } = await params;
  const text = error ? MESSAGES[error] : undefined;
  return text ? <p role="alert">{text}</p> : null;
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = getSupabaseEnv() !== null;

  return (
    <div className="page">
      <div
        className="card"
        style={{
          maxWidth: 420,
          margin: "10vh auto",
          display: "grid",
          gap: 16,
          justifyItems: "center",
          textAlign: "center",
        }}
      >
        <BrandMark size={56} />
        <h1>METAFORGE AI PRO</h1>
        <p>Sign in to save your history and use your account.</p>
        <Suspense fallback={null}>
          <LoginError params={searchParams} />
        </Suspense>
        {configured ? (
          <form action="/auth/google" method="post">
            <button type="submit" className="button">
              Continue with Google
            </button>
          </form>
        ) : (
          <p>Sign-in is not set up. The Supabase environment variables are missing.</p>
        )}
      </div>
    </div>
  );
}