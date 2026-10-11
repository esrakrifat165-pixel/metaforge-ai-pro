# Adds large, full-width result rows to Metadata Generator and Image-to-Prompt.
# Never touches .env.local, never deletes anything, never commits or pushes.
# Backups of every file it edits go to .recovery\ first.

$ErrorActionPreference = "Continue"

$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root "package.json"))) {
  Write-Host "Run this from the project root (the folder that contains package.json)."
  exit 1
}

$report = Join-Path $root "result-rows-report.txt"
$recovery = Join-Path $root ".recovery"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$strict = New-Object System.Text.UTF8Encoding($false, $true)

Set-Content -Path $report -Value ("Result rows report " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding ASCII
function Log([string]$line) {
  Add-Content -Path $report -Value $line -Encoding ASCII
  Write-Host $line
}

$metaPath = Join-Path $root "src\components\metadata\MetadataWorkspace.tsx"
$promptPath = Join-Path $root "src\components\image-to-prompt\ImageToPromptWorkspace.tsx"
$cssPath = Join-Path $root "src\components\metadata\result-rows.css"
$metaPage = Join-Path $root "src\app\(app)\metadata\page.tsx"
$promptPage = Join-Path $root "src\app\(app)\image-to-prompt\page.tsx"

# ---------------------------------------------------------------- state
Log ""
Log "== Git status =="
$gitLines = @(git status --short 2>&1)
if ($gitLines.Count -eq 0) { Log "(clean)" } else { $gitLines | ForEach-Object { Log $_ } }

function Read-Source([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "file not found" } }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -eq 0) { return @{ ok = $false; reason = "file is empty" } }
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
    return @{ ok = $false; reason = "UTF-16 with a byte-order mark (run scripts\recover-encoding.ps1 -Apply first)" }
  }
  $start = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $start = 3 }
  try {
    $text = $strict.GetString($bytes, $start, $bytes.Length - $start)
  } catch {
    return @{ ok = $false; reason = "not valid UTF-8 (run scripts\recover-encoding.ps1 -Apply first)" }
  }
  return @{ ok = $true; text = $text; bytes = $bytes.Length }
}

Log ""
Log "== Encoding of the two workspace files =="
$meta = Read-Source $metaPath
$prompt = Read-Source $promptPath
foreach ($pair in @(@("MetadataWorkspace.tsx", $meta), @("ImageToPromptWorkspace.tsx", $prompt))) {
  if ($pair[1].ok) { Log ("  {0}: valid UTF-8, {1} bytes" -f $pair[0], $pair[1].bytes) }
  else { Log ("  {0}: PROBLEM - {1}" -f $pair[0], $pair[1].reason) }
}
if (-not ($meta.ok -and $prompt.ok)) {
  Log "STOPPED: a workspace file has an encoding problem. Nothing was changed."
  exit 1
}

Log ""
Log "== Backup files (they are compiled by tsc if they sit inside the project) =="
$backups = @(Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -like "MetadataWorkspace.backup*" -and $_.FullName -notlike "*\node_modules\*" -and $_.FullName -notlike "*\.next\*" -and $_.FullName -notlike "*\.recovery\*"
})
if ($backups.Count -eq 0) { Log "  none found inside the project (or already moved to .recovery)" }
foreach ($b in $backups) { Log ("  found: " + $b.FullName.Substring($root.Length + 1)) }

Log ""
Log "== Old multi-column result CSS (mw-rc-grid) =="
$oldCss = @(Get-ChildItem -Path (Join-Path $root "src") -Recurse -Include *.css | Select-String -Pattern "mw-rc-grid" | ForEach-Object { "{0}:{1}" -f $_.Path.Substring($root.Length + 1), $_.LineNumber })
if ($oldCss.Count -eq 0) { Log "  none" } else { $oldCss | ForEach-Object { Log ("  " + $_) } ; Log "  (the new stylesheet overrides these with a single-column layout)" }

