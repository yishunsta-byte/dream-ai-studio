$ErrorActionPreference = 'Stop'
$mediaRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.tools/ffmpeg'))
$archiveFile = Join-Path $mediaRoot 'ffmpeg-9.0.2.zip'
New-Item -ItemType Directory -Force -Path $mediaRoot | Out-Null
$expectedHash = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
if (!(Test-Path -LiteralPath $archiveFile)) {
  & curl.exe --fail --location --silent --show-error 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip' --output $archiveFile
  if ($LASTEXITCODE -ne 0) { throw 'Media archive download failed.' }
}
if ((Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Media archive checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archiveFile)
try {
  foreach ($binaryName in @('ffmpeg.exe','ffprobe.exe')) {
    $entry = $archive.GetEntry("ffmpeg-9.0.2-essentials_build/bin/$binaryName")
    if ($null -eq $entry) { throw 'Expected media executable is missing.' }
    $destination = Join-Path $mediaRoot $binaryName
    if (!(Test-Path -LiteralPath $destination)) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false) }
  }
  $license = $archive.GetEntry('ffmpeg-9.0.2-essentials_build/LICENSE')
  $licensePath = Join-Path $mediaRoot 'LICENSE.txt'
  if ($null -ne $license -and !(Test-Path -LiteralPath $licensePath)) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($license,$licensePath,$false) }
} finally { $archive.Dispose() }
& (Join-Path $mediaRoot 'ffprobe.exe') -version | Select-Object -First 1
if ($LASTEXITCODE -ne 0) { throw 'Media executable check failed.' }
