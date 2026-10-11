"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  ASPECTS,
  BASE_WIDTH,
  EXPORT_SCALE,
  LAYOUTS,
  MAX_IMAGES,
  computeCells,
  isLayoutId,
  placeCells,
  type LayoutId,
} from "./bentoLayouts";
import "./bento.css";

type Item = { id: string; file: File; url: string };
type Notice = { kind: "success" | "error" | "info"; text: string } | null;
type Fit = "cover" | "contain";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_MB = 15;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const DEFAULTS = {
  layout: "balanced" as LayoutId,
  aspect: "1:1",
  background: "#0d0f22",
  gap: 16,
  padding: 24,
  radius: 24,
  fit: "cover" as Fit,
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("One of the images could not be loaded."));
    image.src = url;
  });
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fit: Fit,
) {
  ctx.save();
  roundedPath(ctx, x, y, w, h, radius);
  ctx.clip();
  const scale =
    fit === "cover"
      ? Math.max(w / image.naturalWidth, h / image.naturalHeight)
      : Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

export function BentoWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const itemsRef = useRef<Item[]>([]);

  const [items, setItems] = useState<Item[]>([]);
  const [layout, setLayout] = useState<LayoutId>(DEFAULTS.layout);
  const [aspectId, setAspectId] = useState(DEFAULTS.aspect);
  const [background, setBackground] = useState(DEFAULTS.background);
  const [gap, setGap] = useState(DEFAULTS.gap);
  const [padding, setPadding] = useState(DEFAULTS.padding);
  const [radius, setRadius] = useState(DEFAULTS.radius);
  const [fit, setFit] = useState<Fit>(DEFAULTS.fit);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  const aspect = ASPECTS.find((entry) => entry.id === aspectId) ?? ASPECTS[0];
  const baseHeight = BASE_WIDTH / aspect.ratio;
  const cells = computeCells(layout, items.length);
  const rects = placeCells(cells, BASE_WIDTH, baseHeight, padding, gap);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) {
      return;
    }
    const problems: string[] = [];
    const accepted: Item[] = [];
    let room = MAX_IMAGES - items.length;

    for (const file of incoming) {
      if (!ACCEPTED.includes(file.type)) {
        problems.push(`${file.name}: use JPG, PNG or WebP.`);
      } else if (file.size === 0) {
        problems.push(`${file.name}: the file is empty.`);
      } else if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: larger than ${MAX_MB} MB.`);
      } else if (room <= 0) {
        problems.push(`${file.name}: skipped, the limit is ${MAX_IMAGES} images.`);
      } else {
        idCounter.current += 1;
        accepted.push({ id: `bento-${idCounter.current}`, file, url: URL.createObjectURL(file) });
        room -= 1;
      }
    }

    if (accepted.length > 0) {
      setItems((previous) => [...previous, ...accepted]);
    }
    if (problems.length > 0) {
      const shown = problems.slice(0, 4).join(" ");
      setNotice({ kind: "error", text: problems.length > 4 ? `${shown} And ${problems.length - 4} more.` : shown });
    } else {
      setNotice({ kind: "success", text: `Added ${accepted.length} image${accepted.length === 1 ? "" : "s"}.` });
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      addFiles(event.target.files);
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
    addFiles(event.dataTransfer.files);
  }

  function removeItem(id: string) {
    const target = items.find((item) => item.id === id);
    if (target) {
      URL.revokeObjectURL(target.url);
    }
    setItems((previous) => previous.filter((item) => item.id !== id));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }
    setItems((previous) => {
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function resetNow() {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
    setLayout(DEFAULTS.layout);
    setAspectId(DEFAULTS.aspect);
    setBackground(DEFAULTS.background);
    setGap(DEFAULTS.gap);
    setPadding(DEFAULTS.padding);
    setRadius(DEFAULTS.radius);
    setFit(DEFAULTS.fit);
    setConfirmReset(false);
    setNotice({ kind: "info", text: "Workspace reset." });
  }

  function requestReset() {
    if (items.length > 0) {
      setConfirmReset(true);
    } else {
      resetNow();
    }
  }

  async function exportPng() {
    if (items.length === 0) {
      setNotice({ kind: "error", text: "Add at least one image before exporting." });
      return;
    }
    if (exporting) {
      return;
    }
    setExporting(true);
    setNotice({ kind: "info", text: "Rendering the PNG..." });

    try {
      const width = BASE_WIDTH * EXPORT_SCALE;
      const height = Math.round(width / aspect.ratio);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("This browser cannot create a drawing canvas.");
      }

      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      for (let index = 0; index < items.length; index += 1) {
        const image = await loadImage(items[index].url);
        const rect = rects[index];
        drawTile(
          ctx,
          image,
          rect.left * EXPORT_SCALE,
          rect.top * EXPORT_SCALE,
          rect.width * EXPORT_SCALE,
          rect.height * EXPORT_SCALE,
          radius * EXPORT_SCALE,
          fit,
        );
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        throw new Error("The browser could not create the PNG file.");
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "metaforge-bento-design.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ kind: "success", text: `Downloaded metaforge-bento-design.png (${width} x ${height}).` });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? `Export failed: ${error.message}` : "Export failed.",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page bn-page">
      <header className="page-header">
        <span className="eyebrow">Creative tools</span>
        <h1>Bento Builder</h1>
        <p>Arrange images into a bento layout and export it as a PNG. Images stay in your browser.</p>
      </header>

      <div role="status" aria-live="polite">
        {notice ? (
          <p className="bn-notice" data-kind={notice.kind}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={onInputChange}
      />

      <div className="bn-grid">
        <div className="bn-side">
          <section className="card bn-block" aria-labelledby="bn-upload-title">
            <h2 id="bn-upload-title" className="section-title">1. Images</h2>
            <div
              className="bn-drop"
              data-dragging={dragging ? "true" : "false"}
              onDragEnter={onDragOver}
              onDragOver={onDragOver}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <p>Drag and drop images here</p>
              <p className="bn-hint">JPG, PNG or WebP, up to {MAX_MB} MB each, max {MAX_IMAGES} images.</p>
              <button type="button" className="button" onClick={() => inputRef.current?.click()}>
                Select files
              </button>
            </div>

            {items.length === 0 ? (
              <p className="bn-hint">No images yet.</p>
            ) : (
              <ul className="bn-list" aria-label="Uploaded images">
                {items.map((item, index) => (
                  <li key={item.id} className="bn-row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="" className="bn-thumb" />
                    <span className="bn-name">
                      {index + 1}. {item.file.name}
                    </span>
                    <span className="bn-row-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={() => moveItem(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${item.file.name} earlier`}
                      >
                        &larr;
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => moveItem(index, 1)}
                        disabled={index === items.length - 1}
                        aria-label={`Move ${item.file.name} later`}
                      >
                        &rarr;
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card bn-block" aria-labelledby="bn-layout-title">
            <h2 id="bn-layout-title" className="section-title">2. Layout</h2>
            <div className="bn-presets" role="group" aria-label="Layout presets">
              {LAYOUTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="bn-preset"
                  aria-pressed={layout === entry.id}
                  onClick={() => setLayout(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </section>

          <section className="card bn-block" aria-labelledby="bn-canvas-title">
            <h2 id="bn-canvas-title" className="section-title">3. Canvas</h2>
            <div className="bn-field">
              <label htmlFor="bn-aspect">Aspect ratio</label>
              <select id="bn-aspect" value={aspectId} onChange={(event) => setAspectId(event.target.value)}>
                {ASPECTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="bn-field">
              <label htmlFor="bn-bg">Background color</label>
              <input id="bn-bg" type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
            </div>
            <div className="bn-field">
              <label htmlFor="bn-gap">Gap: {gap}</label>
              <input id="bn-gap" type="range" min={0} max={60} value={gap} onChange={(event) => setGap(Number(event.target.value))} />
            </div>
            <div className="bn-field">
              <label htmlFor="bn-pad">Outer padding: {padding}</label>
              <input id="bn-pad" type="range" min={0} max={120} value={padding} onChange={(event) => setPadding(Number(event.target.value))} />
            </div>
            <div className="bn-field">
              <label htmlFor="bn-radius">Corner radius: {radius}</label>
              <input id="bn-radius" type="range" min={0} max={80} value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
            </div>
            <div className="bn-field">
              <label htmlFor="bn-fit">Image fit</label>
              <select
                id="bn-fit"
                value={fit}
                onChange={(event) => setFit(event.target.value === "contain" ? "contain" : "cover")}
              >
                <option value="cover">Cover (crop to fill)</option>
                <option value="contain">Contain (show whole image)</option>
              </select>
            </div>
          </section>
        </div>

        <section className="card bn-preview-card" aria-labelledby="bn-preview-title">
          <div className="bn-preview-head">
            <h2 id="bn-preview-title" className="section-title">Preview</h2>
            <div className="bn-actions">
              <button type="button" className="button button-primary" onClick={() => void exportPng()} disabled={exporting}>
                {exporting ? "Exporting..." : "Export PNG"}
              </button>
              <button type="button" className="button" onClick={requestReset}>
                Reset
              </button>
            </div>
          </div>

          {confirmReset ? (
            <div className="bn-confirm" role="alertdialog" aria-label="Confirm reset">
              <span>Remove all images and restore default settings?</span>
              <button type="button" className="button" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button type="button" className="button bn-danger" onClick={resetNow}>
                Yes, reset
              </button>
            </div>
          ) : null}

          <div className="bn-canvas" style={{ aspectRatio: `${aspect.ratio}`, background }}>
            {items.length === 0 ? (
              <p className="bn-empty">Add images to see your layout here.</p>
            ) : (
              items.map((item, index) => {
                const rect = rects[index];
                if (!rect) {
                  return null;
                }
                return (
                  <div
                    key={item.id}
                    className="bn-tile"
                    style={{
                      left: `${(rect.left / BASE_WIDTH) * 100}%`,
                      top: `${(rect.top / baseHeight) * 100}%`,
                      width: `${(rect.width / BASE_WIDTH) * 100}%`,
                      height: `${(rect.height / baseHeight) * 100}%`,
                      borderRadius: `${(radius / BASE_WIDTH) * 100}cqw`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={`Tile ${index + 1}: ${item.file.name}`}
                      style={{ objectFit: fit }}
                    />
                  </div>
                );
              })
            )}
          </div>
          <p className="bn-hint">
            Export size: {BASE_WIDTH * EXPORT_SCALE} x {Math.round((BASE_WIDTH * EXPORT_SCALE) / aspect.ratio)} px.
          </p>
        </section>
      </div>
    </div>
  );
}