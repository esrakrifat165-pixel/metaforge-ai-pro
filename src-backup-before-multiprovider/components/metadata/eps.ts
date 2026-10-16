// Browser side of EPS support: checks the file's contents, asks the server to render it
// to a JPEG, and remembers the result so each file is converted only once.

const MAX_EPS_BYTES = 8 * 1024 * 1024;
const cache = new WeakMap<File, Promise<Blob>>();

// Conversions run one at a time because Ghostscript is heavy.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

export function isEpsFile(file: File): boolean {
  return /\.eps$/i.test(file.name);
}

function fail(file: File, reason: string): Error {
  return new Error(`${file.name}: ${reason}`);
}

async function looksLikeEps(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 11).arrayBuffer());
  if (head.length >= 4 && head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6) {
    return true;
  }
  return String.fromCharCode(...Array.from(head)) === "%!PS-Adobe-";
}

async function run(file: File): Promise<Blob> {
  if (file.size === 0) {
    throw fail(file, "the file is empty.");
  }
  if (file.size > MAX_EPS_BYTES) {
    throw fail(file, "the EPS is larger than 8 MB, which is the conversion limit.");
  }
  if (!(await looksLikeEps(file))) {
    throw fail(file, "this is not a valid EPS file (its contents do not start like an EPS).");
  }

  const form = new FormData();
  form.append("file", file, "input.eps");

  let response: Response;
  try {
    response = await fetch("/api/convert-eps", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw fail(file, "could not reach the server for conversion.");
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      typeof payload === "object" && payload !== null && typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : "the conversion failed.";
    throw fail(file, message);
  }

  const blob = await response.blob();
  if (blob.size === 0 || blob.type !== "image/jpeg") {
    throw fail(file, "the server did not return an image.");
  }
  return blob;
}

export function convertEps(file: File): Promise<Blob> {
  const cached = cache.get(file);
  if (cached) {
    return cached;
  }
  const promise = enqueue(() => run(file));
  cache.set(file, promise);
  // A failed conversion is not remembered, so Retry can try again.
  promise.catch(() => cache.delete(file));
  return promise;
}