# ---------------------------------------------------------------- helpers
function Backup-File([string]$path) {
  New-Item -ItemType Directory -Force -Path $recovery | Out-Null
  $name = [System.IO.Path]::GetFileName($path)
  Copy-Item -LiteralPath $path -Destination (Join-Path $recovery ("$name.$stamp.pre-result-rows")) -ErrorAction Stop
}

function Delta([string]$t) {
  $o = $t.Length - $t.Replace("{", "").Length
  $c = $t.Length - $t.Replace("}", "").Length
  $po = $t.Length - $t.Replace("(", "").Length
  $pc = $t.Length - $t.Replace(")", "").Length
  return @(($o - $c), ($po - $pc))
}

function Insert-Section([string]$path, [string]$text, [string]$label, [string]$guard, [string[]]$needles, [string]$block) {
  if ($text.Contains($guard)) {
    Log "  ${label}: the section is already there (found '$guard'). No insertion needed."
    return
  }
  $missing = @($needles | Where-Object { -not $text.Contains($_) })
  if ($missing.Count -gt 0) {
    Log "  ${label}: STOPPED. This file does not have the names the new section needs: $($missing -join ', ')"
    Log "     Nothing was changed in this file. Send me this report so I can adapt the section."
    return
  }
  $marker = '<div className="mw-bottom">'
  $count = ([regex]::Matches($text, [regex]::Escape($marker))).Count
  if ($count -ne 1) {
    Log "  ${label}: STOPPED. Expected exactly one '$marker' but found $count. Nothing was changed in this file."
    return
  }

  $useCrLf = $text.Contains("`r`n")
  $normalized = $block.Replace("`r`n", "`n").TrimEnd() + "`n"
  if ($useCrLf) { $normalized = $normalized.Replace("`n", "`r`n") }

  $index = $text.IndexOf($marker)
  $lineStart = $text.LastIndexOf("`n", $index) + 1
  $new = $text.Insert($lineStart, $normalized + $(if ($useCrLf) { "`r`n" } else { "`n" }))

  $before = Delta $text
  $after = Delta $new
  if (($before[0] -ne $after[0]) -or ($before[1] -ne $after[1])) {
    Log "  ${label}: STOPPED. The inserted block would unbalance the file. Nothing was changed."
    return
  }

  Backup-File $path
  [System.IO.File]::WriteAllText($path, $new, $utf8)
  $check = Read-Source $path
  if (-not $check.ok) {
    Log "  ${label}: FAILED after writing ($($check.reason)). Restore from .recovery\*.pre-result-rows"
    return
  }
  Log "  ${label}: section inserted above the action bar. Backup saved in .recovery\ ($([System.IO.Path]::GetFileName($path)).$stamp.pre-result-rows)."
}

function Add-CssImport([string]$path, [string]$after, [string]$importLine, [string]$label) {
  $r = Read-Source $path
  if (-not $r.ok) { Log "  ${label}: cannot edit ($($r.reason))"; return }
  if ($r.text.Contains("result-rows.css")) { Log "  ${label}: stylesheet import already present"; return }
  $n = ([regex]::Matches($r.text, [regex]::Escape($after))).Count
  if ($n -ne 1) { Log "  ${label}: STOPPED. Expected one '$after' but found $n. Not changed."; return }
  Backup-File $path
  $nl = if ($r.text.Contains("`r`n")) { "`r`n" } else { "`n" }
  [System.IO.File]::WriteAllText($path, $r.text.Replace($after, $after + $nl + $importLine), $utf8)
  Log "  ${label}: stylesheet import added"
}

