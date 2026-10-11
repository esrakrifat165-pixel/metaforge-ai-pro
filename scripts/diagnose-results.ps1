param([switch]$Fix)

# Finds out why "All Image Results" does not show one large row per image.
# Without -Fix it only reads files. With -Fix it makes one safe change (a stylesheet import,
# after backing the file up to .recovery\) and then runs tsc, lint and build.
# Never touches .env.local, never deletes files, never commits or pushes.

$ErrorActionPreference = "Continue"
$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root "package.json"))) {
  Write-Host "Run this from the project root (the folder that contains package.json)."
  exit 1
}

$report = Join-Path $root "results-diagnosis.txt"
$recovery = Join-Path $root ".recovery"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$strict = New-Object System.Text.UTF8Encoding($false, $true)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Set-Content -Path $report -Value ("Results diagnosis " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding ASCII
function Log([string]$line) {
  Add-Content -Path $report -Value $line -Encoding ASCII
  Write-Host $line
}

$metaPath = Join-Path $root "src\components\metadata\MetadataWorkspace.tsx"
$genCss = Join-Path $root "src\components\metadata\generate.css"
$rowsCss = Join-Path $root "src\components\metadata\result-rows.css"

function Read-Utf8([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "file not found" } }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -eq 0) { return @{ ok = $false; reason = "file is empty" } }
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
    return @{ ok = $false; reason = "UTF-16 (run scripts\recover-encoding.ps1 -Apply first)" }
  }
  $start = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $start = 3 }
  try { $text = $strict.GetString($bytes, $start, $bytes.Length - $start) }
  catch { return @{ ok = $false; reason = "not valid UTF-8 (run scripts\recover-encoding.ps1 -Apply first)" } }
  return @{ ok = $true; text = $text; bytes = $bytes.Length }
}

function Line-Numbers([string]$text, [string]$needle) {
  $found = @()
  $n = 0
  foreach ($line in ($text -split "`n")) {
    $n++
    if ($line.Contains($needle)) { $found += $n }
  }
  return $found
}

function Depth-At([string]$text, [int]$index) {
  $depth = 0
  for ($i = 0; $i -lt $index; $i++) {
    $c = $text[$i]
    if ($c -eq '{' -or $c -eq '(') { $depth++ }
    elseif ($c -eq '}' -or $c -eq ')') { $depth-- }
  }
  return $depth
}

function Show-Lines([string]$label, $numbers) {
  if (@($numbers).Count -eq 0) { Log ("  {0}: not found" -f $label) }
  else { Log ("  {0}: line {1}" -f $label, (@($numbers) -join ", ")) }
}

Log ""
Log "== Encoding =="
$meta = Read-Utf8 $metaPath
if (-not $meta.ok) {
  Log ("  MetadataWorkspace.tsx: PROBLEM - " + $meta.reason)
  Log "STOPPED: fix the encoding first."
  exit 1
}
Log ("  MetadataWorkspace.tsx: valid UTF-8, {0} bytes" -f $meta.bytes)
$text = $meta.text

Log ""
Log "== What the component contains =="
$sectionCount = ([regex]::Matches($text, 'id="mw-all-title"')).Count
Log ("  'All Image Results' sections: {0}" -f $sectionCount)
Show-Lines "section heading (mw-all-title)" (Line-Numbers $text 'mw-all-title')
Show-Lines "section condition" (Line-Numbers $text 'items.length > 0 && resultTab')
Show-Lines "resultTab state" (Line-Numbers $text 'useState<ResultTab>')
Show-Lines "upload and settings grid (mw-grid)" (Line-Numbers $text 'className="mw-grid"')
Show-Lines "action bar (mw-bottom)" (Line-Numbers $text 'className="mw-bottom"')
Show-Lines "queue hook" (Line-Numbers $text 'useMetadataQueue(')
Show-Lines "metaById state" (Line-Numbers $text 'const [metaById')
Show-Lines "result handler" (Line-Numbers $text 'const handleResult')

