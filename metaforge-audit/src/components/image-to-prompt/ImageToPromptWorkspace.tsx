"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { EmptyState } from "../EmptyState";
import { DEFAULT_GEMINI_MODEL, GEMINI_MODELS } from "../../lib/providers/gemini-models";
import {
  PROMPT_DETAILS,
  PROMPT_STYLES,
  isPromptDetailId,
  isPromptStyleId,
  type PromptDetailId,
  type PromptStyleId,
} from "../../lib/prompt/generation";
import {
  MAX_FILES,
  MAX_FILE_MB,
  plural,
  triggerDownload,
  type ImageItem,
} from "../metadata/helpers";
import { prepareImageForUpload } from "../metadata/imagePrep";
import { ThumbStrip } from "../metadata/ThumbStrip";
import { ToolIcon } from "../metadata/ToolIcons";
import {
  collectImages,
  isRecord,
  postImageJob,
  useImageQueue,
  type JobOutcome,
  type JobStatus,
} from "../jobs/imageJobs";
import "../metadata/generate.css";

type Notice = { kind: "info" | "success" | "error"; text: string } | null;
type KeyStatus = "checking" | "found" | "missing" | "unknown";
type PromptSettings = { model: string; style: PromptStyleId; detail: PromptDetailId };
type PromptResult = { prompt: string; warnings: string[]; saved: boolean };

const STOP_CODES = [
  "not_configured",
  "invalid_key",
  "unsupported_model",
  "unsupported_provider",
  "rate_limited",
  "invalid_request",
  "forbidden",
  "unauthenticated",
];

async function requestPrompt(
  item: ImageItem,
  settings: PromptSettings,
  signal: AbortSignal,
): Promise<JobOutcome<PromptResult>> {
  let image: Blob;
  try {
    image = await prepareImageForUpload(item.file);
  } catch (error) {
    return {
      ok: false,
      code: "image_unreadable",
      message: error instanceof Error ? error.message : "The image could not be prepared.",
    };
  }
  if (signal.aborted) {
    return { ok: false, code: "cancelled", message: "Cancelled.", cancelled: true };
  }

  const form = new FormData();
  form.append("image", image, "image.jpg");
  form.append("fileName", item.file.name);
  form.append("provider", "gemini");
  form.append("model", settings.model);
  form.append("style", settings.style);
  form.append("detail", settings.detail);

  const http = await postImageJob("/api/generate-prompt", form, signal);
  if (!http.ok) {
    return http;
  }

  const data = http.payload.data;
  if (isRecord(data) && typeof data.prompt === "string" && data.prompt.length > 0) {
    const warnings = Array.isArray(data.warnings)
      ? data.warnings.filter((warning): warning is string => typeof warning === "string")
      : [];
    return { ok: true, result: { prompt: data.prompt, warnings, saved: http.payload.saved === true } };
  }
  return { ok: false, code: "bad_response", message: "The server answer was incomplete. Try again." };
}

function csvCell(value: string): string {
  // A leading = + - @ can be run as a formula by spreadsheet programs, so a quote is added in front.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName) || "image";
}

