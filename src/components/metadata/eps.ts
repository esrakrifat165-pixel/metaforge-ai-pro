
const MAX_EPS_BYTES = 100 * 1024 * 1024;
const CONVERTER_HOST = "metaforge-eps-converter.onrender.com";

const cache = new WeakMap<File, Promise<Blob>>();

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task);
  chain = result.catch(() => undefined);
  return result;
}

export function isEpsFile(file: File): boolean {
  return /\.eps$/i.test(file.name);
}

function fail(file: File, reason: string): Error {
  return new Error(`${file.name}: ${reason}`);
}

async function looksLikeEps(file: File): Promise<boolean> {
  const header = new Uint8Array(
    await file.slice(0, 11).arrayBuffer(),
  );

  const textHeader = new TextDecoder().decode(header);

  return (
    textHeader.startsWith("%!PS-Adobe-") ||
    (header.length >= 4 &&
      header[0] === 0xc5 &&
      header[1] === 0xd0 &&
      header[2] === 0xd3 &&
      header[3] === 0xc6)
  );
}

async function readError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null);

  if (typeof data?.message === "string") {
    return data.message;
  }

  if (typeof data?.detail === "string") {
    return data.detail;
  }

  return `Request failed (HTTP ${response.status}).`;
}

async function run(file: File): Promise<Blob> {
  if (file.size === 0) {
    throw fail(file, "File is empty.");
  }

  if (file.size > MAX_EPS_BYTES) {
    throw fail(file, "File exceeds the 100 MB limit.");
  }

  if (!(await looksLikeEps(file))) {
    throw fail(file, "Invalid EPS file.");
  }

  // Get a short-lived authorization token from the Next.js server.
  let authResponse: Response;

  try {
    authResponse = await fetch("/api/eps-upload-token", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw fail(file, "Could not contact the authorization service.");
  }

  if (!authResponse.ok) {
    throw fail(file, await readError(authResponse));
  }

  const authData = await authResponse.json().catch(() => null);

  if (
    !authData ||
    typeof authData.token !== "string" ||
    typeof authData.uploadUrl !== "string"
  ) {
    throw fail(file, "Invalid converter authorization response.");
  }

  let uploadUrl: URL;

  try {
    uploadUrl = new URL(authData.uploadUrl);
  } catch {
    throw fail(file, "Invalid converter URL.");
  }

  // Only send the token to the configured Render converter.
  if (
    uploadUrl.protocol !== "https:" ||
    uploadUrl.hostname !== CONVERTER_HOST ||
    uploadUrl.pathname.replace(/\/+$/, "") !== "/convert" ||
    uploadUrl.username ||
    uploadUrl.password
  ) {
    throw fail(file, "Unexpected EPS converter URL.");
  }

  const form = new FormData();
  form.append("file", file, file.name);

  let response: Response;

  try {
    response = await fetch(uploadUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authData.token}`,
      },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw fail(
      file,
      "Could not reach the EPS converter. Check that the service is running and try again.",
    );
  }

  if (!response.ok) {
    throw fail(file, await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  const blob = await response.blob();

  if (
    blob.size === 0 ||
    !contentType.toLowerCase().includes("image/jpeg")
  ) {
    throw fail(
      file,
      "The converter did not return a valid JPEG preview.",
    );
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

  // Remove failed conversions from cache so the user can retry.
  void promise.catch(() => {
    cache.delete(file);
  });

  return promise;
}
