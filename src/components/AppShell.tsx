"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./Icons";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { NAV_ITEMS, isActivePath } from "../lib/navigation";

const SIDEBAR_ID = "app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  const currentItem = NAV_ITEMS.find((item) => isActivePath(pathname, item.href));
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

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Sidebar id={SIDEBAR_ID} open={menuOpen} onNavigate={closeMenu} />

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
          <div className="topbar-left">
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
            <p className="crumb">
              <span className="crumb-muted">Workspace</span>
              <span className="crumb-muted" aria-hidden="true">
                /
              </span>
              <strong>{currentItem?.label ?? "METAFORGE AI PRO"}</strong>
            </p>
          </div>
          <ThemeToggle />
        </header>

        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}