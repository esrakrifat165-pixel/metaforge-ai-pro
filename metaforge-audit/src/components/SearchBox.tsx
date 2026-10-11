"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import { getVisibleNavItems, type NavItem } from "../lib/navigation";
import "./SearchBox.css";

const MAX_RESULTS = 8;

export function SearchBox() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const term = query.trim().toLowerCase();
  const results: NavItem[] =
    term.length === 0
      ? []
      : getVisibleNavItems(false)
          .filter(
            (item) =>
              item.label.toLowerCase().includes(term) ||
              item.description.toLowerCase().includes(term),
          )
          .slice(0, MAX_RESULTS);

  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const showList = open && term.length > 0;

  function go(item: NavItem) {
    router.push(item.href);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive(results.length === 0 ? 0 : (activeIndex + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive(results.length === 0 ? 0 : (activeIndex - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      const chosen = results[activeIndex];
      if (chosen) {
        event.preventDefault();
        go(chosen);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  return (
    <div className="sb-root" onBlur={handleBlur}>
      <svg className="sb-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        className="sb-input"
        placeholder="Search tools and pages"
        aria-label="Search tools and pages"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {showList ? (
        <ul id={listId} role="listbox" className="sb-list">
          {results.length === 0 ? (
            <li className="sb-empty">No matching pages</li>
          ) : (
            results.map((item, index) => (
              <li
                key={item.href}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className="sb-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item)}
              >
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}