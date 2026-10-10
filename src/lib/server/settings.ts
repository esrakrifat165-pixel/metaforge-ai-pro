"use client";

import { useState } from "react";
import { MESSAGE_MAX, type RuntimeSettings } from "../../lib/settings/runtime";

export function AdminSettings({ initial }: { initial: RuntimeSettings }) {
  const [settings, setSettings] = useState<RuntimeSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save() {
    if (saving) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload: unknown = await response.json().catch(() => null);
      const ok =
        typeof payload === "object" &&
        payload !== null &&
        (payload as { success?: unknown }).success === true;
      if (ok) {
        setMessage({ kind: "success", text: "Settings saved." });
      } else {
        const text =
          typeof payload === "object" &&
          payload !== null &&
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : "The settings could not be saved.";
        setMessage({ kind: "error", text });
      }
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Nothing was saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="admin-runtime">
      <h2 id="admin-runtime" className="section-title">
        Runtime controls
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        These apply to AI generation for everyone except admins.
      </p>

      <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={settings.generationEnabled}
            onChange={(event) => setSettings({ ...settings, generationEnabled: event.target.checked })}
          />
          Generation enabled
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={settings.maintenanceEnabled}
            onChange={(event) => setSettings({ ...settings, maintenanceEnabled: event.target.checked })}
          />
          Maintenance mode
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: "0.85rem" }}>
          Maintenance message (shown to users)
          <input
            type="text"
            value={settings.maintenanceMessage}
            maxLength={MESSAGE_MAX}
            placeholder="We are updating the app. Please try again soon."
            onChange={(event) => setSettings({ ...settings, maintenanceMessage: event.target.value })}
            style={{
              height: 40,
              padding: "0 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface-hover)",
              color: "var(--text)",
              font: "inherit",
            }}
          />
        </label>

        <div>
          <button type="button" className="button button-primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p style={{ color: message.kind === "error" ? "var(--warn)" : "var(--text)" }}>
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}