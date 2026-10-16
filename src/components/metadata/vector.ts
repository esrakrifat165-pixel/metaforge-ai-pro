
 // Safe SVG handling: validate SVG markup, rasterize to JPEG, and never load external DTDs.
const MAX_SVG_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
]);

export function isSvgFile(file: File): boolean {
  return /\.svg$/i.test(file.name);
}

function fail(file: File, reason: string): Error {
  return new Error(`${file.name}: ${reason}`);
}

function parseSize(value: string | null): number | null {
  if (!value || value.trim().endsWith("%")) return null;

  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Accept only the standard external SVG 1.1 DOCTYPE used by many vector files.
 * Remove it before parsing so the browser never needs to resolve an external DTD.
 * Unknown DOCTYPE declarations and all ENTITY declarations remain forbidden.
 */
function sanitizeSvgDeclaration(file: File, source: string): string {
  let clean = source.replace(/^\uFEFF/, "");

  if (/<!ENTITY\b/i.test(clean)) {
    throw fail(file, "unsupported SVG (entity declarations are not allowed).");
  }

  if (/<!DOCTYPE\b/i.test(clean)) {
    const standardSvgDoctype =
      /<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])-\/\/W3C\/\/DTD SVG 1\.1\/\/EN\1\s+(["'])https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd\2\s*>/i;

    const match = clean.match(standardSvgDoctype);

    if (!match) {
      throw fail(
        file,
        "unsupported SVG (only the standard SVG 1.1 DOCTYPE is accepted).",
      );
    }

    clean = clean.replace(match[0], "");

    if (/<!DOCTYPE\b|<!ENTITY\b/i.test(clean)) {
      throw fail(file, "unsupported SVG (additional XML declarations are not allowed).");
    }
  }

  return clean;
}

function hasUnsafeCssUrl(value: string): boolean {
  const urls = value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi);

  for (const match of urls) {
    const target = (match[2] ?? "").trim();

    if (
      !target.startsWith("#") &&
      !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(target)
    ) {
      return true;
    }
  }

  return false;
}

function checkElementSafety(file: File, root: Element): void {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];

  for (const element of all) {
    const tag = element.localName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      throw fail(file, `unsafe SVG content (<${tag}> is not allowed).`);
    }

    if (tag === "style") {
      const css = element.textContent ?? "";

      if (/@import\b/i.test(css) || hasUnsafeCssUrl(css)) {
        throw fail(file, "unsafe SVG content (external resource in a style).");
      }
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on")) {
        throw fail(file, "unsafe SVG content (event handler attribute).");
      }

      if (/javascript\s*:/i.test(value)) {
        throw fail(file, "unsafe SVG content (script link).");
      }

      if (name === "href" || name === "xlink:href") {
        const isLocalReference = value.startsWith("#");
        const isRasterData =
          /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value);

        if (!isLocalReference && !isRasterData) {
          throw fail(file, "unsafe SVG content (external link or resource).");
        }
      }

      if (name === "style" && hasUnsafeCssUrl(value)) {
        throw fail(file, "unsafe SVG content (external resource in a style).");
      }
    }
  }
}

/** Validate SVG markup and set explicit pixel dimensions. */
function prepareSvgText(
  file: File,
  text: string,
  maxEdge: number,
): string {
  if (!Number.isFinite(maxEdge) || maxEdge < 1) {
    throw fail(file, "invalid image conversion size.");
  }

  const clean = sanitizeSvgDeclaration(file, text);
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");

  if (
    doc.documentElement.localName.toLowerCase() === "parsererror" ||
    doc.querySelector("parsererror")
  ) {
    throw fail(file, "this is not a valid SVG (the XML is malformed).");
  }

  const root = doc.documentElement;

  if (
    root.localName.toLowerCase() !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    throw fail(file, "this is not a valid SVG image.");
  }

  checkElementSafety(file, root);

  let width = parseSize(root.getAttribute("width"));
  let height = parseSize(root.getAttribute("height"));

  const viewBoxValues = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);

  const hasViewBox =
    viewBoxValues.length === 4 &&
    viewBoxValues.every(Number.isFinite) &&
    viewBoxValues[2] > 0 &&
    viewBoxValues[3] > 0;

  if (hasViewBox) {
    const viewWidth = viewBoxValues[2];
    const viewHeight = viewBoxValues[3];

    if (width === null || height === null) {
      width = viewWidth;
      height = viewHeight;
    }
  } else if (width === null || height === null) {
    throw fail(file, "the SVG has no usable width, height or viewBox.");
  } else {
    root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const originalWidth = width as number;
  const originalHeight = height as number;
  const scale = Math.min(
    maxEdge / Math.max(originalWidth, originalHeight),
    1,
  );

  root.setAttribute(
    "width",
    String(Math.max(1, Math.round(originalWidth * scale))),
  );
  root.setAttribute(
    "height",
    String(Math.max(1, Math.round(originalHeight * scale))),
  );

  return new XMLSerializer().serializeToString(root);
}

export async function rasterizeSvg(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  if (file.size === 0) {
    throw fail(file, "the file is empty.");
  }

  if (file.size > MAX_SVG_BYTES) {
    throw fail(file, "the SVG is larger than 5 MB.");
  }

  const safeQuality = Math.max(0, Math.min(1, quality));
  const svgText = prepareSvgText(file, await file.text(), maxEdge);
  const blobUrl = URL.createObjectURL(
    new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }),
  );

  try {
    const image = new Image();

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(fail(file, "the browser could not draw this SVG."));
      image.src = blobUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;

    if (
      width < 1 ||
      height < 1 ||
      width > maxEdge ||
      height > maxEdge
    ) {
      throw fail(file, "the converted SVG dimensions are invalid.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw fail(file, "this browser could not prepare the image.");
    }

    // JPEG has no transparency, so use a white background.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const output = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", safeQuality);
    });

    if (!output) {
      throw fail(file, "the SVG could not be converted to JPEG.");
    }

    return output;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
