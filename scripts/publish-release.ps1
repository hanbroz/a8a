param(
  [string]$Version = (Get-Date -Format 'yyyy.MM.dd.HH.mm'),
  [string]$Repo = 'hanbroz/a8a',
  [string]$Remote = 'origin'
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if ($Version -notmatch '^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$') {
  throw "Version must use yyyy.MM.dd.HH.mm format: $Version"
}

if ($Repo -notmatch '^[^/\s]+/[^/\s]+$') {
  throw "GitHub repository must use owner/repo format: $Repo"
}

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Title"
  & $Script
}

function Assert-LastExitCode {
  param([string]$CommandName)

  if ($LASTEXITCODE -ne 0) {
    throw "$CommandName failed. Exit code: $LASTEXITCODE"
  }
}

$tag = "v$Version"
$setupExe = "dist/a8a-Setup-$Version.exe"
$setupBlockmap = "dist/a8a-Setup-$Version.exe.blockmap"
$portableExe = "dist/a8a-Portable-$Version.exe"
$setupChecksum = "$setupExe.sha256"
$setupBlockmapChecksum = "$setupBlockmap.sha256"
$portableChecksum = "$portableExe.sha256"
$releaseNotes = "build/release-notes.md"

if (-not (Test-Path $releaseNotes)) {
  throw "Release notes file not found: $releaseNotes"
}

Invoke-Step "Stamp version: $Version" {
  $env:A8A_UPDATE_GITHUB_REPO = $Repo
  $env:A8A_APP_VERSION = $Version
  npm run version:stamp -- $Version
  Assert-LastExitCode 'npm run version:stamp'
}

Invoke-Step "Build Windows installer and portable package" {
  $env:A8A_UPDATE_GITHUB_REPO = $Repo
  $env:A8A_APP_VERSION = $Version
  npm run build:win
  Assert-LastExitCode 'npm run build:win'
}

foreach ($asset in @($setupExe, $setupBlockmap, $portableExe)) {
  if (-not (Test-Path $asset)) {
    throw "Release asset not found: $asset"
  }
}

Invoke-Step "Create Windows checksums" {
  foreach ($asset in @($setupExe, $setupBlockmap, $portableExe)) {
    $hash = (Get-FileHash -Algorithm SHA256 $asset).Hash.ToLowerInvariant()
    $name = Split-Path -Leaf $asset
    "$hash  $name" | Out-File -FilePath "$asset.sha256" -Encoding ascii
  }
}

foreach ($asset in @($setupChecksum, $setupBlockmapChecksum, $portableChecksum)) {
  if (-not (Test-Path $asset)) {
    throw "Release checksum asset not found: $asset"
  }
}

Invoke-Step "Commit version file" {
  git diff --check -- src/main/appVersion.ts
  Assert-LastExitCode 'git diff --check'

  git diff --quiet -- src/main/appVersion.ts
  $diffExitCode = $LASTEXITCODE
  if ($diffExitCode -eq 0) {
    Write-Host "No src/main/appVersion.ts change. Skipping commit."
    return
  }
  if ($diffExitCode -ne 1) {
    throw "Failed to check git diff."
  }

  git add src/main/appVersion.ts
  Assert-LastExitCode 'git add'
  git commit `
    -m "Publish the current date-stamped version manually" `
    -m "Update the app-visible date version so users can receive the locally built GitHub Release while Actions is unavailable." `
    -m "Constraint: GitHub Actions Release workflow can fail because of account billing or spending-limit issues." `
    -m "Rejected: Waiting for Actions recovery | New version delivery would be delayed." `
    -m "Confidence: high" `
    -m "Scope-risk: narrow" `
    -m "Directive: For each new release, repeat this process with npm run release:manual until Actions is restored." `
    -m "Tested: npm run build:win" `
    -m "Not-tested: GitHub Actions automatic release, macOS packaging"
  Assert-LastExitCode 'git commit'
}

Invoke-Step "Push current branch" {
  $branch = git branch --show-current
  Assert-LastExitCode 'git branch --show-current'
  if (-not $branch) {
    throw "Cannot determine current branch."
  }
  git push $Remote "HEAD:$branch"
  Assert-LastExitCode 'git push'
}

Invoke-Step "Create GitHub Release: $tag" {
  gh release view $tag --repo $Repo *> $null
  $releaseViewExitCode = $LASTEXITCODE
  if ($releaseViewExitCode -eq 0) {
    throw "Release already exists: $tag"
  }
  if ($releaseViewExitCode -ne 1) {
    throw "Failed to query GitHub Release."
  }

  $head = git rev-parse HEAD
  gh release create $tag `
    $setupExe `
    $setupBlockmap `
    $portableExe `
    $setupChecksum `
    $setupBlockmapChecksum `
    $portableChecksum `
    --repo $Repo `
    --target $head `
    --latest `
    --title $Version `
    --notes-file $releaseNotes
  Assert-LastExitCode 'gh release create'
}

Invoke-Step "Verify latest Release" {
  gh api "repos/$Repo/releases/latest" --jq '{tag_name:.tag_name, name:.name, html_url:.html_url, assets:[.assets[].name]}'
  Assert-LastExitCode 'gh api releases/latest'
}
