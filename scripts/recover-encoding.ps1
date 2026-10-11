param([switch]$Apply)

# Repairs src\components\metadata\MetadataWorkspace.tsx when it is not valid UTF-8.
# Without -Apply it only reads files and writes recovery-report.txt.
# With -Apply it first copies the damaged file into .recovery\, writes the chosen
# source as UTF-8 (no BOM), re-checks it, then runs tsc, lint and build.
# It never touches .env.local, never deletes backups, never runs git checkout or reset.

$ErrorActionPreference = "Continue"

$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root "package.json"))) {
  Write-Host "Run this from the project root (the folder that contains package.json)."
  exit 1
}

$relTarget = "src/components/metadata/MetadataWorkspace.tsx"
$target = Join-Path $root "src\components\metadata\MetadataWorkspace.tsx"
$reportPath = Join-Path $root "recovery-report.txt"
$recoveryDir = Join-Path $root ".recovery"
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$plainUtf8 = New-Object System.Text.UTF8Encoding($false)

Set-Content -Path $reportPath -Value ("Recovery report " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding ASCII
function Log([string]$line) {
  Add-Content -Path $reportPath -Value $line -Encoding ASCII
  Write-Host $line
}

function Hex8([byte[]]$b) {
  $n = [Math]::Min(8, $b.Length)
  $parts = @()
  for ($i = 0; $i -lt $n; $i++) { $parts += $b[$i].ToString("X2") }
  return ($parts -join " ")
}

function Inspect-Bytes([byte[]]$b) {
  $result = @{ Kind = ""; Detail = "" }
  if ($b.Length -eq 0) { $result.Kind = "EMPTY"; return $result }
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $result.Kind = "UTF8-BOM"; return $result }
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $result.Kind = "UTF16-LE-BOM"; return $result }
  if ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { $result.Kind = "UTF16-BE-BOM"; return $result }
  $nulls = 0
  for ($i = 0; $i -lt $b.Length; $i++) { if ($b[$i] -eq 0) { $nulls++ } }
  if ($nulls -gt 0) {
    $result.Kind = "BINARY-OR-UTF16-NO-BOM"
    $result.Detail = "$nulls zero bytes"
    return $result
  }
  try {
    [void]$strictUtf8.GetString($b)
    $result.Kind = "UTF8"
  } catch {
    $inner = $_.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    $where = ""
    if ($inner -is [System.Text.DecoderFallbackException]) { $where = " at byte " + $inner.Index }
    $result.Kind = "INVALID-UTF8"
    $result.Detail = "first bad sequence$where"
  }
  return $result
}

function Decode-Text([byte[]]$b, [string]$kind) {
  try {
    if ($kind -eq "UTF8") { return $strictUtf8.GetString($b) }
    if ($kind -eq "UTF8-BOM") { return $strictUtf8.GetString($b, 3, $b.Length - 3) }
    if ($kind -eq "UTF16-LE-BOM") { $t = [System.Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) }
    elseif ($kind -eq "UTF16-BE-BOM") { $t = [System.Text.Encoding]::BigEndianUnicode.GetString($b, 2, $b.Length - 2) }
    else { return $null }
    if ($t.Contains([string][char]0xFFFD)) { return $null }
    return $t
  } catch {
    return $null
  }
}

function Evaluate-Text([string]$t) {
  $o = @{}
  $o.UseClient = [bool]($t -match '^\s*"use client"')
  $o.Exports = [bool]($t -match 'export\s+function\s+MetadataWorkspace\b')
  $o.AllResults = [bool]($t -match 'mw-all-title')
  $o.Queue = [bool]($t -match 'useMetadataQueue')
  $braceOpen = $t.Length - $t.Replace("{", "").Length
  $braceClose = $t.Length - $t.Replace("}", "").Length
  $parenOpen = $t.Length - $t.Replace("(", "").Length
  $parenClose = $t.Length - $t.Replace(")", "").Length
  $o.Balanced = (($braceOpen -eq $braceClose) -and ($parenOpen -eq $parenClose))
  $o.Complete = $t.TrimEnd().EndsWith("}")
  $o.Valid = ($o.UseClient -and $o.Exports -and $o.Balanced -and $o.Complete)
  $o.Score = -1
  if ($o.Valid) {
    $o.Score = 10
    if ($o.AllResults) { $o.Score += 4 }
    if ($o.Queue) { $o.Score += 2 }
  }
  return $o
}