$byId = [regex]::IsMatch($text, 'const handleResult[\s\S]{0,400}\[id\]')
Log ("  results are stored under the image id ([id]) in handleResult: {0}" -f $byId)
$readsById = $text.Contains('metaById[item.id]')
Log ("  rows read results with metaById[item.id]: {0}" -f $readsById)

Log ""
Log "== Is the section where it can be seen? =="
$sectionVerdict = "missing"
if ($sectionCount -eq 0) {
  Log "  The section is NOT in this file. This is the cause: there is nothing to render."
} elseif ($sectionCount -gt 1) {
  $sectionVerdict = "duplicate"
  Log "  The section appears more than once. Remove the duplicate."
} else {
  $startMarker = '{items.length > 0 && resultTab === "metadata" ?'
  $startIndex = $text.IndexOf($startMarker)
  if ($startIndex -lt 0) { $startIndex = $text.IndexOf('id="mw-all-title"') }
  $bottomIndex = $text.IndexOf('<div className="mw-bottom">')
  $gridIndex = $text.IndexOf('<div className="mw-grid">')
  if ($bottomIndex -lt 0 -or $gridIndex -lt 0) {
    $sectionVerdict = "unknown"
    Log "  Could not find the grid or the action bar to compare against."
  } else {
    $d1 = Depth-At $text $startIndex
    $d2 = Depth-At $text $bottomIndex
    $d3 = Depth-At $text $gridIndex
    Log ("  nesting depth - section: {0}, action bar: {1}, upload grid: {2}" -f $d1, $d2, $d3)
    $before = ($startIndex -lt $bottomIndex)
    Log ("  section comes before the action bar: {0}" -f $before)
    if ($d1 -eq $d2 -and $d2 -eq $d3 -and $before) {
      $sectionVerdict = "ok"
      Log "  The section sits at the same level as the other blocks, so no condition hides it except resultTab."
    } else {
      $sectionVerdict = "nested"
      Log "  The section is nested at a different level (for example inside the selected-image branch)."
      Log "  That would hide it. This is a likely cause."
    }
  }
}

Log ""
Log "== Styles =="
$rowsExists = Test-Path -LiteralPath $rowsCss
Log ("  result-rows.css exists: {0}" -f $rowsExists)
$singleColumn = $false
if ($rowsExists) {
  $rows = Read-Utf8 $rowsCss
  if ($rows.ok) { $singleColumn = [regex]::IsMatch($rows.text, '\.mw-rc-list[\s\S]{0,160}grid-template-columns:\s*minmax\(0,\s*1fr\)') }
}
Log ("  result-rows.css makes the list single-column: {0}" -f $singleColumn)

$importers = @(Get-ChildItem -Path (Join-Path $root "src") -Recurse -Include *.ts, *.tsx | Select-String -Pattern 'result-rows\.css' | ForEach-Object { $_.Path.Substring($root.Length + 1) })
if ($importers.Count -eq 0) { Log "  result-rows.css is imported by: nothing" } else { Log ("  result-rows.css is imported by: " + ($importers -join ", ")) }

$oldGrid = @(Get-ChildItem -Path (Join-Path $root "src") -Recurse -Include *.css | Select-String -Pattern 'mw-rc-grid' | ForEach-Object { "{0}:{1}" -f $_.Path.Substring($root.Length + 1), $_.LineNumber })
if ($oldGrid.Count -eq 0) { Log "  old multi-column rules (mw-rc-grid): none" } else { Log ("  old multi-column rules (mw-rc-grid): " + ($oldGrid -join ", ")) }

$genRc = @()
if (Test-Path -LiteralPath $genCss) { $genRc = @(Select-String -Path $genCss -Pattern 'mw-rc' | ForEach-Object { $_.LineNumber }) }
Log ("  generate.css lines mentioning mw-rc: {0}" -f $(if ($genRc.Count -eq 0) { "none" } else { $genRc -join ", " }))

