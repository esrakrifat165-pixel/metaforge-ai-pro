$dest = Join-Path $env:TEMP 'inspect-metaforge-master.ps1'
$code = @'
#requires -Version 5.1
# inspect-metaforge-master.ps1 (v2) - READ-ONLY inspection for METAFORGE AI PRO.
# Writes ONLY to %TEMP%. Never modifies, creates or deletes anything inside the project.
$ErrorActionPreference = 'Continue'
$Root         = 'C:\Projects\metaforge-ai-pro\metaforge-web'
$Report       = Join-Path $env:TEMP 'metaforge-inspection.txt'
$PartsDir     = Join-Path $env:TEMP 'metaforge-inspection-parts'
$ChunkChars   = 60000
$MaxFileBytes = 400000
$Utf8         = New-Object System.Text.UTF8Encoding($false)

function Fail([string]$m) { Write-Host "ABORT: $m" -ForegroundColor Red; exit 1 }

# ---------------- 1. verify project root ----------------
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { Fail "Project root not found: $Root" }
$resolved = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
if ($resolved -ine $Root) { Fail "Resolved root '$resolved' differs from expected '$Root'" }
foreach ($need in 'package.json','src') { if (-not (Test-Path -LiteralPath (Join-Path $Root $need))) { Fail "Expected '$need' is missing in the project root" } }
try { $pkg = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Fail 'package.json is not valid JSON' }
$hasNext = $false
if ($pkg.dependencies -and $pkg.dependencies.PSObject.Properties['next']) { $hasNext = $true }
if (-not $hasNext) { Fail 'package.json has no "next" dependency - this does not look like the METAFORGE Next.js app' }
if ($Report.StartsWith($Root, 'OrdinalIgnoreCase') -or $PartsDir.StartsWith($Root, 'OrdinalIgnoreCase')) { Fail 'Output location is inside the project - refusing to run' }
Set-Location -LiteralPath $Root