function Get-GitBytes([string]$rev) {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "show ${rev}:${relTarget}"
    $psi.WorkingDirectory = $root
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $ms = New-Object System.IO.MemoryStream
    $p.StandardOutput.BaseStream.CopyTo($ms)
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { return $null }
    return ,$ms.ToArray()
  } catch {
    return $null
  }
}

$candidates = New-Object System.Collections.ArrayList

function Add-Candidate([string]$name, $bytes, [int]$rank) {
  if ($null -eq $bytes) {
    Log "  [$name] not available"
    return
  }
  $info = Inspect-Bytes $bytes
  $text = $null
  if ($info.Kind -in @("UTF8", "UTF8-BOM", "UTF16-LE-BOM", "UTF16-BE-BOM")) {
    $text = Decode-Text $bytes $info.Kind
  }
  $detail = ""
  if ($info.Detail) { $detail = " (" + $info.Detail + ")" }
  Log ("  [{0}] {1} bytes, first bytes: {2}, encoding: {3}{4}" -f $name, $bytes.Length, (Hex8 $bytes), $info.Kind, $detail)

  $eval = $null
  $score = -1
  if ($null -ne $text) {
    $eval = Evaluate-Text $text
    $score = $eval.Score
    Log ("      use-client={0} exports-MetadataWorkspace={1} braces-balanced={2} complete={3} has-AllImageResults={4} uses-queue={5} -> {6}" -f $eval.UseClient, $eval.Exports, $eval.Balanced, $eval.Complete, $eval.AllResults, $eval.Queue, $(if ($eval.Valid) { "USABLE" } else { "NOT usable" }))
  } else {
    Log "      could not be decoded safely -> NOT usable"
  }
  [void]$candidates.Add([pscustomobject]@{ Name = $name; Rank = $rank; Kind = $info.Kind; Text = $text; Eval = $eval; Score = $score })
}

Log "PowerShell version: $($PSVersionTable.PSVersion)"
if ($Apply) { Log "Mode: APPLY" } else { Log "Mode: REPORT ONLY (no files are changed)" }
Log ""
Log "== Candidates for MetadataWorkspace.tsx =="

if (Test-Path $target) {
  Add-Candidate "current file" ([System.IO.File]::ReadAllBytes($target)) 0
} else {
  Log "  [current file] does not exist"
}

$others = Get-ChildItem -Path (Join-Path $root "src") -Recurse -File | Where-Object { $_.Name -like "MetadataWorkspace*" -and $_.FullName -ne $target } | Sort-Object LastWriteTime -Descending
foreach ($file in $others) {
  Add-Candidate ("file: " + $file.FullName.Substring($root.Length + 1)) ([System.IO.File]::ReadAllBytes($file.FullName)) 1
}

$hashes = @(git log --format=%h -5 -- $relTarget 2>$null)
if ($hashes.Count -eq 0) { Log "  (no Git history found for this file)" }
foreach ($hash in $hashes) {
  Add-Candidate ("git " + $hash) (Get-GitBytes $hash) 2
}

$valid = @($candidates | Where-Object { $_.Score -ge 0 } | Sort-Object @{ Expression = "Score"; Descending = $true }, @{ Expression = "Rank"; Descending = $false })

Log ""
if ($valid.Count -eq 0) {
  Log "RESULT: no candidate is a usable MetadataWorkspace.tsx. Nothing was changed."
  Log "Send recovery-report.txt (not the source) and tell me if you have any older copy."
  exit 1
}

$best = $valid[0]
Log "Chosen source: $($best.Name)"
if (-not $best.Eval.AllResults) {
  Log "WARNING: the chosen source does not contain the All Image Results section. It must be added again."
}
if (-not $best.Eval.Queue) {
  Log "WARNING: the chosen source does not use useMetadataQueue (generation code), so it may be an older version."
}

