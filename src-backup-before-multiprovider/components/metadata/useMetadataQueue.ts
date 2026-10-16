
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageItem } from "./helpers";
import { prepareImageForUpload } from "./imagePrep";

export type GenState = "idle" | "queued" | "processing" | "done" | "failed";

export type GenStatus = {
  state: GenState;
  message?: string;
  warnings?: string[];
};

export type GenSettings = {
  provider: string;
  model: string;
  platform: string;
  keywordCount: number;
};

export type GenResult = {
  title: string;
  description: string;
  keywords: string[];
  warnings: string[];
  model: string;
};

export type RunOutcome = {
  done: number;
  failed: number;
  notStarted: number;
  cancelled: boolean;
  stopMessage?: string;
};

type RequestOutcome =
  | { ok: true; result: GenResult }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      cancelled?: boolean;
    };

const CONCURRENCY = 2;
const CLIENT_TIMEOUT_MS = 100_000;

const STOP_CODES = new Set([
  "not_configured",
  "invalid_key",
  "unsupported_model",
  "unsupported_provider",
  "rate_limited",
  "invalid_request",
  "forbidden",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: string,
  message: string,
  retryable: boolean,
): RequestOutcome {
  return { ok: false, code, message, retryable };
}

function readOutcome(payload: unknown, status: number): RequestOutcome {
  if (isRecord(payload) && payload.success === true && isRecord(payload.data)) {
    const data = payload.data;

    const rawKeywords: string[] = Array.isArray(data.keywords)
      ? data.keywords.filter(
          (keyword): keyword is string => typeof keyword === "string",
        )
      : typeof data.keywords === "string"
        ? data.keywords.split(/[,\n]/)
        : [];

    const seen = new Set<string>();
    const keywords: string[] = [];

    for (const value of rawKeywords) {
      const keyword = value.trim();
      const normalized = keyword.toLowerCase();

      if (keyword && !seen.has(normalized)) {
        seen.add(normalized);
        keywords.push(keyword);
      }
    }

    if (
      typeof data.title === "string" &&
      data.title.trim().length > 0 &&
      typeof data.description === "string" &&
      data.description.trim().length > 0 &&
      keywords.length > 0
    ) {
      const warnings = Array.isArray(data.warnings)
        ? data.warnings.filter(
            (warning): warning is string => typeof warning === "string",
          )
        : [];

      return {
        ok: true,
        result: {
          title: data.title,
          description: data.description,
          keywords,
          warnings,
          model:
            typeof payload.model === "string"
              ? payload.model
              : typeof data.model === "string"
                ? data.model
                : "",
        },
      };
    }

    return failure(
      "bad_response",
      "The server returned incomplete metadata. Check the title, description and keywords in the API response.",
      true,
    );
  }

  if (isRecord(payload) && payload.success === false) {
    return {
      ok: false,
      code: typeof payload.code === "string" ? payload.code : "unknown",
      message:
        typeof payload.message === "string"
          ? payload.message
          : "The request failed.",
      retryable: payload.retryable === true,
    };
  }

  return failure(
    "bad_response",
    `The server returned an unexpected answer (status ${status}).`,
    true,
  );
}

async function requestMetadata(
  item: ImageItem,
  settings: GenSettings,
  parentSignal: AbortSignal,
): Promise<RequestOutcome> {
  if (
    !Number.isInteger(settings.keywordCount) ||
    settings.keywordCount < 1 ||
    settings.keywordCount > 50
  ) {
    return failure(
      "invalid_request",
      `The keyword count setting is not valid (${String(settings.keywordCount)}). Choose a number from 1 to 50.`,
      false,
    );
  }

  let image: Blob;

  try {
    image = await prepareImageForUpload(item.file);
  } catch (error) {
    return failure(
      "image_unreadable",
      error instanceof Error
        ? error.message
        : "The image could not be prepared.",
      false,
    );
  }

  if (parentSignal.aborted) {
    return {
      ok: false,
      code: "cancelled",
      message: "Cancelled.",
      retryable: true,
      cancelled: true,
    };
  }

  const form = new FormData();

  form.append("image", image, "image.jpg");
  form.append("provider", settings.provider);
  form.append("model", settings.model);
  form.append("platform", settings.platform);
  form.append("keywordCount", String(settings.keywordCount));
  form.append("fileName", item.file.name);

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();

  parentSignal.addEventListener("abort", forwardAbort);

  const timer = window.setTimeout(
    () => controller.abort(),
    CLIENT_TIMEOUT_MS,
  );

  try {
    const response = await fetch("/api/generate-metadata", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);

    return readOutcome(payload, response.status);
  } catch {
    if (parentSignal.aborted) {
      return {
        ok: false,
        code: "cancelled",
        message: "Cancelled.",
        retryable: true,
        cancelled: true,
      };
    }

    if (controller.signal.aborted) {
      return failure("timeout", "The request took too long. Try again.", true);
    }

    return failure(
      "network",
      "Could not reach the server. Check that the dev server is still running.",
      true,
    );
  } finally {
    window.clearTimeout(timer);
    parentSignal.removeEventListener("abort", forwardAbort);
  }
}

export function useMetadataQueue(
  onResult: (id: string, result: GenResult) => void,
) {
  const [statuses, setStatuses] = useState<Record<string, GenStatus>>({});
  const [running, setRunning] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const setStatus = useCallback((id: string, status: GenStatus) => {
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
    async (
      items: ImageItem[],
      settings: GenSettings,
    ): Promise<RunOutcome> => {
      if (controllerRef.current !== null || items.length === 0) {
        return {
          done: 0,
          failed: 0,
          notStarted: items.length,
          cancelled: false,
        };
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

      const tally = {
        done: 0,
        failed: 0,
        stopMessage: undefined as string | undefined,
      };

      const worker = async (): Promise<void> => {
        while (!controller.signal.aborted && tally.stopMessage === undefined) {
          const item = waiting.shift();

          if (!item) {
            return;
          }

          setStatus(item.id, { state: "processing" });

          const outcome = await requestMetadata(
            item,
            settings,
            controller.signal,
          );

          if (outcome.ok) {
            onResultRef.current(item.id, outcome.result);
            tally.done += 1;

            setStatus(item.id, {
              state: "done",
              warnings: outcome.result.warnings,
            });

            continue;
          }

          if (outcome.cancelled) {
            setStatus(item.id, {
              state: "idle",
              message: "Cancelled.",
            });

            return;
          }

          tally.failed += 1;

          setStatus(item.id, {
            state: "failed",
            message: outcome.message,
          });

          if (
            STOP_CODES.has(outcome.code) &&
            tally.stopMessage === undefined
          ) {
            tally.stopMessage = outcome.message;
          }
        }
      };

      try {
        await Promise.all(
          Array.from(
            { length: Math.min(CONCURRENCY, waiting.length) },
            () => worker(),
          ),
        );
      } finally {
        const cancelled = controller.signal.aborted;
        const notStarted = waiting.length;

        if (notStarted > 0) {
          const message = cancelled
            ? "Cancelled before it started."
            : "Not started because the run stopped early.";

          setStatuses((previous) => {
            const next = { ...previous };

            for (const item of waiting) {
              next[item.id] = {
                state: "idle",
                message,
              };
            }

            return next;
          });
        }

        controllerRef.current = null;
        setRunning(false);
      }

      return {
        done: tally.done,
        failed: tally.failed,
        notStarted: waiting.length,
        cancelled: controller.signal.aborted,
        stopMessage: tally.stopMessage,
      };
    },
    [setStatus],
  );

  return {
    statuses,
    running,
    start,
    cancel,
    removeStatus,
    resetStatuses,
  };
}
