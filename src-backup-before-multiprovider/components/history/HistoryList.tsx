
"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "../EmptyState";
import { isRecord } from "../jobs/imageJobs";

type Kind = "metadata" | "prompt";
type Filter = "all" | Kind;

type Entry = {
  id: string;
  kind: Kind;
  fileName: string;
  provider: string;
  model: string;
  platform: string | null;
  result: Record<string, unknown>;
  createdAt: string;
};

type Message = { kind: "success" | "error"; text: string } | null;

function isEntry(value: unknown): value is Entry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "metadata" || value.kind === "prompt") &&
    typeof value.fileName === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    (value.platform === null || typeof value.platform === "string") &&
    isRecord(value.result) &&
    typeof value.createdAt === "string"
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function keywordsText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join(", ")
    : "";
}

export function HistoryList() {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Load history whenever the page, filter or reload counter changes.
  useEffect(() => {
    let ignore = false;

    async function loadHistory() {
      try {
        const query = `/api/history?page=${page}${
          filter === "all" ? "" : `&kind=${filter}`
        }`;

        const response = await fetch(query, { cache: "no-store" });
        const payload: unknown = await response.json().catch(() => null);

        if (ignore) return;

        if (
          response.ok &&
          isRecord(payload) &&
          payload.success === true &&
          Array.isArray(payload.entries) &&
          payload.entries.every(isEntry) &&
          typeof payload.total === "number" &&
          typeof payload.pageSize === "number"
        ) {
          setEntries(payload.entries);
          setTotal(payload.total);
          setPageSize(payload.pageSize);
          setError(null);
        } else {
          setError(
            isRecord(payload) && typeof payload.message === "string"
              ? payload.message
              : "The server sent an unexpected answer.",
          );
        }
      } catch {
        if (!ignore) {
          setError(
            "Could not reach the server. Check that the dev server is running.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadHistory();

    return () => {
      ignore = true;
    };
  }, [page, filter, reloadTick]);

  function retryLoad() {
    setLoading(true);
    setError(null);
    setReloadTick((tick) => tick + 1);
  }

  function changeFilter(next: Filter) {
    if (next === filter) return;

    setLoading(true);
    setError(null);
    setFilter(next);
    setPage(1);
    setOpenId(null);
    setConfirmId(null);
  }

  function changePage(next: number) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (next < 1 || next > pageCount || next === page) return;

    setLoading(true);
    setError(null);
    setPage(next);
    setOpenId(null);
    setConfirmId(null);
  }

  async function copyText(label: string, value: string) {
    if (!value.trim()) {
      setMessage({
        kind: "error",
        text: `The ${label.toLowerCase()} is empty.`,
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setMessage({
        kind: "success",
        text: `${label} copied to the clipboard.`,
      });
    } catch {
      setMessage({
        kind: "error",
        text: "Copy failed. Your browser blocked clipboard access.",
      });
    }
  }

  function downloadText(entry: Entry, value: string) {
    const blob = new Blob([value], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${
      entry.fileName.replace(/\.[^.]+$/, "") || "image"
    }-prompt.txt`;

    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleDelete(entry: Entry) {
    if (busyId) return;

    setBusyId(entry.id);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/history?id=${encodeURIComponent(entry.id)}`,
        { method: "DELETE" },
      );
      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && isRecord(payload) && payload.success === true) {
        setConfirmId(null);
        setOpenId(null);
        setMessage({
          kind: "success",
          text: `Deleted the entry for ${entry.fileName}.`,
        });

        if (entries.length === 1 && page > 1) {
          setLoading(true);
          setPage((current) => current - 1);
        } else {
          setLoading(true);
          setReloadTick((tick) => tick + 1);
        }
      } else {
        setMessage({
          kind: "error",
          text:
            isRecord(payload) && typeof payload.message === "string"
              ? payload.message
              : "The entry could not be deleted.",
        });
      }
    } catch {
      setMessage({
        kind: "error",
        text: "Could not reach the server. Nothing was deleted.",
      });
    } finally {
      setBusyId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Account</span>
        <h1>History</h1>
        <p>
          Metadata and prompts you generated while signed in. Only you can see
          these.
        </p>
      </header>

      <div className="hs-filters" role="group" aria-label="Filter history">
        {(["all", "metadata", "prompt"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="hs-filter"
            aria-pressed={filter === option}
            onClick={() => changeFilter(option)}
          >
            {option === "all"
              ? "All"
              : option === "metadata"
                ? "Metadata"
                : "Prompts"}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p className="hs-message" data-kind={message.kind}>
            {message.text}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="hs-loading" role="status">
          Loading history...
        </p>
      ) : error ? (
        <div className="card hs-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button"
            onClick={retryLoad}
          >
            Try again
          </button>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon="history"
          title="No history yet"
          description="Results appear here after you generate metadata or a prompt while signed in."
        />
      ) : (
        <>
          <ul className="hs-list" aria-label="History entries">
            {entries.map((entry) => {
              const open = openId === entry.id;
              const promptValue = text(entry.result.prompt);

              return (
                <li key={entry.id} className="card hs-row">
                  <div className="hs-row-head">
                    <div className="hs-row-main">
                      <span className="badge">
                        {entry.kind === "metadata" ? "Metadata" : "Prompt"}
                      </span>

                      <strong className="hs-name">{entry.fileName}</strong>

                      <span className="hs-meta">
                        {new Date(entry.createdAt).toLocaleString()} -{" "}
                        {entry.provider} - {entry.model}
                        {entry.platform ? ` - ${entry.platform}` : ""}
                      </span>
                    </div>

                    <div className="hs-row-actions">
                      <button
                        type="button"
                        className="button"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : entry.id)}
                      >
                        {open ? "Hide" : "View"}
                      </button>

                      {confirmId === entry.id ? (
                        <span
                          className="hs-confirm"
                          role="group"
                          aria-label={`Confirm deleting ${entry.fileName}`}
                        >
                          <span>Delete this entry?</span>

                          <button
                            type="button"
                            className="button"
                            disabled={busyId !== null}
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>

                          <button
                            type="button"
                            className="button hs-danger"
                            disabled={busyId !== null}
                            onClick={() => void handleDelete(entry)}
                          >
                            {busyId === entry.id ? "Deleting..." : "Yes, delete"}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null}
                          onClick={() => setConfirmId(entry.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {open ? (
                    <div className="hs-detail">
                      {entry.kind === "metadata" ? (
                        <>
                          {(
                            [
                              ["Title", text(entry.result.title)],
                              ["Description", text(entry.result.description)],
                              ["Keywords", keywordsText(entry.result.keywords)],
                            ] as const
                          ).map(([label, value]) => (
                            <div key={label} className="hs-field">
                              <div className="hs-field-head">
                                <strong>{label}</strong>
                                <button
                                  type="button"
                                  className="button"
                                  onClick={() => void copyText(label, value)}
                                >
                                  Copy
                                </button>
                              </div>
                              <p className="hs-value">{value || "(empty)"}</p>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="hs-field">
                          <div className="hs-field-head">
                            <strong>Prompt</strong>
                            <span className="hs-field-actions">
                              <button
                                type="button"
                                className="button"
                                onClick={() =>
                                  void copyText("Prompt", promptValue)
                                }
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                className="button"
                                disabled={!promptValue}
                                onClick={() => downloadText(entry, promptValue)}
                              >
                                Download .txt
                              </button>
                            </span>
                          </div>
                          <p className="hs-value">
                            {promptValue || "(empty)"}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="hs-pager">
            <button
              type="button"
              className="button"
              disabled={page <= 1 || loading}
              onClick={() => changePage(page - 1)}
            >
              Previous
            </button>

            <span>
              Page {page} of {pageCount} ({total}{" "}
              {total === 1 ? "entry" : "entries"})
            </span>

            <button
              type="button"
              className="button"
              disabled={page >= pageCount || loading}
              onClick={() => changePage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
