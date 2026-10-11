"use client";

import "./settings.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  IMAGE_FORMATS,
  LIMITS,
  PREFERENCES_STORAGE_KEY,
  PROMPT_DETAILS,
  clonePreferences,
  loadPreferences,
  savePreferences,
  validatePreferences,
  type ImageFormat,
  type LoadStatus,
  type Preferences,
  type PromptDetail,
} from "../../../lib/preferences";

type Feedback = { kind: "success" | "error" | "info"; text: string } | null;

function Badge() {
  return <span className="stg-badge">Saved locally - not yet read by tools</span>;
}

function Switch(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="stg-row">
      <div className="stg-row-text">
        <label htmlFor={props.id} className="stg-label">{props.label}</label>
        <p id={`${props.id}-hint`} className="stg-hint">{props.hint}</p>
      </div>
      <input
        id={props.id}
        type="checkbox"
        role="switch"
        className="stg-switch"
        checked={props.checked}
        disabled={props.disabled}
        aria-describedby={`${props.id}-hint`}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </div>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  error?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stg-field">
      <label htmlFor={props.id} className="stg-label">{props.label}</label>
      <input
        id={props.id}
        type="number"
        inputMode="numeric"
        className="stg-input"
        min={props.min}
        max={props.max}
        step={1}
        value={Number.isFinite(props.value) ? String(props.value) : ""}
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={`${props.id}-hint${props.error ? ` ${props.id}-err` : ""}`}
        onChange={(e) => props.onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
      <p id={`${props.id}-hint`} className="stg-hint">{props.hint} ({props.min}-{props.max})</p>
      {props.error ? <p id={`${props.id}-err`} className="stg-error" role="alert">{props.error}</p> : null}
    </div>
  );
}

