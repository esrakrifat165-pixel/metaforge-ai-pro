// Styles, prompt text and checks for Image-to-Prompt. Safe to import anywhere.

export type PromptStyleId =
  | "photorealistic"
  | "vector"
  | "flat"
  | "3d"
  | "minimal"
  | "commercial"
  | "editorial";

export type PromptDetailId = "short" | "standard" | "detailed";

export type PromptStyleOption = { id: PromptStyleId; label: string; instruction: string };
export type PromptDetailOption = { id: PromptDetailId; label: string; words: string; maxChars: number };

export const PROMPT_STYLES: PromptStyleOption[] = [
  { id: "photorealistic", label: "Photorealistic", instruction: "a photorealistic photograph" },
  { id: "vector", label: "Vector illustration", instruction: "a clean vector illustration" },
  { id: "flat", label: "Flat design", instruction: "a flat design illustration" },
  { id: "3d", label: "3D render", instruction: "a 3D render" },
  { id: "minimal", label: "Minimal", instruction: "a minimal composition with very few elements" },
  { id: "commercial", label: "Commercial stock", instruction: "a polished commercial stock image" },
  { id: "editorial", label: "Editorial", instruction: "an editorial-style image" },
];

export const PROMPT_DETAILS: PromptDetailOption[] = [
  { id: "short", label: "Short", words: "about 30 to 50 words", maxChars: 500 },
  { id: "standard", label: "Standard", words: "about 80 to 120 words", maxChars: 1000 },
  { id: "detailed", label: "Detailed", words: "about 150 to 220 words", maxChars: 1800 },
];

export function isPromptStyleId(value: unknown): value is PromptStyleId {
  return typeof value === "string" && PROMPT_STYLES.some((style) => style.id === value);
}

export function isPromptDetailId(value: unknown): value is PromptDetailId {
  return typeof value === "string" && PROMPT_DETAILS.some((detail) => detail.id === value);
}

export function getPromptStyle(id: PromptStyleId): PromptStyleOption {
  return PROMPT_STYLES.find((style) => style.id === id) ?? PROMPT_STYLES[0];
}

export function getPromptDetail(id: PromptDetailId): PromptDetailOption {
  return PROMPT_DETAILS.find((detail) => detail.id === id) ?? PROMPT_DETAILS[1];
}

export function buildPromptSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "One image-generation prompt describing only what is visible in the image.",
      },
    },
    required: ["prompt"],
  };
}

export function buildPromptRequest(style: PromptStyleOption, detail: PromptDetailOption): string {
  return [
    "You look at the single image provided and write one prompt for an AI image generator that would recreate it.",
    "",
    "Rules:",
    "- Describe only what is clearly visible. Never invent people, brands, logos, text, places or objects that are not visible.",
    "- Cover, where they apply: the main subject, composition and framing, lighting, color palette, medium or style, environment and background, camera angle and lens feel for photographs, and small visible details.",
    "- Do not identify real people. Do not name artists, brands or fictional characters.",
    "- Do not mention that you are looking at an image. Do not use markdown, headings or quotation marks.",
    "- Write one plain paragraph in English.",
    "",
    `Style: write the prompt so that a generated image would be ${style.instruction}.`,
    `Length: ${detail.words}, and at most ${detail.maxChars} characters.`,
    "",
    "Return only a JSON object with the single field prompt.",
  ].join("\n");
}

export type PromptNormalizeResult =
  | { ok: true; prompt: string; warnings: string[] }
  | { ok: false; message: string };

export function normalizePrompt(raw: unknown, detail: PromptDetailOption): PromptNormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "The model did not return a JSON object." };
  }

  const value = (raw as Record<string, unknown>).prompt;
  let prompt = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 20) {
    return { ok: false, message: "The model response had no usable prompt." };
  }

  const warnings: string[] = [];
  if (prompt.length > detail.maxChars) {
    const cut = prompt.slice(0, detail.maxChars);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
    prompt = (lastStop > detail.maxChars * 0.6 ? cut.slice(0, lastStop) : cut).replace(/[\s,;:-]+$/, "");
    warnings.push(`The prompt was shortened to fit ${detail.maxChars} characters. Please check it still reads well.`);
  }

  return { ok: true, prompt, warnings };
}