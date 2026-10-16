export const PREFERENCES_STORAGE_KEY = "metaforge.preferences.v1";
export const PREFERENCES_VERSION = 1;

export const PROMPT_DETAILS = ["concise", "standard", "detailed"] as const;
export const IMAGE_FORMATS = ["jpg", "png", "webp"] as const;

export type PromptDetail = (typeof PROMPT_DETAILS)[number];
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export interface Preferences {
  metadata: {
    generateTitle: boolean;
    generateDescription: boolean;
    keywordCount: number;
    singleWordKeywords: boolean;
    titleMaxLength: number;
    descriptionMaxLength: number;
  };
  imageToPrompt: {
    detail: PromptDetail;
  };
  image: {
    outputFormat: ImageFormat;
    jpgQuality: number;
    backgroundColor: string;
    preserveAspectRatio: boolean;
  };
  batch: {
    batchSize: number;
  };
}

// Safe ranges enforced by the Settings page itself. Individual tools
// should still clamp values against their own limits.
export const LIMITS = {
  keywordCount: { min: 5, max: 50 },
  titleMaxLength: { min: 20, max: 200 },
  descriptionMaxLength: { min: 50, max: 500 },
  jpgQuality: { min: 50, max: 100 },
  batchSize: { min: 1, max: 10 },
} as const;

export const DEFAULT_PREFERENCES: Preferences = {
  metadata: {
    generateTitle: true,
    generateDescription: true,
    keywordCount: 25,
    singleWordKeywords: false,
    titleMaxLength: 70,
    descriptionMaxLength: 200,
  },
  imageToPrompt: { detail: "standard" },
  image: {
    outputFormat: "jpg",
    jpgQuality: 90,
    backgroundColor: "#ffffff",
    preserveAspectRatio: true,
  },
  batch: { batchSize: 3 },
};

export type ValidationErrors = Record<string, string>;
export type LoadStatus = "default" | "loaded" | "recovered" | "unavailable";

export interface LoadResult {
  preferences: Preferences;
  status: LoadStatus;
}

