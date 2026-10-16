import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkRateLimit } from "../../../lib/server/rateLimit";

// Renders an EPS to a JPEG with Ghostscript. Needs Ghostscript installed on the server.
// Hosted platforms such as Vercel do not include it. Access still goes through the
// sign-in proxy, and the request must come from this site.
  
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
type GsOutcome = "ok" | "missing" | "timeout" | "failed";

function reply(status: number, code: string, message: string): Response {
  return Response.json(
    { success: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function looksLikeEps(bytes: Uint8Array): boolean {
  if (bytes.length >= 4 && bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
    return true;
  }
  return Buffer.from(bytes.subarray(0, 11)).toString("latin1") === "%!PS-Adobe-";
}

// Keeps the longest side near 3000 pixels so huge artboards cannot exhaust memory.
function chooseDpi(buffer: Buffer): number {
  const head = buffer.subarray(0, 131072).toString("latin1");
  const match = /%%BoundingBox:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(head);
  if (!match) {
    return 100;
  }
  const width = Math.abs(Number(match[3]) - Number(match[1]));
  const height = Math.abs(Number(match[4]) - Number(match[2]));
  const longest = Math.max(width, height, 1);
  return Math.max(20, Math.min(150, Math.floor((3000 * 72) / longest)));
}

function candidates(): string[] {
  const configured = (process.env.GHOSTSCRIPT_PATH ?? "").trim();
  const defaults = process.platform === "win32" ? ["gswin64c", "gswin32c", "gs"] : ["gs"];
  return configured ? [configured, ...defaults] : defaults;
}

function runGhostscript(command: string, args: string[]): Promise<GsOutcome> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 1024 * 1024 },
      (error: ExecFileException | null) => {
        if (!error) {
          resolve("ok");
        } else if (error.code === "ENOENT") {
          resolve("missing");
        } else if (error.killed) {
          resolve("timeout");
        } else {
          resolve("failed");
        }
      },
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return reply(403, "forbidden", "This request was not allowed.");
  }

  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkRateLimit(`eps:${client}`, 30, 60_000).allowed) {
    return reply(429, "rate_limited", "Too many conversions. Please wait a moment.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(400, "invalid_request", "The upload could not be read.");
  }

  const file = form.get("file");
  if (file === null || typeof file === "string") {
    return reply(400, "invalid_request", "No file was uploaded.");
  }
  if (file.size === 0) {
    return reply(400, "invalid_request", "The file is empty.");
  }
  if (file.size > MAX_BYTES) {
    return reply(413, "payload_too_large", "The EPS is larger than 8 MB.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikeEps(bytes)) {
    return reply(400, "invalid_file", "This is not a valid EPS file.");
  }

  // Remote Linux Ghostscript service for Vercel.
  const converterUrl = process.env.EPS_CONVERTER_URL?.trim();
  const converterToken = process.env.EPS_CONVERTER_TOKEN?.trim();

  if (converterUrl || converterToken) {
    if (!converterUrl || !converterToken) {
      return reply(
        503,
        "converter_not_configured",
        "The EPS conversion service is not fully configured.",
      );
    }

    let endpoint: URL;
    try {
      endpoint = new URL(converterUrl);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      ) {
        throw new Error("Invalid converter URL");
      }
    } catch {
      return reply(
        503,
        "converter_not_configured",
        "The EPS conversion service URL is invalid.",
      );
    }

    let remoteResponse: Response;

    try {
      const body = new FormData();
      body.append(
        "file",
        new Blob([new Uint8Array(bytes)], {
          type: "application/postscript",
        }),
        file.name || "upload.eps",
      );

      remoteResponse = await fetch(
        `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "")}/convert`,
        {
          method: "POST",
          headers: { "x-converter-token": converterToken },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(28_000),
        },
      );
    } catch {
      return reply(
        502,
        "converter_unavailable",
        "The EPS conversion service could not be reached. Please try again.",
      );
    }

    if (!remoteResponse.ok) {
      if (remoteResponse.status === 504) {
        return reply(504, "timeout", "Converting this EPS took too long.");
      }

      if (remoteResponse.status === 413) {
        return reply(413, "payload_too_large", "The EPS is too large.");
      }

      if (remoteResponse.status === 401) {
        return reply(
          502,
          "converter_auth_failed",
          "The EPS conversion service authentication failed. Check the server configuration.",
        );
      }

      return reply(
        422,
        "conversion_failed",
        "This EPS could not be converted. It may be damaged or use unsupported features.",
      );
    }

    const contentType = remoteResponse.headers.get("content-type") ?? "";
    const contentLength = Number(
      remoteResponse.headers.get("content-length") ?? "0",
    );

    if (
      !contentType.toLowerCase().startsWith("image/jpeg") ||
      (contentLength > 0 && contentLength > MAX_OUTPUT_BYTES)
    ) {
      return reply(
        502,
        "invalid_converter_response",
        "The conversion service returned an invalid image.",
      );
    }

    let jpeg: Buffer;

    try {
      const outputBytes = await remoteResponse.arrayBuffer();

      if (outputBytes.byteLength === 0 ||
          outputBytes.byteLength > MAX_OUTPUT_BYTES) {
        return reply(
          422,
          "conversion_failed",
          "The converted image was empty or too large.",
        );
      }

      jpeg = Buffer.from(outputBytes);
    } catch {
      return reply(
        502,
        "invalid_converter_response",
        "The converted image could not be read.",
      );
    }

    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "metaforge-eps-"));
  try {
    const input = path.join(dir, "input.eps");
    const output = path.join(dir, "output.jpg");
    await writeFile(input, bytes);

    const args = [
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-dQUIET",
      "-dEPSCrop",
      "-sDEVICE=jpeg",
      "-dJPEGQ=88",
      "-dGraphicsAlphaBits=4",
      "-dTextAlphaBits=4",
      `-r${chooseDpi(bytes)}`,
      `-sOutputFile=${output}`,
      input,
    ];

    let outcome: GsOutcome = "missing";
    for (const command of candidates()) {
      outcome = await runGhostscript(command, args);
      if (outcome !== "missing") {
        break;
      }
    }

    if (outcome === "missing") {
      return reply(
        503,
        "renderer_missing",
        "EPS conversion needs Ghostscript, which is not installed on this server. Install Ghostscript and restart, or set GHOSTSCRIPT_PATH. Hosted platforms such as Vercel do not include it.",
      );
    }
    if (outcome === "timeout") {
      return reply(504, "timeout", "Converting this EPS took too long.");
    }
    if (outcome === "failed") {
      return reply(422, "conversion_failed", "This EPS could not be rendered. It may be damaged or use unsupported features.");
    }

    let jpeg: Buffer;
    try {
      jpeg = await readFile(output);
    } catch {
      return reply(422, "conversion_failed", "This EPS produced no image.");
    }
    if (jpeg.length === 0 || jpeg.length > MAX_OUTPUT_BYTES) {
      return reply(422, "conversion_failed", "The converted image was empty or too large.");
    }

    return new Response(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return reply(500, "internal_error", "The conversion failed unexpectedly.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}