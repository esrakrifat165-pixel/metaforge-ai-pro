export async function GET(): Promise<Response> {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
  return Response.json(
    { gemini: { configured: key.length > 0 } },
    { headers: { "Cache-Control": "no-store" } },
  );
}