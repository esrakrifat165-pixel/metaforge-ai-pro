"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { EmptyState } from "../EmptyState";
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

const PROVIDERS = ["Google Gemini", "OpenAI", "Anthropic Claude", "xAI Grok", "Groq"];
const MODELS = ["Auto Select (Best)"];
const PLATFORMS = ["All Platforms", "Adobe Stock", "Shutterstock", "Freepik", "Vecteezy"];
const KEYWORD_COUNTS = [10, 15, 20, 25, 30, 35, 40, 45, 50];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

type ToolTab = "metadata" | "prompt" | "batch";
type ResultTab = "metadata" | "prompt";
type Notice = { kind: "info" | "success" | "error"; text: string } | null;

const TOOL_TABS: { id: ToolTab; label: string; icon: ToolIconName; phase: string }[] = [
  { id: "metadata", label: "Metadata Generator", icon: "fileText", phase: "Phase 2" },
  { id: "prompt", label: "Image Generator Prompt", icon: "sparkles", phase: "Phase 4" },
  { id: "batch", label: "Batch Process", icon: "layers", phase: "Phase 8" },
];

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
    empty: "No title yet. Click Edit to write one. AI generation arrives in Phase 2.",
  },
  {
    key: "description",
    label: "Description",
    tone: "pink",
    icon: "fileText",
    rows: 3,
    empty: "No description yet. Click Edit to write one. AI generation arrives in Phase 2.",
  },
  {
    key: "keywords",
    label: "Keywords",
    tone: "blue",
    icon: "fileText",
    rows: 6,
    empty:
      "No keywords yet. Click Edit and type them separated by commas. AI generation arrives in Phase 2.",
  },
];

const PROMPT_FIELDS: FieldDef[] = [
  {
    key: "prompt",
    label: "Image Prompt",
    tone: "green",
    icon: "sparkles",
    rows: 6,
    empty: "No prompt yet. Click Edit to write one. AI prompt generation arrives in Phase 4.",
  },
];

