// The AI providers METAFORGE AI PRO plans to support.
// Groq and xAI Grok are two different companies with different keys and endpoints.

export type ProviderId = "gemini" | "openai" | "groq" | "anthropic" | "xai";

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  summary: string;
  docsUrl: string;
  docsLabel: string;
};

/** Each provider can have up to this many keys. */
export const MAX_KEYS_PER_PROVIDER = 12;

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    summary: "Gemini API keys come from Google AI Studio.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    docsLabel: "Gemini API docs",
  },
  {
    id: "openai",
    name: "OpenAI",
    summary:
      "OpenAI API keys are separate from a ChatGPT subscription. The API is billed on its own.",
    docsUrl: "https://platform.openai.com/docs",
    docsLabel: "OpenAI API docs",
  },
  {
    id: "groq",
    name: "Groq",
    summary: "Groq is a different company from xAI Grok and uses different keys.",
    docsUrl: "https://console.groq.com/docs",
    docsLabel: "Groq API docs",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    summary:
      "Anthropic API keys are separate from a Claude.ai chat subscription. The API is billed on its own.",
    docsUrl: "https://docs.claude.com",
    docsLabel: "Claude API docs",
  },
  {
    id: "xai",
    name: "xAI Grok",
    summary: "xAI Grok is a different company from Groq and uses different keys.",
    docsUrl: "https://docs.x.ai",
    docsLabel: "xAI API docs",
  },
];