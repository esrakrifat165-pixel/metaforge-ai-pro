// METAFORGE-HELP-SUPPORT v1
export type HelpCategory = "Getting Started" | "FAQ" | "Troubleshooting";

export interface HelpLink {
  label: string;
  path: string;
}

export interface HelpArticle {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  body: string[];
  steps?: string[];
  verified: boolean;
  link?: HelpLink;
}

export const CATEGORIES: HelpCategory[] = ["Getting Started", "FAQ", "Troubleshooting"];

export const UNVERIFIED_NOTE =
  "General description. It has not been checked against the current implementation of this tool, so what you see on screen may differ.";

// Only routes that are known to exist are linked. Add more after the placeholder audit.
export const KNOWN_ROUTES = {
  settings: "/settings",
  apiKeys: "/settings/api-keys",
} as const;

export const HELP_ARTICLES: HelpArticle[] = [
  // ---------------- Getting Started ----------------
  {
    id: "gs-dashboard",
    category: "Getting Started",
    title: "Dashboard navigation",
    summary: "Move between tools with the sidebar.",
    body: [
      "The sidebar lists the tools, History, API Key Manager, Settings, Help & Support and, if your account can access it, the Admin Panel. The top bar holds global search and the light/dark theme switch.",
      "Click a sidebar item to open that page.",
    ],
    verified: false,
  },
  {
    id: "gs-metadata",
    category: "Getting Started",
    title: "Metadata Generator",
    summary: "Generate titles, descriptions and keywords for images.",
    body: [
      "Add the images you want to process, start generation and review the results before copying or exporting them.",
      "A working API key for a supported provider must be configured in API Key Manager first.",
    ],
    steps: [
      "Open Metadata Generator from the sidebar.",
      "Add your images.",
      "Start generation and wait for each file to finish.",
      "Review titles, descriptions and keywords, then copy or export.",
    ],
    verified: false,
  },
  {
    id: "gs-i2p",
    category: "Getting Started",
    title: "Image-to-Prompt",
    summary: "Create a text prompt that describes an image.",
    body: ["Upload an image, generate a prompt and copy it. A working API key is required."],
    steps: [
      "Open Image-to-Prompt from the sidebar.",
      "Upload a supported image.",
      "Generate the prompt.",
      "Copy or download the result.",
    ],
    verified: false,
  },
  {
    id: "gs-bg",
    category: "Getting Started",
    title: "Background Remover",
    summary: "Remove the background from an image.",
    body: [
      "Upload an image, run the removal, check the preview and download the result.",
      "If processing fails, no result is produced. Try a smaller image or a different format.",
    ],
    verified: false,
  },
  {
    id: "gs-adobe",
    category: "Getting Started",
    title: "Adobe Keywords Search",
    summary: "Generate keyword suggestions.",
    body: ["Open the tool and follow the fields on its own page. What it accepts is defined by the tool itself."],
    verified: false,
  },
  {
    id: "gs-calendar",
    category: "Getting Started",
    title: "Global Event Calendar",
    summary: "Browse and manage events on a calendar.",
    body: [
      "Use the calendar to view dates and manage events where the tool supports it.",
      "Do not assume events sync with an external calendar unless the tool says so.",
    ],
    verified: false,
  },
  {
    id: "gs-bento",
    category: "Getting Started",
    title: "Bento Builder",
    summary: "Arrange content into a bento-style layout.",
    body: ["Add and arrange elements on the workspace and export the layout where the tool offers an export action."],
    verified: false,
  },
  {
    id: "gs-psd",
    category: "Getting Started",
    title: "Image-to-PSD",
    summary: "Convert an image into a PSD file.",
    body: ["Import an image and export a PSD. After downloading, open the file in your image editor to confirm it is valid."],
    verified: false,
  },
  {
    id: "gs-eps",
    category: "Getting Started",
    title: "AI/EPS-to-JPG Converter",
    summary: "Convert vector AI or EPS files to JPG.",
    body: [
      "Conversion needs a rendering engine. If none is available the tool should say so.",
      "Renaming a file to .jpg is not a conversion and will not produce a usable image.",
    ],
    verified: false,
  },
  {
    id: "gs-keys",
    category: "Getting Started",
    title: "API Key Manager",
    summary: "Add and manage keys for AI providers.",
    body: [
      "Provider keys are entered in API Key Manager. This Help page and the Settings page never display or store them.",
    ],
    verified: false,
    link: { label: "Open API Key Manager", path: KNOWN_ROUTES.apiKeys },
  },
  {
    id: "gs-settings",
    category: "Getting Started",
    title: "Settings",
    summary: "Save preferences in this browser.",
    body: [
      "Settings stores preferences for metadata, Image-to-Prompt, image processing and batch size in this browser's local storage. Change the theme with the top-bar switch, not in Settings.",
      "Sections marked 'not yet read by tools' are saved, but the tools do not apply them yet.",
    ],
    steps: [
      "Change a value.",
      "Click Save settings. A success message appears only if saving worked.",
      "Cancel restores the last saved values.",
      "Reset to defaults asks for confirmation before replacing saved settings.",
    ],
    verified: true,
    link: { label: "Open Settings", path: KNOWN_ROUTES.settings },
  },
  {
    id: "gs-history",
    category: "Getting Started",
    title: "History",
    summary: "Review earlier results.",
    body: ["Open History from the sidebar to see saved records, if history persistence is enabled for your account."],
    verified: false,
  },

  // ---------------- FAQ ----------------
  {
    id: "faq-upload",
    category: "FAQ",
    title: "Which files can I upload?",
    summary: "Each tool accepts different formats.",
    body: [
      "Raster images such as JPG and PNG are typical inputs. Vector files (AI, EPS) belong to the converter. If a file is rejected, check its real format and size.",
    ],
    verified: false,
  },
  {
    id: "faq-metadata-errors",
    category: "FAQ",
    title: "Why did metadata generation fail?",
    summary: "Usually a key, provider, model or file problem.",
    body: [
      "Common causes: no usable API key, an invalid or expired key, the provider being unavailable, a model the application does not support, a damaged image, or a network problem.",
      "Open API Key Manager, confirm the provider has a key, then retry with a single file.",
    ],
    verified: true,
    link: { label: "Open API Key Manager", path: KNOWN_ROUTES.apiKeys },
  },
  {
    id: "faq-api-key",
    category: "FAQ",
    title: "How do I configure an API key?",
    summary: "Use API Key Manager only.",
    body: [
      "Open API Key Manager, add the key for the provider you use and save it. Keys are never shown on the Help or Settings pages and are not copied by the diagnostics buttons.",
    ],
    verified: true,
    link: { label: "Open API Key Manager", path: KNOWN_ROUTES.apiKeys },
  },
  {
    id: "faq-providers",
    category: "FAQ",
    title: "Why is a provider or model unavailable?",
    summary: "Only supported providers with a usable key work.",
    body: [
      "Only providers and models built into the application can be used, and a provider without a usable key cannot be used. The Settings page does not offer a default provider or model yet.",
    ],
    verified: true,
  },
  {
    id: "faq-image-errors",
    category: "FAQ",
    title: "Why does image processing fail?",
    summary: "Size, format or memory limits.",
    body: [
      "Very large or corrupted images, unsupported formats and too many files at once can cause failures. Try a smaller image, save it as JPG or PNG, and process fewer files at a time.",
    ],
    verified: false,
  },
  {
    id: "faq-downloads",
    category: "FAQ",
    title: "Why did a download fail or open incorrectly?",
    summary: "Browser blocking or an incomplete result.",
    body: [
      "Check that your browser is not blocking downloads or pop-ups and that you have free disk space. Try again, or try another browser. Open the downloaded file to confirm it is valid before relying on it.",
    ],
    verified: false,
  },
  {
    id: "faq-settings-storage",
    category: "FAQ",
    title: "Where are my settings stored?",
    summary: "Only in this browser.",
    body: [
      "Settings are saved in this browser's local storage under the key metaforge.preferences.v1. They are not stored on a server, do not sync to other browsers or devices, and are removed if you clear site data.",
      "No API keys, tokens or passwords are saved there.",
    ],
    verified: true,
    link: { label: "Open Settings", path: KNOWN_ROUTES.settings },
  },
  {
    id: "faq-build",
    category: "FAQ",
    title: "How do I fix build or deployment problems?",
    summary: "Run the checks and read the first error.",
    body: [
      "Run the type check and the production build locally and fix the first reported error before anything else. If you deploy to a hosting service such as Vercel, set environment variables in the hosting dashboard, never in committed code, and redeploy afterwards.",
    ],
    steps: [
      "npx tsc --noEmit",
      "npm run build",
      "Fix the first error shown, then run both again.",
      "After changing a NEXT_PUBLIC_ variable, restart the dev server or rebuild.",
    ],
    verified: true,
  },

  // ---------------- Troubleshooting ----------------
  {
    id: "ts-key",
    category: "Troubleshooting",
    title: "API key missing or invalid",
    summary: "The provider rejects the request or no key is set.",
    body: ["The key may be missing, mistyped, expired or revoked at the provider."],
    steps: [
      "Open API Key Manager.",
      "Confirm the provider you are using has a saved key.",
      "Re-enter the key if the provider keeps rejecting it.",
      "Retry the action.",
    ],
    verified: true,
    link: { label: "Open API Key Manager", path: KNOWN_ROUTES.apiKeys },
  },
  {
    id: "ts-provider",
    category: "Troubleshooting",
    title: "Provider request failure",
    summary: "The AI provider returned an error or timed out.",
    body: ["Provider errors can be temporary or caused by a key, quota or model problem."],
    steps: [
      "Retry once.",
      "Try another supported model or provider if one is available.",
      "Check the provider's own status page.",
      "Copy the troubleshooting information below and include the exact error message in your report.",
    ],
    verified: true,
  },
  {
    id: "ts-format",
    category: "Troubleshooting",
    title: "Unsupported image or vector format",
    summary: "The file type is not accepted by the tool.",
    body: ["The file extension and the real file format must both match what the tool accepts."],
    steps: [
      "Check the file's real format, not just its extension.",
      "Export a JPG or PNG from your editor for image tools.",
      "Use the AI/EPS converter for vector files.",
      "Do not rename extensions to force a file through.",
    ],
    verified: true,
  },
  {
    id: "ts-size",
    category: "Troubleshooting",
    title: "File too large",
    summary: "The upload or processing step fails on big files.",
    body: [
      "Large files can exceed upload or memory limits. The batch-size preference in Settings is saved but is not read by tools yet, so reduce the number of files yourself.",
    ],
    steps: ["Resize or compress the image.", "Process one file at a time.", "Retry."],
    verified: true,
  },
  {
    id: "ts-engine",
    category: "Troubleshooting",
    title: "Conversion engine unavailable",
    summary: "AI, EPS or PSD conversion cannot run.",
    body: [
      "Some conversions need rendering software or libraries on the computer or server running the app. If a tool reports that its engine is missing, the environment lacks it. Install the required software or convert the file elsewhere. A renamed file is not a conversion.",
    ],
    verified: true,
  },
  {
    id: "ts-download",
    category: "Troubleshooting",
    title: "Failed download",
    summary: "The file does not save or will not open.",
    body: ["The browser may be blocking the download, or the result may be incomplete."],
    steps: [
      "Allow downloads and pop-ups for this site.",
      "Check free disk space.",
      "Retry, or try another browser.",
      "Open the file to confirm it is valid.",
    ],
    verified: true,
  },
  {
    id: "ts-prefs",
    category: "Troubleshooting",
    title: "Preferences not appearing in another browser",
    summary: "Settings are per browser.",
    body: [
      "Settings live in local storage, which is separate for each browser, profile, device and web address. Localhost and a deployed domain also have separate storage. Save the settings again in the other browser.",
    ],
    verified: true,
    link: { label: "Open Settings", path: KNOWN_ROUTES.settings },
  },
  {
    id: "ts-network",
    category: "Troubleshooting",
    title: "Network or server error",
    summary: "Requests fail or pages do not load.",
    body: ["Check your connection first, then the server."],
    steps: [
      "Check that you are online and reload the page.",
      "Retry in a few minutes.",
      "If you run the app locally, read the terminal where npm run dev is running for the real error.",
      "Copy the troubleshooting information below and include the error text.",
    ],
    verified: true,
  },
];

export function articleText(a: HelpArticle): string {
  return [a.title, a.category, a.summary, ...a.body, ...(a.steps ?? [])].join(" ").toLowerCase();
}

export function searchArticles(list: HelpArticle[], query: string): HelpArticle[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return list;
  return list.filter((a) => {
    const text = articleText(a);
    return terms.every((t) => text.includes(t));
  });
}