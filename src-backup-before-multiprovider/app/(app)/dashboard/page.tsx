"use client";
 
import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
 
type Row = Record<string, any>;
type Provider = { id: string; name: string; configured: boolean };
 
// Edit hrefs here if your routes differ (the installer prints your real routes).
const TOOLS = [
  { name: "Metadata Generator", desc: "Titles, descriptions and keywords", href: "/dashboard/metadata-generator" },
  { name: "Image to Prompt", desc: "Detailed prompts from images", href: "/dashboard/image-to-prompt" },
  { name: "Background Remover", desc: "Cut out subjects cleanly", href: "/dashboard/background-remover" },
  { name: "Adobe Keywords Search", desc: "Research stock keywords", href: "/dashboard/adobe-keywords" },
  { name: "Global Event Calendar", desc: "Plan around key events", href: "/dashboard/event-calendar" },
  { name: "Bento Builder", desc: "Compose bento layouts", href: "/dashboard/bento-builder" },
  { name: "Image to PSD", desc: "Convert images to layered PSD", href: "/dashboard/image-to-psd" },
  { name: "AI/EPS to JPG", desc: "Convert vector files to JPG", href: "/dashboard/converter" },
  { name: "History", desc: "Review past jobs", href: "/dashboard/history" },
  { name: "API Key Manager", desc: "Manage provider keys", href: "/dashboard/api-keys" },
];
 
const HISTORY_TABLES = ["history", "jobs"];
 
function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;
  return createBrowserClient(url, key);
}
 
function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 21) return "Good Evening";
  return "Good Night";
}
 
function displayName(user: any) {
  const m = user?.user_metadata || {};
  return (
    m.full_name || m.name || m.display_name ||
    (user?.email ? String(user.email).split("@")[0] : "there")
  );
}
 
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
 
function rowTitle(r: Row) {
  return r.file_name || r.filename || r.title || r.name || r.tool || r.type || "Job";
}
 
