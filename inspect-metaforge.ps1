$ErrorActionPreference = 'Continue'

# ---------- Safety: verify project directory ----------
$root = 'C:\Projects\metaforge-ai-pro\metaforge-web'
if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
    Write-Host "STOP: package.json not found in $root. Nothing was read or written." -ForegroundColor Red
    exit 1
}
Set-Location -LiteralPath $root

$desktop = [Environment]::GetFolderPath('Desktop')
$outFile = Join-Path $desktop 'metaforge-inspection.txt'
$MaxLinesPerFile = 300
$MaxTotalSourceLines = 6000

$sb = New-Object System.Text.StringBuilder
function Add-Line([string]$t) { [void]$sb.AppendLine($t) }
function Section([string]$title) {
    Add-Line ''
    Add-Line ('=' * 70)
    Add-Line "## $title"
    Add-Line ('=' * 70)
}

# ---------- Redaction (applied to every line that is written) ----------
function Redact([string]$s) {
    if ($null -eq $s) { return $s }
    $s = $s -replace 'sk-[A-Za-z0-9_\-]{16,}', '[REDACTED_KEY]'
    $s = $s -replace 'AIza[0-9A-Za-z_\-]{20,}', '[REDACTED_KEY]'
    $s = $s -replace 'gsk_[A-Za-z0-9]{16,}', '[REDACTED_KEY]'
    $s = $s -replace 'xai-[A-Za-z0-9]{16,}', '[REDACTED_KEY]'
    $s = $s -replace 'eyJ[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}', '[REDACTED_JWT]'
    $s = $s -replace 'https://[^/@\s]+@', 'https://[REDACTED]@'
    $s = $s -replace '(?i)((?:key|secret|token|password)[A-Za-z_]*\s*[:=]\s*)["''][^"'']{16,}["'']', '$1"[REDACTED]"'
    return $s
}

$excludeDirs = '\\(node_modules|\.next|\.git|\.vercel|\.turbo|coverage|dist)(\\|$)'

# ---------- 1. Environment and Git ----------
Section '1. ENVIRONMENT AND GIT (read-only)'
Add-Line "Project directory : $((Get-Location).Path)"
Add-Line "Node             : $(try { node -v } catch { 'not found' })"
Add-Line "npm              : $(try { npm -v } catch { 'not found' })"
Add-Line "Git branch       : $(try { git branch --show-current } catch { 'git not found' })"
Add-Line 'Git status --short:'
try { git status --short 2>&1 | ForEach-Object { Add-Line ('  ' + (Redact $_)) } } catch { Add-Line '  (git unavailable)' }
Add-Line 'Last 5 commits:'
try { git log --oneline -n 5 2>&1 | ForEach-Object { Add-Line ('  ' + (Redact $_)) } } catch { }
Add-Line 'Remotes:'
try { git remote -v 2>&1 | ForEach-Object { Add-Line ('  ' + (Redact $_)) } } catch { }

# ---------- 2. package.json ----------
Section '2. package.json'
Get-Content -LiteralPath 'package.json' | ForEach-Object { Add-Line (Redact $_) }
if (Test-Path -LiteralPath 'package-lock.json') {
    $len = (Get-Item -LiteralPath 'package-lock.json').Length
    Add-Line "package-lock.json exists ($len bytes)"
} else { Add-Line 'package-lock.json: NOT FOUND' }

# ---------- 3. Environment variable NAMES only ----------
Section '3. ENV FILES (variable names only - values are never read into this report)'
Get-ChildItem -LiteralPath $root -Force -Filter '.env*' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Add-Line "File: $($_.Name)"
    Get-Content -LiteralPath $_.FullName | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $name = $Matches[1]
            $val = $Matches[2].Trim().Trim('"').Trim("'")
            $state = if ($val.Length -gt 0) { 'set' } else { 'empty' }
            Add-Line "  $name  [$state]"
        }
    }
}

