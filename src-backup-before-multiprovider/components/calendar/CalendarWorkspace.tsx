"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { EmptyState } from "../EmptyState";
import {
  CATEGORIES,
  EVENT_TYPES,
  MONTH_NAMES,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  buildCatalog,
  buildEventsCsv,
  categoryLabel,
  daysBetween,
  daysInMonth,
  endOf,
  eventTypeLabel,
  formatDate,
  isCategoryId,
  monthLabel,
  parseCustomEvents,
  parseDate,
  parseFavorites,
  toDateStr,
  todayLocal,
  verificationLabel,
  weekdayOf,
  type CalendarEvent,
  type CategoryId,
} from "./calendarData";
import { EVENTS_KEY, FAVORITES_KEY, readRaw, subscribeStore, writeRaw } from "./calendarStore";
import "./calendar.css";

type View = "month" | "week" | "list";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

type FormState = {
  editingId: string | null;
  title: string;
  startDate: string;
  endDate: string;
  category: CategoryId;
  countries: string;
  description: string;
  tags: string;
  notes: string;
};
type FormErrors = Partial<Record<"title" | "startDate" | "endDate" | "countries", string>>;

const noopSubscribe = () => () => undefined;
// "YYYY-MM-DD|Time/Zone". Read only in the browser, so the server never guesses the date.
const clockSnapshot = () =>
  `${todayLocal()}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
const serverSnapshot = () => null;
const readEvents = () => readRaw(EVENTS_KEY);
const readFavorites = () => readRaw(FAVORITES_KEY);

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function scopeText(event: CalendarEvent): string {
  return event.countryCodes.length > 0 ? event.countryCodes.join(", ") : "Worldwide";
}

function relativeText(event: CalendarEvent, today: string): string {
  const until = daysBetween(today, event.startDate);
  if (until > 1) {
    return `in ${until} days`;
  }
  if (until === 1) {
    return "tomorrow";
  }
  if (until === 0) {
    return "today";
  }
  return endOf(event) >= today ? "ongoing" : "";
}

export function CalendarWorkspace() {
  const clock = useSyncExternalStore(noopSubscribe, clockSnapshot, serverSnapshot);
  const customRaw = useSyncExternalStore(subscribeStore, readEvents, serverSnapshot);
  const favoritesRaw = useSyncExternalStore(subscribeStore, readFavorites, serverSnapshot);

  const today = clock ? clock.split("|")[0] : "";
  const timeZone = clock ? clock.split("|")[1] : "";

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | CategoryId>("all");
  const [country, setCountry] = useState("all");
  const [type, setType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState<Notice>(null);

  const base = cursor ?? (today || "2026-01-01");
  const baseYear = parseDate(base)?.y ?? 2026;

  const custom = useMemo(() => parseCustomEvents(customRaw), [customRaw]);
  const favorites = useMemo(() => parseFavorites(favoritesRaw), [favoritesRaw]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const allEvents = useMemo(
    () => [...buildCatalog(baseYear - 1, baseYear + 1), ...custom],
    [baseYear, custom],
  );

  const countryOptions = useMemo(() => {
    const codes = new Set<string>();
    allEvents.forEach((event) => event.countryCodes.forEach((code) => codes.add(code)));
    return Array.from(codes).sort();
  }, [allEvents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allEvents
      .filter((event) => {
        if (favOnly && !favoriteSet.has(event.id)) {
          return false;
        }
        if (category !== "all" && event.category !== category) {
          return false;
        }
        if (type !== "all" && event.eventType !== type) {
          return false;
        }
        if (country !== "all" && event.countryCodes.length > 0 && !event.countryCodes.includes(country)) {
          return false;
        }
        if (from && endOf(event) < from) {
          return false;
        }
        if (to && event.startDate > to) {
          return false;
        }
        if (needle) {
          const text = [event.title, event.description, event.tags.join(" "), event.countryCodes.join(" ")]
            .join(" ")
            .toLowerCase();
          if (!text.includes(needle)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  }, [allEvents, favOnly, favoriteSet, category, type, country, from, to, query]);

  const summary = useMemo(() => {
    if (!today) {
      return { month: 0, upcoming: 0, holidays: 0, saved: favorites.length };
    }
    const monthStart = addMonths(today, 0);
    const monthEnd = addDays(addMonths(today, 1), -1);
    const inMonth = allEvents.filter((event) => event.startDate <= monthEnd && endOf(event) >= monthStart);
    const horizon = addDays(today, 30);
    return {
      month: inMonth.length,
      upcoming: allEvents.filter((event) => event.startDate > today && event.startDate <= horizon).length,
      holidays: inMonth.filter((event) => event.eventType === "holiday").length,
      saved: favorites.length,
    };
  }, [allEvents, today, favorites.length]);

  const filtersActive =
    query !== "" || category !== "all" || country !== "all" || type !== "all" || from !== "" || to !== "" || favOnly;

  const detail = detailId ? allEvents.find((event) => event.id === detailId) ?? null : null;

  useEffect(() => {
    if (!detailId && !form) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDetailId(null);
        setForm(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailId, form]);

  if (!clock) {
    return (
      <div className="page">
        <p className="cal-loading" role="status">Loading calendar...</p>
      </div>
    );
  }

  function eventsOn(date: string): CalendarEvent[] {
    return filtered.filter((event) => event.startDate <= date && endOf(event) >= date);
  }

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setCountry("all");
    setType("all");
    setFrom("");
    setTo("");
    setFavOnly(false);
    setNotice({ kind: "info", text: "Filters cleared." });
  }

  function step(direction: -1 | 1) {
    setSelected(null);
    setCursor(view === "week" ? addDays(base, direction * 7) : addMonths(base, direction));
  }

  function goToday() {
    setSelected(null);
    setCursor(today);
  }

  function toggleFavorite(id: string) {
    const next = favoriteSet.has(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    if (!writeRaw(FAVORITES_KEY, JSON.stringify(next))) {
      setNotice({ kind: "error", text: "Could not save favorites. Browser storage is blocked or full." });
    }
  }

  function openDetails(id: string) {
    setForm(null);
    setConfirmDelete(false);
    setDetailId(id);
  }

  function openAdd(date: string) {
    setDetailId(null);
    setErrors({});
    setForm({
      editingId: null,
      title: "",
      startDate: date,
      endDate: "",
      category: "stock",
      countries: "",
      description: "",
      tags: "",
      notes: "",
    });
  }

  function openEdit(event: CalendarEvent) {
    setDetailId(null);
    setErrors({});
    setForm({
      editingId: event.id,
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate ?? "",
      category: event.category,
      countries: event.countryCodes.join(", "),
      description: event.description,
      tags: event.tags.join(", "),
      notes: event.contentIdeas.join("\n"),
    });
  }

  function submitForm(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!form) {
      return;
    }

    const found: FormErrors = {};
    const title = form.title.trim();
    if (!title) {
      found.title = "Enter an event title.";
    } else if (title.length > 120) {
      found.title = "The title can be at most 120 characters.";
    }
    if (!parseDate(form.startDate)) {
      found.startDate = "Enter a valid start date.";
    }
    if (form.endDate) {
      if (!parseDate(form.endDate)) {
        found.endDate = "Enter a valid end date.";
      } else if (parseDate(form.startDate) && form.endDate < form.startDate) {
        found.endDate = "The end date cannot be before the start date.";
      }
    }
    const codes = splitList(form.countries).map((code) => code.toUpperCase());
    if (codes.some((code) => !/^[A-Z]{2}$/.test(code))) {
      found.countries = "Use two-letter country codes such as US, GB, BD, or leave blank for worldwide.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    const saved: CalendarEvent = {
      id: form.editingId ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: form.description.trim().slice(0, 2000),
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      category: form.category,
      eventType: "custom",
      countryCodes: codes,
      tags: splitList(form.tags).slice(0, 20),
      contentIdeas: form.notes.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20),
      verification: "user",
      isCustom: true,
    };

    const next = form.editingId
      ? custom.map((event) => (event.id === form.editingId ? saved : event))
      : [...custom, saved];

    if (!writeRaw(EVENTS_KEY, JSON.stringify(next))) {
      setNotice({ kind: "error", text: "Could not save the event. Browser storage is blocked or full." });
      return;
    }
    setForm(null);
    setCursor(saved.startDate);
    setNotice({ kind: "success", text: form.editingId ? "Event updated." : "Event added." });
  }

  function deleteCustom(id: string) {
    const next = custom.filter((event) => event.id !== id);
    if (!writeRaw(EVENTS_KEY, JSON.stringify(next))) {
      setNotice({ kind: "error", text: "Could not delete the event. Browser storage is blocked." });
      return;
    }
    if (favoriteSet.has(id)) {
      writeRaw(FAVORITES_KEY, JSON.stringify(favorites.filter((item) => item !== id)));
    }
    setDetailId(null);
    setConfirmDelete(false);
    setNotice({ kind: "success", text: "Event deleted." });
  }

  async function copyDetails(event: CalendarEvent) {
    const lines = [
      event.title,
      `Date: ${formatDate(event.startDate)}${event.endDate ? ` to ${formatDate(event.endDate)}` : ""}`,
      `Scope: ${scopeText(event)}`,
      `Category: ${categoryLabel(event.category)}`,
      event.description,
      event.tags.length > 0 ? `Tags: ${event.tags.join(", ")}` : "",
      event.contentIdeas.length > 0 ? `Ideas:\n- ${event.contentIdeas.join("\n- ")}` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice({ kind: "success", text: "Event details copied." });
    } catch {
      setNotice({ kind: "error", text: "Copy failed. Your browser blocked clipboard access." });
    }
  }

  function exportCsv() {
    if (filtered.length === 0) {
      setNotice({ kind: "error", text: "There are no events matching the current filters to export." });
      return;
    }
    const blob = new Blob([buildEventsCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `metaforge-global-events-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ kind: "success", text: `Exported ${filtered.length} event${filtered.length === 1 ? "" : "s"}.` });
  }

  /* ---------- Views ---------- */

  const parsedBase = parseDate(base) ?? { y: 2026, m: 1, d: 1 };
  const monthFirst = toDateStr(parsedBase.y, parsedBase.m, 1);
  const leadingBlanks = weekdayOf(monthFirst);
  const monthDays = daysInMonth(parsedBase.y, parsedBase.m);
  const weekStart = addDays(base, -weekdayOf(base));
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const rangeLabel =
    view === "week" ? `${formatDate(weekDates[0])} - ${formatDate(weekDates[6])}` : monthLabel(base);

  const listEvents = filtered.filter((event) => endOf(event) >= monthFirst).slice(0, 80);
  const selectedEvents = selected ? eventsOn(selected) : [];

  function chip(event: CalendarEvent) {
    return (
      <button
        key={event.id}
        type="button"
        className="cal-chip"
        data-cat={event.category}
        title={event.title}
        onClick={(click) => {
          click.stopPropagation();
          openDetails(event.id);
        }}
      >
        {favoriteSet.has(event.id) ? "\u2605 " : ""}
        {event.title}
      </button>
    );
  }

  return (
    <div className="page cal-page">
      <header className="page-header">
        <span className="eyebrow">Creative tools</span>
        <h1>Global Event Calendar</h1>
        <p>Plan content around holidays, seasons and events worldwide.</p>
        <p className="cal-meta">
          {monthLabel(today)} - today is {formatDate(today)}
          {timeZone ? ` (${timeZone})` : ""}
        </p>
        <div className="cal-header-actions">
          <button type="button" className="button button-primary" onClick={() => openAdd(selected ?? today)}>
            Add Event
          </button>
          <button type="button" className="button" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </header>

      <div role="status" aria-live="polite">
        {notice ? (
          <p className="cal-notice" data-kind={notice.kind}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <section className="status-grid" aria-label="Summary">
        <div className="card status-card">
          <span className="status-label">Events this month</span>
          <span className="cal-big">{summary.month}</span>
        </div>
        <div className="card status-card">
          <span className="status-label">Upcoming (next 30 days)</span>
          <span className="cal-big">{summary.upcoming}</span>
        </div>
        <div className="card status-card">
          <span className="status-label">Holidays this month</span>
          <span className="cal-big">{summary.holidays}</span>
        </div>
        <div className="card status-card">
          <span className="status-label">Saved events</span>
          <span className="cal-big">{summary.saved}</span>
        </div>
      </section>

      <section className="card cal-filters" aria-label="Search and filters">
        <div className="cal-field cal-field-wide">
          <label htmlFor="cal-search">Search</label>
          <input
            id="cal-search"
            type="search"
            value={query}
            placeholder="Event name, country, tag or description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="cal-field">
          <label htmlFor="cal-country">Country</label>
          <select id="cal-country" value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="all">All (worldwide + every country)</option>
            {countryOptions.map((code) => (
              <option key={code} value={code}>
                {code} + worldwide events
              </option>
            ))}
          </select>
        </div>
        <div className="cal-field">
          <label htmlFor="cal-category">Category</label>
          <select
            id="cal-category"
            value={category}
            onChange={(event) => {
              const value = event.target.value;
              setCategory(isCategoryId(value) ? value : "all");
            }}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div className="cal-field">
          <label htmlFor="cal-type">Event type</label>
          <select id="cal-type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            {EVENT_TYPES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div className="cal-field">
          <label htmlFor="cal-from">From date</label>
          <input id="cal-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="cal-field">
          <label htmlFor="cal-to">To date</label>
          <input id="cal-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="cal-field cal-check">
          <label htmlFor="cal-fav">
            <input id="cal-fav" type="checkbox" checked={favOnly} onChange={(event) => setFavOnly(event.target.checked)} />
            Favorites only
          </label>
        </div>
        <div className="cal-field cal-check">
          <button type="button" className="button" onClick={clearFilters} disabled={!filtersActive}>
            Clear filters
          </button>
        </div>
      </section>

      <section className="card" aria-label="Calendar">
        <div className="cal-toolbar">
          <div className="cal-nav">
            <button type="button" className="button" onClick={() => step(-1)} aria-label="Previous">
              &lsaquo;
            </button>
            <button type="button" className="button" onClick={goToday}>
              Today
            </button>
            <button type="button" className="button" onClick={() => step(1)} aria-label="Next">
              &rsaquo;
            </button>
            <h2 className="cal-range">{rangeLabel}</h2>
          </div>
          <div className="cal-views" role="group" aria-label="Calendar view">
            {(["month", "week", "list"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="cal-view"
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                  setSelected(null);
                }}
              >
                {option === "month" ? "Month" : option === "week" ? "Week" : "List"}
              </button>
            ))}
          </div>
        </div>

        {view === "month" ? (
          <div className="cal-scroll">
            <div className="cal-grid cal-weekdays">
              {WEEKDAY_SHORT.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div className="cal-grid">
              {Array.from({ length: leadingBlanks }, (_, index) => (
                <span key={`blank-${index}`} className="cal-cell cal-blank" aria-hidden="true" />
              ))}
              {Array.from({ length: monthDays }, (_, index) => {
                const date = toDateStr(parsedBase.y, parsedBase.m, index + 1);
                const dayEvents = eventsOn(date);
                return (
                  <div
                    key={date}
                    className="cal-cell"
                    data-today={date === today ? "true" : "false"}
                    data-selected={date === selected ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="cal-daynum"
                      aria-label={`${formatDate(date)}, ${dayEvents.length} events`}
                      onClick={() => setSelected(date === selected ? null : date)}
                    >
                      {index + 1}
                    </button>
                    {dayEvents.slice(0, 3).map(chip)}
                    {dayEvents.length > 3 ? (
                      <button type="button" className="cal-more" onClick={() => setSelected(date)}>
                        +{dayEvents.length - 3} more
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "week" ? (
          <div className="cal-week">
            {weekDates.map((date) => {
              const dayEvents = eventsOn(date);
              return (
                <div key={date} className="cal-weekday" data-today={date === today ? "true" : "false"}>
                  <button
                    type="button"
                    className="cal-weekhead"
                    onClick={() => setSelected(date === selected ? null : date)}
                  >
                    {WEEKDAY_SHORT[weekdayOf(date)]} {formatDate(date)}
                  </button>
                  {dayEvents.length === 0 ? <span className="cal-none">No events</span> : dayEvents.map(chip)}
                </div>
              );
            })}
          </div>
        ) : null}

        {view === "list" ? (
          listEvents.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No events found"
              description="No events match the current filters from this month onward."
            />
          ) : (
            <ul className="cal-list">
              {listEvents.map((event) => (
                <li key={event.id}>
                  <button type="button" className="cal-row" onClick={() => openDetails(event.id)}>
                    <span className="cal-row-date">
                      {formatDate(event.startDate)}
                      {event.endDate ? ` - ${formatDate(event.endDate)}` : ""}
                    </span>
                    <span className="cal-row-title">
                      {favoriteSet.has(event.id) ? "\u2605 " : ""}
                      {event.title}
                    </span>
                    <span className="cal-badge" data-cat={event.category}>
                      {categoryLabel(event.category)}
                    </span>
                    <span className="cal-row-meta">
                      {scopeText(event)} {relativeText(event, today) ? `- ${relativeText(event, today)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {selected ? (
          <div className="cal-day-panel">
            <div className="cal-day-head">
              <strong>{formatDate(selected)}</strong>
              <button type="button" className="button" onClick={() => openAdd(selected)}>
                Add event on this date
              </button>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="cal-none">No events on this date.</p>
            ) : (
              <div className="cal-day-events">{selectedEvents.map(chip)}</div>
            )}
          </div>
        ) : null}

        <div className="cal-legend" aria-label="Category colors">
          {CATEGORIES.map((entry) => (
            <span key={entry.id} className="cal-badge" data-cat={entry.id}>
              {entry.label}
            </span>
          ))}
        </div>
        <p className="section-note">
          Built-in dates follow fixed-date or calendar rules and are not a live holiday feed. Dates for
          religious and lunar events (such as Eid, Ramadan and Lunar New Year) are not included because they
          depend on observation. Add them yourself from an official source. Your custom events and favorites
          are saved in this browser only.
        </p>
      </section>

      {detail ? (
        <div className="cal-overlay" onClick={() => setDetailId(null)}>
          <div
            className="cal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cal-detail-title"
            onClick={(click) => click.stopPropagation()}
          >
            <div className="cal-modal-head">
              <h2 id="cal-detail-title">{detail.title}</h2>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDetailId(null)}>
                &times;
              </button>
            </div>
            <p className="cal-modal-meta">
              {formatDate(detail.startDate)}
              {detail.endDate ? ` to ${formatDate(detail.endDate)}` : ""} - {scopeText(detail)}
            </p>
            <p>
              <span className="cal-badge" data-cat={detail.category}>
                {categoryLabel(detail.category)}
              </span>{" "}
              <span className="cal-badge">{eventTypeLabel(detail.eventType)}</span>
            </p>
            {detail.description ? <p>{detail.description}</p> : null}
            {detail.tags.length > 0 ? (
              <p className="cal-modal-meta">Tags: {detail.tags.join(", ")}</p>
            ) : null}
            {detail.contentIdeas.length > 0 ? (
              <div>
                <strong>{detail.isCustom ? "Your planning notes" : "Content ideas"}</strong>
                <ul className="cal-ideas">
                  {detail.contentIdeas.map((idea) => (
                    <li key={idea}>{idea}</li>
                  ))}
                </ul>
                {detail.leadTime ? (
                  <p className="cal-modal-meta">Suggested preparation: {detail.leadTime}. These are ideas, not a sales forecast.</p>
                ) : null}
              </div>
            ) : null}
            <p className="cal-modal-meta">Date status: {verificationLabel(detail.verification)}</p>
            {detail.sourceUrl ? (
              <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            ) : null}

            <div className="cal-modal-actions">
              <button type="button" className="button" onClick={() => toggleFavorite(detail.id)}>
                {favoriteSet.has(detail.id) ? "\u2605 Remove favorite" : "\u2606 Add to favorites"}
              </button>
              <button type="button" className="button" onClick={() => void copyDetails(detail)}>
                Copy details
              </button>
              {detail.isCustom ? (
                <>
                  <button type="button" className="button" onClick={() => openEdit(detail)}>
                    Edit
                  </button>
                  {confirmDelete ? (
                    <>
                      <span>Delete this event?</span>
                      <button type="button" className="button" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </button>
                      <button type="button" className="button cal-danger" onClick={() => deleteCustom(detail.id)}>
                        Yes, delete
                      </button>
                    </>
                  ) : (
                    <button type="button" className="button" onClick={() => setConfirmDelete(true)}>
                      Delete
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {form ? (
        <div className="cal-overlay" onClick={() => setForm(null)}>
          <form
            className="cal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cal-form-title"
            onClick={(click) => click.stopPropagation()}
            onSubmit={submitForm}
            noValidate
          >
            <div className="cal-modal-head">
              <h2 id="cal-form-title">{form.editingId ? "Edit event" : "Add event"}</h2>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setForm(null)}>
                &times;
              </button>
            </div>

            <div className="cal-field">
              <label htmlFor="cal-f-title">Event title *</label>
              <input
                id="cal-f-title"
                value={form.title}
                maxLength={120}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
              {errors.title ? <span className="cal-error" role="alert">{errors.title}</span> : null}
            </div>
            <div className="cal-two">
              <div className="cal-field">
                <label htmlFor="cal-f-start">Start date *</label>
                <input
                  id="cal-f-start"
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                />
                {errors.startDate ? <span className="cal-error" role="alert">{errors.startDate}</span> : null}
              </div>
              <div className="cal-field">
                <label htmlFor="cal-f-end">End date (optional)</label>
                <input
                  id="cal-f-end"
                  type="date"
                  value={form.endDate}
                  onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                />
                {errors.endDate ? <span className="cal-error" role="alert">{errors.endDate}</span> : null}
              </div>
            </div>
            <div className="cal-two">
              <div className="cal-field">
                <label htmlFor="cal-f-cat">Category</label>
                <select
                  id="cal-f-cat"
                  value={form.category}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isCategoryId(value)) {
                      setForm({ ...form, category: value });
                    }
                  }}
                >
                  {CATEGORIES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cal-field">
                <label htmlFor="cal-f-country">Countries (codes, blank = worldwide)</label>
                <input
                  id="cal-f-country"
                  value={form.countries}
                  placeholder="US, GB"
                  onChange={(event) => setForm({ ...form, countries: event.target.value })}
                />
                {errors.countries ? <span className="cal-error" role="alert">{errors.countries}</span> : null}
              </div>
            </div>
            <div className="cal-field">
              <label htmlFor="cal-f-desc">Description</label>
              <textarea
                id="cal-f-desc"
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <div className="cal-field">
              <label htmlFor="cal-f-tags">Tags (comma separated)</label>
              <input
                id="cal-f-tags"
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
              />
            </div>
            <div className="cal-field">
              <label htmlFor="cal-f-notes">Content-planning notes (one per line)</label>
              <textarea
                id="cal-f-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>

            <div className="cal-modal-actions">
              <button type="button" className="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                {form.editingId ? "Save changes" : "Add event"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <p className="sr-only">{MONTH_NAMES[parsedBase.m - 1]}</p>
    </div>
  );
}