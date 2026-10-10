"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icons";
import { MAX_KEYS_PER_PROVIDER, PROVIDERS, type ProviderId } from "../../lib/providers/catalog";
import {
  validateApiKey,
  validateLabel,
  type LastResult,
  type PublicKey,
  type StorageState,
} from "../../lib/keys/shared";

type Message = { kind: "success" | "error"; text: string } | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicKey(value: unknown): value is PublicKey {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    PROVIDERS.some((provider) => provider.id === value.provider) &&
    typeof value.label === "string" &&
    typeof value.masked === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.createdAt === "string" &&
    (value.lastUsedAt === null || typeof value.lastUsedAt === "string") &&
    (value.lastResult === null ||
      value.lastResult === "ok" ||
      value.lastResult === "rejected" ||
      value.lastResult === "rate_limited")
  );
}

function isStorageState(value: unknown): value is StorageState {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    (value.state === "ready" ||
      value.state === "missing_secret" ||
      value.state === "unavailable" ||
      value.state === "error")
  );
}

function readList(payload: unknown): { storage: StorageState; keys: PublicKey[] } | null {
  if (!isRecord(payload) || payload.success !== true || !isStorageState(payload.storage)) {
    return null;
  }
  if (!Array.isArray(payload.keys) || !payload.keys.every(isPublicKey)) {
    return null;
  }
  return { storage: payload.storage, keys: payload.keys };
}

function readKey(payload: unknown): PublicKey | null {
  return isRecord(payload) && payload.success === true && isPublicKey(payload.key)
    ? payload.key
    : null;
}

function readMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.message === "string" ? payload.message : fallback;
}

function resultText(result: LastResult): string {
  switch (result) {
    case "ok":
      return "Last request worked";
    case "rejected":
      return "Last request was rejected by the provider";
    case "rate_limited":
      return "Hit a rate limit on the last request";
    default:
      return "Not tested yet";
  }
}