type ToggleProps = {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function Toggle({ id, label, hint, checked, onChange }: ToggleProps) {
  return (
    <div className="mw-toggle-row">
      <button
        type="button"
        role="switch"
        id={id}
        className="mw-switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
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

  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [model, setModel] = useState(MODELS[0]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [keywordCount, setKeywordCount] = useState(40);
  const [autoFallback, setAutoFallback] = useState(false);
  const [metadataFirst, setMetadataFirst] = useState(true);
  const [analyzeImage, setAnalyzeImage] = useState(true);

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const current: ImageItem | undefined = items[selectedIndex];
  const meta: ImageMetadata = current ? (metaById[current.id] ?? EMPTY_META) : EMPTY_META;
  const hasAnyMetadata = Object.values(metaById).some(
    (entry) => entry.title || entry.description || entry.keywords,
  );

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
      const lowerName = file.name.toLowerCase();
      if (/\.(eps|ai|ps)$/.test(lowerName)) {
        problems.push(
          `${file.name}: EPS and AI files cannot be previewed in the browser. Convert them to JPG first (the converter arrives in Phase 7).`,
        );
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
      idCounter.current += 1;
      accepted.push({
        id: `image-${idCounter.current}`,
        file,
        url: URL.createObjectURL(file),
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
      .filter((item) => {
        const entry = metaById[item.id];
        return Boolean(entry && (entry.title || entry.description || entry.keywords));
      })
      .map((item) => {
        const entry = metaById[item.id];
        return {
          filename: item.file.name,
          title: entry.title,
          description: entry.description,
          keywords: entry.keywords,
          platform,
        };
      });

    if (rows.length === 0) {
      showNotice(
        "info",
        "Nothing to export yet. Save a title, description or keywords for at least one image first.",
      );
      return;
    }

    const csv = buildCsv(rows);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `metaforge-metadata-${new Date().toISOString().slice(0, 10)}.csv`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const unsaved = FIELD_KEYS.some((key) => editing[key]);
    showNotice(
      "success",
      `Exported ${plural(rows.length, "image")} to CSV.${unsaved ? " Unsaved edits were not included." : ""}`,
    );
  }

  function handleDownloadImage() {
    if (!current) {
      showNotice("info", "Select an image first.");
      return;
    }
    triggerDownload(current.url, current.file.name);
    showNotice("success", `Downloading ${current.file.name}.`);
  }

  const visibleFields = resultTab === "metadata" ? METADATA_FIELDS : PROMPT_FIELDS;
  const activeTool = TOOL_TABS.find((tab) => tab.id === toolTab) ?? TOOL_TABS[0];

  return (
    <div className="mw-page">
      <h1 className="sr-only">Metadata Generator</h1>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept={ACCEPT_ATTRIBUTE}
        onChange={handleInputChange}
      />

      <div className="mw-tabs" role="group" aria-label="Tools">
        {TOOL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="mw-tab"
            aria-pressed={toolTab === tab.id}
            onClick={() => setToolTab(tab.id)}
          >
            <ToolIcon name={tab.icon} size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {toolTab !== "metadata" ? (
        <EmptyState
          icon="imageToPrompt"
          title="Not available yet"
          description={`${activeTool.label} is planned for ${activeTool.phase}. Nothing on this tab processes data yet.`}
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
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                {PLATFORMS.map((name) => (
                  <option key={name} value={name}>
                    {name}
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
                  JPG, PNG, WEBP (max {MAX_FILES} files, {MAX_FILE_MB} MB each). EPS and AI files
                  must be converted to JPG first.
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
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                  >
                    {PROVIDERS.map((name) => (
                      <option key={name} value={name}>
                        {name}
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
                    {MODELS.map((name) => (
                      <option key={name} value={name}>
                        {name}
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
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value)}
                  >
                    {PLATFORMS.map((name) => (
                      <option key={name} value={name}>
                        {name}
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

              <p className="mw-provider-status">
                <span className="status-dot" aria-hidden="true" />
                {provider} is not configured. No AI connection exists yet, so nothing can be
                generated until Phase 2.
              </p>

              <div className="mw-toggles">
                <Toggle
                  id="mw-toggle-fallback"
                  label="Auto Fallback"
                  hint="Use next model if current fails"
                  checked={autoFallback}
                  onChange={setAutoFallback}
                />
                <Toggle
                  id="mw-toggle-first"
                  label="Generate Metadata First"
                  hint="Then Generate Image Prompt"
                  checked={metadataFirst}
                  onChange={setMetadataFirst}
                />
                <Toggle
                  id="mw-toggle-analyze"
                  label="Analyze Image for Best Output"
                  checked={analyzeImage}
                  onChange={setAnalyzeImage}
                />
              </div>

              <p className="mw-note">
                These settings are kept in memory on this page only and have no effect until the AI
                connection is built.
              </p>
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
              <button
                type="button"
                className="mw-chip"
                data-unavailable="true"
                aria-disabled="true"
                title="Needs the AI connection (Phase 2)"
                onClick={() =>
                  showNotice(
                    "info",
                    "Generating metadata needs the AI connection, which is built in Phase 2. Nothing was generated.",
                  )
                }
              >
                <ToolIcon name="sparkles" size={16} />
                Generate Metadata
              </button>
            </div>

            {current ? (
              visibleFields.map((def) => {
                const saved = meta[def.key];
                const shown = editing[def.key] ? drafts[def.key] : saved;
                const stats = getFieldStats(def.key, shown, keywordCount);
                return (
                  <ResultField
                    key={`${current.id}-${def.key}`}
                    id={`mw-field-${def.key}`}
                    label={def.label}
                    tone={def.tone}
                    icon={def.icon}
                    countLabel={stats.countLabel}
                    footer={stats.footer}
                    footerOver={stats.over}
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
              })
            ) : (
              <EmptyState
                icon="metadata"
                title="No image selected"
                description="Select an image above to view and edit its metadata."
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
              <button
                type="button"
                className="mw-action"
                data-tone="violet"
                data-unavailable="true"
                aria-disabled="true"
                title="Needs the AI connection (Phase 4)"
                onClick={() =>
                  showNotice(
                    "info",
                    "Image prompt generation needs the AI connection, planned for Phase 4. Nothing was generated.",
                  )
                }
              >
                <ToolIcon name="sparkles" size={16} />
                Generate Image Prompt (Next)
              </button>
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