# T-108: installs the pinned Chrome Headless Shell for @remotion/renderer into .tools/remotion-browser/<version>.
# Everything it trusts comes from browser-pin.json next to this file (source URL, archive size and SHA-256, the
# executable's SHA-256). It never overwrites: an existing install is only verified, a partial one is an error.
# The download is the only network use; rendering itself uses this folder through `browserExecutable` and never
# downloads a browser. Usage: powershell -ExecutionPolicy Bypass -File scripts/remotion/install-browser.ps1 [-ArchivePath <zip>]
param([string]$ArchivePath = '')
$ErrorActionPreference = 'Stop'
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'browser-pin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pin.schemaVersion -ne 1 -or $pin.platform -ne 'win64') { throw 'browser-pin.json is not a win64 schemaVersion 1 pin.' }
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$toolsRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot '.tools/remotion-browser'))
$installDir = [System.IO.Path]::GetFullPath((Join-Path $appRoot $pin.installDir))
if (-not $installDir.StartsWith($toolsRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Install folder is outside .tools/remotion-browser.' }
$executable = Join-Path $installDir $pin.executable.path
function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Test-Install {
  if ((Get-Sha256 $executable) -ne $pin.executable.sha256) { throw 'Installed browser executable differs from the pin. Move the folder away and install again.' }
  if ((Get-Sha256 (Join-Path $installDir $pin.license.path)) -ne $pin.license.sha256) { throw 'Installed browser license file differs from the pin.' }
  $count = (Get-ChildItem -LiteralPath (Join-Path $installDir 'chrome-headless-shell-win64') -File).Count
  if ($count -ne $pin.archive.entries) { throw "Installed browser folder has $count files, expected $($pin.archive.entries)." }
}
if (Test-Path -LiteralPath $installDir) {
  if (-not (Test-Path -LiteralPath $executable)) { throw 'An incomplete browser folder exists. It is not overwritten; move it away first.' }
  Test-Install
  Write-Output "Browser already installed and verified: $($pin.version)"
  exit 0
}
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
$archiveFile = Join-Path $toolsRoot $pin.archive.fileName
if ($ArchivePath) {
  # A copy downloaded earlier (for example by the T-108 check) is accepted only if it has the pinned hash.
  if (-not (Test-Path -LiteralPath $archiveFile)) { Copy-Item -LiteralPath $ArchivePath -Destination $archiveFile }
} elseif (-not (Test-Path -LiteralPath $archiveFile)) {
  $partial = "$archiveFile.part-$([guid]::NewGuid().ToString('N'))"
  & curl.exe --fail --location --silent --show-error --max-time 1800 $pin.source --output $partial
  if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $partial -ErrorAction SilentlyContinue; throw 'Browser archive download failed.' }
  Move-Item -LiteralPath $partial -Destination $archiveFile
}
$size = (Get-Item -LiteralPath $archiveFile).Length
if ($size -ne $pin.archive.sizeBytes -or (Get-Sha256 $archiveFile) -ne $pin.archive.sha256) { throw "Browser archive checksum mismatch ($size bytes). The file is left at $archiveFile for inspection." }
# Extract into a new staging folder next to the target, check it, then rename it into place (never over an existing folder).
$staging = Join-Path $toolsRoot ".staging-$($pin.version)-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveFile)
  try {
    if ($archive.Entries.Count -ne $pin.archive.entries) { throw 'Browser archive entry count differs from the pin.' }
    $stagingFull = [System.IO.Path]::GetFullPath($staging) + [System.IO.Path]::DirectorySeparatorChar
    foreach ($entry in $archive.Entries) {
      if (-not $entry.FullName.StartsWith('chrome-headless-shell-win64/') -or $entry.FullName.Contains('..')) { throw "Unexpected archive entry: $($entry.FullName)" }
      $target = [System.IO.Path]::GetFullPath((Join-Path $staging $entry.FullName))
      if (-not $target.StartsWith($stagingFull)) { throw 'Archive entry escapes the staging folder.' }
      if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
  } finally { $archive.Dispose() }
  if ((Get-Sha256 (Join-Path $staging $pin.executable.path)) -ne $pin.executable.sha256) { throw 'Extracted browser executable differs from the pin.' }
  if (Test-Path -LiteralPath $installDir) { throw 'The browser folder appeared while installing; it is not overwritten.' }
  Move-Item -LiteralPath $staging -Destination $installDir
} catch {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  throw
}
Test-Install
$versionText = (& $executable --version | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $versionText.Trim() -ne $pin.executable.versionOutput) { throw "Browser version check failed: $versionText" }
Write-Output "Browser installed and verified: $versionText"