$componentImports = $text.Contains('result-rows.css')
Log ("  MetadataWorkspace.tsx imports result-rows.css itself: {0}" -f $componentImports)

# ------------------------------------------------------------- verdict
Log ""
Log "== Verdict =="
if ($sectionVerdict -eq "missing") {
  Log "CAUSE: the All Image Results section is not in MetadataWorkspace.tsx."
  Log "FIX: run  powershell -ExecutionPolicy Bypass -File scripts\result-rows.ps1  (it adds the section above the action bar, writes the stylesheet and runs the checks)."
} elseif ($sectionVerdict -eq "duplicate" -or $sectionVerdict -eq "nested" -or $sectionVerdict -eq "unknown") {
  Log "CAUSE: the section exists but is duplicated or placed where it may be hidden."
  Log "FIX: send me results-diagnosis.txt (the report only). I will give you the exact move."
} elseif (-not $rowsExists) {
  Log "CAUSE: the section exists, but the stylesheet that makes full-width rows was never written."
  Log "FIX: run  scripts\result-rows.ps1  (it is safe to run when the section already exists)."
} elseif (-not $componentImports -and $importers.Count -eq 0) {
  Log "CAUSE: the section and stylesheet exist, but nothing imports the stylesheet, so the rows are unstyled."
  Log "FIX: run this script again with -Fix to add the import."
} else {
  Log "The section is present, correctly placed and styled. It only shows when the Metadata Result tab is active and at least one image is loaded."
  Log "If it still does not show: stop the dev server, delete .next, restart, hard refresh (Ctrl + Shift + R), and check you are on the Metadata Result (1st) tab."
}

# ------------------------------------------------------------- optional fix
function Run-Check([string]$name, [scriptblock]$command) {
  Log ""
  Log "---- $name ----"
  $output = & $command 2>&1 | Out-String
  $code = $LASTEXITCODE
  foreach ($line in (($output -split "`r?`n") | Select-Object -Last 40)) { Log $line }
  if ($code -eq 0) { Log "RESULT: $name PASS" } else { Log "RESULT: $name FAIL (exit code $code)" }
}

if ($Fix) {
  Log ""
  Log "== -Fix =="
  if ($sectionCount -eq 1 -and $rowsExists -and -not $componentImports) {
    $anchor = 'import "./generate.css";'
    $n = ([regex]::Matches($text, [regex]::Escape($anchor))).Count
    if ($n -ne 1) {
      Log ("  STOPPED: expected one '" + $anchor + "' but found " + $n + ". Nothing changed.")
    } else {
      New-Item -ItemType Directory -Force -Path $recovery | Out-Null
      Copy-Item -LiteralPath $metaPath -Destination (Join-Path $recovery ("MetadataWorkspace.tsx." + $stamp + ".pre-import-fix")) -ErrorAction Stop
      $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
      [System.IO.File]::WriteAllText($metaPath, $text.Replace($anchor, $anchor + $nl + 'import "./result-rows.css";'), $utf8)
      $check = Read-Utf8 $metaPath
      if ($check.ok) { Log "  added the stylesheet import to MetadataWorkspace.tsx (backup in .recovery\)" }
      else { Log "  FAILED after writing: restore .recovery\MetadataWorkspace.tsx.$stamp.pre-import-fix" }
    }
  } else {
    Log "  nothing to change automatically for this situation."
  }

  Log ""
  Log "== Checks (real results) =="
  Run-Check "tsc" { npx tsc --noEmit }
  Run-Check "lint" { npm run lint }
  Remove-Item -Recurse -Force (Join-Path $root ".next") -ErrorAction SilentlyContinue
  Run-Check "build" { npm run build }
}

Log ""
Log "Report saved to results-diagnosis.txt. Not committed, not pushed."