if ($best.Name -eq "current file" -and $best.Kind -eq "UTF8") {
  Log "The current file is already valid UTF-8. The Turbopack error may be stale: delete .next and rebuild."
} elseif ($Apply) {
  try {
    New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    if (Test-Path $target) {
      Copy-Item -LiteralPath $target -Destination (Join-Path $recoveryDir "MetadataWorkspace.tsx.$stamp.damaged") -ErrorAction Stop
      Log "Saved a raw copy of the damaged file to .recovery\MetadataWorkspace.tsx.$stamp.damaged"
    }
    [System.IO.File]::WriteAllText($target, $best.Text, $plainUtf8)
    $after = [System.IO.File]::ReadAllBytes($target)
    $afterKind = (Inspect-Bytes $after).Kind
    if ($afterKind -ne "UTF8") {
      Log "FAILED: the rewritten file is not valid UTF-8 ($afterKind). The damaged copy is in .recovery\."
      exit 1
    }
    Log ("Rewrote MetadataWorkspace.tsx as UTF-8 without BOM ({0} bytes, first bytes: {1})" -f $after.Length, (Hex8 $after))
  } catch {
    Log "FAILED while writing: $($_.Exception.Message)"
    exit 1
  }
} else {
  Log "Report only: run again with -Apply to write the chosen source."
}

# ---------- other files with the same problem ----------
Log ""
Log "== Other source files that are not plain UTF-8 =="
$scanFiles = @()
foreach ($dir in @("src", "supabase", "scripts")) {
  $p = Join-Path $root $dir
  if (Test-Path $p) {
    $scanFiles += Get-ChildItem -Path $p -Recurse -File -Include *.ts, *.tsx, *.css, *.sql, *.json, *.md, *.ps1
  }
}
$scanFiles += Get-ChildItem -Path "$root\*" -File -Include *.json, *.ts, *.mjs, *.md
$scanFiles = $scanFiles | Where-Object { $_.Name -notlike "*backup*" -and $_.Name -notlike "*.bak" -and $_.FullName -ne $target } | Sort-Object FullName -Unique

$badCount = 0
foreach ($file in $scanFiles) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  $info = Inspect-Bytes $bytes
  if ($info.Kind -eq "UTF8") { continue }
  $badCount++
  $rel = $file.FullName.Substring($root.Length + 1)
  Log ("  {0}: {1} (first bytes {2})" -f $rel, $info.Kind, (Hex8 $bytes))
  if ($Apply -and ($info.Kind -in @("UTF8-BOM", "UTF16-LE-BOM", "UTF16-BE-BOM"))) {
    $text = Decode-Text $bytes $info.Kind
    if ($null -ne $text) {
      New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $recoveryDir ($file.Name + "." + (Get-Date -Format "yyyyMMdd-HHmmss") + ".orig")) -ErrorAction SilentlyContinue
      [System.IO.File]::WriteAllText($file.FullName, $text, $plainUtf8)
      Log "     converted to UTF-8 without BOM (original saved in .recovery\)"
    } else {
      Log "     could not be decoded safely; left unchanged"
    }
  }
}
if ($badCount -eq 0) { Log "  (none found)" }

# ---------- checks ----------
function Run-Check([string]$name, [scriptblock]$command) {
  Log ""
  Log "---- $name ----"
  $output = & $command 2>&1 | Out-String
  $code = $LASTEXITCODE
  $tail = ($output -split "`r?`n") | Select-Object -Last 60
  foreach ($line in $tail) { Log $line }
  if ($code -eq 0) { Log "RESULT: $name PASS" } else { Log "RESULT: $name FAIL (exit code $code)" }
}

if ($Apply) {
  Log ""
  Log "== Checks (real results) =="
  Run-Check "tsc" { npx tsc --noEmit }
  Run-Check "lint" { npm run lint }
  Remove-Item -Recurse -Force (Join-Path $root ".next") -ErrorAction SilentlyContinue
  Run-Check "build" { npm run build }
}

Log ""
Log "Report saved to recovery-report.txt. Do not commit .recovery\ or recovery-report.txt."