# ---------------- helpers ----------------
$Sum = New-Object System.Text.StringBuilder
function Sec([string]$t) { [void]$Sum.AppendLine(''); [void]$Sum.AppendLine(('=' * 78)); [void]$Sum.AppendLine("## $t"); [void]$Sum.AppendLine(('=' * 78)) }
function Ln([string]$t = '') { [void]$Sum.AppendLine($t) }
function Rel([string]$full) { return $full.Substring($Root.Length + 1).Replace('\', '/') }

$script:Redactions = 0
$RedactRules = @(
  @('sk-ant-[A-Za-z0-9_\-]{16,}', '[REDACTED:anthropic-key]', 'None'),
  @('sk-[A-Za-z0-9_\-]{20,}', '[REDACTED:sk-key]', 'None'),
  @('AIza[0-9A-Za-z_\-]{30,}', '[REDACTED:google-key]', 'None'),
  @('gsk_[A-Za-z0-9]{20,}', '[REDACTED:groq-key]', 'None'),
  @('xai-[A-Za-z0-9]{20,}', '[REDACTED:xai-key]', 'None'),
  @('eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}', '[REDACTED:jwt]', 'None'),
  @('gh[pousr]_[A-Za-z0-9]{30,}', '[REDACTED:github-token]', 'None'),
  @('sbp_[A-Fa-f0-9]{30,}', '[REDACTED:supabase-token]', 'None'),
  @('((?:secret|token|password|passwd|api[_-]?key|private[_-]?key|service[_-]?role)[A-Za-z0-9_]*\s*[:=]\s*)([\x22\x27\x60])[^\x22\x27\x60\r\n]{16,}\2', '${1}${2}[REDACTED]${2}', 'IgnoreCase'),
  @('-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----', '[REDACTED:private-key-block]', 'None')
)
function Protect-Text([string]$text) {
  foreach ($r in $RedactRules) {
    $opt = [System.Text.RegularExpressions.RegexOptions]$r[2]
    $found = [regex]::Matches($text, $r[0], $opt)
    if ($found.Count -gt 0) { $script:Redactions += $found.Count; $text = [regex]::Replace($text, $r[0], $r[1], $opt) }
  }
  return $text
}

function Run-Git([string[]]$a) {
  try { return @(& git --no-pager --no-optional-locks -C $Root @a 2>&1 | ForEach-Object { "$_" }) }
  catch { return @("git failed: $($_.Exception.Message)") }
}

# ---------------- source file inventory ----------------
$excludeDirRx = '(^|/)(node_modules|\.next|\.git|\.vercel|dist|coverage|\.turbo|\.cache)(/|$)'
$textExt = @('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.sql', '.md', '.mdx')

$Groups = @(
  @('AI engine (src/lib/server/ai)',            '^src/lib/server/ai/'),
  @('Other AI/provider libraries',              '^src/lib/(ai|providers?)/|^src/lib/server/providers?/'),
  @('Provider catalog / models / status',       '(^|/)(providers?|catalog|models?|model-?catalog|provider-?status)[^/]*\.(ts|tsx|js|json)$|/providers?/|/models?/'),
  @('Encrypted key store / key manager',        'key-?store|keystore|api-?keys?|apikey|crypto|encrypt|secret|vault|/keys?/'),
  @('AI generation and related API routes',     '^src/app/api/.*(generate|metadata|prompt|analy|/ai[/-]|vision|retry|regenerate|provider|keys?|models?|fallback).*route\.(ts|js)$'),
  @('Other API routes',                         '^src/app/api/.*route\.(ts|js)$'),
  @('Metadata workspace',                       'metadata'),
  @('Image-to-prompt workspace',                'prompt'),
  @('Batch queue / retry / jobs / upload',      'batch|queue|retry|job|worker|concurren|chunk|upload|dropzone'),
  @('Conversion / validation / image prep',     'convert|conversion|(^|[^a-z])(eps|svg|psd)([^a-z]|$)|ghostscript|raster|image-?prep|prepare|sharp|pdf|validat|limits?|file-?type|mime|normali[sz]e'),
  @('Auth / history / rate limit / Supabase',   '^src/lib/.*(auth|admin|history|rate-?limit|supabase|session|origin)|^src/(middleware|proxy)\.(ts|js)$')
)
function Get-GroupName([string]$rel) {
  $l = $rel.ToLowerInvariant()
  if ($l -match '^src/components/ui/') { return $null }
  if ($l -match '(^|[._-])(bak|backup|old|orig)([._-]|$)') { return $null }
  foreach ($g in $Groups) { if ($l -match $g[1]) { return $g[0] } }
  return $null
}

$Files = New-Object System.Collections.Generic.List[object]
Get-ChildItem -LiteralPath (Join-Path $Root 'src') -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { (Rel $_.FullName) -notmatch $excludeDirRx } | ForEach-Object {
    $rel = Rel $_.FullName
    $ext = $_.Extension.ToLowerInvariant()
    $isText = (($textExt -contains $ext) -and ($_.Length -le 2000000) -and ($rel -notmatch '\.d\.ts$'))
    $Files.Add([pscustomobject]@{ Rel = $rel; Full = $_.FullName; Size = $_.Length; Ext = $ext; IsText = $isText; Group = (Get-GroupName $rel); Modified = $_.LastWriteTime })
  }

$LineCache = @{}
function Get-Lines($item) {
  if (-not $LineCache.ContainsKey($item.Rel)) {
    try { $LineCache[$item.Rel] = [System.IO.File]::ReadAllLines($item.Full, $Utf8) } catch { $LineCache[$item.Rel] = @() }
  }
  return ,$LineCache[$item.Rel]
}

function Search-Src([string]$title, [string]$pattern, [int]$perFile = 25) {
  Sec $title
  Ln "  pattern: $pattern"
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, 'IgnoreCase')
  $total = 0; $filesHit = 0
  foreach ($it in $Files) {
    if (-not $it.IsText) { continue }
    $lines = Get-Lines $it
    $hits = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($rx.IsMatch($lines[$i])) {
        $t = $lines[$i].Trim()
        if ($t.Length -gt 220) { $t = $t.Substring(0, 220) + ' ...[line cut for display]' }
        $hits.Add(('{0}: {1}' -f ($i + 1), $t))
      }
    }
    if ($hits.Count -gt 0) {
      $filesHit++; $total += $hits.Count
      Ln "  $($it.Rel)  [$($hits.Count) match(es)]"
      $show = [Math]::Min($perFile, $hits.Count)
      for ($k = 0; $k -lt $show; $k++) { Ln "      $($hits[$k])" }
      if ($hits.Count -gt $show) { Ln "      ... +$($hits.Count - $show) more matches in this file (not shown)" }
    }
  }
  Ln "  TOTAL: $total match(es) in $filesHit file(s)"
}