export function clonePreferences(p: Preferences): Preferences {
  return {
    metadata: { ...p.metadata },
    imageToPrompt: { ...p.imageToPrompt },
    image: { ...p.image },
    batch: { ...p.batch },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function intInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function validatePreferences(p: Preferences): ValidationErrors {
  const e: ValidationErrors = {};
  const L = LIMITS;

  if (typeof p.metadata.generateTitle !== "boolean") e["metadata.generateTitle"] = "Must be on or off.";
  if (typeof p.metadata.generateDescription !== "boolean") e["metadata.generateDescription"] = "Must be on or off.";
  if (typeof p.metadata.singleWordKeywords !== "boolean") e["metadata.singleWordKeywords"] = "Must be on or off.";
  if (!intInRange(p.metadata.keywordCount, L.keywordCount.min, L.keywordCount.max))
    e["metadata.keywordCount"] = `Enter a whole number from ${L.keywordCount.min} to ${L.keywordCount.max}.`;
  if (!intInRange(p.metadata.titleMaxLength, L.titleMaxLength.min, L.titleMaxLength.max))
    e["metadata.titleMaxLength"] = `Enter a whole number from ${L.titleMaxLength.min} to ${L.titleMaxLength.max}.`;
  if (!intInRange(p.metadata.descriptionMaxLength, L.descriptionMaxLength.min, L.descriptionMaxLength.max))
    e["metadata.descriptionMaxLength"] = `Enter a whole number from ${L.descriptionMaxLength.min} to ${L.descriptionMaxLength.max}.`;

  if (!PROMPT_DETAILS.includes(p.imageToPrompt.detail)) e["imageToPrompt.detail"] = "Choose a supported detail level.";

  if (!IMAGE_FORMATS.includes(p.image.outputFormat)) e["image.outputFormat"] = "Choose a supported format.";
  if (!intInRange(p.image.jpgQuality, L.jpgQuality.min, L.jpgQuality.max))
    e["image.jpgQuality"] = `Enter a whole number from ${L.jpgQuality.min} to ${L.jpgQuality.max}.`;
  if (typeof p.image.backgroundColor !== "string" || !HEX_COLOR.test(p.image.backgroundColor))
    e["image.backgroundColor"] = "Use a 6-digit hex colour such as #ffffff.";
  if (typeof p.image.preserveAspectRatio !== "boolean") e["image.preserveAspectRatio"] = "Must be on or off.";

  if (!intInRange(p.batch.batchSize, L.batchSize.min, L.batchSize.max))
    e["batch.batchSize"] = `Enter a whole number from ${L.batchSize.min} to ${L.batchSize.max}.`;

  return e;
}

// Rebuilds a valid Preferences object from untrusted stored data.
// Any invalid or missing field falls back to its default.
function sanitize(raw: Record<string, unknown>): { preferences: Preferences; repaired: boolean } {
  const D = DEFAULT_PREFERENCES;
  const L = LIMITS;
  let repaired = false;

  const section = (key: string): Record<string, unknown> => {
    const s = raw[key];
    if (isRecord(s)) return s;
    repaired = true;
    return {};
  };
  const bool = (s: Record<string, unknown>, k: string, fb: boolean): boolean => {
    const v = s[k];
    if (typeof v === "boolean") return v;
    repaired = true;
    return fb;
  };
  const int = (s: Record<string, unknown>, k: string, min: number, max: number, fb: number): number => {
    const v = s[k];
    if (intInRange(v, min, max)) return v;
    repaired = true;
    return fb;
  };
  const oneOf = <T extends string>(s: Record<string, unknown>, k: string, list: readonly T[], fb: T): T => {
    const v = s[k];
    if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
    repaired = true;
    return fb;
  };
  const color = (s: Record<string, unknown>, k: string, fb: string): string => {
    const v = s[k];
    if (typeof v === "string" && HEX_COLOR.test(v)) return v.toLowerCase();
    repaired = true;
    return fb;
  };

  const m = section("metadata");
  const i2p = section("imageToPrompt");
  const img = section("image");
  const b = section("batch");

  const preferences: Preferences = {
    metadata: {
      generateTitle: bool(m, "generateTitle", D.metadata.generateTitle),
      generateDescription: bool(m, "generateDescription", D.metadata.generateDescription),
      keywordCount: int(m, "keywordCount", L.keywordCount.min, L.keywordCount.max, D.metadata.keywordCount),
      singleWordKeywords: bool(m, "singleWordKeywords", D.metadata.singleWordKeywords),
      titleMaxLength: int(m, "titleMaxLength", L.titleMaxLength.min, L.titleMaxLength.max, D.metadata.titleMaxLength),
      descriptionMaxLength: int(m, "descriptionMaxLength", L.descriptionMaxLength.min, L.descriptionMaxLength.max, D.metadata.descriptionMaxLength),
    },
    imageToPrompt: {
      detail: oneOf(i2p, "detail", PROMPT_DETAILS, D.imageToPrompt.detail),
    },
    image: {
      outputFormat: oneOf(img, "outputFormat", IMAGE_FORMATS, D.image.outputFormat),
      jpgQuality: int(img, "jpgQuality", L.jpgQuality.min, L.jpgQuality.max, D.image.jpgQuality),
      backgroundColor: color(img, "backgroundColor", D.image.backgroundColor),
      preserveAspectRatio: bool(img, "preserveAspectRatio", D.image.preserveAspectRatio),
    },
    batch: {
      batchSize: int(b, "batchSize", L.batchSize.min, L.batchSize.max, D.batch.batchSize),
    },
  };
  return { preferences, repaired };
}

// Client-side only. Safe to call from tools: returns defaults on the server
// or when nothing valid is stored.
export function loadPreferences(): LoadResult {
  const defaults = clonePreferences(DEFAULT_PREFERENCES);
  if (typeof window === "undefined") return { preferences: defaults, status: "default" };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
  } catch {
    return { preferences: defaults, status: "unavailable" };
  }
  if (raw === null) return { preferences: defaults, status: "default" };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== PREFERENCES_VERSION || !isRecord(parsed.values)) {
      return { preferences: defaults, status: "recovered" };
    }
    const { preferences, repaired } = sanitize(parsed.values);
    return { preferences, status: repaired ? "recovered" : "loaded" };
  } catch {
    return { preferences: defaults, status: "recovered" };
  }
}

export function getPreferences(): Preferences {
  return loadPreferences().preferences;
}

// Validates, writes, then reads back to confirm the write really happened.
// Throws an Error with a readable message on any failure.
export function savePreferences(p: Preferences): Preferences {
  const errors = validatePreferences(p);
  if (Object.keys(errors).length > 0) {
    throw new Error("Some values are invalid. Fix them and try again.");
  }
  if (typeof window === "undefined") {
    throw new Error("Settings can only be saved in the browser.");
  }
  const toStore = clonePreferences(p);
  try {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: PREFERENCES_VERSION, savedAt: new Date().toISOString(), values: toStore })
    );
  } catch {
    throw new Error("The browser blocked saving (storage is full, disabled, or in private mode).");
  }
  const check = loadPreferences();
  if (check.status !== "loaded" || JSON.stringify(check.preferences) !== JSON.stringify(toStore)) {
    throw new Error("Saving could not be verified. Your settings were not stored reliably.");
  }
  return check.preferences;
}