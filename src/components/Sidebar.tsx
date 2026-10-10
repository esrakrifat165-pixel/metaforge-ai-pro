"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icons";
import { NAV_GROUPS, getVisibleNavItems, isActivePath } from "../lib/navigation";

type SidebarProps = {
  id: string;
  open: boolean;
  onNavigate: () => void;
};

export function Sidebar({ id, open, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const items = getVisibleNavItems();

  return (
    <aside id={id} className="sidebar" data-open={open ? "true" : "false"}>
      <Link href="/dashboard" className="brand" onClick={onNavigate}>
        <BrandMark size={42} />
        <span className="brand-text">
          <strong>METAFORGE AI PRO</strong>
          <span>By FER</span>
        </span>
      </Link>

      <nav aria-label="Main navigation" className="sidebar-nav">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) {
            return null;
          }

          return (
            <div key={group}>
              <p className="nav-group-label">{group}</p>
              <ul className="nav-list">
                {groupItems.map((item) => (
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
            </div>
          );
        })}
      </nav>

      <p className="sidebar-note">
        Local development mode. Sign-in is not set up yet.
      </p>
    </aside>
  );
}