export function ApiKeyManager() {
  const [selectedId, setSelectedId] = useState<ProviderId>(PROVIDERS[0].id);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [keys, setKeys] = useState<PublicKey[]>([]);

  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [reveal, setReveal] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const provider = PROVIDERS.find((entry) => entry.id === selectedId) ?? PROVIDERS[0];
  const providerKeys = keys.filter((key) => key.provider === selectedId);
  const enabledCount = providerKeys.filter((key) => key.enabled).length;
  const storageReady = storage?.state === "ready";
  const atLimit = providerKeys.length >= MAX_KEYS_PER_PROVIDER;

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/api-keys", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      const list = readList(payload);
      if (!list) {
        setLoadError(readMessage(payload, "The server sent an unexpected answer."));
        return;
      }
      setStorage(list.storage);
      setKeys(list.keys);
      setLoadError(null);
    } catch {
      setLoadError("Could not reach the server. Check that the dev server is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function retryLoad() {
    setLoading(true);
    void load();
  }

  function selectProvider(id: ProviderId) {
    setSelectedId(id);
    // Never carry a half-typed key over to another provider.
    setSecret("");
    setReveal(false);
    setFieldError(null);
    setConfirmId(null);
    setMessage(null);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % PROVIDERS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + PROVIDERS.length) % PROVIDERS.length;
    } else {
      return;
    }
    event.preventDefault();
    const next = PROVIDERS[nextIndex];
    selectProvider(next.id);
    tabRefs.current[next.id]?.focus();
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || !storageReady) {
      return;
    }

    const problem = validateLabel(label) ?? validateApiKey(secret);
    if (problem) {
      setFieldError(problem);
      return;
    }
    if (providerKeys.some((key) => key.label.toLowerCase() === label.trim().toLowerCase())) {
      setFieldError("A key with this label already exists for this provider.");
      return;
    }

    setFieldError(null);
    setMessage(null);
    setAdding(true);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedId,
          label: label.trim(),
          apiKey: secret.trim(),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const saved = readKey(payload);
      if (saved) {
        setKeys((previous) => [...previous, saved]);
        // The typed key is removed from the page as soon as it is saved.
        setLabel("");
        setSecret("");
        setReveal(false);
        setMessage({ kind: "success", text: `Saved "${saved.label}". It is encrypted on this computer.` });
      } else {
        setMessage({ kind: "error", text: readMessage(payload, "The key could not be saved.") });
      }
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. The key was not saved." });
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(key: PublicKey) {
    if (busyId) {
      return;
    }
    setBusyId(key.id);
    setMessage(null);
    try {
      const response = await fetch("/api/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id, enabled: !key.enabled }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const updated = readKey(payload);
      if (updated) {
        setKeys((previous) => previous.map((entry) => (entry.id === updated.id ? updated : entry)));
        setMessage({
          kind: "success",
          text: `"${updated.label}" is now ${updated.enabled ? "enabled" : "disabled"}.`,
        });
      } else {
        setMessage({ kind: "error", text: readMessage(payload, "The key could not be updated.") });
      }
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Nothing was changed." });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(key: PublicKey) {
    if (busyId) {
      return;
    }
    setBusyId(key.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/api-keys?id=${encodeURIComponent(key.id)}`, {
        method: "DELETE",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (isRecord(payload) && payload.success === true) {
        setKeys((previous) => previous.filter((entry) => entry.id !== key.id));
        setConfirmId(null);
        setMessage({ kind: "success", text: `Removed "${key.label}".` });
      } else {
        setMessage({ kind: "error", text: readMessage(payload, "The key could not be removed.") });
      }
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Nothing was removed." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Settings</span>
        <h1>API Key Manager</h1>
        <p>
          Manage the AI provider keys METAFORGE AI PRO uses. Saved keys are encrypted on the
          server and are never shown again after they are saved.
        </p>
      </header>

      {loading ? (
        <p className="ak-loading" role="status">
          Loading saved keys...
        </p>
      ) : loadError ? (
        <div className="card ak-notice" data-level="warn" role="alert">
          <span className="ak-notice-icon">
            <Icon name="key" size={20} />
          </span>
          <div>
            <h2 className="section-title">Could not load the key manager</h2>
            <p>{loadError}</p>
            <button type="button" className="button" onClick={retryLoad}>
              Try again
            </button>
          </div>
        </div>
      ) : storage ? (
        <div className="card ak-notice" data-level={storageReady ? "ok" : "warn"} role="note">
          <span className="ak-notice-icon">
            <Icon name="key" size={20} />
          </span>
          <div>
            <h2 className="section-title">
              {storageReady ? "Key storage is active (local development)" : "Key storage is not ready"}
            </h2>
            <p>{storage.message}</p>
            {storage.state === "missing_secret" ? (
              <pre className="ak-code">
                {`$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
Add-Content -Path ".env.local" -Value ("\`nKEY_ENCRYPTION_SECRET=" + [Convert]::ToBase64String($bytes))`}
              </pre>
            ) : null}
            {storageReady ? (
              <p>
                There is no sign-in yet, so anyone using this computer can manage these keys. Keep
                the encryption secret private.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section aria-labelledby="ak-providers-heading">
        <div className="section-head">
          <h2 id="ak-providers-heading" className="section-title">
            Providers
          </h2>
          <span className="section-note">Up to {MAX_KEYS_PER_PROVIDER} keys per provider</span>
        </div>

        <div className="ak-tabs" role="tablist" aria-label="AI providers">
          {PROVIDERS.map((entry, index) => (
            <button
              key={entry.id}
              ref={(node) => {
                tabRefs.current[entry.id] = node;
              }}
              type="button"
              role="tab"
              id={`ak-tab-${entry.id}`}
              className="ak-tab"
              aria-selected={entry.id === selectedId}
              aria-controls="ak-panel"
              tabIndex={entry.id === selectedId ? 0 : -1}
              onClick={() => selectProvider(entry.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {entry.name}
              <span className="ak-tab-count">
                {keys.filter((key) => key.provider === entry.id).length}
              </span>
            </button>
          ))}
        </div>

        <div
          className="card ak-panel"
          id="ak-panel"
          role="tabpanel"
          aria-labelledby={`ak-tab-${provider.id}`}
        >
          <div className="ak-panel-head">
            <div className="ak-panel-title">
              <span className="tool-icon">
                <Icon name="key" />
              </span>
              <div>
                <h3>{provider.name}</h3>
                <p className="ak-count">
                  {providerKeys.length} / {MAX_KEYS_PER_PROVIDER} keys configured
                </p>
              </div>
            </div>
            <span className="status-pill">
              <span className="status-dot" aria-hidden="true" />
              {providerKeys.length === 0
                ? "Not configured"
                : `${enabledCount} of ${providerKeys.length} enabled`}
            </span>
          </div>

          <p className="ak-summary">{provider.summary}</p>
          {provider.id !== "gemini" ? (
            <p className="ak-summary">
              Keys saved here are not used by any tool yet. Only Google Gemini is connected to the
              Metadata Generator so far.
            </p>
          ) : null}

          <form className="ak-form" onSubmit={handleAdd} noValidate>
            <div className="ak-field">
              <label className="ak-label" htmlFor="ak-label">
                Key label
              </label>
              <input
                id="ak-label"
                className="ak-input"
                type="text"
                value={label}
                maxLength={40}
                placeholder={`${provider.name} Primary`}
                autoComplete="off"
                disabled={!storageReady || atLimit || adding}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>

            <div className="ak-field ak-field-wide">
              <label className="ak-label" htmlFor="ak-secret">
                API key
              </label>
              <div className="ak-secret-row">
                <input
                  id="ak-secret"
                  className="ak-input"
                  type={reveal ? "text" : "password"}
                  value={secret}
                  placeholder="Paste the key here"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!storageReady || atLimit || adding}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <button
                  type="button"
                  className="button"
                  aria-pressed={reveal}
                  disabled={!storageReady || atLimit || adding}
                  onClick={() => setReveal((value) => !value)}
                >
                  {reveal ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="button button-primary ak-submit"
              disabled={!storageReady || atLimit || adding}
            >
              {adding ? "Saving..." : "Add API Key"}
            </button>
          </form>

          {atLimit ? (
            <p className="ak-error" role="alert">
              You have reached the limit of {MAX_KEYS_PER_PROVIDER} keys for {provider.name}. Remove
              one to add another.
            </p>
          ) : null}
          {fieldError ? (
            <p className="ak-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <p className="section-note">
            Show and Hide only affect the key you are typing. Saved keys are never sent back to
            this page, so only a masked value can be shown.
          </p>

          <div role="status" aria-live="polite">
            {message ? (
              <p className="ak-message" data-kind={message.kind}>
                {message.text}
              </p>
            ) : null}
          </div>

          {loading ? null : providerKeys.length === 0 ? (
            <EmptyState
              icon="key"
              title="No keys saved"
              description={`No ${provider.name} keys are saved yet. Add one above. Each saved key appears here with enable, disable and remove controls.`}
            />
          ) : (
            <ul className="ak-list" aria-label={`${provider.name} keys`}>
              {providerKeys.map((key) => (
                <li key={key.id} className="ak-row" data-enabled={key.enabled ? "true" : "false"}>
                  <div className="ak-row-main">
                    <strong className="ak-row-label">{key.label}</strong>
                    <code className="ak-masked" aria-label="Saved key, hidden">
                      {key.masked}
                    </code>
                    <span className="ak-row-meta">
                      {provider.name} - {key.enabled ? "Enabled" : "Disabled"} -{" "}
                      {resultText(key.lastResult)} - Added{" "}
                      {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="ak-row-actions">
                    <button
                      type="button"
                      role="switch"
                      className="ak-switch"
                      aria-checked={key.enabled}
                      aria-label={`${key.enabled ? "Disable" : "Enable"} ${key.label}`}
                      disabled={busyId !== null}
                      onClick={() => handleToggle(key)}
                    />
                    <span className="ak-switch-text">{key.enabled ? "Enabled" : "Disabled"}</span>

                    {confirmId === key.id ? (
                      <span className="ak-confirm" role="group" aria-label={`Confirm removing ${key.label}`}>
                        <span>Remove this key?</span>
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null}
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="button ak-danger"
                          disabled={busyId !== null}
                          onClick={() => handleRemove(key)}
                        >
                          {busyId === key.id ? "Removing..." : "Yes, remove"}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button"
                        disabled={busyId !== null}
                        onClick={() => setConfirmId(key.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="ak-actions">
            <a
              className="button"
              href={provider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {provider.docsLabel}
              <Icon name="arrowRight" size={16} />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}