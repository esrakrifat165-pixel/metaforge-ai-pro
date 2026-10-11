"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCEPTED_TYPES,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  fingerprint,
  plural,
  type ImageItem,
} from "../metadata/helpers";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ---------- Checking selected files ---------- */

export function collectImages(
  incoming: File[],
  existing: ImageItem[],
  makeId: () => string,
): { accepted: ImageItem[]; problems: string[] } {
  const problems: string[] = [];
  const accepted: ImageItem[] = [];
  const known = new Set(existing.map((item) => fingerprint(item.file)));
  let room = MAX_FILES - existing.length;
  let duplicates = 0;
  let overflow = 0;

  for (const file of incoming) {
    if (/\.(eps|ai|ps)$/i.test(file.name)) {
      problems.push(`${file.name}: EPS and AI files cannot be read in the browser. Use JPG, PNG or WEBP.`);
      continue;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      problems.push(`${file.name}: unsupported file type. Use JPG, PNG or WEBP.`);
      continue;
    }
    if (file.size === 0) {
      problems.push(`${file.name}: the file is empty.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      problems.push(`${file.name}: larger than ${MAX_FILE_MB} MB.`);
      continue;
    }
    const print = fingerprint(file);
    if (known.has(print)) {
      duplicates += 1;
      continue;
    }
    if (room <= 0) {
      overflow += 1;
      continue;
    }
    accepted.push({ id: makeId(), file, url: URL.createObjectURL(file) });
    known.add(print);
    room -= 1;
  }

  if (duplicates > 0) {
    problems.push(`${plural(duplicates, "duplicate file")} skipped.`);
  }
  if (overflow > 0) {
    problems.push(`${plural(overflow, "file")} skipped because the limit is ${MAX_FILES} images.`);
  }

  const shown = problems.length > 5 ? [...problems.slice(0, 5), `...and ${problems.length - 5} more.`] : problems;
  return { accepted, problems: shown };
}

/* ---------- Sending one image to the server ---------- */

export type HttpOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; code: string; message: string; cancelled?: boolean };

const CLIENT_TIMEOUT_MS = 100_000;

export async function postImageJob(
  url: string,
  form: FormData,
  parent: AbortSignal,
): Promise<HttpOutcome> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  parent.addEventListener("abort", forward);
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);

    if (isRecord(payload) && payload.success === true) {
      return { ok: true, payload };
    }
    if (isRecord(payload) && payload.success === false) {
      return {
        ok: false,
        code: typeof payload.code === "string" ? payload.code : "unknown",
        message: typeof payload.message === "string" ? payload.message : "The request failed.",
      };
    }
    return {
      ok: false,
      code: "bad_response",
      message: `The server returned an unexpected answer (status ${response.status}).`,
    };
  } catch {
    if (parent.aborted) {
      return { ok: false, code: "cancelled", message: "Cancelled.", cancelled: true };
    }
    if (controller.signal.aborted) {
      return { ok: false, code: "timeout", message: "The request took too long. Try again." };
    }
    return {
      ok: false,
      code: "network",
      message: "Could not reach the server. Check that the dev server is still running.",
    };
  } finally {
    window.clearTimeout(timer);
    parent.removeEventListener("abort", forward);
  }
}

/* ---------- A small queue: a few images at a time, cancel, per-image status ---------- */

export type JobState = "idle" | "queued" | "processing" | "done" | "failed";

export type JobStatus = {
  state: JobState;
  message?: string;
  warnings?: string[];
};

export type JobOutcome<R> =
  | { ok: true; result: R }
  | { ok: false; code: string; message: string; cancelled?: boolean };

export type RunSummary = {
  done: number;
  failed: number;
  notStarted: number;
  cancelled: boolean;
  stopMessage?: string;
};

type QueueOptions<S, R extends { warnings: string[] }> = {
  run: (item: ImageItem, settings: S, signal: AbortSignal) => Promise<JobOutcome<R>>;
  onResult: (id: string, result: R) => void;
  /** Error codes that would repeat for every image, so the whole run stops. */
  stopCodes: readonly string[];
  concurrency?: number;
};

export function useImageQueue<S, R extends { warnings: string[] }>(options: QueueOptions<S, R>) {
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const setStatus = useCallback((id: string, status: JobStatus) => {
    setStatuses((previous) => ({ ...previous, [id]: status }));
  }, []);

  const removeStatus = useCallback((id: string) => {
    setStatuses((previous) => {
      if (!(id in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  const resetStatuses = useCallback(() => {
    setStatuses({});
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(
    async (items: ImageItem[], settings: S): Promise<RunSummary> => {
      if (controllerRef.current !== null || items.length === 0) {
        return { done: 0, failed: 0, notStarted: items.length, cancelled: false };
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(true);

      setStatuses((previous) => {
        const next = { ...previous };
        for (const item of items) {
          next[item.id] = { state: "queued" };
        }
        return next;
      });

      const waiting = [...items];
      const tally = { done: 0, failed: 0, stopMessage: undefined as string | undefined };
      const { stopCodes, concurrency = 2 } = optionsRef.current;

      const worker = async (): Promise<void> => {
        while (!controller.signal.aborted && tally.stopMessage === undefined) {
          const item = waiting.shift();
          if (!item) {
            return;
          }

          setStatus(item.id, { state: "processing" });
          const outcome = await optionsRef.current.run(item, settings, controller.signal);

          if (outcome.ok) {
            optionsRef.current.onResult(item.id, outcome.result);
            tally.done += 1;
            setStatus(item.id, { state: "done", warnings: outcome.result.warnings });
            continue;
          }

          if (outcome.cancelled) {
            setStatus(item.id, { state: "idle", message: "Cancelled." });
            return;
          }

          tally.failed += 1;
          setStatus(item.id, { state: "failed", message: outcome.message });
          if (stopCodes.includes(outcome.code) && tally.stopMessage === undefined) {
            tally.stopMessage = outcome.message;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, waiting.length) }, () => worker()));

      const cancelled = controller.signal.aborted;
      const notStarted = waiting.length;
      if (notStarted > 0) {
        const message = cancelled ? "Cancelled before it started." : "Not started because the run stopped early.";
        setStatuses((previous) => {
          const next = { ...previous };
          for (const item of waiting) {
            next[item.id] = { state: "idle", message };
          }
          return next;
        });
      }

      controllerRef.current = null;
      setRunning(false);

      return { done: tally.done, failed: tally.failed, notStarted, cancelled, stopMessage: tally.stopMessage };
    },
    [setStatus],
  );

  return { statuses, running, start, cancel, removeStatus, resetStatuses };
}