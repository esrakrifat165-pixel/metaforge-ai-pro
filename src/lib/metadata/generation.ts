import type { PlatformProfile } from "../platforms/profiles";

export type GeneratedMetadata = {
  title: string;
  description: string;
  keywords: string[];
};

export type NormalizeResult =
  | { ok: true; data: GeneratedMetadata; warnings: string[] }
  | { ok: false; message: string };

const MAX_KEYWORD_LENGTH = 60;

/** JSON shape the model is asked to return. */
export function buildResponseSchema(keywordMax: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "A clear, natural title describing the visible subject.",
      },
      description: {
        type: "string",
        description: "One or two sentences describing only what is visible.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        maxItems: keywordMax,
        description: "Relevant keywords, most important first.",
      },
    },
    required: ["title", "description", "keywords"],
  };
}

export function buildPrompt(profile: PlatformProfile, keywordCount: number): string {
  const lines = [
    "You write stock-content metadata for the single image provided.",
    "",
    "Rules:",
    "- Describe only what is clearly visible. Never invent people, brands, trademarks, logos, locations, text, objects or actions that are not visible.",
    "- Do not identify real people. Do not name fictional characters, artists or brands.",
    "- Do not use the words AI, AI-generated or generated unless that text is visibly part of the image.",
    "- Do not make promises about sales, rankings or acceptance.",
    "- Write everything in English.",
    "",
    `Title: a clear, natural, searchable title of at most ${profile.titleMaxChars} characters including spaces. Name the main subject and, if obvious, its likely use. No keyword lists, no quotation marks, no trailing period.`,
    `Description: one or two informative sentences of at most ${profile.descriptionMaxChars} characters including spaces. Add detail that the title does not simply repeat.`,
    `Keywords: up to ${keywordCount} relevant keywords, most important first: main subject, then style, setting, colors, mood and concepts. Each keyword is one word or a short phrase. No duplicates or near-duplicates, no brand names, no filler. Fewer accurate keywords are better than padding.`,
    "",
  ];

  if (profile.id === "all") {
    lines.push("Write neutral metadata that would suit any stock platform.");
  } else {
    lines.push(`Target platform: ${profile.name}.`);
  }

  lines.push("Return only a JSON object with the fields title, description and keywords.");
  return lines.join("\n");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function shortenToLimit(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(max * 0.6) ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:-]+$/, "");
}

function readKeywords(value: unknown): string[] {
  let source: unknown[] = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (typeof value === "string") {
    source = value.split(",");
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const keyword = cleanText(item).replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, "");
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) {
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

/** Checks the model's JSON, cleans it up and applies the platform profile. */
export function normalizeMetadata(
  raw: unknown,
  profile: PlatformProfile,
  keywordCount: number,
): NormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "The model did not return a JSON object." };
  }

  const record = raw as Record<string, unknown>;
  const warnings: string[] = [];

  let title = cleanText(record.title);
  let description = cleanText(record.description);
  let keywords = readKeywords(record.keywords);

  if (!title) {
    return { ok: false, message: "The model response had no title." };
  }
  if (!description) {
    return { ok: false, message: "The model response had no description." };
  }
  if (keywords.length === 0) {
    return { ok: false, message: "The model response had no usable keywords." };
  }

  if (title.length > profile.titleMaxChars) {
    title = shortenToLimit(title, profile.titleMaxChars);
    warnings.push(`The title was shortened to fit ${profile.titleMaxChars} characters. Please check it still reads well.`);
  }
  if (description.length > profile.descriptionMaxChars) {
    description = shortenToLimit(description, profile.descriptionMaxChars);
    warnings.push(`The description was shortened to fit ${profile.descriptionMaxChars} characters. Please check it still reads well.`);
  }
  if (keywords.length > keywordCount) {
    keywords = keywords.slice(0, keywordCount);
    warnings.push(`Extra keywords were removed to match the requested ${keywordCount}.`);
  }
  if (profile.keywordsMin !== null && keywords.length < profile.keywordsMin) {
    warnings.push(
      `Only ${keywords.length} keywords were returned. ${profile.name} is reported to want at least ${profile.keywordsMin}. Add a few accurate ones by hand if needed.`,
    );
  }

  return { ok: true, data: { title, description, keywords }, warnings };
}