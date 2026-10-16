"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { SearchBox } from "./SearchBox";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

const SIDEBAR_ID = "app-sidebar";
const NAME_MAX = 18;

export type ShellUser = {
  email: string;
  role: "user" | "admin";
  fullName?: string | null;
} | null;

function shorten(text: string): string {
  return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1)}\u2026` : text;
}

export function AppShell({ children, user }: { children: ReactNode; user: ShellUser }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  const fullName = user?.fullName?.trim() ?? "";
  const displayName = user ? (fullName.length > 0 ? fullName : user.email.split("@")[0]) : "Guest";
  const initial = (displayName.charAt(0) || "G").toUpperCase();
  const subtitle = user ? (user.role === "admin" ? "Administrator" : "User") : "Not signed in";
  const chipTitle = user
    ? `${displayName} (${user.email}) - ${subtitle}`
    : "Sign-in is not set up yet";

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Sidebar
        id={SIDEBAR_ID}
        open={menuOpen}
        isAdmin={user?.role === "admin"}
        onNavigate={closeMenu}
      />

      {menuOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close navigation menu"
          onClick={closeMenu}
        />
      ) : null}

      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls={SIDEBAR_ID}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>

          <SearchBox />

          <div className="topbar-actions">
            <ThemeToggle />
            <button
              type="button"
              className="icon-button"
              disabled
              aria-disabled="true"
              aria-label="Notifications (not available yet)"
              title="Notifications are not available yet"
            >
              <Icon name="bell" />
            </button>
            <div className="user-chip" title={chipTitle}>
              <span className="user-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="user-text">
                <strong>{shorten(displayName)}</strong>
                <small>{subtitle}</small>
              </span>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}