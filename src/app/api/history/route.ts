import { HISTORY_PAGE_SIZE, HistoryError, deleteHistory, getCurrentUser, listHistory, type HistoryKind } from "../../../lib/server/history";

const ID_PATTERN = /^[0-9a-fA-F-]{36}$/;

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(status: number, code: string, message: string): Response {
  return reply({ success: false, code, message }, status);
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return host === null ? true : new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const who = await getCurrentUser();
  if (!who.configured) {
    return fail(503, "auth_not_configured", "History needs sign-in and the database, which are not configured.");
  }
  if (!who.userId) {
    return fail(401, "unauthenticated", "Please sign in.");
  }

  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return fail(400, "invalid_request", "Invalid page number.");
  }
  const kindParam = params.get("kind");
  if (kindParam !== null && kindParam !== "metadata" && kindParam !== "prompt") {
    return fail(400, "invalid_request", "Invalid history type.");
  }
  const kind: HistoryKind | null = kindParam;

  try {
    const { entries, total } = await listHistory(who.userId, { kind, page });
    return reply({ success: true, entries, total, page, pageSize: HISTORY_PAGE_SIZE });
  } catch (error) {
    if (error instanceof HistoryError) {
      return fail(500, "history_unavailable", "History could not be read. Check that the history SQL was run in Supabase.");
    }
    return fail(500, "internal_error", "Something went wrong. Please try again.");
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return fail(403, "forbidden", "This request was not allowed.");
  }

  const who = await getCurrentUser();
  if (!who.configured) {
    return fail(503, "auth_not_configured", "History needs sign-in and the database, which are not configured.");
  }
  if (!who.userId) {
    return fail(401, "unauthenticated", "Please sign in.");
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID_PATTERN.test(id)) {
    return fail(400, "invalid_request", "A valid entry id is required.");
  }

  try {
    const removed = await deleteHistory(who.userId, id);
    if (!removed) {
      return fail(404, "not_found", "That entry no longer exists.");
    }
    return reply({ success: true });
  } catch {
    return fail(500, "history_unavailable", "The entry could not be deleted. Try again.");
  }
}