"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { EmptyState } from "../EmptyState";
import {
  DEFAULT_PLATFORM_ID,
  PLATFORM_PROFILES,
  describeProfile,
  effectiveKeywordCount,
  getPlatformProfile,
  isPlatformId,
  profileStatusLabel,
  type PlatformId,
} from "../../lib/platforms/profiles";
import { DEFAULT_GEMINI_MODEL, GEMINI_MODELS } from "../../lib/providers/gemini-models";
import {
  ACCEPTED_TYPES,
  ACCEPT_ATTRIBUTE,
  EMPTY_META,
  FIELD_KEYS,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  NO_EDITING,
  buildCsv,
  fileExtension,
  fingerprint,
  getFieldStats,
  parseKeywords,
  plural,
  triggerDownload,
  type FieldKey,
  type ImageItem,
  type ImageMetadata,
} from "./helpers";
import { ResultField } from "./ResultField";
import { ThumbStrip } from "./ThumbStrip";
import { ToolIcon, type ToolIconName } from "./ToolIcons";
import { useMetadataQueue, type GenResult, type GenStatus } from "./useMetadataQueue";
import { convertEps, isEpsFile } from "./eps";
import "./generate.css";

const PROVIDER_OPTIONS = [
  { id: "gemini", name: "Google Gemini", connected: true },
  { id: "openai", name: "OpenAI", connected: false },
  { id: "anthropic", name: "Anthropic Claude", connected: false },
  { id: "xai", name: "xAI Grok", connected: false },
  { id: "groq", name: "Groq", connected: false },
];

const KEYWORD_COUNTS = [10, 15, 20, 25, 30, 35, 40, 45, 50];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

type ToolTab = "metadata" | "batch";
type ResultTab = "metadata" | "prompt";
type Notice = { kind: "info" | "success" | "error"; text: string } | null;
type KeyStatus = "checking" | "found" | "missing" | "unknown";

type FieldDef = {
  key: FieldKey;
  label: string;
  tone: "violet" | "pink" | "blue" | "green";
  icon: ToolIconName;
  rows: number;
  empty: string;
};

const METADATA_FIELDS: FieldDef[] = [
  {
    key: "title",
    label: "Title",
    tone: "violet",
    icon: "fileText",
    rows: 2,
    empty: "No title yet. Click Generate Metadata, or Edit to write one yourself.",
  },
  {
    key: "description",
    label: "Description",
    tone: "pink",
    icon: "fileText",
    rows: 3,
    empty: "No description yet. Click Generate Metadata, or Edit to write one yourself.",
  },
  {
    key: "keywords",
    label: "Keywords",
    tone: "blue",
    icon: "fileText",
    rows: 6,
    empty:
      "No keywords yet. Click Generate Metadata, or Edit and type them separated by commas.",
  },
];

function hasMetadata(entry: ImageMetadata | undefined): boolean {
  return Boolean(entry && (entry.title || entry.description || entry.keywords));
}

function keyStatusText(status: KeyStatus): { text: string; warn: boolean } {
  switch (status) {
    case "found":
      return {
        text: "A Gemini API key was found on the server. It is not checked until you generate metadata.",
        warn: false,
      };
    case "missing":
      return {
        text: "No Gemini API key found on the server. Add GEMINI_API_KEY to .env.local, then restart the dev server.",
        warn: true,
      };
    case "unknown":
      return {
        text: "Could not check the server for a Gemini key. Is the dev server running?",
        warn: true,
      };
    default:
      return { text: "Checking the server for a Gemini key...", warn: false };
  }
}

function statusLabel(status: GenStatus): string {
  switch (status.state) {
    case "queued":
      return "Waiting in the queue...";
    case "processing":
      return "Generating metadata...";
    case "done":
      return "Metadata generated.";
    case "failed":
      return `Failed: ${status.message ?? "unknown error."}`;
    default:
      return status.message ?? "";
  }
}

