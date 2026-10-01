# ZZ Programming Language installer — Windows (PowerShell 5.1+)
# Usage (elevated prompt NOT required):
#   irm https://zz-lang.pages.dev/install.ps1 | iex
# Pin a version:
#   $env:ZZ_VERSION = "v0.1.6"; irm https://zz-lang.pages.dev/install.ps1 | iex
# Re-running updates an existing install to the latest version.
$ErrorActionPreference = "Stop"

$Repo       = "zaidejjo/zz"
$InstallDir = Join-Path $HOME ".zz\bin"
$Want       = if ($env:ZZ_VERSION) { $env:ZZ_VERSION } else { "latest" }
$WantDir    = if ($env:ZZ_INSTALL_DIR) { $env:ZZ_INSTALL_DIR } else { $InstallDir }

function Write-Step($Text) { Write-Host "==> $Text" -ForegroundColor Blue }
function Write-Ok($Text)   { Write-Host "[OK] $Text" -ForegroundColor Green }
function Write-Warn($Text) { Write-Host " !! $Text" -ForegroundColor Yellow }
function Fail($Text)       { Write-Host " XX $Text" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ZZZZZZZ  ZZZZZZZ " -ForegroundColor Cyan
Write-Host "      ZZ       ZZ  " -ForegroundColor Cyan
Write-Host "     ZZ       ZZ   " -ForegroundColor Cyan
Write-Host "    ZZ       ZZ    " -ForegroundColor Cyan
Write-Host "  ZZZZZZZ  ZZZZZZZ " -ForegroundColor Cyan
Write-Host "ZZ installer — Windows  ($Repo)" -ForegroundColor White
Write-Host ""

# ---------- 1/5 detect platform ----------
Write-Step "[1/5] Detecting platform…"
$Arch = "x86_64"
try {
  $OsArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($OsArch -eq "Arm64") { $Arch = "aarch64" }
} catch {
  if ($env:PROCESSOR_ARCHITECTURE -like "*ARM64*") { $Arch = "aarch64" }
}
$OsId = "windows"
Write-Ok "platform: ${OsId}-${Arch}"

# ---------- 2/5 resolve version ----------
Write-Step "[2/5] Resolving version…"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Tag = $Want
if ($Tag -eq "latest") {
  try {
    $Rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 30
    $Tag = $Rel.tag_name
  } catch {
    Fail "could not resolve latest release (check network or set `$env:ZZ_VERSION='vX.Y.Z'). $_"
  }
}
if ([string]::IsNullOrWhiteSpace($Tag)) { Fail "empty release tag (check network or set `$env:ZZ_VERSION)." }
if ($Tag -notmatch '^v\d+\.\d+\.\d+$') { Fail "invalid version tag: $Tag (expected vX.Y.Z)" }
$Ver = $Tag.TrimStart("v")
Write-Host "==> version: $Tag" -ForegroundColor Blue

$Installed = $null
$Existing = Get-Command zz -ErrorAction SilentlyContinue
if ($Existing) {
  try { $Installed = (zz --version 2>$null | Select-Object -First 1 | Select-String -Pattern '\d+\.\d+\.\d+' -AllMatches).Matches[0].Value } catch {}
  if ($Installed -eq $Ver) {
    Write-Ok "zz $Tag already installed — nothing to do."
    Write-Host "  run zz --version to verify." -ForegroundColor Gray
    exit 0
  } elseif ($Installed) {
    Write-Warn "found zz $Installed — updating to $Tag…"
  }
}

# ---------- 3/5 download ----------
Write-Step "[3/5] Downloading zz $Tag…"
$ZipName = "zz-${Ver}-${OsId}-${Arch}.zip"
$Url     = "https://github.com/$Repo/releases/download/$Tag/$ZipName"
$Tmp     = Join-Path ([IO.Path]::GetTempPath()) ("zz-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $ZipPath = Join-Path $Tmp $ZipName
  $ProgressPreference = "Continue"
  Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
  Write-Ok "downloaded $ZipName"
} catch {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  Fail "download failed: $Url (release may not ship ${OsId}-${Arch} yet). $_"
}

# ---------- 4/5 install ----------
Write-Step "[4/5] Installing to $WantDir…"
try {
  $PkgDir = Join-Path $Tmp "pkg"
  Expand-Archive -Path $ZipPath -DestinationPath $PkgDir -Force
  $ZzExe = Get-ChildItem -Path $PkgDir -Filter "zz.exe" -Recurse -File | Select-Object -First 1
  if (-not $ZzExe) {
    # Some zips may ship a bare `zz` name; normalize to zz.exe
    $Bare = Get-ChildItem -Path $PkgDir -Filter "zz" -Recurse -File | Select-Object -First 1
    if (-not $Bare) { Fail "zip did not contain a zz binary" }
    $ZzExe = $Bare
  }
  New-Item -ItemType Directory -Path $WantDir -Force | Out-Null
  Copy-Item -Path $ZzExe.FullName -Destination (Join-Path $WantDir "zz.exe") -Force
  $Lsp = Get-ChildItem -Path $PkgDir -Filter "zz-lsp*" -Recurse -File | Select-Object -First 1
  if ($Lsp) { Copy-Item -Path $Lsp.FullName -Destination (Join-Path $WantDir "zz-lsp.exe") -Force }
  Write-Ok "installed zz $Tag"
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

# ---------- 5/5 PATH ----------
Write-Step "[5/5] Setting up PATH…"
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$WantDir*") {
  $NewPath = if ([string]::IsNullOrWhiteSpace($UserPath)) { $WantDir } else { "$UserPath;$WantDir" }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  Write-Ok "added $WantDir to User PATH (restart terminal to pick it up)"
} else {
  Write-Ok "User PATH already contains $WantDir"
}
if ($env:Path -notlike "*$WantDir*") {
  $env:Path = "$WantDir;$env:Path"
  Write-Warn "current session PATH updated; restart your terminal for new windows."
}

# ---------- setup: PATH + completions ----------
Write-Step "[6/6] Wiring up shell (zz setup)…"
try {
  & (Join-Path $WantDir "zz.exe") setup --yes
} catch {
  Write-Warn "zz setup needs attention — run 'zz setup' manually."
}

# ---------- verify ----------
try {
  $VersionLine = (& (Join-Path $WantDir "zz.exe") --version) | Select-Object -First 1
  Write-Host ""
  Write-Host "* congratulations — $VersionLine is ready!" -ForegroundColor Green
} catch {
  Fail "install finished but $WantDir\zz.exe does not run. $_"
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  zz run hello.zz   run a program"
Write-Host "  zz --help         see all commands"
Write-Host "Tools installed with zz install also land in ~/.zz/bin." -ForegroundColor Gray