# ---------------------------------------------------------------- blocks
$metadataBlock = @'
          {items.length > 0 && resultTab === "metadata" ? (
            <section className="mw-card" aria-labelledby="mw-all-title">
              <div className="mw-card-head">
                <h2 id="mw-all-title" className="mw-card-title">
                  All Image Results
                </h2>
                <span className="mw-rc-summary">
                  {items.length} images - {counts.done} done, {counts.failed} failed
                  {counts.active > 0 ? `, ${counts.active} waiting` : ""}
                </span>
              </div>
              <div className="mw-rc-list">
                {items.map((item, index) => {
                  const m = metaById[item.id] ?? EMPTY_META;
                  const state = queue.statuses[item.id];
                  const keywordTotal = parseKeywords(m.keywords).length;
                  let label = "Not generated";
                  let tone = "idle";
                  if (state?.state === "processing") {
                    label = "Processing";
                    tone = "processing";
                  } else if (state?.state === "queued") {
                    label = "Waiting";
                    tone = "queued";
                  } else if (state?.state === "failed") {
                    label = "Failed";
                    tone = "failed";
                  } else if (m.title.trim() || keywordTotal > 0) {
                    label = "Completed";
                    tone = "done";
                  }
                  return (
                    <article
                      key={item.id}
                      className="mw-rc"
                      data-selected={current?.id === item.id ? "true" : "false"}
                    >
                      <button
                        type="button"
                        className="mw-rc-top"
                        aria-label={`Select image ${index + 1}, ${item.file.name}`}
                        onClick={() => selectById(item.id)}
                      >
                        <span className="mw-rc-name">
                          {index + 1}. {item.file.name}
                        </span>
                        <span className="mw-rc-badge" data-tone={tone}>
                          {label}
                        </span>
                      </button>

                      {tone === "failed" && state?.message ? (
                        <p className="mw-rc-error" role="alert">
                          {state.message}
                        </p>
                      ) : null}

                      <div className="mw-rc-block">
                        <span className="mw-rc-label">Title</span>
                        <p className="mw-rc-text">{m.title || "No title yet"}</p>
                      </div>
                      <div className="mw-rc-block">
                        <span className="mw-rc-label">Description</span>
                        <p className="mw-rc-text">{m.description || "No description yet"}</p>
                      </div>
                      <div className="mw-rc-block">
                        <span className="mw-rc-label">Keywords</span>
                        <p className="mw-rc-text">{m.keywords || "No keywords yet"}</p>
                      </div>

                      <div className="mw-rc-foot">
                        <span className="mw-rc-count">
                          {keywordTotal}/{effectiveCount} keywords - title {m.title.length} chars -
                          description {m.description.length} chars
                        </span>
                        <span className="mw-rc-actions">
                          <button type="button" className="mw-mini" onClick={() => selectById(item.id)}>
                            Open in editor
                          </button>
                          <button
                            type="button"
                            className="mw-mini"
                            onClick={() => {
                              if (!(m.title.trim() || m.description.trim() || m.keywords.trim())) {
                                showNotice("info", "That image has no metadata to copy yet.");
                                return;
                              }
                              navigator.clipboard
                                .writeText(`${m.title}\n\n${m.description}\n\n${m.keywords}`)
                                .then(
                                  () => showNotice("success", `Copied the metadata for ${item.file.name}.`),
                                  () => showNotice("error", "Copy failed. Your browser blocked clipboard access."),
                                );
                            }}
                          >
                            Copy all
                          </button>
                          {tone === "failed" && !queue.running ? (
                            <button type="button" className="mw-mini" onClick={() => void runGeneration([item])}>
                              Retry
                            </button>
                          ) : null}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
'@

$promptBlock = @'
      {items.length > 0 ? (
        <section className="mw-card" aria-labelledby="ip-all-title">
          <div className="mw-card-head">
            <h2 id="ip-all-title" className="mw-card-title">
              All Image Prompts
            </h2>
            <span className="mw-rc-summary">
              {items.length} images - {counts.done} done, {counts.failed} failed
              {counts.active > 0 ? `, ${counts.active} waiting` : ""}
            </span>
          </div>
          <div className="mw-rc-list">
            {items.map((item, index) => {
              const text = promptById[item.id] ?? "";
              const state = queue.statuses[item.id];
              let label = "Not generated";
              let tone = "idle";
              if (state?.state === "processing") {
                label = "Processing";
                tone = "processing";
              } else if (state?.state === "queued") {
                label = "Waiting";
                tone = "queued";
              } else if (state?.state === "failed") {
                label = "Failed";
                tone = "failed";
              } else if (text.trim()) {
                label = "Completed";
                tone = "done";
              }
              return (
                <article
                  key={item.id}
                  className="mw-rc"
                  data-selected={current?.id === item.id ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="mw-rc-top"
                    aria-label={`Select image ${index + 1}, ${item.file.name}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="mw-rc-name">
                      {index + 1}. {item.file.name}
                    </span>
                    <span className="mw-rc-badge" data-tone={tone}>
                      {label}
                    </span>
                  </button>

                  {tone === "failed" && state?.message ? (
                    <p className="mw-rc-error" role="alert">
                      {state.message}
                    </p>
                  ) : null}

                  <div className="mw-rc-block">
                    <label className="mw-rc-label" htmlFor={`ip-row-${item.id}`}>
                      Prompt
                    </label>
                    <textarea
                      id={`ip-row-${item.id}`}
                      className="mw-rc-text"
                      rows={10}
                      value={text}
                      placeholder="No prompt yet."
                      onFocus={() => setSelectedId(item.id)}
                      onChange={(event) =>
                        setPromptById((previous) => ({ ...previous, [item.id]: event.target.value }))
                      }
                    />
                  </div>

                  <div className="mw-rc-foot">
                    <span className="mw-rc-count">{text.length} chars</span>
                    <span className="mw-rc-actions">
                      <button
                        type="button"
                        className="mw-mini"
                        onClick={() => {
                          if (!text.trim()) {
                            showNotice("info", "That prompt is empty, so there is nothing to copy.");
                            return;
                          }
                          navigator.clipboard.writeText(text).then(
                            () => showNotice("success", `Copied the prompt for ${item.file.name}.`),
                            () => showNotice("error", "Copy failed. Your browser blocked clipboard access."),
                          );
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="mw-mini"
                        onClick={() => {
                          if (!text.trim()) {
                            showNotice("info", "There is no prompt to download for that image yet.");
                            return;
                          }
                          downloadBlob(text, "text/plain;charset=utf-8", `${baseName(item.file.name)}-prompt.txt`);
                          showNotice("success", `Downloaded the prompt for ${item.file.name}.`);
                        }}
                      >
                        Download .txt
                      </button>
                      {tone === "failed" && !queue.running ? (
                        <button type="button" className="mw-mini" onClick={() => void runGeneration([item])}>
                          Retry
                        </button>
                      ) : null}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
'@

$cssText = @'
/* Large, full-width result rows for Metadata Generator and Image-to-Prompt.
   One column on every screen size. Nothing is truncated or clamped.
   Selectors start with .mw-page so they win over older card styles. */

.mw-page .mw-rc-summary {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.mw-page .mw-rc-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  width: 100%;
}

.mw-page .mw-rc {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  width: 100%;
  min-width: 0;
  padding: 22px 24px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 40%, var(--surface));
}

.mw-page .mw-rc[data-selected="true"] {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.mw-page .mw-rc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.mw-page .mw-rc-name {
  flex: 1 1 240px;
  min-width: 0;
  font-size: 1.02rem;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.mw-page .mw-rc-badge {
  flex: none;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.75rem;
  font-weight: 650;
  color: var(--text-muted);
}

.mw-page .mw-rc-badge[data-tone="done"] {
  color: #16a34a;
  border-color: color-mix(in srgb, #16a34a 55%, var(--border));
}

.mw-page .mw-rc-badge[data-tone="failed"] {
  color: #ef4444;
  border-color: color-mix(in srgb, #ef4444 55%, var(--border));
}

.mw-page .mw-rc-badge[data-tone="processing"],
.mw-page .mw-rc-badge[data-tone="queued"] {
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.mw-page .mw-rc-error {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, #ef4444 55%, var(--border));
  background: color-mix(in srgb, #ef4444 8%, var(--surface));
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}

.mw-page .mw-rc-block {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.mw-page .mw-rc-label {
  font-size: 0.78rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mw-page p.mw-rc-text,
.mw-page textarea.mw-rc-text {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 55%, var(--surface));
  color: var(--text);
  font: inherit;
  font-size: 0.95rem;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mw-page textarea.mw-rc-text {
  min-height: 14rem;
  resize: vertical;
}

.mw-page .mw-rc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.mw-page .mw-rc-count {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.mw-page .mw-rc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 640px) {
  .mw-page .mw-rc {
    padding: 16px;
  }
}
'@

# ---------------------------------------------------------------- apply
Log ""
Log "== Applying =="

[System.IO.File]::WriteAllText($cssPath, $cssText.Replace("`r`n", "`n"), $utf8)
Log "  wrote src\components\metadata\result-rows.css (UTF-8 without BOM)"

Insert-Section $metaPath $meta.text "MetadataWorkspace" "mw-all-title" @(
  "const [metaById", "const [resultTab", "const counts", "const effectiveCount", "useMetadataQueue",
  "parseKeywords", "EMPTY_META", "function selectById", "function showNotice", "function runGeneration"
) $metadataBlock

Insert-Section $promptPath $prompt.text "ImageToPromptWorkspace" "ip-all-title" @(
  "const [promptById", "setPromptById", "setSelectedId", "const counts", "useImageQueue",
  "function showNotice", "function runGeneration", "function baseName", "function downloadBlob"
) $promptBlock

Add-CssImport $metaPage 'import "./metadata.css";' 'import "../../../components/metadata/result-rows.css";' "metadata page"
Add-CssImport $promptPage 'import "../metadata/metadata.css";' 'import "../../../components/metadata/result-rows.css";' "image-to-prompt page"

# ---------------------------------------------------------------- checks
function Run-Check([string]$name, [scriptblock]$command) {
  Log ""
  Log "---- $name ----"
  $output = & $command 2>&1 | Out-String
  $code = $LASTEXITCODE
  $tail = ($output -split "`r?`n") | Select-Object -Last 50
  foreach ($line in $tail) { Log $line }
  if ($code -eq 0) { Log "RESULT: $name PASS" } else { Log "RESULT: $name FAIL (exit code $code)" }
  return @{ code = $code; text = $output }
}

Log ""
Log "== Checks (real results) =="
$tsc = Run-Check "tsc" { npx tsc --noEmit }

if ($tsc.code -ne 0 -and $tsc.text -match "MetadataWorkspace\.backup") {
  Log ""
  Log "tsc reports the backup file. Moving ONLY the backup file(s) into .recovery\ (not deleting)."
  New-Item -ItemType Directory -Force -Path $recovery | Out-Null
  foreach ($b in $backups) {
    $dest = Join-Path $recovery ($b.Name + "." + $stamp + ".moved")
    Move-Item -LiteralPath $b.FullName -Destination $dest -ErrorAction SilentlyContinue
    Log ("  moved " + $b.FullName.Substring($root.Length + 1) + " -> .recovery\" + [System.IO.Path]::GetFileName($dest))
  }
  $tsc = Run-Check "tsc (after moving the backup)" { npx tsc --noEmit }
}

$lint = Run-Check "lint" { npm run lint }
Remove-Item -Recurse -Force (Join-Path $root ".next") -ErrorAction SilentlyContinue
$build = Run-Check "build" { npm run build }

Log ""
Log "== Files this script may have changed =="
git status --short 2>&1 | ForEach-Object { Log $_ }
Log ""
Log "Not committed, not pushed. Do not commit .recovery\ or result-rows-report.txt."