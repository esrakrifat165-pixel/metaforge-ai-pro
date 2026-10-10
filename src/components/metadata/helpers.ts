// Shared types, constants and small helper functions for the Metadata Generator.

export type FieldKey = "title" | "description" | "keywords" | "prompt";

export type ImageMetadata = Record<FieldKey, string>;

export type ImageItem = {
  id: string;
  file: File;
  /** Browser-only preview address. Must be revoked when the image is removed. */
  url: string;
};

export type FieldStats = {
  countLabel: string;
  footer: string;
  over: boolean;
};

export type CsvRow = {
  filename: string;
  title: string;
  description: string;
  keywords: string;
  platform: string;
};

export const MAX_FILES = 100;
export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const ACCEPTED_TYPES: string[] = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPT_ATTRIBUTE: string = ACCEPTED_TYPES.join(",");

export const EMPTY_META: ImageMetadata = {
  title: "",
  description: "",
  keywords: "",
  prompt: "",
};

export const NO_EDITING: Record<FieldKey, boolean> = {
  title: false,
  description: false,
  keywords: false,
  prompt: false,
};

export const FIELD_KEYS: FieldKey[] = ["title", "description", "keywords", "prompt"];

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  const matches = trimmed.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return matches ? matches.filter((sentence) => sentence.trim()).length : 0;
}

/** Splits on commas or new lines, trims, and removes duplicates (ignoring case). */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const keyword = part.trim();
    if (!keyword) {
      continue;
    }
    const lower = keyword.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    result.push(keyword);
  }
  return result;
}

export function getFieldStats(
  key: FieldKey,
  text: string,
  keywordCount: number,
): FieldStats {
  const characters = `${text.length} chars`;
  switch (key) {
    case "title":
      return { countLabel: plural(countWords(text), "word"), footer: characters, over: false };
    case "description":
      return {
        countLabel: plural(countSentences(text), "sentence"),
        footer: characters,
        over: false,
      };
    case "keywords": {
      const count = parseKeywords(text).length;
      return {
        countLabel: String(count),
        footer: `${count}/${keywordCount}`,
        over: count > keywordCount,
      };
    }
    default:
      return { countLabel: characters, footer: characters, over: false };
  }
}

export function fingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function csvCell(value: string): string {
  // A leading = + - @ (or tab / carriage return) can be run as a formula by
  // spreadsheet programs, so a single quote is added in front to stop that.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: CsvRow[]): string {
  const header = ["Filename", "Title", "Description", "Keywords", "Platform"]
    .map(csvCell)
    .join(",");
  const lines = rows.map((row) =>
    [row.filename, row.title, row.description, row.keywords, row.platform]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\r\n");
}

export function triggerDownload(href: string, filename: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}