type ToggleProps = {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

function Toggle({ id, label, hint, checked, disabled = false, onChange }: ToggleProps) {
  return (
    <div className="mw-toggle-row" data-disabled={disabled ? "true" : "false"}>
      <button
        type="button"
        role="switch"
        id={id}
        className="mw-switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
      <div className="mw-toggle-text">
        <span id={`${id}-label`} className="mw-toggle-label">
          {label}
        </span>
        {hint ? <span className="mw-toggle-hint">{hint}</span> : null}
      </div>
    </div>
  );
}

// Browsers only show an SVG in an <img> when its type is image/svg+xml. An <img>
// never runs scripts that are inside an SVG.
function previewSource(file: File): Blob {
  if (fileExtension(file.name) === ".svg" && file.type !== "image/svg+xml") {
    return new Blob([file], { type: "image/svg+xml" });
  }
  return file;
}

export function MetadataWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const itemsRef = useRef<ImageItem[]>([]);

  const [toolTab, setToolTab] = useState<ToolTab>("metadata");
  const [resultTab, setResultTab] = useState<ResultTab>("metadata");

  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metaById, setMetaById] = useState<Record<string, ImageMetadata>>({});
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const [editing, setEditing] = useState<Record<FieldKey, boolean>>(NO_EDITING);
  const [drafts, setDrafts] = useState<ImageMetadata>(EMPTY_META);

  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [providerId, setProviderId] = useState("gemini");
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [platformId, setPlatformId] = useState<PlatformId>(DEFAULT_PLATFORM_ID);
  const [keywordCount, setKeywordCount] = useState(40);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("checking");

  const profile = getPlatformProfile(platformId);
  const effectiveCount = effectiveKeywordCount(profile, keywordCount);

  const handleResult = useCallback((id: string, result: GenResult) => {
    setMetaById((previous) => ({
      ...previous,
      [id]: {
        ...(previous[id] ?? EMPTY_META),
        title: result.title,
        description: result.description,
        keywords: result.keywords.join(", "),
      },
    }));
  }, []);

  const queue = useMetadataQueue(handleResult);

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const current: ImageItem | undefined = items[selectedIndex];
  const meta: ImageMetadata = current ? (metaById[current.id] ?? EMPTY_META) : EMPTY_META;
  const hasAnyMetadata = Object.values(metaById).some((entry) => hasMetadata(entry));
  const currentStatus: GenStatus | undefined = current ? queue.statuses[current.id] : undefined;

  const pendingItems = items.filter((item) => !hasMetadata(metaById[item.id]));
  const failedItems = items.filter((item) => queue.statuses[item.id]?.state === "failed");

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

  // Keep a copy of the current list so the unmount cleanup can free preview addresses.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Ask the server whether a Gemini key exists. Only a yes/no answer comes back, never the key.
  useEffect(() => {
    let ignore = false;
    async function checkKey() {
      try {
        const response = await fetch("/api/provider-status", { cache: "no-store" });
        const data: unknown = await response.json();
        const configured = (data as { gemini?: { configured?: unknown } } | null)?.gemini
          ?.configured;
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

  /* ---------- Uploading ---------- */

  function handleFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) {
      return;
    }

    const problems: string[] = [];
    const accepted: ImageItem[] = [];
    const known = new Set(items.map((item) => fingerprint(item.file)));
    let room = MAX_FILES - items.length;
    let duplicates = 0;
    let overflow = 0;

    for (const file of incoming) {
      const extension = fileExtension(file.name);
      const isSvg = extension === ".svg" || file.type === "image/svg+xml";
      if (extension === ".eps" || extension === ".ai" || extension === ".ps") {
        problems.push(
          `${file.name}: EPS and AI files cannot be rendered yet because no server-side renderer is installed. Export the file as SVG, PNG or JPG.`,
        );
        continue;
      }
      // SVG files are checked by content when the image is prepared, because browsers
      // often report a missing or unusual type for them.
      if (!isSvg && !ACCEPTED_TYPES.includes(file.type)) {
        problems.push(`${file.name}: unsupported file type. Use JPG, PNG, WEBP or SVG.`);
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
      idCounter.current += 1;
      accepted.push({
        id: `image-${idCounter.current}`,
        file,
        url: URL.createObjectURL(previewSource(file)),
      });
      known.add(print);
      room -= 1;
    }

    if (duplicates > 0) {
      problems.push(`${plural(duplicates, "duplicate file")} skipped.`);
    }
    if (overflow > 0) {
      problems.push(`${plural(overflow, "file")} skipped because the limit is ${MAX_FILES} images.`);
    }

    const shownProblems =
      problems.length > 5
        ? [...problems.slice(0, 5), `...and ${problems.length - 5} more problems.`]
        : problems;
    setUploadErrors(shownProblems);

    if (accepted.length > 0) {
      setItems((previous) => [...previous, ...accepted]);
      accepted.filter((entry) => isEpsFile(entry.file)).forEach((entry) => void previewEps(entry));
      if (items.length === 0) {
        setSelectedId(accepted[0].id);
      }
      showNotice("success", `Added ${plural(accepted.length, "image")}.`);
    }
  }
  // EPS files cannot be shown by the browser, so the converted JPEG is used as the preview.
  async function previewEps(entry: ImageItem) {
    try {
      const blob = await convertEps(entry.file);
      if (!itemsRef.current.some((existing) => existing.id === entry.id)) {
        return;
      }
      const url = URL.createObjectURL(blob);
      setItems((previous) =>
        previous.map((existing) => (existing.id === entry.id ? { ...existing, url } : existing)),
      );
      URL.revokeObjectURL(entry.url);
    } catch (error) {
      const text = error instanceof Error ? error.message : `${entry.file.name}: conversion failed.`;
      setUploadErrors((previous) => (previous.includes(text) ? previous : [...previous, text]));
    }
  }
  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      handleFiles(event.target.files);
    }
    // Reset so choosing the same file again still triggers a change.
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
    setMetaById({});
    setEditing(NO_EDITING);
    setZoom(1);
    setUploadErrors([]);
    showNotice("info", "All images and their metadata were cleared.");
  }

  function removeSelected() {
    if (!current) {
      return;
    }
    URL.revokeObjectURL(current.url);
    const remaining = items.filter((item) => item.id !== current.id);
    setItems(remaining);
    setMetaById((previous) => {
      const next = { ...previous };
      delete next[current.id];
      return next;
    });
    queue.removeStatus(current.id);
    setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null);
    setEditing(NO_EDITING);
    setZoom(1);
    showNotice("info", `Removed ${current.file.name}.`);
  }

  /* ---------- Selecting and previewing ---------- */

  function selectById(id: string) {
    setSelectedId(id);
    setZoom(1);
    setEditing(NO_EDITING);
  }

  function stepSelection(delta: number) {
    const next = items[selectedIndex + delta];
    if (next) {
      selectById(next.id);
    }
  }

  function zoomBy(delta: number) {
    setZoom((value) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(value + delta).toFixed(2))));
  }

  async function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (stage.requestFullscreen) {
        await stage.requestFullscreen();
      } else {
        showNotice("error", "Fullscreen is not supported by this browser.");
      }
    } catch {
      showNotice("error", "Could not change fullscreen mode.");
    }
  }

  /* ---------- Settings ---------- */

  function handlePlatformChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (isPlatformId(value)) {
      setPlatformId(value);
    }
  }

  /* ---------- Generating ---------- */

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
      showNotice(
        "error",
        "No Gemini API key was found on the server. Add GEMINI_API_KEY to .env.local, then restart the dev server.",
      );
      return;
    }

    showNotice("info", `Generating metadata for ${plural(targets.length, "image")}...`);
    const outcome = await queue.start(targets, {
      provider: providerId,
      model,
      platform: platformId,
      keywordCount: effectiveCount,
    });

    if (outcome.cancelled) {
      showNotice("info", `Cancelled. ${outcome.done} done, ${outcome.failed} failed.`);
      return;
    }
    if (outcome.stopMessage) {
      showNotice(
        "error",
        `Stopped early: ${outcome.stopMessage} (${outcome.done} done, ${outcome.failed} failed, ${outcome.notStarted} not started.)`,
      );
      return;
    }
    if (outcome.failed === 0) {
      showNotice("success", `Generated metadata for ${plural(outcome.done, "image")}.`);
      return;
    }
    showNotice(
      outcome.done > 0 ? "info" : "error",
      `${outcome.done} of ${targets.length} done, ${outcome.failed} failed. Use Retry failed to try again.`,
    );
  }

  function handleGenerateCurrent() {
    if (!current) {
      showNotice("info", "Select an image first.");
      return;
    }
    if (FIELD_KEYS.some((key) => editing[key])) {
      showNotice("info", "Save or cancel your edits first, then generate.");
      return;
    }
    void runGeneration([current]);
  }

  function handleGenerateAll() {
    if (pendingItems.length === 0) {
      showNotice(
        "info",
        "Every image already has metadata. Select one and use Generate Metadata to replace it.",
      );
      return;
    }
    void runGeneration(pendingItems);
  }

  function handleRetryFailed() {
    void runGeneration(failedItems);
  }

  /* ---------- Editing and copying ---------- */

  function updateMeta(id: string, key: FieldKey, value: string) {
    setMetaById((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? EMPTY_META), [key]: value },
    }));
  }

  function startEdit(key: FieldKey) {
    setDrafts((previous) => ({ ...previous, [key]: meta[key] }));
    setEditing((previous) => ({ ...previous, [key]: true }));
  }

  function startEditAll() {
    if (!current) {
      showNotice("info", "Select an image first, then edit its metadata.");
      return;
    }
    setResultTab("metadata");
    setDrafts((previous) => ({
      ...previous,
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
    }));
    setEditing((previous) => ({ ...previous, title: true, description: true, keywords: true }));
  }

  function saveEdit(key: FieldKey, label: string) {
    if (!current) {
      return;
    }
    const raw = drafts[key];
    const value = key === "keywords" ? parseKeywords(raw).join(", ") : raw.trim();
    updateMeta(current.id, key, value);
    setEditing((previous) => ({ ...previous, [key]: false }));
    showNotice("success", `${label} saved for ${current.file.name}.`);
  }

  function cancelEdit(key: FieldKey) {
    setEditing((previous) => ({ ...previous, [key]: false }));
  }

  async function copyField(key: FieldKey, label: string) {
    const text = editing[key] ? drafts[key] : meta[key];
    if (!text.trim()) {
      showNotice("info", `The ${label.toLowerCase()} field is empty, so there is nothing to copy.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showNotice("success", `${label} copied to the clipboard.`);
    } catch {
      showNotice("error", "Copy failed. Your browser blocked clipboard access.");
    }
  }

  /* ---------- Exporting ---------- */

  function handleExportCsv() {
    const rows = items
      .filter((item) => hasMetadata(metaById[item.id]))
      .map((item) => {
        const entry = metaById[item.id];
        return {
          filename: item.file.name,
          title: entry.title,
          description: entry.description,
          keywords: entry.keywords,
          platform: profile.name,
        };
      });

    if (rows.length === 0) {
      showNotice(
        "info",
        "Nothing to export yet. Generate or save a title, description or keywords for at least one image first.",
      );
      return;
    }

    const csv = buildCsv(rows);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `metaforge-metadata-${new Date().toISOString().slice(0, 10)}.csv`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const overLimit = rows.filter(
      (row) =>
        row.title.length > profile.titleMaxChars ||
        row.description.length > profile.descriptionMaxChars ||
        parseKeywords(row.keywords).length > profile.keywordsMax,
    ).length;

    const unsaved = FIELD_KEYS.some((key) => editing[key]);
    const extras = [
      overLimit > 0
        ? ` ${plural(overLimit, "row")} go over the ${profile.name} limits. Check them before uploading.`
        : "",
      unsaved ? " Unsaved edits were not included." : "",
    ].join("");
    showNotice("success", `Exported ${plural(rows.length, "image")} to CSV.${extras}`);
  }

  function handleDownloadImage() {
    if (!current) {
      showNotice("info", "Select an image first.");
      return;
    }
    triggerDownload(current.url, current.file.name);
    showNotice("success", `Downloading ${current.file.name}.`);
  }

  const keyInfo = keyStatusText(keyStatus);
  const profileLevel = profileStatusLabel(profile) === "Provisional" ? "warn" : "ok";

  return (
    <div className="mw-page">
      <h1 className="sr-only">Metadata Generator</h1>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept={`${ACCEPT_ATTRIBUTE},.svg,image/svg+xml,.eps,application/postscript`}
        onChange={handleInputChange}
      />

      <div className="mw-tabs" role="group" aria-label="Tools">
        <button
          type="button"
          className="mw-tab"
          aria-pressed={toolTab === "metadata"}
          onClick={() => setToolTab("metadata")}
        >
          <ToolIcon name="fileText" size={16} />
          Metadata Generator
        </button>
        <Link href="/image-to-prompt" className="mw-tab">
          <ToolIcon name="sparkles" size={16} />
          Image Generator Prompt
        </Link>
        <button
          type="button"
          className="mw-tab"
          aria-pressed={toolTab === "batch"}
          onClick={() => setToolTab("batch")}
        >
          <ToolIcon name="layers" size={16} />
          Batch Process
        </button>
      </div>

      {toolTab === "batch" ? (
        <EmptyState
          icon="metadata"
          title="Batch generation is in the Metadata Generator tab"
          description="Add several images there and use Generate All. A separate Batch Process view is not built yet."
        />
      ) : (
        <>
          <div className="mw-toolbar">
            <button
              type="button"
              className="mw-chip"
              aria-disabled={!hasAnyMetadata}
              onClick={handleExportCsv}
            >
              <ToolIcon name="download" size={16} />
              CSV Export
            </button>
            <label className="mw-chip mw-chip-select">
              <span>Platform Preset</span>
              <select value={platformId} onChange={handlePlatformChange}>
                {PLATFORM_PROFILES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mw-grid">
            <section className="mw-card" aria-labelledby="mw-upload-title">
              <h2 id="mw-upload-title" className="mw-step">
                <span className="mw-badge" data-tone="blue">
                  1
                </span>
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
                  JPG, PNG, WEBP, SVG (max {MAX_FILES} files, {MAX_FILE_MB} MB each). EPS and AI
                  files are not supported yet; export them as SVG, PNG or JPG.
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
                  <button
                    type="button"
                    className="mw-link"
                    onClick={() => setUploadErrors([])}
                    aria-label="Dismiss upload messages"
                  >
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
                <ThumbStrip
                  items={items}
                  selectedId={current?.id}
                  size="small"
                  onSelect={selectById}
                  onAdd={openPicker}
                />
              ) : null}
            </section>

            <section className="mw-card" aria-labelledby="mw-settings-title">
              <h2 id="mw-settings-title" className="mw-step">
                <span className="mw-badge" data-tone="purple">
                  2
                </span>
                Settings
              </h2>

              <div className="mw-fields">
                <div>
                  <label className="mw-label" htmlFor="mw-provider">
                    AI Provider
                  </label>
                  <select
                    id="mw-provider"
                    className="mw-select"
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                  >
                    {PROVIDER_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id} disabled={!option.connected}>
                        {option.connected ? option.name : `${option.name} (not connected yet)`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mw-label" htmlFor="mw-model">
                    Model
                  </label>
                  <select
                    id="mw-model"
                    className="mw-select"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {GEMINI_MODELS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mw-label" htmlFor="mw-platform">
                    Platform
                  </label>
                  <select
                    id="mw-platform"
                    className="mw-select"
                    value={platformId}
                    onChange={handlePlatformChange}
                  >
                    {PLATFORM_PROFILES.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mw-label" htmlFor="mw-keywords">
                    Keywords Count
                  </label>
                  <select
                    id="mw-keywords"
                    className="mw-select"
                    value={keywordCount}
                    onChange={(event) => setKeywordCount(Number(event.target.value))}
                  >
                    {KEYWORD_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="mw-key-status" data-level={keyInfo.warn ? "warn" : "info"}>
                {keyInfo.text}
              </p>

              <div className="mw-profile" aria-live="polite">
                <span>
                  <strong>{profile.name} profile</strong>
                  <span className="mw-profile-badge" data-level={profileLevel}>
                    {profileStatusLabel(profile)}
                  </span>
                </span>
                <span>{describeProfile(profile)}</span>
                <span>{profile.note}</span>
                {effectiveCount !== keywordCount ? (
                  <span>
                    Keyword count lowered from {keywordCount} to {effectiveCount} for this platform.
                  </span>
                ) : null}
                {profile.sourceUrl ? (
                  <a href={profile.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Source: platform help page
                  </a>
                ) : null}
              </div>

              <div className="mw-toggles">
                <Toggle
                  id="mw-toggle-fallback"
                  label="Auto Fallback"
                  hint="Not available yet. Needs more than one key."
                  checked={false}
                  disabled
                  onChange={() => undefined}
                />
                <Toggle
                  id="mw-toggle-first"
                  label="Generate Metadata First"
                  hint="Not available yet."
                  checked={false}
                  disabled
                  onChange={() => undefined}
                />
                <Toggle
                  id="mw-toggle-analyze"
                  label="Analyze Image for Best Output"
                  hint="Not available yet."
                  checked={false}
                  disabled
                  onChange={() => undefined}
                />
              </div>
            </section>
          </div>

          <section className="mw-card" aria-labelledby="mw-preview-title">
            <div className="mw-card-head">
              <h2 id="mw-preview-title" className="mw-card-title">
                Image Preview
              </h2>
              <div className="mw-iconbar">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => zoomBy(-ZOOM_STEP)}
                  disabled={!current || zoom <= ZOOM_MIN}
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <ToolIcon name="zoomOut" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => zoomBy(ZOOM_STEP)}
                  disabled={!current || zoom >= ZOOM_MAX}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <ToolIcon name="zoomIn" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setZoom(1)}
                  disabled={!current}
                  aria-label="Fit to view"
                  title="Fit to view"
                >
                  <ToolIcon name="fit" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={toggleFullscreen}
                  disabled={!current}
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  <ToolIcon name={isFullscreen ? "shrink" : "expand"} />
                </button>
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
                <div className="mw-stage" ref={stageRef} data-fullscreen={isFullscreen}>
                  <div
                    className="mw-stage-inner"
                    style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={current.url} alt={`Preview of ${current.file.name}`} />
                  </div>
                </div>
                <p className="mw-caption">
                  {current.file.name} - {Math.round(zoom * 100)}% - image {selectedIndex + 1} of{" "}
                  {items.length}
                </p>
                {currentStatus && statusLabel(currentStatus) ? (
                  <p className="mw-status" data-state={currentStatus.state}>
                    {statusLabel(currentStatus)}
                  </p>
                ) : null}
                <ThumbStrip
                  items={items}
                  selectedId={current.id}
                  size="large"
                  onSelect={selectById}
                  onPrev={() => stepSelection(-1)}
                  onNext={() => stepSelection(1)}
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

          <section className="mw-card" aria-label="Metadata results">
            <h2 className="sr-only">Metadata results</h2>
            <div className="mw-result-head">
              <div className="mw-seg" role="group" aria-label="Result type">
                <button
                  type="button"
                  aria-pressed={resultTab === "metadata"}
                  onClick={() => setResultTab("metadata")}
                >
                  Metadata Result (1st)
                </button>
                <button
                  type="button"
                  aria-pressed={resultTab === "prompt"}
                  onClick={() => setResultTab("prompt")}
                >
                  Image Prompt (2nd)
                </button>
              </div>

              {resultTab === "metadata" ? (
                <div className="mw-result-actions">
                  <button
                    type="button"
                    className="mw-chip"
                    aria-disabled={!current || queue.running}
                    onClick={handleGenerateCurrent}
                  >
                    <ToolIcon name="sparkles" size={16} />
                    Generate Metadata
                  </button>
                  <button
                    type="button"
                    className="mw-chip"
                    aria-disabled={queue.running || pendingItems.length === 0}
                    onClick={handleGenerateAll}
                  >
                    <ToolIcon name="layers" size={16} />
                    Generate All ({pendingItems.length})
                  </button>
                  {failedItems.length > 0 && !queue.running ? (
                    <button type="button" className="mw-chip" onClick={handleRetryFailed}>
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
              ) : null}
            </div>

            {showProgress && resultTab === "metadata" ? (
              <div className="mw-progress" role="status">
                <span>
                  {queue.running ? "Generating..." : "Last run:"} {counts.done} done,{" "}
                  {counts.failed} failed
                  {counts.active > 0 ? `, ${counts.active} waiting` : ""}.
                </span>
                <progress
                  max={Math.max(1, finished + counts.active)}
                  value={finished}
                  aria-label="Generation progress"
                />
              </div>
            ) : null}

            {resultTab === "prompt" ? (
              <EmptyState
                icon="imageToPrompt"
                title="Image prompts are made on a separate page"
                description="The Image-to-Prompt tool will analyze an image and write a prompt there. Nothing is generated in this tab."
                action={{ href: "/image-to-prompt", label: "Open Image-to-Prompt" }}
              />
            ) : current ? (
              <>
                {currentStatus?.warnings && currentStatus.warnings.length > 0 ? (
                  <ul className="mw-warnings">
                    {currentStatus.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}

                {METADATA_FIELDS.map((def) => {
                  const saved = meta[def.key];
                  const shown = editing[def.key] ? drafts[def.key] : saved;
                  const stats = getFieldStats(def.key, shown, effectiveCount);

                  let footer = stats.footer;
                  let over = stats.over;
                  if (def.key === "title") {
                    footer = `${shown.length}/${profile.titleMaxChars} chars`;
                    over = shown.length > profile.titleMaxChars;
                  } else if (def.key === "description") {
                    footer = `${shown.length}/${profile.descriptionMaxChars} chars`;
                    over = shown.length > profile.descriptionMaxChars;
                  }

                  return (
                    <ResultField
                      key={`${current.id}-${def.key}`}
                      id={`mw-field-${def.key}`}
                      label={def.label}
                      tone={def.tone}
                      icon={def.icon}
                      countLabel={stats.countLabel}
                      footer={footer}
                      footerOver={over}
                      value={saved}
                      draft={drafts[def.key]}
                      editing={editing[def.key]}
                      rows={def.rows}
                      emptyHint={def.empty}
                      onCopy={() => copyField(def.key, def.label)}
                      onStartEdit={() => startEdit(def.key)}
                      onDraftChange={(value) =>
                        setDrafts((previous) => ({ ...previous, [def.key]: value }))
                      }
                      onSave={() => saveEdit(def.key, def.label)}
                      onCancel={() => cancelEdit(def.key)}
                    />
                  );
                })}
              </>
            ) : (
              <EmptyState
                icon="metadata"
                title="No image selected"
                description="Select an image above to generate, view and edit its metadata."
              />
            )}
          </section>

          {items.length > 0 && resultTab === "metadata" ? (
            <section className="mw-card" aria-labelledby="mw-all-title">
              <div className="mw-card-head">
                <h2 id="mw-all-title" className="mw-card-title">
                  All Image Results
                </h2>
                <span className="mw-rc-summary">
                  {items.length} images - {counts.done} done, {counts.failed} failed
                  {counts.active > 0 ? `, ${counts.active} waiting` : ""}
                </span>
              </div>
              <div className="mw-rc-list">
                {items.map((item, index) => {
                  const m = metaById[item.id] ?? EMPTY_META;
                  const state = queue.statuses[item.id];
                  const keywordTotal = parseKeywords(m.keywords).length;
                  let label = "Not generated";
                  let tone = "idle";
                  if (state?.state === "processing") {
                    label = "Processing";
                    tone = "processing";
                  } else if (state?.state === "queued") {
                    label = "Waiting";
                    tone = "queued";
                  } else if (state?.state === "failed") {
                    label = "Failed";
                    tone = "failed";
                  } else if (m.title.trim() || keywordTotal > 0) {
                    label = "Completed";
                    tone = "done";
                  }
                  return (
                    <article
                      key={item.id}
                      className="mw-rc"
                      data-selected={current?.id === item.id ? "true" : "false"}
                    >
                      <button
                        type="button"
                        className="mw-rc-top"
                        aria-label={`Select image ${index + 1}, ${item.file.name}`}
                        onClick={() => selectById(item.id)}
                      >
                        <span className="mw-rc-name">
                          {index + 1}. {item.file.name}
                        </span>
                        <span className="mw-rc-badge" data-tone={tone}>
                          {label}
                        </span>
                      </button>

                      {tone === "failed" && state?.message ? (
                        <p className="mw-rc-error" role="alert">
                          {state.message}
                        </p>
                      ) : null}

                      <div className="mw-rc-block">
                        <span className="mw-rc-label">Title</span>
                        <p className="mw-rc-text">{m.title || "No title yet"}</p>
                      </div>
                      <div className="mw-rc-block">
                        <span className="mw-rc-label">Description</span>
                        <p className="mw-rc-text">{m.description || "No description yet"}</p>
                      </div>
                      <div className="mw-rc-block">
                        <span className="mw-rc-label">Keywords</span>
                        <p className="mw-rc-text">{m.keywords || "No keywords yet"}</p>
                      </div>

                      <div className="mw-rc-foot">
                        <span className="mw-rc-count">
                          {keywordTotal}/{effectiveCount} keywords - title {m.title.length} chars -
                          description {m.description.length} chars
                        </span>
                        <span className="mw-rc-actions">
                          <button type="button" className="mw-mini" onClick={() => selectById(item.id)}>
                            Open in editor
                          </button>
                          <button
                            type="button"
                            className="mw-mini"
                            onClick={() => {
                              if (!(m.title.trim() || m.description.trim() || m.keywords.trim())) {
                                showNotice("info", "That image has no metadata to copy yet.");
                                return;
                              }
                              navigator.clipboard
                                .writeText(`${m.title}\n\n${m.description}\n\n${m.keywords}`)
                                .then(
                                  () => showNotice("success", `Copied the metadata for ${item.file.name}.`),
                                  () => showNotice("error", "Copy failed. Your browser blocked clipboard access."),
                                );
                            }}
                          >
                            Copy all
                          </button>
                          {tone === "failed" && !queue.running ? (
                            <button type="button" className="mw-mini" onClick={() => void runGeneration([item])}>
                              Retry
                            </button>
                          ) : null}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

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
              <button
                type="button"
                className="mw-action"
                data-tone="pink"
                aria-disabled={!current}
                onClick={startEditAll}
              >
                <ToolIcon name="edit" size={16} />
                Edit Metadata
              </button>
              <Link href="/image-to-prompt" className="mw-action" data-tone="violet">
                <ToolIcon name="sparkles" size={16} />
                Generate Image Prompt (Next)
              </Link>
              <button
                type="button"
                className="mw-action"
                data-tone="neutral"
                data-unavailable="true"
                aria-disabled="true"
                title="Needs the database (Phase 5)"
                onClick={() =>
                  showNotice(
                    "info",
                    "Saving to projects needs the database planned for Phase 5. Nothing was saved.",
                  )
                }
              >
                <ToolIcon name="bookmark" size={16} />
                Save to Project
              </button>
              <button
                type="button"
                className="mw-action"
                data-tone="green"
                aria-disabled={!hasAnyMetadata}
                onClick={handleExportCsv}
              >
                <ToolIcon name="fileText" size={16} />
                Export CSV
              </button>
              <button
                type="button"
                className="mw-action"
                data-tone="blue"
                data-unavailable="true"
                aria-disabled="true"
                title="Not built yet"
                onClick={() =>
                  showNotice(
                    "info",
                    "Embedding metadata into image files is not built yet. Your files were not changed.",
                  )
                }
              >
                <ToolIcon name="layers" size={16} />
                Embed Metadata
              </button>
              <button
                type="button"
                className="mw-action"
                data-tone="neutral"
                aria-disabled={!current}
                onClick={handleDownloadImage}
              >
                <ToolIcon name="download" size={16} />
                Download Image
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
