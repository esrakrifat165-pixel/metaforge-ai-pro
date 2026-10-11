// Detection and conversion for the JPG converter. Runs in the browser only.

export type Detected = "jpeg" | "png" | "webp" | "svg" | "pdf" | "eps" | "unknown";

export type ConvertSettings = {
  quality: number; // 10 to 100
  width: number | null;
  height: number | null;
  keepAspect: boolean;
  background: string;
};

export const MAX_FILES = 30;
export const MAX_FILE_MB = 25;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_SIDE = 8000;
export const MAX_PIXELS = 36_000_000;

/** Decides the real type from the first bytes, not from the file name. */
export async function detectFormat(file: File): Promise<Detected> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "jpeg";
  }
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "png";
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...Array.from(head.slice(start, end)));
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "webp";
  }
  if (head.length >= 4 && ascii(0, 4) === "%PDF") {
    return "pdf";
  }
  if (head.length >= 4 && head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6) {
    return "eps"; // EPS with a binary header
  }
  if (head.length >= 2 && ascii(0, 2) === "%!") {
    return "eps";
  }
  const text = new TextDecoder().decode(head);
  if (/<svg[\s>]/i.test(text)) {
    return "svg";
  }
  return "unknown";
}

export function checkSettings(s: ConvertSettings): string | null {
  if (!Number.isInteger(s.quality) || s.quality < 10 || s.quality > 100) {
    return "Quality must be between 10 and 100.";
  }
  for (const [label, value] of [["Width", s.width], ["Height", s.height]] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > MAX_SIDE)) {
      return `${label} must be a whole number from 1 to ${MAX_SIDE}, or left blank.`;
    }
  }
  if (s.width !== null && s.height !== null && s.width * s.height > MAX_PIXELS) {
    return "The output size is too large for the browser. Use smaller dimensions.";
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The file could not be decoded. It may be corrupt."));
    image.src = url;
  });
}

export type Converted = { blob: Blob; width: number; height: number };

export async function convertToJpeg(file: File, s: ConvertSettings): Promise<Converted> {
  const problem = checkSettings(s);
  if (problem) {
    throw new Error(problem);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    // Some browsers report 0 for an SVG with no fixed size.
    const sw = image.naturalWidth || 1000;
    const sh = image.naturalHeight || 1000;

    let ow: number;
    let oh: number;
    if (s.keepAspect) {
      let k = 1;
      if (s.width !== null && s.height !== null) {
        k = Math.min(s.width / sw, s.height / sh);
      } else if (s.width !== null) {
        k = s.width / sw;
      } else if (s.height !== null) {
        k = s.height / sh;
      }
      ow = Math.max(1, Math.round(sw * k));
      oh = Math.max(1, Math.round(sh * k));
    } else {
      ow = s.width ?? sw;
      oh = s.height ?? sh;
    }

    if (ow > MAX_SIDE || oh > MAX_SIDE || ow * oh > MAX_PIXELS) {
      throw new Error("The output would be too large for the browser. Set a smaller width or height.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("This browser cannot create a drawing canvas.");
    }
    // JPEG has no transparency, so transparent areas are filled with the chosen color.
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, ow, oh);
    ctx.drawImage(image, 0, 0, ow, oh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", s.quality / 100),
    );
    if (!blob || blob.size < 100) {
      throw new Error("The browser could not create the JPG.");
    }
    const bytes = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error("The generated file is not a valid JPG.");
    }
    return { blob, width: ow, height: oh };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function safeBaseName(fileName: string): string {
  const cleaned = Array.from(fileName.replace(/\.[^.]+$/, ""))
    .filter((c) => c.charCodeAt(0) >= 32 && !'/\\:*?"<>|'.includes(c))
    .join("")
    .trim()
    .slice(0, 80);
  return cleaned || "converted";
}