export default function SettingsPage() {
  const [ready, setReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("default");
  const [saved, setSaved] = useState<Preferences>(() => clonePreferences(DEFAULT_PREFERENCES));
  const [draft, setDraft] = useState<Preferences>(() => clonePreferences(DEFAULT_PREFERENCES));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    const result = loadPreferences();
    setSaved(result.preferences);
    setDraft(clonePreferences(result.preferences));
    setLoadStatus(result.status);
    setReady(true);
  }, []);

  const errors = useMemo(() => validatePreferences(draft), [draft]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function update<K extends keyof Preferences>(section: K, patch: Partial<Preferences[K]>) {
    setDraft((d) => ({ ...d, [section]: { ...d[section], ...patch } }));
    setFeedback(null);
  }

  function handleSave() {
    if (saving) return;
    if (errorCount > 0) {
      setFeedback({ kind: "error", text: `Fix ${errorCount} invalid value${errorCount === 1 ? "" : "s"} before saving.` });
      return;
    }
    setSaving(true);
    try {
      const stored = savePreferences(draft);
      setSaved(stored);
      setDraft(clonePreferences(stored));
      setLoadStatus("loaded");
      setFeedback({ kind: "success", text: "Settings saved in this browser." });
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "Saving failed." });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (!dirty) return;
    setDraft(clonePreferences(saved));
    setFeedback({ kind: "info", text: "Unsaved changes discarded. Showing your last saved settings." });
  }

  function handleReset() {
    if (saving) return;
    const message = dirty
      ? "Reset all settings to defaults? Your unsaved changes and your currently saved settings will be replaced."
      : "Reset all settings to defaults? Your currently saved settings will be replaced.";
    if (!window.confirm(message)) return;
    setSaving(true);
    try {
      const stored = savePreferences(clonePreferences(DEFAULT_PREFERENCES));
      setSaved(stored);
      setDraft(clonePreferences(stored));
      setLoadStatus("loaded");
      setFeedback({ kind: "success", text: "Settings reset to defaults and saved." });
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "Reset failed." });
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <div className="stg-page" aria-busy="true">
        <p className="stg-hint">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="stg-page">
      <header className="stg-header">
        <h1 className="stg-title">Settings</h1>
        <p className="stg-sub">Preferences for METAFORGE AI PRO, stored in this browser only.</p>
      </header>

      {loadStatus === "recovered" && (
        <p className="stg-banner stg-banner-warn" role="status">
          Some saved settings were unreadable or outdated, so defaults are shown for those fields. Nothing is overwritten until you save.
        </p>
      )}
      {loadStatus === "unavailable" && (
        <p className="stg-banner stg-banner-error" role="alert">
          This browser is blocking local storage, so settings cannot be saved here.
        </p>
      )}

      <p className="stg-banner">
        Preferences below are saved, but the tools do not read them yet. Each section is labelled until a tool is connected to it.
      </p>

      <section className="stg-card" aria-labelledby="stg-appearance">
        <h2 id="stg-appearance" className="stg-h2">Appearance</h2>
        <p className="stg-hint">
          Use the theme switch in the top bar to change between light and dark. Settings does not keep a separate theme, so the two can never disagree.
        </p>
      </section>

      <section className="stg-card stg-card-disabled" aria-labelledby="stg-provider">
        <h2 id="stg-provider" className="stg-h2">AI provider and model</h2>
        <p className="stg-hint">
          Not available yet. Default provider and model need the application&apos;s real model registry, which this page does not guess at. API keys are managed separately, and none are shown here.
        </p>
        <p className="stg-hint">
          <Link href="/settings/api-keys" className="stg-link">Open API Key Manager</Link>
        </p>
      </section>

      <section className="stg-card" aria-labelledby="stg-metadata">
        <div className="stg-card-head">
          <h2 id="stg-metadata" className="stg-h2">Metadata Generator</h2>
          <Badge />
        </div>
        <Switch
          id="stg-title-on"
          label="Generate titles"
          hint="Include a title in generated metadata."
          checked={draft.metadata.generateTitle}
          onChange={(v) => update("metadata", { generateTitle: v })}
        />
        <Switch
          id="stg-desc-on"
          label="Generate descriptions"
          hint="Include a description in generated metadata."
          checked={draft.metadata.generateDescription}
          onChange={(v) => update("metadata", { generateDescription: v })}
        />
        <Switch
          id="stg-single-word"
          label="Prefer single-word keywords"
          hint="Favour one-word keywords over phrases."
          checked={draft.metadata.singleWordKeywords}
          onChange={(v) => update("metadata", { singleWordKeywords: v })}
        />
        <div className="stg-grid">
          <NumberField
            id="stg-kw-count"
            label="Keyword count"
            hint="Default number of keywords"
            min={LIMITS.keywordCount.min}
            max={LIMITS.keywordCount.max}
            value={draft.metadata.keywordCount}
            error={errors["metadata.keywordCount"]}
            onChange={(v) => update("metadata", { keywordCount: v })}
          />
          <NumberField
            id="stg-title-len"
            label="Title max length"
            hint="Characters"
            min={LIMITS.titleMaxLength.min}
            max={LIMITS.titleMaxLength.max}
            value={draft.metadata.titleMaxLength}
            disabled={!draft.metadata.generateTitle}
            error={errors["metadata.titleMaxLength"]}
            onChange={(v) => update("metadata", { titleMaxLength: v })}
          />
          <NumberField
            id="stg-desc-len"
            label="Description max length"
            hint="Characters"
            min={LIMITS.descriptionMaxLength.min}
            max={LIMITS.descriptionMaxLength.max}
            value={draft.metadata.descriptionMaxLength}
            disabled={!draft.metadata.generateDescription}
            error={errors["metadata.descriptionMaxLength"]}
            onChange={(v) => update("metadata", { descriptionMaxLength: v })}
          />
        </div>
      </section>

      <section className="stg-card" aria-labelledby="stg-i2p">
        <div className="stg-card-head">
          <h2 id="stg-i2p" className="stg-h2">Image-to-Prompt</h2>
          <Badge />
        </div>
        <div className="stg-field">
          <label htmlFor="stg-detail" className="stg-label">Prompt detail</label>
          <select
            id="stg-detail"
            className="stg-input stg-select"
            value={draft.imageToPrompt.detail}
            onChange={(e) => update("imageToPrompt", { detail: e.target.value as PromptDetail })}
          >
            {PROMPT_DETAILS.map((d) => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
          <p className="stg-hint">How detailed generated prompts should be by default.</p>
        </div>
      </section>

      <section className="stg-card" aria-labelledby="stg-image">
        <div className="stg-card-head">
          <h2 id="stg-image" className="stg-h2">Image processing</h2>
          <Badge />
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label htmlFor="stg-format" className="stg-label">Default output format</label>
            <select
              id="stg-format"
              className="stg-input stg-select"
              value={draft.image.outputFormat}
              onChange={(e) => update("image", { outputFormat: e.target.value as ImageFormat })}
            >
              {IMAGE_FORMATS.map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="stg-field">
            <label htmlFor="stg-quality" className="stg-label">
              JPG quality: {Number.isFinite(draft.image.jpgQuality) ? draft.image.jpgQuality : "-"}
            </label>
            <input
              id="stg-quality"
              type="range"
              className="stg-range"
              min={LIMITS.jpgQuality.min}
              max={LIMITS.jpgQuality.max}
              step={1}
              value={draft.image.jpgQuality}
              disabled={draft.image.outputFormat !== "jpg"}
              onChange={(e) => update("image", { jpgQuality: Number(e.target.value) })}
            />
            <p className="stg-hint">Applies when the output format is JPG.</p>
            {errors["image.jpgQuality"] ? <p className="stg-error" role="alert">{errors["image.jpgQuality"]}</p> : null}
          </div>
          <div className="stg-field">
            <label htmlFor="stg-bg" className="stg-label">Background colour (for JPG)</label>
            <div className="stg-color-row">
              <input
                id="stg-bg"
                type="color"
                className="stg-color"
                value={/^#[0-9a-fA-F]{6}$/.test(draft.image.backgroundColor) ? draft.image.backgroundColor : "#ffffff"}
                disabled={draft.image.outputFormat !== "jpg"}
                onChange={(e) => update("image", { backgroundColor: e.target.value.toLowerCase() })}
              />
              <code className="stg-code">{draft.image.backgroundColor}</code>
            </div>
            <p className="stg-hint">Fills transparent areas when converting to JPG.</p>
          </div>
        </div>
        <Switch
          id="stg-aspect"
          label="Preserve aspect ratio"
          hint="Keep the original proportions when resizing."
          checked={draft.image.preserveAspectRatio}
          onChange={(v) => update("image", { preserveAspectRatio: v })}
        />
      </section>

      <section className="stg-card" aria-labelledby="stg-batch">
        <div className="stg-card-head">
          <h2 id="stg-batch" className="stg-h2">Batch processing</h2>
          <Badge />
        </div>
        <NumberField
          id="stg-batch-size"
          label="Files processed at once"
          hint="Lower values use less memory and are safer on large images"
          min={LIMITS.batchSize.min}
          max={LIMITS.batchSize.max}
          value={draft.batch.batchSize}
          error={errors["batch.batchSize"]}
          onChange={(v) => update("batch", { batchSize: v })}
        />
      </section>

      <section className="stg-card" aria-labelledby="stg-privacy">
        <h2 id="stg-privacy" className="stg-h2">Privacy and data</h2>
        <ul className="stg-list">
          <li>These preferences live in this browser&apos;s local storage under <code className="stg-code">{PREFERENCES_STORAGE_KEY}</code>.</li>
          <li>They are not sent to a server and do not sync to other devices or browsers.</li>
          <li>No API keys, tokens or passwords are stored here. Keys are handled only by the API Key Manager.</li>
          <li>Clearing site data in your browser also clears these preferences.</li>
          <li>&quot;Reset to defaults&quot; only affects these preferences. It does not touch history, keys or files.</li>
        </ul>
      </section>

      <div className="stg-bar" role="group" aria-label="Settings actions">
        <div className="stg-bar-status" role="status" aria-live="polite">
          {feedback ? (
            <span className={`stg-msg stg-msg-${feedback.kind}`}>{feedback.text}</span>
          ) : dirty ? (
            <span className="stg-msg stg-msg-warn">Unsaved changes</span>
          ) : (
            <span className="stg-msg">All changes saved</span>
          )}
        </div>
        <div className="stg-bar-actions">
          <button type="button" className="stg-btn stg-btn-ghost" onClick={handleReset} disabled={saving}>
            Reset to defaults
          </button>
          <button type="button" className="stg-btn stg-btn-ghost" onClick={handleCancel} disabled={!dirty || saving}>
            Cancel
          </button>
          <button type="button" className="stg-btn stg-btn-primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}