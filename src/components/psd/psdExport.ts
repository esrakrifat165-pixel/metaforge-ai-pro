// Layout, drawing and PSD writing for Image-to-PSD. Runs in the browser only.

export type Fit = "contain" | "cover";

export type PsdSettings = {
  width: number;
  height: number;
  dpi: number;
  transparent: boolean;
  background: string;
  fit: Fit;
  padding: number;
};

export type PsdLayerInput = {
  id: string;
  name: string;
  visible: boolean;
  img: HTMLImageElement;
};

export const MAX_SIDE = 8000;
export const MAX_PIXELS = 36_000_000;
const MAX_LAYER_PIXELS_TOTAL = 150_000_000;

export function checkDimensions(width: number, height: number, padding: number, dpi: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return "Width and height must be whole numbers of at least 1 pixel.";
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    return `Width and height can be at most ${MAX_SIDE} pixels.`;
  }
  if (width * height > MAX_PIXELS) {
    return "The document is too large for the browser. Reduce the width or height.";
  }
  if (!Number.isInteger(padding) || padding < 0 || padding * 2 >= Math.min(width, height)) {
    return "Padding must be a whole number that leaves room for the images.";
  }
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 1200) {
    return "Resolution must be a whole number from 1 to 1200.";
  }
  return null;
}

type Placement = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the image is drawn, relative to the layer's top-left corner. */
  ox: number;
  oy: number;
  dw: number;
  dh: number;
};

export function placeLayer(img: HTMLImageElement, s: PsdSettings): Placement {
  const areaW = Math.max(1, s.width - 2 * s.padding);
  const areaH = Math.max(1, s.height - 2 * s.padding);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  if (s.fit === "cover") {
    const k = Math.max(areaW / iw, areaH / ih);
    const dw = iw * k;
    const dh = ih * k;
    return { left: s.padding, top: s.padding, width: areaW, height: areaH, ox: (areaW - dw) / 2, oy: (areaH - dh) / 2, dw, dh };
  }

  const k = Math.min(areaW / iw, areaH / ih);
  const dw = Math.max(1, Math.round(iw * k));
  const dh = Math.max(1, Math.round(ih * k));
  return {
    left: Math.round(s.padding + (areaW - dw) / 2),
    top: Math.round(s.padding + (areaH - dh) / 2),
    width: dw,
    height: dh,
    ox: 0,
    oy: 0,
    dw,
    dh,
  };
}

/** Draws the flattened document. layers[0] is the TOP layer. */
export function drawComposite(
  ctx: CanvasRenderingContext2D,
  scale: number,
  layers: PsdLayerInput[],
  s: PsdSettings,
) {
  ctx.clearRect(0, 0, s.width * scale, s.height * scale);
  if (!s.transparent) {
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, s.width * scale, s.height * scale);
  }
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!layer.visible) {
      continue;
    }
    const p = placeLayer(layer.img, s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.left * scale, p.top * scale, p.width * scale, p.height * scale);
    ctx.clip();
    ctx.drawImage(layer.img, (p.left + p.ox) * scale, (p.top + p.oy) * scale, p.dw * scale, p.dh * scale);
    ctx.restore();
  }
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("This browser cannot create a drawing canvas.");
  }
  return { canvas, ctx };
}

export function renderPng(layers: PsdLayerInput[], s: PsdSettings): Promise<Blob> {
  const { canvas, ctx } = makeCanvas(s.width, s.height);
  drawComposite(ctx, 1, layers, s);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not create the PNG."))), "image/png");
  });
}

export async function buildPsd(layers: PsdLayerInput[], s: PsdSettings): Promise<Blob> {
  const problem = checkDimensions(s.width, s.height, s.padding, s.dpi);
  if (problem) {
    throw new Error(problem);
  }
  if (layers.length === 0) {
    throw new Error("Add at least one image first.");
  }

  const placements = layers.map((layer) => placeLayer(layer.img, s));
  const layerPixels = placements.reduce((sum, p) => sum + p.width * p.height, 0) + (s.transparent ? 0 : s.width * s.height);
  if (layerPixels > MAX_LAYER_PIXELS_TOTAL) {
    throw new Error("The layers need too much memory. Use a smaller document or fewer images.");
  }

  const { writePsd, readPsd } = await import("ag-psd");

  const children: import("ag-psd").Layer[] = [];

  if (!s.transparent) {
    const bg = makeCanvas(s.width, s.height);
    bg.ctx.fillStyle = s.background;
    bg.ctx.fillRect(0, 0, s.width, s.height);
    children.push({ name: "Background", top: 0, left: 0, canvas: bg.canvas });
  }

  // ag-psd lists the BOTTOM layer first, so walk our list from the bottom up.
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    const p = placements[index];
    const { canvas, ctx } = makeCanvas(p.width, p.height);
    if (s.fit === "cover") {
      ctx.drawImage(layer.img, p.ox, p.oy, p.dw, p.dh);
    } else {
      ctx.drawImage(layer.img, 0, 0, p.width, p.height);
    }
    children.push({
      name: layer.name.trim() || `Layer ${index + 1}`,
      left: p.left,
      top: p.top,
      canvas,
      hidden: !layer.visible,
      opacity: 1,
    });
  }

  const composite = makeCanvas(s.width, s.height);
  drawComposite(composite.ctx, 1, layers, s);

  const buffer = writePsd(
    {
      width: s.width,
      height: s.height,
      children,
      canvas: composite.canvas,
      imageResources: {
        resolutionInfo: {
          horizontalResolution: s.dpi,
          horizontalResolutionUnit: "PPI",
          widthUnit: "Inches",
          verticalResolution: s.dpi,
          verticalResolutionUnit: "PPI",
          heightUnit: "Inches",
        },
      },
    },
    { generateThumbnail: true },
  );

  // Validate before offering the download.
  const bytes = new Uint8Array(buffer);
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (bytes.length < 100 || signature !== "8BPS") {
    throw new Error("The generated file is not a valid PSD.");
  }
  const parsed = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  if (parsed.width !== s.width || parsed.height !== s.height || (parsed.children?.length ?? 0) !== children.length) {
    throw new Error("The generated PSD did not read back correctly.");
  }

  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
}