// Layout math shared by the live preview and the PNG export,
// so the downloaded image matches what you see.

export type LayoutId = "balanced" | "hero" | "left" | "symmetrical" | "editorial";

export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "balanced", label: "Balanced Grid" },
  { id: "hero", label: "Hero + Small Tiles" },
  { id: "left", label: "Large Left + Right Grid" },
  { id: "symmetrical", label: "Symmetrical Grid" },
  { id: "editorial", label: "Editorial Collage" },
];

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === "string" && LAYOUTS.some((layout) => layout.id === value);
}

export const ASPECTS = [
  { id: "1:1", label: "Square 1:1", ratio: 1 },
  { id: "4:3", label: "Landscape 4:3", ratio: 4 / 3 },
  { id: "3:2", label: "Landscape 3:2", ratio: 3 / 2 },
  { id: "16:9", label: "Wide 16:9", ratio: 16 / 9 },
  { id: "3:4", label: "Portrait 3:4", ratio: 3 / 4 },
  { id: "4:5", label: "Portrait 4:5", ratio: 4 / 5 },
  { id: "9:16", label: "Story 9:16", ratio: 9 / 16 },
] as const;

/** Gap, padding and radius values are in units of a canvas that is this wide. */
export const BASE_WIDTH = 1000;
/** The PNG is exported at BASE_WIDTH x EXPORT_SCALE pixels wide. */
export const EXPORT_SCALE = 2;
export const MAX_IMAGES = 12;

/** A tile as fractions (0 to 1) of the drawing area. */
export type Cell = { x: number; y: number; w: number; h: number };
export type Rect = { left: number; top: number; width: number; height: number };

function rowsOf(count: number, x0: number, y0: number, w: number, h: number, perRow: number): Cell[] {
  const rows = Math.ceil(count / perRow);
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r += 1) {
    const k = Math.min(perRow, count - r * perRow);
    for (let j = 0; j < k; j += 1) {
      cells.push({ x: x0 + (j / k) * w, y: y0 + (r / rows) * h, w: w / k, h: h / rows });
    }
  }
  return cells;
}

export function computeCells(layout: LayoutId, n: number): Cell[] {
  if (n <= 0) {
    return [];
  }
  if (n === 1) {
    return [{ x: 0, y: 0, w: 1, h: 1 }];
  }

  switch (layout) {
    case "hero": {
      const rest = n - 1;
      const perRow = rest <= 4 ? rest : Math.ceil(rest / 2);
      return [{ x: 0, y: 0, w: 1, h: 0.6 }, ...rowsOf(rest, 0, 0.6, 1, 0.4, perRow)];
    }
    case "left": {
      const rest = n - 1;
      const perRow = rest <= 3 ? 1 : 2;
      return [{ x: 0, y: 0, w: 0.5, h: 1 }, ...rowsOf(rest, 0.5, 0, 0.5, 1, perRow)];
    }
    case "symmetrical": {
      const columns = n <= 2 ? n : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / columns);
      const cells: Cell[] = [];
      for (let r = 0; r < rows; r += 1) {
        const k = Math.min(columns, n - r * columns);
        const offset = (columns - k) / (2 * columns);
        for (let j = 0; j < k; j += 1) {
          cells.push({ x: offset + j / columns, y: r / rows, w: 1 / columns, h: 1 / rows });
        }
      }
      return cells;
    }
    case "editorial": {
      const rows = Math.ceil(n / 2);
      const cells: Cell[] = [];
      for (let r = 0; r < rows; r += 1) {
        const k = Math.min(2, n - r * 2);
        const y = r / rows;
        const h = 1 / rows;
        if (k === 1) {
          cells.push({ x: 0, y, w: 1, h });
        } else {
          const first = r % 2 === 0 ? 0.4 : 0.6;
          cells.push({ x: 0, y, w: first, h });
          cells.push({ x: first, y, w: 1 - first, h });
        }
      }
      return cells;
    }
    default:
      return rowsOf(n, 0, 0, 1, 1, Math.ceil(Math.sqrt(n)));
  }
}

/** Turns fractional cells into rectangles on a width x height canvas, with padding and gap. */
export function placeCells(
  cells: Cell[],
  width: number,
  height: number,
  padding: number,
  gap: number,
): Rect[] {
  const areaW = width - 2 * padding + gap;
  const areaH = height - 2 * padding + gap;
  return cells.map((cell) => ({
    left: padding + cell.x * areaW,
    top: padding + cell.y * areaH,
    width: Math.max(1, cell.w * areaW - gap),
    height: Math.max(1, cell.h * areaH - gap),
  }));
}