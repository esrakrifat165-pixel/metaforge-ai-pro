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