function downloadBlob(content: string, mime: string, fileName: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function keyStatusText(status: KeyStatus): { text: string; warn: boolean } {
  switch (status) {
    case "found":
      return { text: "A Gemini API key is available on the server. It is not checked until you generate a prompt.", warn: false };
    case "missing":
      return {
        text: "No Gemini API key is available. Add one in the API Key Manager (admin) or set GEMINI_API_KEY, then restart.",
        warn: true,
      };
    case "unknown":
      return { text: "Could not check the server for a Gemini key. Is the dev server running?", warn: true };
    default:
      return { text: "Checking the server for a Gemini key...", warn: false };
  }
}

function statusLabel(status: JobStatus, saved: boolean | undefined): string {
  switch (status.state) {
    case "queued":
      return "Waiting in the queue...";
    case "processing":
      return "Generating prompt...";
    case "done":
      return saved ? "Prompt generated and saved to History." : "Prompt generated. It was not saved to History.";
    case "failed":
      return `Failed: ${status.message ?? "unknown error."}`;
    default:
      return status.message ?? "";
  }
}

export function ImageToPromptWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const itemsRef = useRef<ImageItem[]>([]);

  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promptById, setPromptById] = useState<Record<string, string>>({});
  const [savedById, setSavedById] = useState<Record<string, boolean>>({});
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [style, setStyle] = useState<PromptStyleId>("photorealistic");
  const [detail, setDetail] = useState<PromptDetailId>("standard");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("checking");

  const handleResult = useCallback((id: string, result: PromptResult) => {
    setPromptById((previous) => ({ ...previous, [id]: result.prompt }));
    setSavedById((previous) => ({ ...previous, [id]: result.saved }));
  }, []);

  const queue = useImageQueue<PromptSettings, PromptResult>({
    run: requestPrompt,
    onResult: handleResult,
    stopCodes: STOP_CODES,
  });

  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const current: ImageItem | undefined = items[selectedIndex];
  const currentPrompt = current ? (promptById[current.id] ?? "") : "";
  const currentStatus: JobStatus | undefined = current ? queue.statuses[current.id] : undefined;

  const pendingItems = items.filter((item) => !(promptById[item.id] ?? "").trim());
  const failedItems = items.filter((item) => queue.statuses[item.id]?.state === "failed");
  const withPrompts = items.filter((item) => (promptById[item.id] ?? "").trim().length > 0);

  const counts = { done: 0, failed: 0, active: 0 };
  for (const item of items) {
    const state = queue.statuses[item.id]?.state;
    if (state === "done") {
      counts.done += 1;
    } else if (state === "failed") {
      counts.failed += 1;
    } else if (state === "queued" || state === "processing") {
      counts.active += 1;
    }
  }
  const finished = counts.done + counts.failed;
  const showProgress = queue.running || finished > 0;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    async function checkKey() {
      try {
        const response = await fetch("/api/provider-status", { cache: "no-store" });
        const data: unknown = await response.json();
        const configured = isRecord(data) && isRecord(data.gemini) ? data.gemini.configured : undefined;
        if (!ignore) {
          setKeyStatus(configured === true ? "found" : configured === false ? "missing" : "unknown");
        }
      } catch {
        if (!ignore) {
          setKeyStatus("unknown");
        }
      }
    }
    void checkKey();
    return () => {
      ignore = true;
    };
  }, []);

  function showNotice(kind: "info" | "success" | "error", text: string) {
    setNotice({ kind, text });
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  function handleFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) {
      return;
    }
    const { accepted, problems } = collectImages(incoming, items, () => {
      idCounter.current += 1;
      return `prompt-image-${idCounter.current}`;
    });
    setUploadErrors(problems);
    if (accepted.length > 0) {
      setItems((previous) => [...previous, ...accepted]);
      if (items.length === 0) {
        setSelectedId(accepted[0].id);
      }
      showNotice("success", `Added ${plural(accepted.length, "image")}.`);
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      handleFiles(event.target.files);
    }
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  }

  function clearAll() {
    queue.cancel();
    queue.resetStatuses();
    items.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
    setSelectedId(null);
    setPromptById({});
    setSavedById({});
    setUploadErrors([]);
    showNotice("info", "All images and prompts were cleared from this page. History is not affected.");
  }

  function removeSelected() {
    if (!current) {
      return;
    }
    URL.revokeObjectURL(current.url);
    const remaining = items.filter((item) => item.id !== current.id);
    setItems(remaining);
    setPromptById((previous) => {
      const next = { ...previous };
      delete next[current.id];
      return next;
    });
    queue.removeStatus(current.id);
    setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null);
    showNotice("info", `Removed ${current.file.name}.`);
  }

  async function runGeneration(targets: ImageItem[]) {
    if (targets.length === 0) {
      showNotice("info", "There are no images to process.");
      return;
    }
    if (queue.running) {
      showNotice("info", "A generation run is already in progress.");
      return;
    }
    if (keyStatus === "missing") {
      showNotice("error", "No Gemini API key is available on the server. Add one in the API Key Manager first.");
      return;
    }

    showNotice("info", `Generating prompts for ${plural(targets.length, "image")}...`);
    const outcome = await queue.start(targets, { model, style, detail });

    if (outcome.cancelled) {
      showNotice("info", `Cancelled. ${outcome.done} done, ${outcome.failed} failed.`);
    } else if (outcome.stopMessage) {
      showNotice(
        "error",
        `Stopped early: ${outcome.stopMessage} (${outcome.done} done, ${outcome.failed} failed, ${outcome.notStarted} not started.)`,
      );
    } else if (outcome.failed === 0) {
      showNotice("success", `Generated prompts for ${plural(outcome.done, "image")}.`);
    } else {
      showNotice(
        outcome.done > 0 ? "info" : "error",
        `${outcome.done} of ${targets.length} done, ${outcome.failed} failed. Use Retry failed to try again.`,
      );
    }
  }

  function handleGenerateCurrent() {
    if (!current) {
      showNotice("info", "Select an image first.");
      return;
    }
    void runGeneration([current]);
  }

  function handleGenerateAll() {
    if (pendingItems.length === 0) {
      showNotice("info", "Every image already has a prompt. Select one and use Generate Prompt to replace it.");
      return;
    }
    void runGeneration(pendingItems);
  }

  async function copyPrompt() {
    if (!currentPrompt.trim()) {
      showNotice("info", "The prompt is empty, so there is nothing to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(currentPrompt);
      showNotice("success", "Prompt copied to the clipboard.");
    } catch {
      showNotice("error", "Copy failed. Your browser blocked clipboard access.");
    }
  }

  function downloadCurrent() {
    if (!current || !currentPrompt.trim()) {
      showNotice("info", "There is no prompt to download yet.");
      return;
    }
    downloadBlob(currentPrompt, "text/plain;charset=utf-8", `${baseName(current.file.name)}-prompt.txt`);
    showNotice("success", `Downloaded the prompt for ${current.file.name}.`);
  }

  function downloadAll() {
    if (withPrompts.length === 0) {
      showNotice("info", "No prompts to download yet. Generate or write at least one first.");
      return;
    }
    const lines = [
      [csvCell("Filename"), csvCell("Prompt")].join(","),
      ...withPrompts.map((item) => [csvCell(item.file.name), csvCell(promptById[item.id] ?? "")].join(",")),
    ];
    downloadBlob("\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8", `metaforge-prompts-${new Date().toISOString().slice(0, 10)}.csv`);
    showNotice("success", `Downloaded ${plural(withPrompts.length, "prompt")} as CSV.`);
  }

  const keyInfo = keyStatusText(keyStatus);

  return (
    <div className="mw-page">
      <h1 className="sr-only">Image-to-Prompt</h1>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={handleInputChange}
      />

      <div className="mw-grid">
        <section className="mw-card" aria-labelledby="ip-upload-title">
          <h2 id="ip-upload-title" className="mw-step">
            <span className="mw-badge" data-tone="blue">1</span>
            Upload Image(s)
          </h2>

          <div
            className="mw-drop"
            data-dragging={dragging ? "true" : "false"}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <span className="mw-drop-icon">
              <ToolIcon name="upload" size={40} />
            </span>
            <p className="mw-drop-title">Drag &amp; Drop Images here</p>
            <p className="mw-drop-hint">
              JPG, PNG, WEBP (max {MAX_FILES} files, {MAX_FILE_MB} MB each).
            </p>
            <button type="button" className="mw-select-files" onClick={openPicker}>
              <ToolIcon name="image" size={16} />
              Select Files
            </button>
          </div>

          {uploadErrors.length > 0 ? (
            <div className="mw-errors" role="alert">
              <ul>
                {uploadErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              <button type="button" className="mw-link" onClick={() => setUploadErrors([])} aria-label="Dismiss upload messages">
                <ToolIcon name="close" size={14} />
              </button>
            </div>
          ) : null}

          <div className="mw-upload-meta">
            <span>
              {items.length === 0
                ? "No images selected"
                : `${plural(items.length, "image")} selected (max ${MAX_FILES})`}
            </span>
            {items.length > 0 ? (
              <button type="button" className="mw-link" onClick={clearAll}>
                <ToolIcon name="trash" size={14} />
                Clear all
              </button>
            ) : null}
          </div>

          {items.length > 0 ? (
            <ThumbStrip items={items} selectedId={current?.id} size="small" onSelect={setSelectedId} onAdd={openPicker} />
          ) : null}
        </section>

        <section className="mw-card" aria-labelledby="ip-settings-title">
          <h2 id="ip-settings-title" className="mw-step">
            <span className="mw-badge" data-tone="purple">2</span>
            Settings
          </h2>

          <div className="mw-fields">
            <div>
              <label className="mw-label" htmlFor="ip-provider">AI Provider</label>
              <select id="ip-provider" className="mw-select" value="gemini" disabled onChange={() => undefined}>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>
            <div>
              <label className="mw-label" htmlFor="ip-model">Model</label>
              <select id="ip-model" className="mw-select" value={model} onChange={(event) => setModel(event.target.value)}>
                {GEMINI_MODELS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mw-label" htmlFor="ip-style">Prompt style</label>
              <select
                id="ip-style"
                className="mw-select"
                value={style}
                onChange={(event) => {
                  if (isPromptStyleId(event.target.value)) {
                    setStyle(event.target.value);
                  }
                }}
              >
                {PROMPT_STYLES.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mw-label" htmlFor="ip-detail">Detail</label>
              <select
                id="ip-detail"
                className="mw-select"
                value={detail}
                onChange={(event) => {
                  if (isPromptDetailId(event.target.value)) {
                    setDetail(event.target.value);
                  }
                }}
              >
                {PROMPT_DETAILS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="mw-key-status" data-level={keyInfo.warn ? "warn" : "info"}>{keyInfo.text}</p>
          <p className="mw-note">
            Only Google Gemini is connected so far. The model reads the actual image. It is told not to
            identify real people or invent details, but check each prompt before you use it.
          </p>
        </section>
      </div>

      <section className="mw-card" aria-labelledby="ip-preview-title">
        <div className="mw-card-head">
          <h2 id="ip-preview-title" className="mw-card-title">Image Preview</h2>
          <div className="mw-iconbar">
            <button
              type="button"
              className="icon-button"
              onClick={removeSelected}
              disabled={!current}
              aria-label="Remove this image"
              title="Remove this image"
            >
              <ToolIcon name="trash" />
            </button>
          </div>
        </div>

        {current ? (
          <>
            <div className="mw-stage">
              <div className="mw-stage-inner" style={{ width: "100%", height: "100%" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={current.url} alt={`Preview of ${current.file.name}`} />
              </div>
            </div>
            <p className="mw-caption">
              {current.file.name} - image {selectedIndex + 1} of {items.length}
            </p>
            {currentStatus && statusLabel(currentStatus, savedById[current.id]) ? (
              <p className="mw-status" data-state={currentStatus.state}>
                {statusLabel(currentStatus, savedById[current.id])}
              </p>
            ) : null}
            <ThumbStrip
              items={items}
              selectedId={current.id}
              size="large"
              onSelect={setSelectedId}
              onPrev={() => items[selectedIndex - 1] && setSelectedId(items[selectedIndex - 1].id)}
              onNext={() => items[selectedIndex + 1] && setSelectedId(items[selectedIndex + 1].id)}
              canPrev={selectedIndex > 0}
              canNext={selectedIndex < items.length - 1}
            />
          </>
        ) : (
          <EmptyState
            icon="imageToPrompt"
            title="No image selected"
            description="Choose images in the Upload card above. The selected image appears here."
          />
        )}
      </section>

      <section className="mw-card" aria-labelledby="ip-result-title">
        <div className="mw-result-head">
          <h2 id="ip-result-title" className="mw-card-title">Prompt</h2>
          <div className="mw-result-actions">
            <button type="button" className="mw-chip" aria-disabled={!current || queue.running} onClick={handleGenerateCurrent}>
              <ToolIcon name="sparkles" size={16} />
              Generate Prompt
            </button>
            <button type="button" className="mw-chip" aria-disabled={queue.running || pendingItems.length === 0} onClick={handleGenerateAll}>
              <ToolIcon name="layers" size={16} />
              Generate All ({pendingItems.length})
            </button>
            {failedItems.length > 0 && !queue.running ? (
              <button type="button" className="mw-chip" onClick={() => void runGeneration(failedItems)}>
                <ToolIcon name="check" size={16} />
                Retry failed ({failedItems.length})
              </button>
            ) : null}
            {queue.running ? (
              <button type="button" className="mw-chip" onClick={queue.cancel}>
                <ToolIcon name="close" size={16} />
                Cancel
              </button>
            ) : null}
          </div>
        </div>

        {showProgress ? (
          <div className="mw-progress" role="status">
            <span>
              {queue.running ? "Generating..." : "Last run:"} {counts.done} done, {counts.failed} failed
              {counts.active > 0 ? `, ${counts.active} waiting` : ""}.
            </span>
            <progress max={Math.max(1, finished + counts.active)} value={finished} aria-label="Generation progress" />
          </div>
        ) : null}

        {current ? (
          <>
            {currentStatus?.warnings && currentStatus.warnings.length > 0 ? (
              <ul className="mw-warnings">
                {currentStatus.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <div className="mw-field">
              <div className="mw-field-head">
                <label className="mw-field-title" htmlFor="ip-prompt">
                  <span>Image prompt</span>
                  <span className="mw-field-count">({currentPrompt.length} chars)</span>
                </label>
                <div className="mw-field-actions">
                  <button type="button" className="mw-mini" onClick={copyPrompt}>
                    <ToolIcon name="copy" size={14} />
                    Copy
                  </button>
                  <button type="button" className="mw-mini" onClick={downloadCurrent}>
                    <ToolIcon name="download" size={14} />
                    Download .txt
                  </button>
                </div>
              </div>
              <textarea
                id="ip-prompt"
                className="mw-textarea"
                rows={8}
                value={currentPrompt}
                placeholder="No prompt yet. Click Generate Prompt, or type your own."
                onChange={(event) =>
                  setPromptById((previous) => ({ ...previous, [current.id]: event.target.value }))
                }
              />
              <div className="mw-field-foot">Edits stay on this page. History keeps the version that was generated.</div>
            </div>
          </>
        ) : (
          <EmptyState
            icon="imageToPrompt"
            title="No image selected"
            description="Select an image above to generate and edit its prompt."
          />
        )}
      </section>

      <div className="mw-bottom">
        <div role="status" aria-live="polite">
          {notice ? (
            <p className="mw-notice" data-kind={notice.kind}>
              <ToolIcon name="info" size={16} />
              <span>{notice.text}</span>
            </p>
          ) : null}
        </div>
        <div className="mw-actions">
          <button type="button" className="mw-action" data-tone="green" aria-disabled={withPrompts.length === 0} onClick={downloadAll}>
            <ToolIcon name="download" size={16} />
            Download All Prompts
          </button>
        </div>
      </div>
    </div>
  );
}