"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icons";
import {
  MAX_KEYS_PER_PROVIDER,
  PROVIDERS,
  type ProviderId,
} from "../../lib/providers/catalog";

// Key storage does not exist yet, so no keys are configured for any provider.
// This stays at 0 until the database and encrypted storage are built.
const SAVED_KEY_COUNT = 0;

export function ApiKeyManager() {
  const [selectedId, setSelectedId] = useState<ProviderId>(PROVIDERS[0].id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const provider = PROVIDERS.find((entry) => entry.id === selectedId) ?? PROVIDERS[0];

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
    setSelectedId(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Settings</span>
        <h1>API Key Manager</h1>
        <p>
          Manage the AI provider keys METAFORGE AI PRO uses to generate metadata. Keys are only
          ever handled on the server and are never shown again after they are saved.
        </p>
      </header>

      <div className="card ak-notice" role="note">
        <span className="ak-notice-icon">
          <Icon name="key" size={20} />
        </span>
        <div>
          <h2 className="section-title">Key storage is not set up yet</h2>
          <p>
            Saving keys safely needs three things this project does not have yet: sign-in, a
            database, and a server-only encryption secret. They are built in later phases. Until
            then, this page cannot save, test or use any key, and nothing typed here is stored.
          </p>
        </div>
      </div>

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
              onClick={() => setSelectedId(entry.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {entry.name}
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
                  {SAVED_KEY_COUNT} / {MAX_KEYS_PER_PROVIDER} keys configured
                </p>
              </div>
            </div>
            <span className="status-pill">
              <span className="status-dot" aria-hidden="true" />
              Not configured
            </span>
          </div>

          <p className="ak-summary">{provider.summary}</p>

          <div className="ak-actions">
            <button
              type="button"
              className="button button-primary"
              disabled
              title="Needs sign-in, a database and server-side encryption first"
            >
              Add API Key
            </button>
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
          <p className="section-note">
            Add API Key is turned off on purpose. A key form would have nowhere safe to put a key.
          </p>

          <EmptyState
            icon="key"
            title="No keys saved"
            description={`No ${provider.name} keys are saved. Once storage exists, each key will show a label, a masked value, a status, and enable, test and remove controls.`}
          />
        </div>
      </section>
    </div>
  );
}