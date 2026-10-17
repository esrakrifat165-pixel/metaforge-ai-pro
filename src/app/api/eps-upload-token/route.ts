import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { isEmailAllowed } from "../../../lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const secret = process.env.EPS_UPLOAD_SIGNING_SECRET?.trim();
    const converterUrl = process.env.EPS_CONVERTER_URL?.trim();

    if (!secret || secret.length < 32 || !converterUrl) {
      return NextResponse.json(
        { message: "EPS converter is not configured." },
        { status: 503 },
      );
    }

    const baseUrl = new URL(converterUrl);

    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.hostname !== "metaforge-eps-converter.onrender.com"
    ) {
      return NextResponse.json(
        { message: "Invalid EPS converter configuration." },
        { status: 503 },
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { message: "Please log in again." },
        { status: 401 },
      );
    }

    if (
      !user.email_confirmed_at ||
      !isEmailAllowed(user.email ?? "")
    ) {
      return NextResponse.json(
        { message: "Your account is not authorized." },
        { status: 403 },
      );
    }

    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        aud: "eps-convert",
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
    ).toString("base64url");

    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");

    const token = `${payload}.${signature}`;
    const basePath = baseUrl.pathname.replace(/\/+$/, "");

    return NextResponse.json(
      {
        token,
        uploadUrl: `${baseUrl.origin}${basePath}/convert`,
      },
      {
        headers: {
          "Cache-Control": "no-store, private",
          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    console.error("EPS upload authorization failed:", error);

    return NextResponse.json(
      { message: "Could not authorize EPS conversion." },
      { status: 500 },
    );
  }
}