# ---------------- source blocks (full code, split safely) ----------------
$Blocks = New-Object System.Collections.Generic.List[string]
function Add-Block([string]$title, [string]$group, [string]$content) {
  $content = Protect-Text $content
  $lines = $content -split "`r?`n"
  $limit = $ChunkChars - 1500
  $segs = New-Object System.Collections.Generic.List[object]
  $sb = New-Object System.Text.StringBuilder
  $start = 1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ((($sb.Length + $lines[$i].Length + 1) -gt $limit) -and ($sb.Length -gt 0)) {
      $segs.Add(@($start, $i, $sb.ToString())); [void]$sb.Clear(); $start = $i + 1
    }
    [void]$sb.AppendLine($lines[$i])
  }
  $segs.Add(@($start, $lines.Count, $sb.ToString()))
  $n = $segs.Count; $idx = 0
  foreach ($sg in $segs) {
    $idx++
    $tag = ''
    if ($n -gt 1) { $tag = " | SEGMENT $idx/$n (lines $($sg[0])-$($sg[1]) of $($lines.Count))" }
    $Blocks.Add("######## FILE: $title | group: $group | $($lines.Count) lines$tag ########`n" + $sg[2].TrimEnd("`r", "`n") + "`n######## END: $title$tag ########`n")
  }
}

# ================= START OF SUMMARY =================
$Started = Get-Date
Ln 'METAFORGE AI PRO - INSPECTION REPORT (read-only, secrets redacted)'
Ln "Generated : $($Started.ToString('yyyy-MM-dd HH:mm:ss'))"
Ln "Root      : $Root"
Ln "PowerShell: $($PSVersionTable.PSVersion)"
Ln 'Note      : API keys, tokens and .env values are never printed. Matching patterns in source are replaced by [REDACTED...].'

Sec '1. ROOT VERIFICATION'
Ln "  Root exists and matches expected path: $Root"
Ln "  package.json name: $($pkg.name) | version: $($pkg.version) | next: $($pkg.dependencies.next)"
Ln "  package-lock.json present: $(Test-Path -LiteralPath (Join-Path $Root 'package-lock.json'))"
Ln "  node_modules present: $(Test-Path -LiteralPath (Join-Path $Root 'node_modules'))"
Ln "  Source files scanned under src/: $($Files.Count)"

