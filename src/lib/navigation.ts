import type { IconName } from "../components/Icons";

export type NavGroup = "Workspace" | "Creative tools" | "Account";

/** "main" items sit above the sidebar divider, "bottom" items below it. */
export type NavPlacement = "main" | "bottom";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: IconName;
  group: NavGroup;
  placement: NavPlacement;
  /** The build phase in which this page becomes functional. */
  phase: string;
  /** Hidden from the sidebar until server-verified admin sign-in exists. */
  adminOnly?: boolean;
};

export const NAV_GROUPS: NavGroup[] = ["Workspace", "Creative tools", "Account"];

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description:
      "Overview of your recent jobs, setup status and quick access to every tool.",
    icon: "dashboard",
    group: "Workspace",
    placement: "main",
    phase: "Phase 1",
  },
  {
    href: "/metadata",
    label: "Metadata Generator",
    description:
      "Upload images and generate titles, descriptions and keywords for stock platforms.",
    icon: "metadata",
    group: "Workspace",
    placement: "main",
    phase: "Phase 2",
  },
  {
    href: "/image-to-prompt",
    label: "Image-to-Prompt",
    description:
      "Analyze an image and write a detailed prompt describing what is visible in it.",
    icon: "imageToPrompt",
    group: "Workspace",
    placement: "main",
    phase: "Phase 4",
  },
  {
    href: "/background-remover",
    label: "Background Remover",
    description: "Remove image backgrounds through a configured provider.",
    icon: "backgroundRemover",
    group: "Creative tools",
    placement: "main",
    phase: "Phase 7",
  },
  {
    href: "/keywords",
    label: "Adobe Keywords Search",
    description: "Brainstorm and research keywords for stock content.",
    icon: "keywords",
    group: "Creative tools",
    placement: "main",
    phase: "Phase 7",
  },
  {
    href: "/calendar",
    label: "Global Event Calendar",
    description: "Plan content around holidays, seasons and events worldwide.",
    icon: "calendar",
    group: "Creative tools",
    placement: "main",
    phase: "Phase 7",
  },
  {
    href: "/bento-builder",
    label: "Bento Builder",
    description: "Arrange images into a layout and export it as a picture.",
    icon: "bento",
    group: "Creative tools",
    placement: "main",
    phase: "Phase 7",
  },
  {
    href: "/image-to-psd",
    label: "Image-to-PSD",
    description: "Convert images for Photoshop workflows.",
    icon: "psd",
    group: "Creative tools",
    placement: "main",
    phase: "Phase 7",
  },
  {
    href: "/eps-converter",
    label: "AI/EPS-to-JPG Converter",
    description: "Convert supported AI, EPS, PDF and image files to JPG.",
    icon: "converter",
    group: "Creative tools",
    placement: "main",
    phase: "Phase 7",
  },
  {
    href: "/history",
    label: "History",
    description: "Review and delete your past jobs.",
    icon: "history",
    group: "Account",
    placement: "main",
    phase: "Phase 5",
  },
  {
    href: "/settings/api-keys",
    label: "API Key Manager",
    description: "Manage AI provider keys securely on the server.",
    icon: "key",
    group: "Account",
    placement: "bottom",
    phase: "Phase 6",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Choose providers, models and default options.",
    icon: "settings",
    group: "Account",
    placement: "bottom",
    phase: "Phase 6",
  },
  {
    href: "/help",
    label: "Help & Support",
    description: "Guides, troubleshooting and support information.",
    icon: "help",
    group: "Account",
    placement: "bottom",
    phase: "Phase 9",
  },
  {
    href: "/admin",
    label: "Admin Panel",
    description: "Administrator tools. Available to authorized administrators only.",
    icon: "admin",
    group: "Account",
    placement: "bottom",
    phase: "Phase 9",
    adminOnly: true,
  },
];

export function getVisibleNavItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly);
}

export function getNavItemByHref(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}

/**
 * True when the current page belongs to this menu item. If a more specific
 * menu item also matches (for example /settings/api-keys versus /settings),
 * only the more specific one counts, so two items never light up together.
 */
export function isActivePath(pathname: string, href: string): boolean {
  const matches = (candidate: string) =>
    pathname === candidate || pathname.startsWith(`${candidate}/`);

  if (!matches(href)) {
    return false;
  }

  return !NAV_ITEMS.some(
    (item) => item.href !== href && item.href.startsWith(`${href}/`) && matches(item.href),
  );
}