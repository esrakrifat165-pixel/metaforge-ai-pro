"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { SearchBox } from "./SearchBox";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

const SIDEBAR_ID = "app-sidebar";

export type ShellUser = {
  email: string;
  role: "user" | "admin";
} | null;

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

  const displayName = user ? user.email.split("@")[0] : "Guest";
  const initial = (user ? user.email.charAt(0) : "G").toUpperCase();
  const subtitle = user
    ? user.role === "admin"
      ? "Administrator"
      : "Signed in"
    : "Not signed in";

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
            <div className="user-chip" title={user ? user.email : "Sign-in is not set up yet"}>
              <span className="user-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="user-text">
                <strong>{displayName}</strong>
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