# ---------------- 2. git ----------------
$statusBefore = ''
$headBefore = ''
try {
  Sec '2. GIT (read-only commands only)'
  $statusBefore = (Run-Git @('status', '--porcelain')) -join "`n"
  $headBefore = (Run-Git @('rev-parse', 'HEAD')) -join ''
  Ln '  git version:'; Run-Git @('--version') | ForEach-Object { Ln "    $_" }
  Ln '  top-level:';   Run-Git @('rev-parse', '--show-toplevel') | ForEach-Object { Ln "    $_" }
  Ln '  current branch:'; Run-Git @('rev-parse', '--abbrev-ref', 'HEAD') | ForEach-Object { Ln "    $_" }
  Ln '  HEAD:';        Run-Git @('rev-parse', '--short', 'HEAD') | ForEach-Object { Ln "    $_" }
  Ln '  status (short, with branch):'; Run-Git @('status', '--short', '--branch') | ForEach-Object { Ln "    $_" }
  Ln '  recent commits (15):'; Run-Git @('log', '--oneline', '--decorate', '-n', '15') | ForEach-Object { Ln "    $_" }
  Ln '  local branches:'; Run-Git @('branch', '--list') | ForEach-Object { Ln "    $_" }
  Ln '  stash entries:'; Run-Git @('stash', 'list') | ForEach-Object { Ln "    $_" }
  Ln '  diff --stat (unstaged):'; Run-Git @('diff', '--stat') | ForEach-Object { Ln "    $_" }
  Ln '  diff --stat (staged):'; Run-Git @('diff', '--cached', '--stat') | ForEach-Object { Ln "    $_" }
  Ln '  untracked files (respecting .gitignore):'; Run-Git @('ls-files', '--others', '--exclude-standard') | ForEach-Object { Ln "    $_" }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# changed entries (to include modified/untracked src files that no other group claims)
$changed = @()
try {
  $top = ''
  $topLine = Run-Git @('rev-parse', '--show-toplevel') | Select-Object -First 1
  if ($topLine) { $top = $topLine.Replace('\', '/').TrimEnd('/') }
  $rootFwd = $Root.Replace('\', '/')
  $prefix = ''
  if ($top -and ($rootFwd.Length -gt $top.Length) -and $rootFwd.StartsWith($top, 'OrdinalIgnoreCase')) { $prefix = $rootFwd.Substring($top.Length + 1) + '/' }
  foreach ($l in (Run-Git @('status', '--porcelain'))) {
    if ($l.Length -lt 4) { continue }
    $p = $l.Substring(3).Trim()
    if ($p -match ' -> ') { $p = ($p -split ' -> ')[-1] }
    $p = $p.Trim('"')
    if ($prefix -and $p.StartsWith($prefix, 'OrdinalIgnoreCase')) { $p = $p.Substring($prefix.Length) }
    $changed += $p
  }
} catch { }
$WTG = 'Working-tree changed (not otherwise grouped)'
foreach ($it in $Files) {
  if ($it.Group -or -not $it.IsText) { continue }
  if ($it.Rel -match '(^|[._-])(bak|backup|old|orig)([._-]|$)') { continue }
  foreach ($c in $changed) {
    if (($c -eq $it.Rel) -or ($c.EndsWith('/') -and $it.Rel.StartsWith($c))) { $it.Group = $WTG; break }
  }
}
$GroupOrder = @($Groups | ForEach-Object { $_[0] }) + $WTG

# ---------------- 3. package ----------------
try {
  Sec '3. PACKAGE.JSON SUMMARY'
  Ln "  packageManager: $($pkg.packageManager)"
  if ($pkg.engines) { Ln '  engines:'; foreach ($p in $pkg.engines.PSObject.Properties) { Ln ("    {0}: {1}" -f $p.Name, $p.Value) } }
  if ($pkg.scripts) { Ln '  scripts:'; foreach ($p in $pkg.scripts.PSObject.Properties) { Ln ("    {0}: {1}" -f $p.Name, $p.Value) } }
  $allDeps = @{}
  Ln '  dependencies:'
  if ($pkg.dependencies) { foreach ($p in $pkg.dependencies.PSObject.Properties) { Ln ("    {0} {1}" -f $p.Name, $p.Value); $allDeps[$p.Name] = 'dep' } }
  Ln '  devDependencies:'
  if ($pkg.devDependencies) { foreach ($p in $pkg.devDependencies.PSObject.Properties) { Ln ("    {0} {1}" -f $p.Name, $p.Value); $allDeps[$p.Name] = 'dev' } }
  Ln '  key packages relevant to this task:'
  $keyPk = @('sharp','@google/genai','@google/generative-ai','openai','@anthropic-ai/sdk','groq-sdk','zod','pdfjs-dist','pdf-lib','@resvg/resvg-js','svgo','dompurify','isomorphic-dompurify','jsdom','jszip','p-limit','p-queue','@supabase/supabase-js','@supabase/ssr','@vercel/blob','@aws-sdk/client-s3','tus-js-client','ag-psd','gifuct-js','@imgly/background-removal','onnxruntime-web','typescript','eslint','vitest','jest','@playwright/test')
  foreach ($k in $keyPk) {
    $inNm = Test-Path -LiteralPath (Join-Path $Root ('node_modules/' + $k))
    Ln ("    {0,-28} in package.json: {1,-4} in node_modules: {2}" -f $k, [bool]$allDeps.ContainsKey($k), $inNm)
  }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 4. env (names + SET/EMPTY only) ----------------
$envDefined = @{}
try {
  Sec '4. ENVIRONMENT VARIABLES (names and SET/EMPTY only - values are never read into the report)'
  $envFiles = @(Get-ChildItem -LiteralPath $Root -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.env*' })
  if ($envFiles.Count -eq 0) { Ln '  (no .env* files found in project root)' }
  foreach ($f in $envFiles) {
    Ln "  FILE: $($f.Name)"
    try { $envLines = [System.IO.File]::ReadAllLines($f.FullName) } catch { Ln '    (unreadable)'; continue }
    foreach ($line in $envLines) {
      if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
        $vn = $Matches[1]; $vv = $Matches[2].Trim()
        if (($vv.Length -ge 2) -and (($vv.StartsWith('"') -and $vv.EndsWith('"')) -or ($vv.StartsWith("'") -and $vv.EndsWith("'")))) { $vv = $vv.Substring(1, $vv.Length - 2) }
        $state = 'EMPTY'; if ($vv.Length -gt 0) { $state = 'SET' }
        Ln ("    {0,-44} {1}" -f $vn, $state)
        if (-not $envDefined.ContainsKey($vn)) { $envDefined[$vn] = New-Object System.Collections.Generic.List[string] }
        $envDefined[$vn].Add("$($f.Name)=$state")
      }
    }
  }
  Ln ''
  Ln '  Environment variables referenced by source code (process.env.NAME):'
  $envRefs = @{}
  $envRx = New-Object System.Text.RegularExpressions.Regex('process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*[\x22\x27]([A-Z][A-Z0-9_]*)[\x22\x27]\s*\]')
  foreach ($it in $Files) {
    if (-not $it.IsText) { continue }
    $txt = [string]::Join("`n", (Get-Lines $it))
    foreach ($mm in $envRx.Matches($txt)) {
      $vn = $mm.Groups[1].Value; if (-not $vn) { $vn = $mm.Groups[2].Value }
      if (-not $envRefs.ContainsKey($vn)) { $envRefs[$vn] = New-Object System.Collections.Generic.List[string] }
      if (-not $envRefs[$vn].Contains($it.Rel)) { $envRefs[$vn].Add($it.Rel) }
    }
  }
  foreach ($vn in ($envRefs.Keys | Sort-Object)) {
    $defs = 'not in any .env file'; if ($envDefined.ContainsKey($vn)) { $defs = ($envDefined[$vn] -join ', ') }
    $shell = 'unset'; if ([Environment]::GetEnvironmentVariable($vn)) { $shell = 'SET' }
    Ln ("    {0,-40} files={1,-3} env-files: {2} | current shell: {3}" -f $vn, $envRefs[$vn].Count, $defs, $shell)
  }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 5. routes and pages ----------------
try {
  Sec '5. API ROUTES SUMMARY (methods, runtime config, guard hints)'
  foreach ($it in ($Files | Where-Object { $_.Rel -match '^src/app/api/.*route\.(ts|js)$' } | Sort-Object Rel)) {
    $txt = [string]::Join("`n", (Get-Lines $it))
    $methods = (([regex]::Matches($txt, 'export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique) -join ',')
    $cfg = (([regex]::Matches($txt, 'export\s+const\s+(maxDuration|runtime|dynamic|preferredRegion)\s*=\s*([^;\r\n]+)') | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value.Trim())" }) -join '; ')
    $flags = @()
    if ($txt -match 'getUser|getSession|requireAuth|requireUser|currentUser|withAuth') { $flags += 'auth' }
    if ($txt -match 'rate-?limit') { $flags += 'ratelimit' }
    if ($txt -match 'origin') { $flags += 'origin' }
    if ($txt -match 'gemini') { $flags += 'gemini' }
    if ($txt -match 'openai') { $flags += 'openai' }
    if ($txt -match 'anthropic') { $flags += 'anthropic' }
    if ($txt -match '\bgroq\b') { $flags += 'groq' }
    if ($txt -match '\bxai\b|grok') { $flags += 'xai' }
    $url = $it.Rel.Substring(7); $url = $url -replace '/route\.(ts|js)$', ''
    Ln ("  /{0,-46} [{1}] {2} lines | {3} | hints: {4}" -f $url, $methods, (Get-Lines $it).Count, $cfg, ($flags -join ','))
  }
  Sec '5b. PAGES AND LAYOUTS (src/app, excluding api)'
  foreach ($it in ($Files | Where-Object { $_.Rel -match '^src/app/.*(page|layout)\.(tsx|ts|jsx|js)$' -and $_.Rel -notmatch '^src/app/api/' } | Sort-Object Rel)) {
    Ln ("  {0,-70} {1} lines, modified {2}" -f $it.Rel, (Get-Lines $it).Count, $it.Modified.ToString('yyyy-MM-dd HH:mm'))
  }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 6. AI engine / failover installer ----------------
$installerFound = @()
try {
  Sec '6. AI ENGINE DIRECTORIES AND install-failover.ps1'
  foreach ($d in 'src/lib/server/ai', 'src/lib/ai', 'src/lib/providers', 'src/lib/server/providers') {
    $p = Join-Path $Root $d
    $ex = Test-Path -LiteralPath $p -PathType Container
    Ln "  $d exists: $ex"
    if ($ex) {
      Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { Ln ("      {0}  ({1} bytes, modified {2})" -f (Rel $_.FullName), $_.Length, $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')) }
    }
  }
  $roots = @($Root, (Split-Path $Root -Parent), (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Documents'))
  foreach ($r in $roots) {
    if (Test-Path -LiteralPath $r) {
      $installerFound += @(Get-ChildItem -LiteralPath $r -Recurse -Depth 2 -File -Filter 'install-failover*' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules' })
    }
  }
  $installerFound = @($installerFound | Sort-Object FullName -Unique)
  if ($installerFound.Count -eq 0) { Ln '  install-failover.ps1: NOT FOUND in project, parent folder, Downloads, Desktop or Documents' }
  foreach ($f in $installerFound) { Ln ("  install-failover file: {0}  ({1} bytes, modified {2})" -f $f.FullName, $f.Length, $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')) }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 7. searches ----------------
try {
  Search-Src '7a. FILE-COUNT / FILE-SIZE / BATCH LIMITS (100 files, 20 MB, maxDuration, slice caps)' '20\s*\*\s*1024\s*\*\s*1024|20971520|\b20\s?MB\b|MAX_(FILE|FILES|UPLOAD|BATCH|SIZE|IMAGES|ITEMS|CONCURRENCY)\w*|\bmax(Files|FileSize|FileBytes|Upload|Batch|Items|Images|Size)\b|\b100\s*(files|images|items)|up to 100|\bbodySizeLimit\b|\bmaxDuration\b|\bsizeLimit\b|\.slice\(\s*0\s*,\s*\d+\s*\)|files\.length\s*(>|>=)\s*\d+' 30
  Search-Src '7b. "NOT AVAILABLE YET" AND UNFINISHED MARKERS' 'not available yet|coming soon|not yet (available|implemented)|not implemented|\bTODO\b|\bFIXME\b|\bstub\b' 30
  Search-Src '7c. THE THREE TOGGLES (Auto Fallback / Generate Metadata First / Analyze Image)' 'auto ?fallback|generate ?metadata ?first|metadata ?first|analy[sz]e ?image|analy[sz]eImage|best ?output' 30
  Search-Src '7d. GEMINI-SPECIFIC CHECKS AND HARD-CODED GEMINI USAGE' 'provider\s*(!==?|===?)\s*[\x22\x27](gemini|google)[\x22\x27]|only gemini|gemini only|requires? (a )?gemini|GEMINI_API_KEY|@google/genai|@google/generative-ai|\bgemini-[0-9a-z.\-]+|callGemini|getGemini|geminiKey' 30
  Search-Src '7e. PROVIDER ENDPOINTS REFERENCED IN CODE' 'generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.x\.ai|api\.groq\.com' 20
  Search-Src '7f. RETRY / REGENERATE LOGIC' 'retryFailed|retry failed|handleRetry|onRetry|retryItem|regenerate|retryCount|attempts' 15
  Search-Src '7g. CONVERSION / PROCESS-SPAWNING CODE (Ghostscript, sharp, svg, pdf)' 'ghostscript|gswin|\bgs\b|child_process|execFile|spawn|from .sharp.|resvg|pdfjs|rasteri[sz]e|ImageMagick' 20
  Search-Src '7h. DATABASE TABLE / RPC / STORAGE USAGE' '\.from\(\s*[\x22\x27]|\.rpc\(|\.storage\b' 15
  Sec '7i. PROVIDER MENTION COUNTS PER FILE'
  $provRx = [ordered]@{ gemini = 'gemini|generativelanguage|@google/gen'; openai = 'openai'; anthropic = 'anthropic|claude'; xai = '\bxai\b|\bgrok\b|api\.x\.ai'; groq = '\bgroq\b' }
  foreach ($it in $Files) {
    if (-not $it.IsText) { continue }
    $txt = [string]::Join("`n", (Get-Lines $it))
    $parts = @(); $any = $false
    foreach ($k in $provRx.Keys) {
      $cnt = [regex]::Matches($txt, $provRx[$k], 'IgnoreCase').Count
      if ($cnt -gt 0) { $any = $true }
      $parts += "$k=$cnt"
    }
    if ($any) { Ln ("  {0,-72} {1}" -f $it.Rel, ($parts -join ' ')) }
  }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 8. conversion tools ----------------
try {
  Sec '8. INSTALLED CONVERSION AND BUILD TOOLS'
  function Probe([string]$name, [string[]]$verArgs) {
    $c = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { Ln ("  {0,-12} not found on PATH" -f $name); return }
    $exe = $c.Source; if (-not $exe) { $exe = $c.Name }
    $v = ''
    try { $v = (& $exe @verArgs 2>&1 | Select-Object -First 1 | ForEach-Object { "$_" }) } catch { $v = '(version check failed)' }
    Ln ("  {0,-12} {1}   [{2}]" -f $name, $v, $exe)
  }
  Probe 'node' @('-v'); Probe 'npm' @('-v'); Probe 'npx' @('-v'); Probe 'git' @('--version'); Probe 'vercel' @('--version')
  Probe 'gs' @('--version'); Probe 'gswin64c' @('--version'); Probe 'gswin32c' @('--version')
  Probe 'magick' @('-version'); Probe 'pdftoppm' @('-v'); Probe 'pdftocairo' @('-v'); Probe 'inkscape' @('--version'); Probe 'python' @('--version')
  Ln '  Ghostscript install folders:'
  foreach ($gsRoot in 'C:\Program Files\gs', 'C:\Program Files (x86)\gs') {
    if (Test-Path -LiteralPath $gsRoot) { Get-ChildItem -LiteralPath $gsRoot -Recurse -Depth 3 -File -Filter 'gswin*c.exe' -ErrorAction SilentlyContinue | ForEach-Object { Ln "    $($_.FullName)" } }
  }
  Ln '  ImageMagick install folders:'
  Get-ChildItem -LiteralPath 'C:\Program Files' -Directory -Filter 'ImageMagick*' -ErrorAction SilentlyContinue | ForEach-Object { Ln "    $($_.FullName)" }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 9. loose files, backups, reports ----------------
try {
  Sec '9. ROOT AND PARENT FOLDER LISTING (names only, to see backups / scripts / reports)'
  foreach ($dir in @($Root, (Split-Path $Root -Parent))) {
    Ln "  FOLDER: $dir"
    Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @('node_modules', '.next', '.git') } | Sort-Object PSIsContainer, Name | ForEach-Object {
      $kind = 'file'; $size = "$($_.Length) bytes"
      if ($_.PSIsContainer) { $kind = 'dir '; $size = '' }
      Ln ("    {0} {1,-60} {2,-14} {3}" -f $kind, $_.Name, $size, $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
    }
  }
  Ln '  Backup-like files inside src/:'
  $bk = @($Files | Where-Object { $_.Rel -match '(^|[._-])(bak|backup|old|orig)([._-]|$)' })
  if ($bk.Count -eq 0) { Ln '    (none)' }
  foreach ($it in $bk) { Ln "    $($it.Rel) ($($it.Size) bytes)" }
  $supa = Join-Path $Root 'supabase'
  if (Test-Path -LiteralPath $supa) {
    Ln '  supabase/ folder contents:'
    Get-ChildItem -LiteralPath $supa -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { Ln ("    {0} ({1} bytes)" -f (Rel $_.FullName), $_.Length) }
  } else { Ln '  supabase/ folder: not present in project root' }
} catch { Ln "  SECTION ERROR: $($_.Exception.Message)" }

# ---------------- 10. file index ----------------
Sec '10. COMPLETE src/ FILE INDEX (path | bytes | group included in source parts)'
foreach ($it in ($Files | Sort-Object Rel)) {
  $g = '(listed only)'; if ($it.Group) { $g = $it.Group }
  Ln ("  {0,-78} {1,9}  {2}" -f $it.Rel, $it.Size, $g)
}

# ---------------- source blocks ----------------
$skipped = New-Object System.Collections.Generic.List[string]
$cfgNames = @('package.json', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'vercel.json', 'tsconfig.json', 'eslint.config.mjs', 'eslint.config.js', '.eslintrc.json', 'middleware.ts', 'proxy.ts')
foreach ($n in $cfgNames) {
  $p = Join-Path $Root $n
  if (Test-Path -LiteralPath $p -PathType Leaf) { Add-Block $n 'Project configuration' ([System.IO.File]::ReadAllText($p, $Utf8)) }
}
foreach ($f in $installerFound | Select-Object -First 1) {
  if ($f.Length -le $MaxFileBytes) { Add-Block $f.Name 'Previously applied installer (install-failover)' ([System.IO.File]::ReadAllText($f.FullName, $Utf8)) } else { $skipped.Add("$($f.FullName) ($($f.Length) bytes)") }
}
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $Root 'supabase') -Recurse -File -Filter '*.sql' -ErrorAction SilentlyContinue | Select-Object -First 60)) {
  if ($f.Length -le $MaxFileBytes) { Add-Block (Rel $f.FullName) 'Database migrations' ([System.IO.File]::ReadAllText($f.FullName, $Utf8)) } else { $skipped.Add("$($f.FullName) ($($f.Length) bytes)") }
}
foreach ($gname in $GroupOrder) {
  foreach ($it in ($Files | Where-Object { $_.Group -eq $gname -and $_.IsText } | Sort-Object Rel)) {
    if ($it.Size -gt $MaxFileBytes) { $skipped.Add("$($it.Rel) ($($it.Size) bytes)"); continue }
    Add-Block $it.Rel $gname ([System.IO.File]::ReadAllText($it.Full, $Utf8))
  }
}
try {
  $diffNames = @((Run-Git @('diff', 'HEAD', '--relative', '--name-only')) | Where-Object { $_ -and $_ -notmatch '^git failed' } | Select-Object -First 40)
  foreach ($dn in $diffNames) {
    $d = (Run-Git @('diff', 'HEAD', '--relative', '--', $dn)) -join "`n"
    Add-Block "DIFF vs HEAD: $dn" 'Uncommitted changes (git diff)' $d
  }
} catch { }

Sec '11. FILES NOT INCLUDED IN SOURCE PARTS BECAUSE THEY EXCEED THE SIZE CAP'
if ($skipped.Count -eq 0) { Ln '  (none - every grouped file is included in full)' } else { foreach ($s in $skipped) { Ln "  $s   -> ask for a targeted line range" } }

# ---------------- integrity check ----------------
$statusAfter = (Run-Git @('status', '--porcelain')) -join "`n"
$headAfter = (Run-Git @('rev-parse', 'HEAD')) -join ''
Sec '12. READ-ONLY INTEGRITY CHECK'
Ln "  Working tree status identical before/after: $($statusBefore -eq $statusAfter)"
Ln "  HEAD identical before/after: $($headBefore -eq $headAfter)"

# ---------------- write report + parts ----------------
$summaryText = Protect-Text $Sum.ToString()
$summaryText += "`nRedactions applied across the whole report: $script:Redactions`n"

function Split-Lines([string]$text, [int]$limit) {
  $out = New-Object System.Collections.Generic.List[string]
  $sb = New-Object System.Text.StringBuilder
  foreach ($ln in ($text -split "`r?`n")) {
    if ((($sb.Length + $ln.Length + 1) -gt $limit) -and ($sb.Length -gt 0)) { $out.Add($sb.ToString()); [void]$sb.Clear() }
    [void]$sb.AppendLine($ln)
  }
  if ($sb.Length -gt 0) { $out.Add($sb.ToString()) }
  return ,$out
}
$sumChunks = Split-Lines $summaryText $ChunkChars
$srcChunks = New-Object System.Collections.Generic.List[string]
$cur = New-Object System.Text.StringBuilder
foreach ($b in $Blocks) {
  if ((($cur.Length + $b.Length) -gt $ChunkChars) -and ($cur.Length -gt 0)) { $srcChunks.Add($cur.ToString()); [void]$cur.Clear() }
  [void]$cur.Append($b + "`n")
}
if ($cur.Length -gt 0) { $srcChunks.Add($cur.ToString()) }

New-Item -ItemType Directory -Force -Path $PartsDir | Out-Null
Get-ChildItem -LiteralPath $PartsDir -Filter 'part-*.txt' -ErrorAction SilentlyContinue | Remove-Item -Force
$total = $sumChunks.Count + $srcChunks.Count
$num = 0
$written = @()
foreach ($c in $sumChunks) {
  $num++; $path = Join-Path $PartsDir ('part-{0:D2}-of-{1:D2}-summary.txt' -f $num, $total)
  [System.IO.File]::WriteAllText($path, ("=== METAFORGE INSPECTION PART $num/$total (SUMMARY) ===`n" + $c), $Utf8); $written += $path
}
foreach ($c in $srcChunks) {
  $num++; $path = Join-Path $PartsDir ('part-{0:D2}-of-{1:D2}-source.txt' -f $num, $total)
  [System.IO.File]::WriteAllText($path, ("=== METAFORGE INSPECTION PART $num/$total (SOURCE CODE) ===`n" + $c), $Utf8); $written += $path
}
$all = New-Object System.Text.StringBuilder
[void]$all.Append($summaryText)
foreach ($c in $srcChunks) { [void]$all.Append($c) }
[System.IO.File]::WriteAllText($Report, $all.ToString(), $Utf8)

Write-Host ''
Write-Host 'Inspection finished. Nothing in the project was modified.' -ForegroundColor Green
Write-Host "Full report : $Report ($([math]::Round((Get-Item -LiteralPath $Report).Length / 1KB, 1)) KB)"
Write-Host "Split parts : $PartsDir ($total file(s), each at most about $([math]::Round($ChunkChars / 1000)) KB)"
foreach ($w in $written) { Write-Host ("   {0}  {1} KB" -f (Split-Path $w -Leaf), [math]::Round((Get-Item -LiteralPath $w).Length / 1KB, 1)) }
Write-Host "Redactions applied: $script:Redactions"
Write-Host "Integrity: working tree unchanged = $($statusBefore -eq $statusAfter)"
'@
[System.IO.File]::WriteAllText($dest, $code, (New-Object System.Text.UTF8Encoding($true)))
powershell -NoProfile -ExecutionPolicy Bypass -File $dest