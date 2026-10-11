// Shrinks an image in the browser before it is uploaded. This keeps each request small
// (hosting platforms limit request size) and lowers the cost of each AI call.
// Transparent areas become white, because JPEG has no transparency.
//
// SVG files are validated, stripped of active content and rendered through an <img>
// element, which browsers do not allow to run scripts or load external resources.
// EPS and AI files cannot be rendered in the browser (see prepareImageForUpload).

import { isSvgFile, rasterizeSvg } from "./vector";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const SVG_RENDER_TIMEOUT_MS = 10000;

export type VectorKind = "svg" | "eps" | "ai";

// Classifies a file by extension or declared MIME type. Content is validated later.
export function getVectorKind(file: File): VectorKind | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (name.endsWith(".svg") || type === "image/svg+xml") return "svg";
  if (
    name.endsWith(".eps") ||
    type === "application/postscript" ||
    type === "application/eps" ||
    type === "image/x-eps"
  ) {
    return "eps";
  }
  if (name.endsWith(".ai") || type === "application/illustrator" || type === "application/vnd.adobe.illustrator") {
    return "ai";
  }
  return null;
}

async function renderToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser could not prepare the image.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });

  if (!blob) {
    throw new Error("The image could not be converted for upload.");
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error("The image is still too large after resizing.");
  }
  return blob;
}

async function prepareRaster(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser could not read the image.");
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    return await renderToJpeg(bitmap, width, height);
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------- SVG

const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
]);

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

const UNIT_TO_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
};

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value);
  if (!match) return null; // percentages, em, ex and similar are not usable here
  const amount = parseFloat(match[1]);
  if (!isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] || "px").toLowerCase();
  return amount * UNIT_TO_PX[unit];
}

function parseViewBox(value: string | null): { w: number; h: number } | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !isFinite(n))) return null;
  if (parts[2] <= 0 || parts[3] <= 0) return null;
  return { w: parts[2], h: parts[3] };
}

function stripActiveContent(root: Element): void {
  const all = Array.from(root.querySelectorAll("*"));
  all.push(root);
  for (const el of all) {
    if (el !== root && BLOCKED_ELEMENTS.has(el.localName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const local = attr.localName.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (local === "href") {
        const v = attr.value.trim();
        if (!(v.startsWith("#") || SAFE_DATA_IMAGE.test(v))) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("The SVG took too long to render."));
    }, SVG_RENDER_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("The SVG could not be rendered. It may be invalid or use unsupported features."));
    };
    img.src = url;
  });
}

async function prepareSvg(file: File): Promise<Blob> {
  if (file.size === 0) {
    throw new Error("The SVG file is empty.");
  }
  if (file.size > MAX_SVG_BYTES) {
    throw new Error("The SVG file is larger than 2 MB, which is too large to render safely in the browser.");
  }

  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("This SVG file is not valid. It may be corrupt or not an SVG at all.");
  }
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") {
    throw new Error("This file does not contain an SVG image.");
  }

  stripActiveContent(root);

  let w = parseLength(root.getAttribute("width"));
  let h = parseLength(root.getAttribute("height"));
  const viewBox = parseViewBox(root.getAttribute("viewBox"));

  if (!w || !h) {
    if (viewBox) {
      if (w) h = (w * viewBox.h) / viewBox.w;
      else if (h) w = (h * viewBox.w) / viewBox.h;
      else {
        w = viewBox.w;
        h = viewBox.h;
      }
    }
  }
  if (!w || !h) {
    throw new Error("This SVG has no usable size (it needs a width and height, or a viewBox).");
  }

  const scale = MAX_EDGE / Math.max(w, h);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  if (!viewBox) {
    root.setAttribute("viewBox", "0 0 " + w + " " + h);
  }
  root.setAttribute("width", String(outW));
  root.setAttribute("height", String(outH));

  const xml = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await loadImage(url);
    return await renderToJpeg(img, outW, outH);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- entry point

export async function prepareImageForUpload(file: File): Promise<Blob> {
  const kind = getVectorKind(file);
  if (kind === "svg") {
    return prepareSvg(file);
  }
  if (kind === "eps" || kind === "ai") {
    throw new Error(
      "EPS and AI files cannot be rendered in the browser, and the server-side renderer is not installed yet. " +
        "Export this file as SVG, PNG or JPG from your design software."
    );
  }
  return prepareRaster(file);
}