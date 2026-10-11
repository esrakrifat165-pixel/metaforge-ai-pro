param(
  [string]$Route = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Marker = "METAFORGE-HELP-SUPPORT v1"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$root = (Get-Location).Path
$created = New-Object System.Collections.Generic.List[string]
$modified = New-Object System.Collections.Generic.List[string]
$backedUp = New-Object System.Collections.Generic.List[string]
$unchanged = New-Object System.Collections.Generic.List[string]

# ---------------------------------------------------------------
# File contents
# ---------------------------------------------------------------

$libContent = @'
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
'@

$pageContent = @'
"use client";
// METAFORGE-HELP-SUPPORT v1

import "./help.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  HELP_ARTICLES,
  KNOWN_ROUTES,
  UNVERIFIED_NOTE,
  searchArticles,
  type HelpArticle,
} from "../../../lib/help-content";

type Feedback = { kind: "success" | "error"; text: string } | null;

const SUPPORT_EMAIL = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim();
const SUPPORT_URL_RAW = (process.env.NEXT_PUBLIC_SUPPORT_URL ?? "").trim();
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SUPPORT_EMAIL);

function safeHttpsUrl(value: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
const SUPPORT_URL = safeHttpsUrl(SUPPORT_URL_RAW);

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy method
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Contains no API keys, tokens, query strings, file contents or history.
function buildDiagnostics(): string {
  let prefs = "unknown";
  try {
    prefs =
      window.localStorage.getItem("metaforge.preferences.v1") !== null
        ? "saved in this browser"
        : "not saved (defaults in use)";
  } catch {
    prefs = "local storage unavailable";
  }
  return [
    "METAFORGE AI PRO - troubleshooting information",
    "Generated locally in your browser. Nothing was sent anywhere.",
    "Time: " + new Date().toISOString(),
    "Page: " + window.location.pathname,
    "Browser: " + navigator.userAgent,
    "Viewport: " + window.innerWidth + "x" + window.innerHeight,
    "Online: " + (navigator.onLine ? "yes" : "no"),
    "Saved settings: " + prefs,
    "Not included: API keys, tokens, passwords, file contents, history.",
  ].join("\n");
}

function buildReportTemplate(): string {
  return [
    "METAFORGE AI PRO - error report",
    "",
    "What I was trying to do:",
    "",
    "Which tool/page:",
    "",
    "What I expected:",
    "",
    "What happened (exact error message):",
    "",
    "Steps to reproduce:",
    "1.",
    "2.",
    "3.",
    "",
    "File type and approximate size (do not attach private files unless asked):",
    "",
    "--- Technical information (generated locally) ---",
    buildDiagnostics(),
    "",
    "Do not paste API keys, passwords or tokens into this report.",
  ].join("\n");
}

export default function HelpSupportPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copying, setCopying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchArticles(HELP_ARTICLES, query), [query]);
  const grouped = useMemo(
    () =>
      CATEGORIES.map((c) => ({ category: c, items: results.filter((a) => a.category === c) })).filter(
        (g) => g.items.length > 0
      ),
    [results]
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function say(kind: "success" | "error", text: string) {
    setFeedback({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 6000);
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpen((prev) => {
      const next = new Set(prev);
      results.forEach((a) => next.add(a.id));
      return next;
    });
  }

  function collapseAll() {
    setOpen((prev) => {
      const next = new Set(prev);
      results.forEach((a) => next.delete(a.id));
      return next;
    });
  }

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  async function handleCopy(kind: "diagnostics" | "template") {
    if (copying) return;
    setCopying(true);
    try {
      const text = kind === "diagnostics" ? buildDiagnostics() : buildReportTemplate();
      const ok = await copyText(text);
      if (ok) {
        say("success", "Copied to your clipboard. This only copied text locally; nothing was sent anywhere.");
      } else {
        say("error", "Copy failed because the browser blocked clipboard access. Nothing was copied.");
      }
    } finally {
      setCopying(false);
    }
  }

  function renderArticle(a: HelpArticle) {
    const isOpen = open.has(a.id);
    return (
      <div key={a.id} className="hlp-item">
        <h3 className="hlp-item-h">
          <button
            type="button"
            id={a.id + "-btn"}
            className="hlp-item-btn"
            aria-expanded={isOpen}
            aria-controls={a.id + "-panel"}
            onClick={() => toggle(a.id)}
          >
            <span className="hlp-item-text">
              <span className="hlp-item-title">{a.title}</span>
              <span className="hlp-item-sum">{a.summary}</span>
            </span>
            <span className="hlp-chev" aria-hidden="true">{isOpen ? "-" : "+"}</span>
          </button>
        </h3>
        <div id={a.id + "-panel"} role="region" aria-labelledby={a.id + "-btn"} hidden={!isOpen} className="hlp-panel">
          {a.body.map((p, i) => (
            <p key={i} className="hlp-p">{p}</p>
          ))}
          {a.steps && a.steps.length > 0 ? (
            <ol className="hlp-steps">
              {a.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
          {!a.verified ? <p className="hlp-unverified">{UNVERIFIED_NOTE}</p> : null}
          {a.link ? (
            <p className="hlp-p">
              <Link href={a.link.path} className="hlp-link">{a.link.label}</Link>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const hasContact = EMAIL_OK || SUPPORT_URL !== null;
  const emailBad = SUPPORT_EMAIL !== "" && !EMAIL_OK;
  const urlBad = SUPPORT_URL_RAW !== "" && SUPPORT_URL === null;

  return (
    <div className="hlp-page">
      <header className="hlp-header">
        <h1 className="hlp-title">Help &amp; Support</h1>
        <p className="hlp-sub">Guides, answers and troubleshooting for METAFORGE AI PRO.</p>
      </header>

      <section className="hlp-card" aria-labelledby="hlp-search-h">
        <h2 id="hlp-search-h" className="hlp-h2">Search help</h2>
        <div className="hlp-search-row">
          <input
            ref={searchRef}
            type="search"
            className="hlp-input"
            placeholder="Search guides, FAQs and troubleshooting"
            aria-label="Search help articles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") clearSearch();
            }}
          />
          <button type="button" className="hlp-btn" onClick={clearSearch} disabled={query === ""}>
            Clear search
          </button>
        </div>
        <div className="hlp-toolbar">
          <p className="hlp-count" role="status" aria-live="polite">
            {results.length} of {HELP_ARTICLES.length} articles
          </p>
          <div className="hlp-toolbar-actions">
            <button type="button" className="hlp-btn" onClick={expandAll} disabled={results.length === 0}>
              Expand all
            </button>
            <button type="button" className="hlp-btn" onClick={collapseAll} disabled={results.length === 0}>
              Collapse all
            </button>
          </div>
        </div>
      </section>

      {results.length === 0 ? (
        <section className="hlp-card hlp-empty" aria-live="polite">
          <p className="hlp-p">No help articles match &quot;{query}&quot;.</p>
          <p className="hlp-hint">Try fewer or different words, or clear the search to see everything.</p>
          <button type="button" className="hlp-btn hlp-btn-primary" onClick={clearSearch}>
            Clear search
          </button>
        </section>
      ) : (
        grouped.map((g) => (
          <section key={g.category} className="hlp-card" aria-labelledby={"hlp-cat-" + g.category.replace(/\s+/g, "-")}>
            <h2 id={"hlp-cat-" + g.category.replace(/\s+/g, "-")} className="hlp-h2">
              {g.category} <span className="hlp-hint">({g.items.length})</span>
            </h2>
            {g.items.map(renderArticle)}
          </section>
        ))
      )}

      <section className="hlp-card" aria-labelledby="hlp-actions-h">
        <h2 id="hlp-actions-h" className="hlp-h2">Useful actions</h2>
        <div className="hlp-actions">
          <button type="button" className="hlp-btn hlp-btn-primary" onClick={() => handleCopy("diagnostics")} disabled={copying}>
            Copy troubleshooting information
          </button>
          <button type="button" className="hlp-btn" onClick={() => handleCopy("template")} disabled={copying}>
            Copy error-report template
          </button>
          <Link href={KNOWN_ROUTES.settings} className="hlp-btn hlp-btn-link">Open Settings</Link>
          <Link href={KNOWN_ROUTES.apiKeys} className="hlp-btn hlp-btn-link">Open API Key Manager</Link>
        </div>
        <p className="hlp-hint">
          Copying only places text on your clipboard. It does not check your system and does not send anything to a server.
        </p>
        <p className="hlp-feedback" role="status" aria-live="polite">
          {feedback ? <span className={"hlp-msg hlp-msg-" + feedback.kind}>{feedback.text}</span> : null}
        </p>
      </section>

      <section className="hlp-card" aria-labelledby="hlp-contact-h">
        <h2 id="hlp-contact-h" className="hlp-h2">Contact and support</h2>
        {hasContact ? (
          <div className="hlp-actions">
            {EMAIL_OK ? (
              <a className="hlp-btn hlp-btn-link" href={"mailto:" + SUPPORT_EMAIL}>
                Email {SUPPORT_EMAIL}
              </a>
            ) : null}
            {SUPPORT_URL ? (
              <a className="hlp-btn hlp-btn-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
                Open support site
              </a>
            ) : null}
          </div>
        ) : (
          <p className="hlp-p">
            No support contact has been configured for this installation, so there is nothing to contact from here.
          </p>
        )}
        {emailBad ? <p className="hlp-error">The configured support email is not a valid address and is not shown.</p> : null}
        {urlBad ? <p className="hlp-error">The configured support URL must start with https:// and is not shown.</p> : null}
        <p className="hlp-hint">
          Administrators: set NEXT_PUBLIC_SUPPORT_EMAIL and/or NEXT_PUBLIC_SUPPORT_URL (https only) in the environment,
          then restart or rebuild the app. These values are visible to every visitor, so use public contact details only.
        </p>
      </section>

      <section className="hlp-card" aria-labelledby="hlp-privacy-h">
        <h2 id="hlp-privacy-h" className="hlp-h2">Privacy and safety</h2>
        <ul className="hlp-list">
          <li>Copied information never includes API keys, tokens, passwords, file contents or history.</li>
          <li>Reports are only copied to your clipboard. Nothing is sent to any server from this page.</li>
          <li>Never paste API keys or passwords into a report, chat or email.</li>
        </ul>
      </section>
    </div>
  );
}
'@

$cssContent = @'
/* METAFORGE-HELP-SUPPORT v1 */
.hlp-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 64px;
  --hlp-accent: #7c3aed;
  --hlp-border: rgba(127, 127, 127, 0.28);
  --hlp-surface: rgba(127, 127, 127, 0.08);
}
.hlp-header { margin-bottom: 20px; }
.hlp-title { font-size: 1.75rem; font-weight: 700; margin: 0 0 4px; }
.hlp-sub { margin: 0; opacity: 0.7; }

.hlp-card {
  border: 1px solid var(--hlp-border);
  border-radius: 14px;
  background: var(--hlp-surface);
  padding: 18px;
  margin-bottom: 16px;
}
.hlp-h2 { font-size: 1.1rem; font-weight: 600; margin: 0 0 10px; }
.hlp-p { margin: 0 0 8px; font-size: 0.92rem; line-height: 1.5; }
.hlp-hint { margin: 6px 0 0; font-size: 0.82rem; opacity: 0.7; }
.hlp-error { margin: 8px 0 0; font-size: 0.85rem; color: #dc2626; }
.hlp-list { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 0.9rem; }
.hlp-link { color: var(--hlp-accent); text-decoration: underline; }

.hlp-search-row { display: flex; gap: 8px; flex-wrap: wrap; }
.hlp-input {
  flex: 1 1 260px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--hlp-border);
  background: transparent;
  color: inherit;
  font: inherit;
}
.hlp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.hlp-toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.hlp-count { margin: 0; font-size: 0.85rem; opacity: 0.75; }
.hlp-empty { text-align: center; }

.hlp-item { border-top: 1px solid var(--hlp-border); }
.hlp-item:first-of-type { border-top: 0; }
.hlp-item-h { margin: 0; font-size: 1rem; }
.hlp-item-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 4px;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hlp-item-text { display: flex; flex-direction: column; gap: 2px; }
.hlp-item-title { font-weight: 600; }
.hlp-item-sum { font-size: 0.82rem; opacity: 0.7; font-weight: 400; }
.hlp-chev { flex: none; width: 24px; text-align: center; font-weight: 700; color: var(--hlp-accent); }
.hlp-panel { padding: 0 4px 14px; }
.hlp-steps { margin: 4px 0 8px; padding-left: 20px; display: grid; gap: 4px; font-size: 0.9rem; }
.hlp-unverified {
  margin: 8px 0;
  padding: 6px 10px;
  border: 1px dashed var(--hlp-accent);
  border-radius: 8px;
  font-size: 0.8rem;
  color: var(--hlp-accent);
}

.hlp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.hlp-feedback { margin: 10px 0 0; min-height: 1.2em; font-size: 0.88rem; }
.hlp-msg-success { color: #16a34a; }
.hlp-msg-error { color: #dc2626; }

.hlp-btn {
  display: inline-block;
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid var(--hlp-border);
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.hlp-btn:hover:not(:disabled) { background: var(--hlp-surface); }
.hlp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.hlp-btn-primary { background: var(--hlp-accent); border-color: var(--hlp-accent); color: #fff; }
.hlp-btn-primary:hover:not(:disabled) { background: var(--hlp-accent); filter: brightness(1.1); }

.hlp-input:focus-visible,
.hlp-btn:focus-visible,
.hlp-item-btn:focus-visible,
.hlp-link:focus-visible {
  outline: 2px solid var(--hlp-accent);
  outline-offset: 2px;
}

@media (max-width: 600px) {
  .hlp-page { padding: 16px 12px 48px; }
  .hlp-actions .hlp-btn { flex: 1 1 100%; text-align: center; }
  .hlp-toolbar-actions { width: 100%; }
  .hlp-toolbar-actions .hlp-btn { flex: 1; }
}
'@

# ---------------------------------------------------------------
# Installer logic
# ---------------------------------------------------------------

function Write-Safe {
  param([string]$Path, [string]$Content)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $normalized = $Content -replace "`r`n", "`n"
  if (Test-Path -LiteralPath $Path) {
    $existing = [System.IO.File]::ReadAllText($Path)
    if ($existing -eq $normalized) {
      $script:unchanged.Add($Path)
      return
    }
    $bak = "$Path.bak-$stamp"
    Copy-Item -LiteralPath $Path -Destination $bak
    $script:backedUp.Add($bak)
    [System.IO.File]::WriteAllText($Path, $normalized, $utf8)
    $script:modified.Add($Path)
  } else {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $normalized, $utf8)
    $script:created.Add($Path)
  }
  $check = [System.IO.File]::ReadAllText($Path)
  if ($check -ne $normalized) { throw "Verification failed after writing: $Path" }
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path $root "package.json"))) {
    throw "package.json not found. Run this from C:\Projects\metaforge-ai-pro\metaforge-web."
  }
  $pkg = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw
  if ($pkg -notmatch '"next"') { throw "This does not look like a Next.js project (no next dependency in package.json)." }
  $appDir = Join-Path $root "src\app\(app)"
  if (-not (Test-Path -LiteralPath $appDir)) { throw "src\app\(app) was not found. This installer expects the (app) route group." }

  # ----- Detect mode: no route given -----
  if ([string]::IsNullOrWhiteSpace($Route)) {
    Write-Host "DETECT MODE (nothing will be written)." -ForegroundColor Cyan
    $cands = @{}
    $files = Get-ChildItem -Path (Join-Path $root "src") -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx,*.json
    foreach ($f in $files) {
      $lines = Get-Content -LiteralPath $f.FullName
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match 'Help\s*(&|&amp;|and)\s*Support') {
          $end = [Math]::Min($i + 2, $lines.Count - 1)
          for ($j = $i; $j -le $end; $j++) {
            if ($lines[$j] -match '(?:href|path|url|to|route)\s*[:=]\s*\{?\s*["'']((/[A-Za-z0-9-]+))["'']') {
              $cands[$Matches[1]] = "$($f.Name):$($j + 1)"
            }
          }
        }
      }
    }
    if ($cands.Count -eq 0) {
      Write-Host "No candidate href found near 'Help & Support'." -ForegroundColor Yellow
    } else {
      Write-Host "Possible Help & Support hrefs (verify before using):"
      foreach ($k in $cands.Keys) { Write-Host "  $k   (found at $($cands[$k]))" }
    }
    Write-Host ""
    Write-Host "Confirm the route by opening Help & Support in the browser and reading the URL after the domain."
    Write-Host "Then run:  powershell -ExecutionPolicy Bypass -File .\install-help-support.ps1 -Route help"
    Write-Host "(replace 'help' with your route, without the leading slash)"
    exit 0
  }

  # ----- Install mode -----
  $Route = $Route.Trim().TrimStart('/')
  if ($Route -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
    throw "Route '$Route' is not valid. Use a single lowercase segment such as 'help' or 'help-support'."
  }

  $targets = @(
    @{ Path = (Join-Path $root "src\lib\help-content.ts"); Content = $libContent },
    @{ Path = (Join-Path $root "src\app\(app)\$Route\page.tsx"); Content = $pageContent },
    @{ Path = (Join-Path $root "src\app\(app)\$Route\help.css"); Content = $cssContent }
  )

  # Preflight: refuse before writing anything if a foreign file is in the way.
  foreach ($t in $targets) {
    if (Test-Path -LiteralPath $t.Path) {
      $existing = [System.IO.File]::ReadAllText($t.Path)
      if (-not $existing.Contains($Marker) -and -not $Force) {
        throw "A file that this installer did not create already exists: $($t.Path). Nothing was changed. Re-run with -Force to back it up and replace it."
      }
    }
  }

  foreach ($t in $targets) { Write-Safe -Path $t.Path -Content $t.Content }

  Write-Host ""
  Write-Host "Done. Route: /$Route" -ForegroundColor Green
  Write-Host "Created:   $($created.Count)"; foreach ($p in $created) { Write-Host "  + $p" }
  Write-Host "Modified:  $($modified.Count)"; foreach ($p in $modified) { Write-Host "  ~ $p" }
  Write-Host "Backed up: $($backedUp.Count)"; foreach ($p in $backedUp) { Write-Host "  b $p" }
  Write-Host "Unchanged: $($unchanged.Count)"; foreach ($p in $unchanged) { Write-Host "  = $p" }
  Write-Host ""
  Write-Host "Rollback commands (copy and run if needed):"
  foreach ($p in $created) { Write-Host "  Remove-Item -LiteralPath '$p'" }
  foreach ($b in $backedUp) {
    $orig = $b -replace '\.bak-\d{8}-\d{6}$', ''
    Write-Host "  Copy-Item -LiteralPath '$b' -Destination '$orig' -Force"
  }
  Write-Host ""
  Write-Host "Not done by this installer: type check, build, git commit/push, .env changes."
  exit 0
}
catch {
  Write-Host ""
  Write-Host "INSTALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($created.Count -gt 0 -or $modified.Count -gt 0) {
    Write-Host "Some files may already have been written before the failure:" -ForegroundColor Yellow
    foreach ($p in $created) { Write-Host "  created  $p" }
    foreach ($p in $modified) { Write-Host "  modified $p" }
    foreach ($b in $backedUp) { Write-Host "  backup   $b" }
  }
  exit 1
}