# ---------- 4. External tools ----------
Section '4. CONVERSION TOOLS ON THIS MACHINE'
foreach ($tool in 'gswin64c', 'gs', 'magick', 'ffmpeg', 'inkscape') {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) { Add-Line "$tool : FOUND at $($cmd.Source)" } else { Add-Line "$tool : not found" }
}

# ---------- 5. File tree ----------
Section '5. FILE TREE (excluding node_modules, .next, .git, .vercel)'
$allFiles = Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $excludeDirs -and $_.Name -notmatch '^\.env' }
$allFiles | Select-Object -First 1500 | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    Add-Line ("{0}  ({1} bytes)" -f $rel, $_.Length)
}
if ($allFiles.Count -gt 1500) { Add-Line "... tree truncated, $($allFiles.Count) files total" }

# ---------- 6. Config files ----------
Section '6. CONFIG FILES'
foreach ($name in 'next.config.js', 'next.config.mjs', 'next.config.ts', 'tsconfig.json', 'vercel.json', 'middleware.ts', 'src\middleware.ts') {
    if (Test-Path -LiteralPath $name) {
        Add-Line ''
        Add-Line "--- $name ---"
        Get-Content -LiteralPath $name -TotalCount $MaxLinesPerFile | ForEach-Object { Add-Line (Redact $_) }
    }
}

# ---------- 7. Source dump (prioritized, capped) ----------
Section '7. SOURCE FILES (API routes first, then lib/server, then the rest)'
$pattern = 'api|lib|server|utils|provider|gemini|openai|anthropic|claude|grok|groq|key|crypto|encrypt|metadata|prompt|history|admin|convert|ghostscript|eps|svg|supabase|middleware|auth|upload|csv|dashboard|settings|queue|job'
$srcFiles = $allFiles | Where-Object {
    $_.Extension -in '.ts', '.tsx', '.js', '.mjs', '.sql' -and
    $_.FullName -notmatch '\\components\\ui\\' -and
    $_.FullName -notmatch '\.d\.ts$' -and
    $_.FullName.Substring($root.Length) -match $pattern
}

function Score($f) {
    $p = $f.FullName.Substring($root.Length)
    if ($p -match '\\api\\') { return 1 }
    if ($p -match '\\(lib|utils|server)\\') { return 2 }
    if ($p -match '\.sql$') { return 2 }
    return 3
}
$ranked = $srcFiles | Sort-Object @{ Expression = { Score $_ } }, FullName

$totalLines = 0
$skipped = New-Object System.Collections.Generic.List[string]
foreach ($f in $ranked) {
    $rel = $f.FullName.Substring($root.Length + 1)
    try { $lines = [System.IO.File]::ReadAllLines($f.FullName) } catch { $skipped.Add("$rel (unreadable)"); continue }
    $take = [Math]::Min($lines.Length, $MaxLinesPerFile)
    if (($totalLines + $take) -gt $MaxTotalSourceLines) { $skipped.Add("$rel ($($lines.Length) lines)"); continue }
    Add-Line ''
    Add-Line "=== FILE: $rel ($($lines.Length) lines) ==="
    for ($i = 0; $i -lt $take; $i++) { Add-Line (Redact $lines[$i]) }
    if ($lines.Length -gt $take) { Add-Line "... [truncated after $take of $($lines.Length) lines]" }
    $totalLines += $take
}
if ($skipped.Count -gt 0) {
    Add-Line ''
    Add-Line '--- Files not included because of the size cap (ask for these by name if needed) ---'
    $skipped | ForEach-Object { Add-Line "  $_" }
}

# ---------- Write the report ----------
try {
    [System.IO.File]::WriteAllText($outFile, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
    $size = [Math]::Round((Get-Item -LiteralPath $outFile).Length / 1KB, 1)
    Write-Host ''
    Write-Host "Report written: $outFile ($size KB)" -ForegroundColor Green
    Write-Host 'No project files were modified. Upload this report file to the chat.' -ForegroundColor Cyan
} catch {
    Write-Host "Failed to write report: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}