export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [greeting, setGreeting] = useState("Hello");
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState({ total: 0, week: 0, today: 0 });
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
 
  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
    let cancelled = false;
 
    (async () => {
      try {
        const supabase: any = getClient();
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (!session) {
          if (!cancelled) setError("Please sign in to see your dashboard.");
          return;
        }
        const u = session.user;
        if (!cancelled) setUser(u);
 
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
 
        for (const table of HISTORY_TABLES) {
          const recent = await supabase
            .from(table)
            .select("*")
            .eq("user_id", u.id)
            .order("created_at", { ascending: false })
            .limit(8);
          if (recent.error) continue;
 
          const count = async (since?: string) => {
            let q: any = supabase
              .from(table)
              .select("*", { count: "exact", head: true })
              .eq("user_id", u.id);
            if (since) q = q.gte("created_at", since);
            const r = await q;
            return r.count ?? 0;
          };
 
          const [total, week, today] = await Promise.all([
            count(),
            count(weekAgo.toISOString()),
            count(startOfToday.toISOString()),
          ]);
          if (!cancelled) {
            setRows(recent.data || []);
            setStats({ total, week, today });
          }
          break;
        }
 
        try {
          const res = await fetch("/api/dashboard/providers", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const json = await res.json();
            if (!cancelled) setProviders(json.providers || []);
          }
        } catch {
          /* provider status stays hidden if the check fails */
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load the dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
 
    return () => {
      cancelled = true;
    };
  }, []);
 
  const name = displayName(user);
  const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
 
  return (
    <div className="mf">
      <style>{CSS}</style>
 
      <header className="mf-hero">
        <div className="mf-hello">
          <div className="mf-avatar">
            {avatar && !imgFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={name} onError={() => setImgFailed(true)} />
            ) : (
              <span>{user ? initials(name) : ""}</span>
            )}
          </div>
          <div>
            <h1>{loading ? "Loading..." : `${greeting}, ${name}`}</h1>
            <p>Welcome to METAFORGE AI PRO - By FER</p>
          </div>
        </div>
      </header>
 
      {error && <div className="mf-alert">{error}</div>}
 
      <section className="mf-stats">
        <Stat label="Total jobs" value={stats.total} />
        <Stat label="Last 7 days" value={stats.week} />
        <Stat label="Today" value={stats.today} />
      </section>
 
      <section className="mf-section">
        <h2>Quick access</h2>
        <div className="mf-grid">
          {TOOLS.map((t) => (
            <Link key={t.name} href={t.href} className="mf-card">
              <strong>{t.name}</strong>
              <span>{t.desc}</span>
            </Link>
          ))}
        </div>
      </section>
 
      <div className="mf-two">
        <section className="mf-section">
          <h2>Recent activity</h2>
          {rows.length === 0 ? (
            <div className="mf-empty">
              No activity yet. Run a tool and your recent jobs will show up here.
            </div>
          ) : (
            <ul className="mf-list">
              {rows.map((r, i) => (
                <li key={r.id ?? i}>
                  <div>
                    <strong>{String(rowTitle(r))}</strong>
                    <small>
                      {r.tool || r.type || "Job"}
                      {r.created_at ? ` Â· ${new Date(r.created_at).toLocaleString()}` : ""}
                    </small>
                  </div>
                  {r.status && <span className="mf-pill">{String(r.status)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
 
        {providers && (
          <section className="mf-section">
            <h2>AI providers</h2>
            <ul className="mf-list">
              {providers.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <span className={p.configured ? "mf-pill ok" : "mf-pill"}>
                    {p.configured ? "Server key set" : "No server key"}
                  </span>
                </li>
              ))}
            </ul>
            <small className="mf-note">
              Shows server-level keys only. Keys you save in the API Key Manager are managed there.
            </small>
          </section>
        )}
      </div>
    </div>
  );
}
 
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="mf-stat">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
 
const CSS = `
.mf{--bg:#f6f7fb;--card:#fff;--text:#12141c;--muted:#667085;--line:#e4e7ec;--accent:#6d4aff;--ok:#12805c;
  color:var(--text);background:var(--bg);padding:24px;max-width:1200px;margin:0 auto;border-radius:16px}
@media (prefers-color-scheme: dark){.mf{--bg:#0e1017;--card:#171a24;--text:#eef0f6;--muted:#98a2b3;--line:#262b3a;--accent:#9b85ff;--ok:#4ade9b}}
.dark .mf{--bg:#0e1017;--card:#171a24;--text:#eef0f6;--muted:#98a2b3;--line:#262b3a;--accent:#9b85ff;--ok:#4ade9b}
.mf *{box-sizing:border-box}
.mf-hero{margin-bottom:20px}
.mf-hello{display:flex;gap:16px;align-items:center}
.mf-hello h1{margin:0;font-size:clamp(1.3rem,3vw,1.9rem)}
.mf-hello p{margin:4px 0 0;color:var(--muted)}
.mf-avatar{width:56px;height:56px;border-radius:50%;background:var(--accent);color:#fff;display:flex;
  align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;overflow:hidden;flex:none}
.mf-avatar img{width:100%;height:100%;object-fit:cover}
.mf-alert{background:#fff4e5;color:#8a4b00;border:1px solid #ffd9a8;padding:12px 14px;border-radius:10px;margin-bottom:16px}
.mf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.mf-stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px}
.mf-stat span{color:var(--muted);font-size:.85rem}
.mf-stat strong{font-size:1.8rem}
.mf-section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
.mf-section h2{margin:0 0 12px;font-size:1.05rem}
.mf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.mf-card{display:flex;flex-direction:column;gap:4px;padding:14px;border:1px solid var(--line);border-radius:10px;
  text-decoration:none;color:var(--text);transition:border-color .15s,transform .15s}
.mf-card:hover{border-color:var(--accent);transform:translateY(-1px)}
.mf-card span{color:var(--muted);font-size:.85rem}
.mf-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start}
.mf-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.mf-list li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.mf-list li:last-child{border-bottom:0}
.mf-list small{display:block;color:var(--muted);margin-top:2px}
.mf-pill{font-size:.75rem;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.mf-pill.ok{color:var(--ok);border-color:var(--ok)}
.mf-empty{color:var(--muted);padding:18px;text-align:center;border:1px dashed var(--line);border-radius:10px}
.mf-note{display:block;color:var(--muted);margin-top:10px}
@media (max-width:600px){.mf{padding:14px}}
`;

