// Strict metadata rules: title <= 70 chars, one-sentence description <= 180 chars,
// exactly `count` unique keywords (count comes from the UI and platform rules).

export const STRICT_LIMITS = { titleMax: 70, descriptionMax: 180 } as const;

export type StrictData = { title: string; description: string; keywords: string[] };

export type StrictValidation =
  | { ok: true; data: StrictData; warnings: string[] }
  | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cleanKeyword(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKeywords(value: unknown): string[] {
  const parts: string[] = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const keyword = cleanKeyword(part);
    if (keyword.length === 0 || keyword.length > 60) {
      continue;
    }
    const key = keyword.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function cleanText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    return "";
  }
  const withoutLabel = value.replace(new RegExp(`^\\s*${label}\\s*:\\s*`, "i"), "");
  return withoutLabel.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+\s+/).filter((part) => part.trim().length > 0).length;
}

export function validateStrict(raw: unknown, count: number): StrictValidation {
  if (!isRecord(raw)) {
    return { ok: false, problems: ["The response was not a JSON object."] };
  }

  const problems: string[] = [];
  const warnings: string[] = [];

  const title = cleanText(raw.title, "title");
  if (title.length === 0) {
    problems.push("The title is missing.");
  } else if (title.length > STRICT_LIMITS.titleMax) {
    problems.push(`The title is ${title.length} characters; the maximum is ${STRICT_LIMITS.titleMax}.`);
  }

  const description = cleanText(raw.description, "description");
  if (description.length === 0) {
    problems.push("The description is missing.");
  } else {
    if (description.length > STRICT_LIMITS.descriptionMax) {
      problems.push(
        `The description is ${description.length} characters; the maximum is ${STRICT_LIMITS.descriptionMax}.`,
      );
    }
    if (sentenceCount(description) !== 1) {
      problems.push("The description must be exactly one sentence.");
    }
    if (title.length > 0 && description.toLowerCase() === title.toLowerCase()) {
      problems.push("The description repeats the title.");
    }
  }

  let keywords = normalizeKeywords(raw.keywords);
  if (keywords.length < count) {
    problems.push(`Only ${keywords.length} unique keywords were returned; exactly ${count} are required.`);
  } else if (keywords.length > count) {
    keywords = keywords.slice(0, count);
    warnings.push(`Extra keywords were removed so exactly ${count} remain.`);
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, data: { title, description, keywords }, warnings };
}

export function buildStrictSchema(count: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string", maxLength: STRICT_LIMITS.titleMax },
      description: { type: "string", maxLength: STRICT_LIMITS.descriptionMax },
      keywords: { type: "array", minItems: count, maxItems: count, items: { type: "string" } },
    },
    required: ["title", "description", "keywords"],
  };
}

export function buildStrictPrompt(count: number, problems: string[] = []): string {
  const lines = [
    "You write stock-image metadata for the single image provided.",
    "",
    "Rules:",
    `- title: one accurate, natural, professional English title, at most ${STRICT_LIMITS.titleMax} characters including spaces. No quotation marks, no label, no promotional language.`,
    `- description: exactly ONE complete sentence, at most ${STRICT_LIMITS.descriptionMax} characters including spaces, describing the visible subject, composition, background, colors and style. Do not repeat the title.`,
    `- keywords: an array of EXACTLY ${count} unique English keywords, most important subject and concepts first.`,
    "- Describe only what is clearly visible. Never invent objects, brands, people or places.",
    "- Keywords may cover objects, colors, composition, style, background, mood and use cases, and meaningful phrases such as copy space or flat lay are allowed.",
    "- No duplicates, no trivial variations of the same word, no unrelated filler.",
    "",
    "Return only a JSON object with the fields title, description and keywords.",
  ];
  if (problems.length > 0) {
    lines.push(
      "",
      "Your previous answer was rejected for these reasons:",
      ...problems.map((problem) => `- ${problem}`),
      `Fix every problem. The keywords array must contain exactly ${count} unique, relevant entries.`,
    );
  }
  return lines.join("\n");
}