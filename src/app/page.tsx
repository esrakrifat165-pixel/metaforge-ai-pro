"use client";

import { useState } from "react";

const tools = [
  { name: "Metadata Generator", icon: "✦", desc: "Create stock-ready titles, descriptions and keywords", color: "purple" },
  { name: "Image to Prompt", icon: "⌘", desc: "Turn images into detailed professional prompts", color: "blue" },
  { name: "Background Remover", icon: "◈", desc: "Prepare clean transparent PNG images", color: "pink" },
  { name: "Adobe Keywords Search", icon: "⌕", desc: "Research relevant stock keywords", color: "cyan" },
  { name: "Global Event Calendar", icon: "▦", desc: "Explore seasonal and global events", color: "orange" },
  { name: "Bento Builder", icon: "▧", desc: "Arrange images into attractive layouts", color: "green" },
  { name: "Image to PSD", icon: "▣", desc: "Prepare image files for PSD workflows", color: "blue" },
  { name: "AI / EPS to JPG", icon: "⇩", desc: "Convert supported artwork files", color: "purple" },
];

const navigation = [
  { section: "WORKSPACE", items: ["Dashboard", "Metadata Generator", "Image to Prompt", "Projects", "History"] },
  { section: "CREATIVE TOOLS", items: ["Background Remover", "Adobe Keywords Search", "Global Event Calendar", "Bento Builder", "Image to PSD", "AI / EPS to JPG"] },
  { section: "PREFERENCES", items: ["API Key Manager", "Settings", "Help & Support"] },
];

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [light, setLight] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  const selectedTool = tools.find((tool) => tool.name === active);
  const visibleTools = tools.filter((tool) =>
    `${tool.name} ${tool.desc}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className={`app-shell ${light ? "light-theme" : ""}`}>
      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
        <button className="brand" onClick={() => setActive("Dashboard")} aria-label="Go to dashboard">
          <span className="brand-mark">M<span>✦</span></span>
          {!collapsed && <span className="brand-copy"><strong>METAFORGE</strong><small>AI PRO <i>BY FER</i></small></span>}
        </button>

        <button className="workspace-select" onClick={() => setActive("Dashboard")}>
          <span className="workspace-avatar">F</span>
          {!collapsed && <><span className="workspace-name">My Workspace</span><span className="chevron">⌄</span></>}
        </button>

        <nav className="side-nav">
          {navigation.map((group) => (
            <div className="nav-group" key={group.section}>
              {!collapsed && <p className="nav-label">{group.section}</p>}
              {group.items.map((item) => (
                <button key={item} onClick={() => setActive(item)} className={`nav-item ${active === item ? "active" : ""}`} title={collapsed ? item : undefined}>
                  <span className="nav-icon">{getIcon(item)}</span>
                  {!collapsed && <span>{item}</span>}
                  {!collapsed && item === "Metadata Generator" && <span className="nav-badge">AI</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {!collapsed && (
          <div className="sidebar-bottom">
            <div className="plan-card">
              <span className="plan-icon">✧</span>
              <strong>Creative workspace</strong>
              <p>Build your next great idea.</p>
              <div className="plan-progress"><span /></div>
              <small>Phase 1 · Dashboard</small>
            </div>
            <button className="profile-row" onClick={() => setActive("Settings")}>
              <span className="profile-avatar">F</span>
              <span className="profile-copy"><strong>FER Workspace</strong><small>Local preview</small></span>
              <span>•••</span>
            </button>
          </div>
        )}
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <button className="icon-button mobile-menu" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">☰</button>
            <span className="crumb-muted">Workspace</span><span className="crumb-divider">/</span><strong>{active}</strong>
          </div>
          <div className="top-actions">
            <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools..." /></label>
            <button className="icon-button theme-button" onClick={() => setLight(!light)} title="Toggle theme" aria-label="Toggle theme">{light ? "☾" : "☼"}</button>
            <button className="notification-button" title="Notifications" aria-label="Notifications">♧<span /></button>
            <button className="top-avatar" onClick={() => setActive("Settings")} title="Profile settings">F</button>
          </div>
        </header>

        {active === "Dashboard" ? (
          <div className="page-content">
            <div className="welcome-row">
              <div>
                <div className="eyebrow"><span className="live-dot" /> YOUR CREATIVE WORKSPACE</div>
                <h1>Make something<br /><span>extraordinary.</span></h1>
                <p className="welcome-description">Your AI-powered studio for smarter stock content, better metadata, and creative workflows.</p>
                <div className="welcome-actions">
                  <button className="primary-button" onClick={() => setActive("Metadata Generator")}><span>✦</span> Generate metadata <span>↗</span></button>
                  <button className="secondary-button" onClick={() => setActive("Image to Prompt")}>Explore tools <span>→</span></button>
                </div>
              </div>
              <div className="hero-art" aria-label="Decorative abstract artwork">
                <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
                <div className="hero-glow" /><div className="hero-core"><span>MF</span><i>✦</i></div>
                <div className="floating-chip chip-top"><span>✧</span> AI STUDIO</div>
                <div className="floating-chip chip-bottom"><span>↗</span> CREATIVE ENGINE</div>
                <span className="hero-star star-one">✦</span><span className="hero-star star-two">✧</span>
              </div>
            </div>

            <div className="section-heading"><div><span className="eyebrow">QUICK ACCESS</span><h2>Your creative tools</h2></div><span className="section-note">{visibleTools.length} tools available</span></div>
            <div className="tool-grid">
              {visibleTools.map((tool, index) => (
                <button className="tool-card" key={tool.name} onClick={() => setActive(tool.name)}>
                  <div className="tool-card-top"><span className={`tool-icon ${tool.color}`}>{tool.icon}</span><span className="tool-arrow">↗</span></div>
                  <h3>{tool.name}</h3><p>{tool.desc}</p>
                  <div className="tool-card-footer"><span className="tool-status"><i /> Ready for setup</span><span className="tool-number">{String(index + 1).padStart(2, "0")}</span></div>
                </button>
              ))}
            </div>
            <footer className="page-footer"><span>METAFORGE AI PRO <span className="footer-dot">•</span> BY FER</span><span>CREATED FOR YOUR CREATIVE FLOW</span></footer>
          </div>
        ) : (
          <div className="page-content subpage-content">
            <div className="eyebrow"><span className="live-dot" /> METAFORGE WORKSPACE</div>
            <h1>{active}</h1>
            <p className="subpage-intro">{selectedTool?.desc ?? getPageDescription(active)}</p>
            {active === "Metadata Generator" ? (
              <div className="feature-panel">
                <div className="feature-icon">✦</div><h2>Stock metadata studio</h2>
                <p>Upload and review images, then prepare professional titles, descriptions and keywords.</p>
                <div className="metadata-fields"><label>Title<input placeholder="Your SEO-friendly image title" /></label><label>Description<textarea placeholder="Describe the image and its potential uses" rows={3} /></label><label>Keywords<input placeholder="keyword one, keyword two, keyword three" /></label></div>
                <button className="primary-button" onClick={() => alert("Connect an AI provider in a future phase to generate real metadata.")}>Generate metadata <span>↗</span></button>
                <p className="notice">Preview only: AI generation and file processing are not connected yet.</p>
              </div>
            ) : (
              <div className="feature-panel">
                <div className="feature-icon">{getIcon(active)}</div><h2>{active}</h2>
                <p>{selectedTool?.desc ?? getPageDescription(active)}</p>
                <div className="coming-soon"><span>✧</span><strong>Ready for the next phase</strong><p>This page is part of the METAFORGE AI PRO interface. Its working functionality will be added in a later phase.</p></div>
              </div>
            )}
            <button className="secondary-button back-button" onClick={() => setActive("Dashboard")}>← Back to dashboard</button>
          </div>
        )}
      </section>
    </main>
  );
}

function getIcon(name: string) {
  const icons: Record<string, string> = {
    Dashboard: "⌂", "Metadata Generator": "✦", "Image to Prompt": "⌘",
    Projects: "▣", History: "◷", "Background Remover": "◈",
    "Adobe Keywords Search": "⌕", "Global Event Calendar": "▦",
    "Bento Builder": "▧", "Image to PSD": "▣", "AI / EPS to JPG": "⇩",
    "API Key Manager": "⌘", Settings: "⚙", "Help & Support": "?",
  };
  return icons[name] ?? "✧";
}

function getPageDescription(name: string) {
  const descriptions: Record<string, string> = {
    Projects: "Organize your creative projects and generated assets.",
    History: "Review previous metadata and prompt sessions.",
    "API Key Manager": "Configure AI provider credentials securely in a later phase.",
    Settings: "Manage your workspace preferences and appearance.",
    "Help & Support": "Find help and guidance for your creative workflow.",
  };
  return descriptions[name] ?? "Explore this tool in your creative workspace.";
}