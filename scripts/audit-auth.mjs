// READ-ONLY audit of authentication, profiles and secrets handling.
// Run from the project root:  node scripts/audit-auth.mjs
// Writes auth-audit.txt. It changes nothing, never connects to Supabase, never prints
// environment VALUES (names only), and redacts anything that looks like a secret.

import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const lines = [];
const log = (text = "") => { lines.push(text); console.log(text); };

const SKIP = new Set(["node_modules", ".next", ".git", ".recovery", ".data", "out", "dist"]);

async function walk(dir, exts, found = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, exts, found);
    else if (exts.some((ext) => entry.name.endsWith(ext))) found.push(full);
  }
  return found;
}

async function read(file) {
  try { return (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"); } catch { return null; }
}

const rel = (file) => path.relative(root, file).replaceAll("\\", "/");

function redact(line) {
  return line
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/((?:secret|token|password|api[_-]?key)\w*\s*[:=]\s*)(["'])[^"']{8,}\2/gi, "$1[REDACTED]")
    .trim()
    .slice(0, 170);
}

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

const srcFiles = await walk(path.join(root, "src"), [".ts", ".tsx"]);
const sources = new Map();
for (const file of srcFiles) sources.set(file, await read(file) ?? "");

function search(pattern, limit = 14) {
  const hits = [];
  for (const [file, text] of sources) {
    text.split("\n").forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${rel(file)}:${index + 1}: ${redact(line)}`);
    });
  }
  return { total: hits.length, shown: hits.slice(0, limit) };
}

function show(label, pattern, limit) {
  const { total, shown } = search(pattern, limit);
  log(`- ${label}: ${total} match${total === 1 ? "" : "es"}`);
  shown.forEach((hit) => log(`    ${hit}`));
  if (total > shown.length) log(`    ...and ${total - shown.length} more`);
}

log(`AUTH AUDIT (read-only) ${new Date().toISOString()}`);

// ---------------------------------------------------------------- versions
log("\n== 1. Versions ==");
const pkgText = await read(path.join(root, "package.json"));
if (pkgText) {
  try {
    const pkg = JSON.parse(pkgText);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ["next", "react", "@supabase/ssr", "@supabase/supabase-js", "typescript"]) {
      log(`  ${name}: ${deps[name] ?? "NOT INSTALLED"}`);
    }
  } catch { log("  package.json could not be parsed"); }
} else log("  package.json not found. Run this from the project root.");

// ---------------------------------------------------------------- files
log("\n== 2. Authentication files ==");
const expected = [
  "src/proxy.ts", "src/middleware.ts", "src/lib/supabase/proxy.ts", "src/lib/supabase/server.ts",
  "src/lib/supabase/env.ts", "src/lib/supabase/client.ts", "src/lib/auth/guards.ts", "src/lib/auth/session.ts",
  "src/app/auth/google/route.ts", "src/app/auth/callback/route.ts", "src/app/auth/signout/route.ts",
  "src/app/login/page.tsx", "src/app/(app)/layout.tsx", "src/components/AppShell.tsx", "src/components/Sidebar.tsx",
  "src/components/GoogleSignInButton.tsx",
];
for (const file of expected) {
  const full = path.join(root, file);
  if (await exists(full)) {
    const size = (await fs.stat(full)).size;
    log(`  present  ${file} (${size} bytes)`);
  } else log(`  missing  ${file}`);
}
if (await exists(path.join(root, "src/middleware.ts")) && await exists(path.join(root, "src/proxy.ts"))) {
  log("  PROBLEM: both middleware.ts and proxy.ts exist. Next.js 16 uses proxy.ts, so remove the conflict.");
}
const authDirs = srcFiles.filter((file) => /src\/app\/(auth|login)\//.test(rel(file)));
log(`  all files under src/app/auth and src/app/login: ${authDirs.map(rel).join(", ") || "none"}`);

// ---------------------------------------------------------------- patterns
log("\n== 3. How sign-in and access are decided (matching lines) ==");
show("email allowlist (blocks public sign-in)", /ALLOWED_EMAILS|isEmailAllowed|getAllowedEmails/);
show("email confirmation required", /email_confirmed_at/);
show("OAuth start / code exchange", /signInWithOAuth|exchangeCodeForSession|redirectTo/);
show("sign-out calls", /\.signOut\(/);
show("session reads (getUser / getSession / getClaims)", /auth\.(getUser|getSession|getClaims)\(/);
show("role checks", /\.role\b|role\s*===|adminApiGuard|requireAdmin/);
show("suspension / ban logic", /suspend|banned_until|ban_duration/i);
show("service-role key usage", /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);

// ---------------------------------------------------------------- proxy
log("\n== 4. Proxy behavior ==");
for (const file of ["src/proxy.ts", "src/lib/supabase/proxy.ts"]) {
  const text = sources.get(path.join(root, file));
  if (text === undefined) continue;
  log(`  ${file}:`);
  text.split("\n").forEach((line, index) => {
    if (/PUBLIC_PREFIXES|matcher|status:\s*40[13]|redirect\(|isEmailAllowed|profiles|suspend|no-store/i.test(line)) {
      log(`    ${index + 1}: ${redact(line)}`);
    }
  });
}

// ---------------------------------------------------------------- api routes
log("\n== 5. API routes and their own checks (defense in depth) ==");
const routes = srcFiles.filter((file) => /\/route\.ts$/.test(rel(file)) && rel(file).startsWith("src/app/api/"));
for (const file of routes) {
  const text = sources.get(file) ?? "";
  const methods = [...text.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
  const gates = [];
  if (/adminApiGuard|requireAdmin/.test(text)) gates.push("admin check");
  if (/getAccess\(/.test(text)) gates.push("getAccess");
  if (/getCurrentUser\(/.test(text)) gates.push("getCurrentUser");
  if (/auth\.getUser\(/.test(text)) gates.push("getUser");
  log(`  ${rel(file)} [${methods.join(", ") || "no handlers?"}] -> ${gates.length ? gates.join(", ") : "NO OWN AUTH CHECK (relies on the proxy only)"}`);
}
if (routes.length === 0) log("  no API routes found");

log("\n== 6. Pages that check sign-in themselves ==");
const pages = srcFiles.filter((file) => /\/(page|layout)\.tsx$/.test(rel(file)) && rel(file).startsWith("src/app/"));
for (const file of pages) {
  const text = sources.get(file) ?? "";
  const gates = [];
  if (/getAccess\(/.test(text)) gates.push("getAccess");
  if (/getCurrentUser\(/.test(text)) gates.push("getCurrentUser");
  if (/redirect\(["']\/login["']\)/.test(text)) gates.push("redirects to /login");
  if (gates.length) log(`  ${rel(file)} -> ${gates.join(", ")}`);
}

// ---------------------------------------------------------------- secrets in client code
log("\n== 7. Server secrets referenced from client components (must be none) ==");
let clientProblems = 0;
for (const [file, text] of sources) {
  if (!/^\s*["']use client["']/m.test(text.split("\n").slice(0, 4).join("\n"))) continue;
  const bad = [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]).filter((name) => !name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV");
  const named = /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|KEY_ENCRYPTION_SECRET|GEMINI_API_KEY/.test(text);
  if (bad.length || named) { clientProblems += 1; log(`  PROBLEM ${rel(file)}: ${[...new Set(bad)].join(", ") || "mentions a secret name"}`); }
}
if (clientProblems === 0) log("  none found");

// ---------------------------------------------------------------- env names
log("\n== 8. Environment variable names (values are never read into this report) ==");
const defined = new Set();
for (const name of [".env", ".env.local", ".env.development", ".env.production", ".env.development.local", ".env.production.local"]) {
  const text = await read(path.join(root, name));
  if (text === null) continue;
  for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) defined.add(m[1]);
  log(`  found file: ${name}`);
}
const referenced = new Set();
for (const text of sources.values()) {
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) referenced.add(m[1]);
  for (const m of text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g)) referenced.add(m[1]);
}
const platformNames = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NEXT_RUNTIME", "CI", "PORT"]);
const envTs = sources.get(path.join(root, "src/lib/supabase/env.ts")) ?? "";
const envTsNames = [...new Set([...envTs.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))];
log(`  names read by src/lib/supabase/env.ts: ${envTsNames.join(", ") || "none (file missing?)"}`);
for (const name of envTsNames) log(`    ${name}: ${defined.has(name) ? "defined in a local .env file" : "NOT defined locally"}`);
log(`  names defined locally: ${[...defined].sort().join(", ") || "none"}`);
log(`  referenced in code but not defined locally (set on Vercel instead? check there): ${[...referenced].filter((n) => !defined.has(n) && !platformNames.has(n)).sort().join(", ") || "none"}`);
log(`  defined locally but never referenced: ${[...defined].filter((n) => !referenced.has(n)).sort().join(", ") || "none"}`);
const suspicious = [...defined].filter((n) => /^NEXT_PUBLIC_.*(SECRET|SERVICE|PRIVATE)/.test(n));
log(`  NEXT_PUBLIC names that look secret (must be none): ${suspicious.join(", ") || "none"}`);

// ---------------------------------------------------------------- git hygiene
log("\n== 9. Secrets and Git ==");
const gitignore = await read(path.join(root, ".gitignore")) ?? "";
log(`  .gitignore covers .env files: ${/^\.env/m.test(gitignore) ? "yes" : "NO"}`);
log(`  .gitignore covers .data: ${/^\.data\/?$/m.test(gitignore) ? "yes" : "no (only matters for the old local key store)"}`);
try {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /^\.env(?!\.example)|^\.data\//.test(f));
  log(`  tracked secret-like files in Git: ${tracked.join(", ") || "none"}`);
} catch { log("  git not available, tracked files not checked"); }

// ---------------------------------------------------------------- migrations
log("\n== 10. SQL files in the repo ==");
const sqlFiles = await walk(path.join(root, "supabase"), [".sql"]);
for (const file of sqlFiles) {
  const text = await read(file) ?? "";
  const tags = [];
  if (/create table[^;]*profiles/i.test(text)) tags.push("profiles");
  if (/create table[^;]*api_keys/i.test(text)) tags.push("api_keys");
  if (/create table[^;]*history/i.test(text)) tags.push("history");
  if (/handle_new_user/i.test(text)) tags.push("signup trigger");
  if (/suspend/i.test(text)) tags.push("suspension");
  log(`  ${rel(file)}${tags.length ? ` (${tags.join(", ")})` : ""}`);
}
if (sqlFiles.length === 0) log("  none");
log("  NOTE: files in the repo show what was intended. Only the Supabase queries show what is actually in the database.");

// ---------------------------------------------------------------- manual
log("\n== 11. Check by hand in the Supabase dashboard ==");
[
  "Authentication > Sign In / Providers: Google is enabled. Note whether Email is also enabled.",
  "Authentication > Sign In / Providers: 'Allow new users to sign up' is ON (needed for public sign-in).",
  "Authentication > URL Configuration: Site URL is your production URL; Redirect URLs include http://localhost:3000/** and your Vercel URL /**.",
  "Authentication > Rate Limits: note the current limits.",
  "Google Cloud > OAuth consent screen: if it says 'Testing', only listed test users can sign in. Public sign-in needs it published.",
].forEach((item) => log(`  [ ] ${item}`));

await fs.writeFile(path.join(root, "auth-audit.txt"), lines.join("\n") + "\n", "utf8");
console.log("\nSaved auth-audit.txt (read-only audit, nothing was changed).");