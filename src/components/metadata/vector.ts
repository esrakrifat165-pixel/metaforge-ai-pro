// Safe SVG handling for the browser. Validates the file's real contents, then draws it
// onto a canvas as a JPEG. An SVG drawn through an <img> cannot run scripts, and the
// checks below reject risky files before they are ever drawn.

const MAX_SVG_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_TAGS = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video"]);

export function isSvgFile(file: File): boolean {
  return /\.svg$/i.test(file.name);
}

function fail(file: File, reason: string): Error {
  return new Error(`${file.name}: ${reason}`);
}

function parseSize(value: string | null): number | null {
  if (!value || value.trim().endsWith("%")) {
    return null;
  }
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function checkElementSafety(file: File, root: Element): void {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of all) {
    if (FORBIDDEN_TAGS.has(element.localName.toLowerCase())) {
      throw fail(file, `unsafe SVG content (<${element.localName}> is not allowed).`);
    }
    if (element.localName.toLowerCase() === "style" && /@import|url\(\s*["']?\s*(?!data:image\/|#)/i.test(element.textContent ?? "")) {
      throw fail(file, "unsafe SVG content (external resource in a style).");
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        throw fail(file, "unsafe SVG content (event handler attribute).");
      }
      if (/javascript:/i.test(value)) {
        throw fail(file, "unsafe SVG content (script link).");
      }
      if ((name === "href" || name === "xlink:href") && !(value.startsWith("#") || /^data:image\//i.test(value))) {
        throw fail(file, "unsafe SVG content (external link or resource).");
      }
      if (name === "style" && /url\(\s*["']?\s*(?!data:image\/|#)/i.test(value)) {
        throw fail(file, "unsafe SVG content (external resource in a style).");
      }
    }
  }
}

/** Validates the SVG and returns a copy with explicit pixel size scaled to maxEdge. */
function prepareSvgText(file: File, text: string, maxEdge: number): string {
  const clean = text.replace(/^\uFEFF/, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(clean)) {
    throw fail(file, "unsupported SVG (DOCTYPE or entity declarations are not allowed).");
  }

  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw fail(file, "this is not a valid SVG (the XML is malformed).");
  }
  const root = doc.documentElement;
  if (root.localName.toLowerCase() !== "svg") {
    throw fail(file, "this is not an SVG image.");
  }

  checkElementSafety(file, root);

  let width = parseSize(root.getAttribute("width"));
  let height = parseSize(root.getAttribute("height"));
  const viewBox = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const hasViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;

  if (hasViewBox) {
    width = width ?? viewBox[2];
    height = height ?? viewBox[3];
    if (parseSize(root.getAttribute("width")) === null || parseSize(root.getAttribute("height")) === null) {
      // Keep the artwork's own proportions when only some sizes were given.
      width = viewBox[2];
      height = viewBox[3];
    }
  } else if (width === null || height === null) {
    throw fail(file, "the SVG has no usable width, height or viewBox, so its size is unknown.");
  } else {
    root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const scale = maxEdge / Math.max(width as number, height as number);
  root.setAttribute("width", String(Math.max(1, Math.round((width as number) * scale))));
  root.setAttribute("height", String(Math.max(1, Math.round((height as number) * scale))));

  return new XMLSerializer().serializeToString(root);
}

export async function rasterizeSvg(file: File, maxEdge: number, quality: number): Promise<Blob> {
  if (file.size === 0) {
    throw fail(file, "the file is empty.");
  }
  if (file.size > MAX_SVG_BYTES) {
    throw fail(file, "the SVG is larger than 5 MB.");
  }

  const svgText = prepareSvgText(file, await file.text(), maxEdge);
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(fail(file, "the browser could not draw this SVG."));
      image.src = url;
    });

    const width = Math.max(1, image.naturalWidth);
    const height = Math.max(1, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw fail(file, "this browser could not prepare the image.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) {
      throw fail(file, "the SVG could not be converted for upload.");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}