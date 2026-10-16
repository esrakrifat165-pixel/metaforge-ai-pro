"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  buildPsd,
  checkDimensions,
  drawComposite,
  renderPng,
  type Fit,
  type PsdSettings,
} from "./psdExport";
import "./psd.css";

type Item = {
  id: string;
  file: File;
  url: string;
  img: HTMLImageElement;
  name: string;
  visible: boolean;
};
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const EXTENSION = /\.(jpe?g|png|webp)$/i;
const MAX_IMAGES = 20;
const MAX_MB = 20;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const PREVIEW_WIDTH = 800;

const PRESETS = [
  { id: "1080x1080", label: "1080 x 1080", w: 1080, h: 1080 },
  { id: "1920x1080", label: "1920 x 1080", w: 1920, h: 1080 },
  { id: "3000x2000", label: "3000 x 2000", w: 3000, h: 2000 },
];

function layerName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").slice(0, 60) || "Layer";
}

function decode(file: File): Promise<{ url: string; img: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, img });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not be decoded as an image."));
    };
    img.src = url;
  });
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PsdWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const idCounter = useRef(0);
  const itemsRef = useRef<Item[]>([]);

  const [items, setItems] = useState<Item[]>([]); // index 0 = top layer
  const [preset, setPreset] = useState("1080x1080");
  const [widthText, setWidthText] = useState("1080");
  const [heightText, setHeightText] = useState("1080");
  const [dpiText, setDpiText] = useState("72");
  const [paddingText, setPaddingText] = useState("0");
  const [transparent, setTransparent] = useState(true);
  const [background, setBackground] = useState("#ffffff");
  const [fit, setFit] = useState<Fit>("contain");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const width = Number(widthText);
  const height = Number(heightText);
  const dpi = Number(dpiText);
  const padding = Number(paddingText);
  const dimError = checkDimensions(width, height, padding, dpi);

  const settings: PsdSettings = useMemo(
    () => ({ width, height, dpi, transparent, background, fit, padding }),
    [width, height, dpi, transparent, background, fit, padding],
  );

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) {
      return;
    }
    if (checkDimensions(settings.width, settings.height, settings.padding, settings.dpi)) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    const scale = Math.min(1, PREVIEW_WIDTH / settings.width);
    canvas.width = Math.max(1, Math.round(settings.width * scale));
    canvas.height = Math.max(1, Math.round(settings.height * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      drawComposite(ctx, scale, items, settings);
    }
  }, [items, settings]);

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) {
      return;
    }
    const problems: string[] = [];
    const accepted: Item[] = [];
    let room = MAX_IMAGES - items.length;

    for (const file of incoming) {
      if (!ACCEPTED.includes(file.type) || !EXTENSION.test(file.name)) {
        problems.push(`${file.name}: use JPG, PNG or WebP.`);
      } else if (file.size === 0) {
        problems.push(`${file.name}: the file is empty.`);
      } else if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: larger than ${MAX_MB} MB.`);
      } else if (room <= 0) {
        problems.push(`${file.name}: skipped, the limit is ${MAX_IMAGES} images.`);
      } else {
        try {
          const { url, img } = await decode(file);
          idCounter.current += 1;
          accepted.push({ id: `psd-${idCounter.current}`, file, url, img, name: layerName(file.name), visible: true });
          room -= 1;
        } catch (error) {
          problems.push(`${file.name}: ${error instanceof Error ? error.message : "could not be read."}`);
        }
      }
    }

    if (accepted.length > 0) {
      // New images go on top.
      setItems((previous) => [...accepted.reverse(), ...previous]);
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

  function updateItem(id: string, change: Partial<Pick<Item, "name" | "visible">>) {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...change } : item)));
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

  function changePreset(value: string) {
    setPreset(value);
    const chosen = PRESETS.find((entry) => entry.id === value);
    if (chosen) {
      setWidthText(String(chosen.w));
      setHeightText(String(chosen.h));
    }
  }

  function resetNow() {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
    changePreset("1080x1080");
    setDpiText("72");
    setPaddingText("0");
    setTransparent(true);
    setBackground("#ffffff");
    setFit("contain");
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

  async function exportPsd() {
    if (busy) {
      return;
    }
    if (dimError) {
      setNotice({ kind: "error", text: dimError });
      return;
    }
    if (items.length === 0) {
      setNotice({ kind: "error", text: "Add at least one image first." });
      return;
    }
    setBusy(true);
    setNotice({ kind: "info", text: "Building the PSD..." });
    try {
      const blob = await buildPsd(items, settings);
      download(blob, "metaforge-image-to-psd.psd");
      setNotice({
        kind: "success",
        text: `PSD created and checked (${(blob.size / 1024 / 1024).toFixed(1)} MB, ${items.length} image layer${items.length === 1 ? "" : "s"}). Open it in Photoshop to confirm.`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? `PSD export failed: ${error.message}` : "PSD export failed." });
    } finally {
      setBusy(false);
    }
  }

  async function exportPngPreview() {
    if (busy) {
      return;
    }
    if (dimError || items.length === 0) {
      setNotice({ kind: "error", text: dimError ?? "Add at least one image first." });
      return;
    }
    setBusy(true);
    try {
      const blob = await renderPng(items, settings);
      download(blob, "metaforge-image-to-psd-preview.png");
      setNotice({ kind: "success", text: "Downloaded a flattened PNG preview. It is not a PSD." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? `PNG export failed: ${error.message}` : "PNG export failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page ps-page">
      <header className="page-header">
        <span className="eyebrow">Creative tools</span>
        <h1>Image-to-PSD</h1>
        <p>
          Convert images into a layered Photoshop document. JPG, PNG or WebP, up to {MAX_MB} MB each and {MAX_IMAGES} images.
          Everything runs in your browser.
        </p>
      </header>

      <div role="status" aria-live="polite">
        {notice ? (
          <p className="ps-notice" data-kind={notice.kind}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <input ref={inputRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={onInputChange} />

      <div className="ps-grid">
        <div className="ps-side">
          <section className="card ps-block" aria-labelledby="ps-up">
            <h2 id="ps-up" className="section-title">1. Images (top layer first)</h2>
            <div
              className="ps-drop"
              data-dragging={dragging ? "true" : "false"}
              onDragEnter={onDragOver}
              onDragOver={onDragOver}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <p>Drag and drop images here</p>
              <button type="button" className="button" onClick={() => inputRef.current?.click()}>
                Browse files
              </button>
            </div>

            {items.length === 0 ? (
              <p className="ps-hint">No images yet.</p>
            ) : (
              <ul className="ps-list" aria-label="Layers">
                {items.map((item, index) => (
                  <li key={item.id} className="ps-row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="" className="ps-thumb" />
                    <div className="ps-info">
                      <label className="sr-only" htmlFor={`ps-name-${item.id}`}>Layer name</label>
                      <input
                        id={`ps-name-${item.id}`}
                        value={item.name}
                        maxLength={60}
                        onChange={(event) => updateItem(item.id, { name: event.target.value })}
                      />
                      <span className="ps-hint">
                        {item.img.naturalWidth} x {item.img.naturalHeight} px - {(item.file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                    <div className="ps-row-actions">
                      <label className="ps-check">
                        <input
                          type="checkbox"
                          checked={item.visible}
                          onChange={(event) => updateItem(item.id, { visible: event.target.checked })}
                        />
                        Visible
                      </label>
                      <button type="button" className="button" onClick={() => moveItem(index, -1)} disabled={index === 0} aria-label={`Move ${item.name} up`}>
                        Up
                      </button>
                      <button type="button" className="button" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1} aria-label={`Move ${item.name} down`}>
                        Down
                      </button>
                      <button type="button" className="button" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card ps-block" aria-labelledby="ps-doc">
            <h2 id="ps-doc" className="section-title">2. Document</h2>
            <div className="ps-field">
              <label htmlFor="ps-preset">Size preset</label>
              <select id="ps-preset" value={preset} onChange={(event) => changePreset(event.target.value)}>
                {PRESETS.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="ps-two">
              <div className="ps-field">
                <label htmlFor="ps-w">Width (px)</label>
                <input id="ps-w" inputMode="numeric" value={widthText} onChange={(event) => { setPreset("custom"); setWidthText(event.target.value); }} />
              </div>
              <div className="ps-field">
                <label htmlFor="ps-h">Height (px)</label>
                <input id="ps-h" inputMode="numeric" value={heightText} onChange={(event) => { setPreset("custom"); setHeightText(event.target.value); }} />
              </div>
            </div>
            <div className="ps-two">
              <div className="ps-field">
                <label htmlFor="ps-dpi">Resolution (PPI metadata)</label>
                <input id="ps-dpi" inputMode="numeric" value={dpiText} onChange={(event) => setDpiText(event.target.value)} />
              </div>
              <div className="ps-field">
                <label htmlFor="ps-pad">Padding (px)</label>
                <input id="ps-pad" inputMode="numeric" value={paddingText} onChange={(event) => setPaddingText(event.target.value)} />
              </div>
            </div>
            <div className="ps-field">
              <label htmlFor="ps-fit">Image fit</label>
              <select id="ps-fit" value={fit} onChange={(event) => setFit(event.target.value === "cover" ? "cover" : "contain")}>
                <option value="contain">Contain (whole image)</option>
                <option value="cover">Cover (crop to fill)</option>
              </select>
            </div>
            <label className="ps-check">
              <input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} />
              Transparent background
            </label>
            {!transparent ? (
              <div className="ps-field">
                <label htmlFor="ps-bg">Background color</label>
                <input id="ps-bg" type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
              </div>
            ) : null}
            {dimError ? <p className="ps-error" role="alert">{dimError}</p> : null}
            <p className="ps-hint">
              Resolution is metadata only. It does not add detail to the images. Layers keep the source pixels and are
              scaled only to fit the document.
            </p>
          </section>
        </div>

        <section className="card ps-preview-card" aria-labelledby="ps-prev">
          <div className="ps-preview-head">
            <h2 id="ps-prev" className="section-title">Preview</h2>
            <div className="ps-actions">
              <button type="button" className="button button-primary" onClick={() => void exportPsd()} disabled={busy}>
                {busy ? "Working..." : "Export PSD"}
              </button>
              <button type="button" className="button" onClick={() => void exportPngPreview()} disabled={busy}>
                Export PNG preview
              </button>
              <button type="button" className="button" onClick={requestReset}>
                Reset
              </button>
            </div>
          </div>

          {confirmReset ? (
            <div className="ps-confirm" role="alertdialog" aria-label="Confirm reset">
              <span>Remove all images and restore default settings?</span>
              <button type="button" className="button" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button type="button" className="button ps-danger" onClick={resetNow}>Yes, reset</button>
            </div>
          ) : null}

          <div className="ps-stage">
            <canvas ref={previewRef} className="ps-canvas" aria-label="Document preview" />
            {items.length === 0 ? <p className="ps-empty">Add images to see the document here.</p> : null}
          </div>
          <p className="ps-hint">
            All images are placed in the same area, one above another, like Photoshop layers. The top layer hides the
            ones below unless it is smaller or hidden. Raster layers only. No text, vector or adjustment layers.
          </p>
        </section>
      </div>
    </div>
  );
}