// Gemini model IDs taken from Google's published model list (checked October 2026).
// Google retires and adds models often. Update this list when that happens.
// An invalid or retired model returns a clear "unsupported model" error.

export type GeminiModelOption = {
  id: string;
  label: string;
};

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const GEMINI_MODELS: GeminiModelOption[] = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (default)" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
];

export function isKnownGeminiModel(id: string): boolean {
  return GEMINI_MODELS.some((model) => model.id === id);
}