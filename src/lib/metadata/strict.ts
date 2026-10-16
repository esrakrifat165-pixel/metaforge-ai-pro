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
    const key = keyword.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]/gu, "");
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
    "You are an expert stock-image metadata writer. Analyze only the supplied image.",
    "",
    "TITLE QUALITY RULES:",
    "- Identify the dominant subject, what it is doing, and the most distinctive visible feature.",
    "- Write a concise, natural, professional English title that a stock-image buyer could search for.",
    "- Put the strongest subject phrase first; add an action, style, or composition detail only when useful.",
    "- For a multi-item image, describe the actual collection accurately. Use set, collection, or bundle only when justified.",
    "- Distinguish similar images by their genuinely visible subjects, actions, arrangement, or attributes.",
    "- Avoid vague titles such as 'Different Activities', 'Creative Design', or 'Beautiful Illustration'.",
    "- Avoid keyword-stuffed titles, promotional language, unnecessary repetition, and unsupported claims.",
    "- Do not infer an exact occupation, identity, material, color, background transparency, or intended use unless visually supported.",
    "",
    "KEYWORD QUALITY RULES:",
    `- Return exactly ${count} distinct, relevant English keywords in an array.`,
    "- Order keywords by search importance: main subject, specific subject phrase, visible actions, objects, subject attributes, visual style, composition, and relevant concepts.",
    "- Use specific multi-word search phrases when they add useful meaning, alongside appropriate concise terms.",
    "- Include singular or plural variants only when they add meaningful search value; do not pad the list with near-duplicates.",
    "- Do not repeat the same idea using minor wording changes.",
    "- Avoid generic filler such as 'beautiful', 'amazing', 'best', 'creative', 'design', or 'graphic' unless it adds a specific, accurate meaning.",
    "- Do not add unrelated seasonal, commercial, emotional, or decorative terms just to reach the requested count.",
    "- Include color, background, silhouette, vector, icon, isolated object, or copy space only when supported by the visible image.",
    "- For a collection, include important individual subjects when identifiable, not just the word 'collection'.",
    "- Never invent objects, activities, locations, brands, people, or technical properties.",
    "- Every keyword must be useful to someone searching for this particular image.",
    "",
    "DESCRIPTION RULES:",
    `- Write exactly ONE complete English sentence, at most ${STRICT_LIMITS.descriptionMax} characters including spaces.`,
    "- Describe the visible subject and its meaningful action or arrangement, with relevant style and background details.",
    "- Do not merely repeat the title or add unsupported details.",
    "",
    "OUTPUT RULES:",
    `- Title: one accurate title, maximum ${STRICT_LIMITS.titleMax} characters including spaces.`,
    "- Keywords: an array of strings, no numbering, no explanations, no empty entries.",
    "- Return only a valid JSON object with exactly these fields: title, description, keywords.",
  ];

  if (problems.length > 0) {
    lines.push(
      "",
      "Your previous answer failed validation. Correct every issue:",
      ...problems.map((problem) => `- ${problem}`),
      `- Return exactly ${count} unique, relevant keywords.`,
      `- Keep the title within ${STRICT_LIMITS.titleMax} characters and description within ${STRICT_LIMITS.descriptionMax} characters.`,
    );
  }

  return lines.join("\n");
}


