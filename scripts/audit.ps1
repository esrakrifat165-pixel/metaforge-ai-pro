param([string]$Label = "run")

$ErrorActionPreference = "Continue"
$root = (Get-Location).Path
$out = Join-Path $root "audit.txt"

function Add-Line([string]$text) { Add-Content -Path $out -Value $text }
function Add-Section([string]$title) { Add-Line ""; Add-Line "==== $title ====" }

Add-Line ""
Add-Line ("######## AUDIT [{0}] {1} ########" -f $Label, (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Add-Line "Project: $root"

$results = [ordered]@{}

# Runs a command, records real output and exit code. Output is filtered for obvious secret patterns.
function Invoke-Check([string]$name, [string]$display, [scriptblock]$command) {
  Add-Section $name
  Add-Line "Command: $display"
  $text = ""
  try {
    $text = (& $command 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } catch {
    $text = $_.Exception.Message
    $code = 1
  }
  $text = $text -replace '(?i)(api[_-]?key|secret|token|password|service[_-]?role)\s*[=:]\s*\S+', '$1=[REDACTED]'
  $text = $text -replace 'AIza[0-9A-Za-z_\-]{20,}', '[REDACTED]'
  $text = $text -replace 'eyJ[0-9A-Za-z_\-\.]{30,}', '[REDACTED]'
  Add-Line $text
  $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
  Add-Line "Exit code: $code"
  Add-Line "RESULT: $status"
  $results[$name] = "$status (exit $code)"
}

function Mark-NotRun([string]$name, [string]$reason) {
  Add-Section $name
  Add-Line "RESULT: NOT RUN - $reason"
  $results[$name] = "NOT RUN ($reason)"
}

# 1. Node and npm
Add-Section "1. Node.js and npm"
$nodeOk = $false
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($node) { Add-Line ("node " + (& node -v)); $nodeOk = $true } else { Add-Line "node: NOT FOUND" }
if ($npm)  { Add-Line ("npm " + (& npm -v)) } else { Add-Line "npm: NOT FOUND" }
$results["Node.js and npm"] = $(if ($node -and $npm) { "PASS" } else { "FAIL (missing)" })

# 2. package.json and package manager
Add-Section "2. package.json and package manager"
$pkgPath = Join-Path $root "package.json"
$scripts = @{}
$pm = "npm"
if (Test-Path $pkgPath) {
  try {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if ($pkg.scripts) { $pkg.scripts.PSObject.Properties | ForEach-Object { $scripts[$_.Name] = $_.Value } }
    Add-Line "package name: $($pkg.name)"
    Add-Line "scripts found:"
    if ($scripts.Count -eq 0) { Add-Line "  (none)" } else { $scripts.GetEnumerator() | Sort-Object Name | ForEach-Object { Add-Line ("  {0} = {1}" -f $_.Key, $_.Value) } }
  } catch { Add-Line "package.json could not be parsed: $($_.Exception.Message)" }
} else { Add-Line "package.json: NOT FOUND" }

if (Test-Path (Join-Path $root "pnpm-lock.yaml")) { $pm = "pnpm" }
elseif (Test-Path (Join-Path $root "yarn.lock")) { $pm = "yarn" }
elseif (Test-Path (Join-Path $root "bun.lockb")) { $pm = "bun" }
elseif (Test-Path (Join-Path $root "package-lock.json")) { $pm = "npm" }
Add-Line "Detected package manager (from lockfile): $pm"
$pmCmd = Get-Command $pm -ErrorAction SilentlyContinue
if (-not $pmCmd) { Add-Line "WARNING: $pm is not installed; checks will use npm if available."; $pm = "npm" }

Add-Section "node_modules"
if (Test-Path (Join-Path $root "node_modules")) { Add-Line "node_modules: present" } else { Add-Line "node_modules: MISSING (checks below will likely fail; this audit does not install packages)" }

# 3. Checks
if (-not $nodeOk -or -not $npm) {
  Mark-NotRun "TypeScript" "Node.js or npm not available"
  Mark-NotRun "Lint" "Node.js or npm not available"
  Mark-NotRun "Production build" "Node.js or npm not available"
} else {
  $tsScript = @("typecheck","type-check","tsc") | Where-Object { $scripts.ContainsKey($_) } | Select-Object -First 1
  if ($tsScript) {
    Invoke-Check "TypeScript" "$pm run $tsScript" { & $pm run $tsScript }
  } elseif (Test-Path (Join-Path $root "tsconfig.json")) {
    Invoke-Check "TypeScript" "npx tsc --noEmit (no typecheck script in package.json; tsconfig.json exists)" { & npx tsc --noEmit }
  } else {
    Mark-NotRun "TypeScript" "no typecheck script and no tsconfig.json"
  }

  if ($scripts.ContainsKey("lint")) {
    Invoke-Check "Lint" "$pm run lint" { & $pm run lint }
  } else {
    Mark-NotRun "Lint" "no 'lint' script in package.json"
  }

  if ($scripts.ContainsKey("build")) {
    Invoke-Check "Production build" "$pm run build" { & $pm run build }
  } else {
    Mark-NotRun "Production build" "no 'build' script in package.json"
  }
}

# 5. Git status (read-only)
Add-Section "5. Git working tree (read-only)"
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  $inside = (& git rev-parse --is-inside-work-tree 2>&1 | Out-String).Trim()
  if ($inside -eq "true") {
    Add-Line "Branch: $((& git rev-parse --abbrev-ref HEAD 2>&1 | Out-String).Trim())"
    Add-Line "git status --short:"
    $status = (& git status --short 2>&1 | Out-String)
    if ($status.Trim()) { Add-Line $status } else { Add-Line "(clean)" }
    Add-Line "Last 3 commits:"
    Add-Line (& git log --oneline -3 2>&1 | Out-String)
    $results["Git status"] = "READ"
  } else { Add-Line "Not a git repository."; $results["Git status"] = "NOT RUN (not a git repo)" }
} else { Add-Line "git not found."; $results["Git status"] = "NOT RUN (git not installed)" }

# Env file: variable NAMES only
Add-Section "Environment variable names (values never printed)"
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
  Get-Content $envFile | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { Add-Line (($_ -split '=')[0].Trim()) }
} else { Add-Line ".env.local not found" }

# Summary
Add-Section "SUMMARY"
foreach ($k in $results.Keys) { Add-Line ("{0}: {1}" -f $k, $results[$k]) }

Add-Section "NOT VERIFIED (needs a browser, account or credentials)"
Add-Line "- Google sign-in/sign-out, admin-only access, saved keys, real Gemini generation, History, Vercel deployment"

Write-Host "Wrote $out"