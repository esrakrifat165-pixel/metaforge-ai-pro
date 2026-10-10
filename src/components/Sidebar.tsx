"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icons";
import { getSupabaseEnv } from "../lib/supabase/env";
import {
  getVisibleNavItems,
  isActivePath,
  type NavItem,
} from "../lib/navigation";

type SidebarProps = {
  id: string;
  open: boolean;
  onNavigate: () => void;
};

type NavListProps = {
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
};

function NavList({ items, pathname, onNavigate }: NavListProps) {
  return (
    <ul className="nav-list">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="nav-link"
            aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ id, open, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const items = getVisibleNavItems();
  const mainItems = items.filter((item) => item.placement === "main");
  const bottomItems = items.filter((item) => item.placement === "bottom");
  const signInEnabled = getSupabaseEnv() !== null;

  return (
    <aside id={id} className="sidebar" data-open={open ? "true" : "false"}>
      <Link href="/dashboard" className="brand" onClick={onNavigate}>
        <BrandMark size={46} />
        <span className="brand-text">
          <strong>METAFORGE</strong>
          <strong className="brand-ai">AI PRO</strong>
          <small>By FER</small>
        </span>
      </Link>

      <nav aria-label="Main navigation" className="sidebar-nav">
        <NavList items={mainItems} pathname={pathname} onNavigate={onNavigate} />
        <hr className="sidebar-divider" />
        <NavList items={bottomItems} pathname={pathname} onNavigate={onNavigate} />
      </nav>

      <div className="sidebar-footer">
        {signInEnabled ? (
          <form action="/auth/signout" method="post">
            <button type="submit" className="nav-link">
              <Icon name="logout" />
              <span>Logout</span>
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="nav-link"
            disabled
            aria-disabled="true"
            title="Sign-in is not set up yet"
          >
            <Icon name="logout" />
            <span>Logout</span>
            <span className="nav-soon">Not set up</span>
          </button>
        )}
      </div>
    </aside>
  );
}