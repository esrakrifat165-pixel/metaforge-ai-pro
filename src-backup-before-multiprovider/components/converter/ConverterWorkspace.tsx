"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  checkSettings,
  convertToJpeg,
  detectFormat,
  safeBaseName,
  type ConvertSettings,
} from "./convertEngine";
import "./converter.css";

type Status = "idle" | "queued" | "processing" | "done" | "failed";
type Item = {
  id: string;
  file: File;
  format: string;
  outName: string;
  status: Status;
  message?: string;
  blob?: Blob;
  outWidth?: number;
  outHeight?: number;
};
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

const CONCURRENCY = 2;
const ACCEPT = ".jpg,.jpeg,.png,.webp,.svg,.ai,.eps,.pdf";

const DEFAULTS = { quality: "90", width: "", height: "", keepAspect: true, background: "#ffffff" };

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function parseOptional(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ConverterWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [qualityText, setQualityText] = useState(DEFAULTS.quality);
  const [widthText, setWidthText] = useState(DEFAULTS.width);
  const [heightText, setHeightText] = useState(DEFAULTS.height);
  const [keepAspect, setKeepAspect] = useState(DEFAULTS.keepAspect);
  const [background, setBackground] = useState(DEFAULTS.background);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const settings: ConvertSettings = {
    quality: Number(qualityText),
    width: parseOptional(widthText),
    height: parseOptional(heightText),
    keepAspect,
    background,
  };
  const settingsError = checkSettings(settings);

  useEffect(() => {
    return () => {
      if (cancelRef.current) {
        cancelRef.current.cancelled = true;
      }
    };
  }, []);

  function patch(id: string, change: Partial<Item>) {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) {
      return;
    }
    const problems: string[] = [];
    const accepted: Item[] = [];
    const usedNames = new Set(items.map((item) => item.outName.toLowerCase()));
    let room = MAX_FILES - items.length;

    for (const file of incoming) {
      if (file.size === 0) {
        problems.push(`${file.name}: the file is empty.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name}: larger than ${MAX_FILE_MB} MB.`);
        continue;
      }
      if (room <= 0) {
        problems.push(`${file.name}: skipped, the limit is ${MAX_FILES} files.`);
        continue;
      }
      const format = await detectFormat(file);
      if (format === "pdf" || format === "eps") {
        problems.push(
          `${file.name}: this is a ${format === "pdf" ? "PDF (or PDF-based AI)" : "PostScript (EPS or older AI)"} file. This version has no renderer for it, so it was not added.`,
        );
        continue;
      }
      if (format === "unknown") {
        problems.push(`${file.name}: not a JPG, PNG, WebP or SVG file.`);
        continue;
      }

      const base = safeBaseName(file.name);
      let outName = `${base}.jpg`;
      for (let n = 2; usedNames.has(outName.toLowerCase()); n += 1) {
        outName = `${base}-${n}.jpg`;
      }
      usedNames.add(outName.toLowerCase());
      idCounter.current += 1;
      accepted.push({ id: `cv-${idCounter.current}`, file, format, outName, status: "idle" });
      room -= 1;
    }

    if (accepted.length > 0) {
      setItems((previous) => [...previous, ...accepted]);
    }
    if (problems.length > 0) {
      const shown = problems.slice(0, 4).join(" ");
      setNotice({ kind: "error", text: problems.length > 4 ? `${shown} And ${problems.length - 4} more.` : shown });
    } else {
      setNotice({ kind: "success", text: `Added ${accepted.length} file${accepted.length === 1 ? "" : "s"}.` });
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      void addFiles(event.target.files);
    }
    event.target.value = "";
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  async function runConversion(targets: Item[]) {
    if (running) {
      return;
    }
    if (targets.length === 0) {
      setNotice({ kind: "info", text: "There is nothing to convert." });
      return;
    }
    if (settingsError) {
      setNotice({ kind: "error", text: settingsError });
      return;
    }

    const snapshot = settings;
    const control = { cancelled: false };
    cancelRef.current = control;
    setRunning(true);
    setNotice({ kind: "info", text: `Converting ${targets.length} file${targets.length === 1 ? "" : "s"}...` });

    const ids = new Set(targets.map((item) => item.id));
    setItems((previous) =>
      previous.map((item) => (ids.has(item.id) ? { ...item, status: "queued", message: undefined } : item)),
    );

    const waiting = [...targets];
    const tally = { done: 0, failed: 0 };

    const worker = async (): Promise<void> => {
      while (!control.cancelled) {
        const target = waiting.shift();
        if (!target) {
          return;
        }
        patch(target.id, { status: "processing" });
        try {
          const result = await convertToJpeg(target.file, snapshot);
          tally.done += 1;
          patch(target.id, {
            status: "done",
            blob: result.blob,
            outWidth: result.width,
            outHeight: result.height,
          });
        } catch (error) {
          tally.failed += 1;
          patch(target.id, {
            status: "failed",
            message: error instanceof Error ? error.message : "Conversion failed.",
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, waiting.length) }, () => worker()));

    const skipped = new Set(waiting.map((item) => item.id));
    if (skipped.size > 0) {
      setItems((previous) =>
        previous.map((item) => (skipped.has(item.id) ? { ...item, status: "idle", message: "Cancelled before it started." } : item)),
      );
    }

    cancelRef.current = null;
    setRunning(false);

    if (control.cancelled) {
      setNotice({ kind: "info", text: `Cancelled. ${tally.done} converted, ${tally.failed} failed, ${skipped.size} not started.` });
    } else if (tally.failed === 0) {
      setNotice({ kind: "success", text: `Converted ${tally.done} file${tally.done === 1 ? "" : "s"}.` });
    } else {
      setNotice({ kind: "error", text: `${tally.done} converted, ${tally.failed} failed. Use Retry failed to try again.` });
    }
  }

  function downloadOne(item: Item) {
    if (!item.blob) {
      return;
    }
    saveBlob(item.blob, item.outName);
  }

  async function downloadAll() {
    const ready = items.filter((item) => item.status === "done" && item.blob);
    if (ready.length === 0) {
      setNotice({ kind: "error", text: "There are no converted files to download yet." });
      return;
    }
    for (const item of ready) {
      if (item.blob) {
        saveBlob(item.blob, item.outName);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    }
    setNotice({ kind: "success", text: `Started ${ready.length} download${ready.length === 1 ? "" : "s"}. Your browser may ask to allow multiple downloads.` });
  }

  function removeItem(id: string) {
    setItems((previous) => previous.filter((item) => item.id !== id));
  }

  function clearAll() {
    if (cancelRef.current) {
      cancelRef.current.cancelled = true;
    }
    setItems([]);
    setNotice({ kind: "info", text: "All files cleared." });
  }

  function resetSettings() {
    setQualityText(DEFAULTS.quality);
    setWidthText(DEFAULTS.width);
    setHeightText(DEFAULTS.height);
    setKeepAspect(DEFAULTS.keepAspect);
    setBackground(DEFAULTS.background);
    setNotice({ kind: "info", text: "Settings restored to defaults." });
  }

  const idleItems = items.filter((item) => item.status === "idle");
  const failedItems = items.filter((item) => item.status === "failed");
  const doneCount = items.filter((item) => item.status === "done").length;

  return (
    <div className="page cv-page">
      <header className="page-header">
        <span className="eyebrow">Creative tools</span>
        <h1>AI/EPS-to-JPG Converter</h1>
        <p>
          Convert JPG, PNG, WebP and SVG files to JPG in your browser. AI, EPS and PDF files are detected but
          not converted in this version.
        </p>
      </header>

      <div role="status" aria-live="polite">
        {notice ? (
          <p className="cv-notice" data-kind={notice.kind}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <input ref={inputRef} type="file" hidden multiple accept={ACCEPT} onChange={onInputChange} />

      <div className="cv-grid">
        <div className="cv-side">
          <section className="card cv-block" aria-labelledby="cv-up">
            <h2 id="cv-up" className="section-title">1. Files</h2>
            <div
              className="cv-drop"
              data-dragging={dragging ? "true" : "false"}
              onDragEnter={onDragOver}
              onDragOver={onDragOver}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <p>Drag and drop files here</p>
              <p className="cv-hint">JPG, PNG, WebP, SVG. Up to {MAX_FILE_MB} MB each and {MAX_FILES} files.</p>
              <button type="button" className="button" onClick={() => inputRef.current?.click()}>
                Browse files
              </button>
            </div>
          </section>

          <section className="card cv-block" aria-labelledby="cv-set">
            <h2 id="cv-set" className="section-title">2. Settings</h2>
            <div className="cv-field">
              <label htmlFor="cv-quality">JPG quality: {qualityText} (10 to 100)</label>
              <input
                id="cv-quality"
                type="range"
                min={10}
                max={100}
                value={Number(qualityText) || 90}
                onChange={(event) => setQualityText(event.target.value)}
              />
            </div>
            <div className="cv-two">
              <div className="cv-field">
                <label htmlFor="cv-w">Width (px, optional)</label>
                <input id="cv-w" inputMode="numeric" value={widthText} placeholder="Original" onChange={(event) => setWidthText(event.target.value)} />
              </div>
              <div className="cv-field">
                <label htmlFor="cv-h">Height (px, optional)</label>
                <input id="cv-h" inputMode="numeric" value={heightText} placeholder="Original" onChange={(event) => setHeightText(event.target.value)} />
              </div>
            </div>
            <label className="cv-check">
              <input type="checkbox" checked={keepAspect} onChange={(event) => setKeepAspect(event.target.checked)} />
              Keep aspect ratio (fit inside the width and height)
            </label>
            <div className="cv-field">
              <label htmlFor="cv-bg">Background for transparent areas</label>
              <input id="cv-bg" type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
            </div>
            {settingsError ? <p className="cv-error" role="alert">{settingsError}</p> : null}
            <p className="cv-hint">
              With aspect ratio off and both sizes set, images are stretched to that exact size. DPI is not offered
              because these formats have no physical size to render at.
            </p>
            <button type="button" className="button" onClick={resetSettings}>
              Reset settings
            </button>
          </section>
        </div>

        <section className="card cv-main" aria-labelledby="cv-list">
          <div className="cv-head">
            <h2 id="cv-list" className="section-title">
              Files ({items.length}) - {doneCount} converted
            </h2>
            <div className="cv-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void runConversion(idleItems)}
                disabled={running || idleItems.length === 0}
              >
                Convert ({idleItems.length})
              </button>
              {failedItems.length > 0 && !running ? (
                <button type="button" className="button" onClick={() => void runConversion(failedItems)}>
                  Retry failed ({failedItems.length})
                </button>
              ) : null}
              {running ? (
                <button type="button" className="button" onClick={() => { if (cancelRef.current) { cancelRef.current.cancelled = true; } }}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className="button" onClick={() => void downloadAll()} disabled={doneCount === 0}>
                Download all
              </button>
              <button type="button" className="button" onClick={clearAll} disabled={items.length === 0}>
                Clear all
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="cv-hint">No files yet. Add files on the left.</p>
          ) : (
            <ul className="cv-list" aria-label="Files">
              {items.map((item) => (
                <li key={item.id} className="cv-row">
                  <div className="cv-row-main">
                    <strong className="cv-name">{item.file.name}</strong>
                    <span className="cv-hint">
                      {item.format.toUpperCase()} - {formatSize(item.file.size)} - saves as {item.outName}
                      {item.outWidth && item.outHeight ? ` - ${item.outWidth} x ${item.outHeight} px, ${item.blob ? formatSize(item.blob.size) : ""}` : ""}
                    </span>
                    {item.status === "failed" && item.message ? (
                      <span className="cv-error" role="alert">{item.message}</span>
                    ) : null}
                    {item.status === "idle" && item.message ? <span className="cv-hint">{item.message}</span> : null}
                  </div>
                  <span className="cv-badge" data-status={item.status}>
                    {item.status === "idle" ? "Ready" : item.status === "queued" ? "Queued" : item.status === "processing" ? "Processing" : item.status === "done" ? "Done" : "Failed"}
                  </span>
                  <div className="cv-row-actions">
                    {item.status === "done" ? (
                      <button type="button" className="button" onClick={() => downloadOne(item)}>
                        Download
                      </button>
                    ) : null}
                    {item.status === "failed" && !running ? (
                      <button type="button" className="button" onClick={() => void runConversion([item])}>
                        Retry
                      </button>
                    ) : null}
                    <button type="button" className="button" onClick={() => removeItem(item.id)} disabled={item.status === "processing"} aria-label={`Remove ${item.file.name}`}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}