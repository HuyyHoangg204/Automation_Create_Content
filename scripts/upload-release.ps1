# Script to upload release to GitHub after build
param(
    [string]$Version = "",
    [string]$Token = ""
)

# Get version from package.json if not provided
if ([string]::IsNullOrEmpty($Version)) {
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    $Version = $packageJson.version
}

# Get GitHub token from environment or parameter
if ([string]::IsNullOrEmpty($Token)) {
    $Token = $env:GITHUB_TOKEN
}

# Try to read from .env file if token not found
if ([string]::IsNullOrEmpty($Token)) {
    $envFile = ".env"
    if (Test-Path $envFile) {
        $envContent = Get-Content $envFile
        foreach ($line in $envContent) {
            if ($line -match '^\s*GITHUB_TOKEN\s*=\s*(.+)$') {
                $Token = $Matches[1].Trim()
                Write-Host "Found GITHUB_TOKEN in .env file" -ForegroundColor Cyan
                break
            }
        }
    }
}

if ([string]::IsNullOrEmpty($Token)) {
    Write-Host "Error: GitHub token not found. Set GITHUB_TOKEN environment variable, add it to .env file, or pass -Token parameter" -ForegroundColor Red
    exit 1
}

# Get repository info from git
$repoRemote = git remote get-url origin
if ($repoRemote -match "github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$") {
    $repoOwner = $Matches[1]
    $repoName = $Matches[2] -replace '\.git$', ''
} else {
    Write-Host "Error: Could not determine GitHub repository from git remote" -ForegroundColor Red
    exit 1
}

Write-Host "Repository: $repoOwner/$repoName" -ForegroundColor Cyan
Write-Host "Version: $Version" -ForegroundColor Cyan

# Find release directory
$releaseDir = "release\$Version"
if (-not (Test-Path $releaseDir)) {
    Write-Host "Error: Release directory not found: $releaseDir" -ForegroundColor Red
    exit 1
}

# Find installer file
$installerFile = Get-ChildItem -Path $releaseDir -Filter "*.exe" | Where-Object { $_.Name -notlike "*.blockmap*" } | Select-Object -First 1
if (-not $installerFile) {
    # Try alternative: list all files and find .exe
    Write-Host "Debug: Listing files in $releaseDir..." -ForegroundColor Yellow
    $allFiles = Get-ChildItem -Path $releaseDir -File
    foreach ($file in $allFiles) {
        Write-Host "  Found: $($file.Name)" -ForegroundColor Gray
    }
    
    # Try to find any .exe file
    $installerFile = $allFiles | Where-Object { $_.Extension -eq ".exe" } | Select-Object -First 1
    
    if (-not $installerFile) {
        Write-Host "Error: Installer file not found in $releaseDir" -ForegroundColor Red
        Write-Host "Expected file pattern: *-Setup.exe or *-Installer.exe" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Found installer: $($installerFile.Name)" -ForegroundColor Green

# Check if GitHub CLI is available
$ghPath = $null
$ghPaths = @(
    "C:\Program Files\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\GitHub CLI\gh.exe",
    "$env:ProgramFiles\GitHub CLI\gh.exe"
)

foreach ($path in $ghPaths) {
    if (Test-Path $path) {
        $ghPath = $path
        break
    }
}

# Try to find gh in PATH
if (-not $ghPath) {
    $ghPath = Get-Command gh -ErrorAction SilentlyContinue
    if ($ghPath) {
        $ghPath = $ghPath.Source
    }
}

if (-not $ghPath) {
    Write-Host "Error: GitHub CLI (gh) not found. Please install it from https://cli.github.com/" -ForegroundColor Red
    exit 1
}

Write-Host "Using GitHub CLI: $ghPath" -ForegroundColor Cyan

# Check if release already exists
$releaseExists = & $ghPath release view "v$Version" --repo "$repoOwner/$repoName" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Release v$Version already exists. Updating..." -ForegroundColor Yellow
    
    # Delete existing release
    & $ghPath release delete "v$Version" --repo "$repoOwner/$repoName" --yes
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Failed to delete existing release" -ForegroundColor Yellow
    }
}

# Create release
Write-Host "Creating release v$Version..." -ForegroundColor Cyan
$releaseNotes = "Release version $Version`n`nAutomated build and upload."
& $ghPath release create "v$Version" `
    --repo "$repoOwner/$repoName" `
    --title "v$Version" `
    --notes "$releaseNotes"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to create release" -ForegroundColor Red
    exit 1
}

Write-Host "Release created successfully!" -ForegroundColor Green

# Upload installer file
Write-Host "Uploading installer file..." -ForegroundColor Cyan
& $ghPath release upload "v$Version" "$($installerFile.FullName)" `
    --repo "$repoOwner/$repoName" `
    --clobber

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to upload installer file" -ForegroundColor Red
    exit 1
}

Write-Host "Installer uploaded successfully!" -ForegroundColor Green

Write-Host "`nRelease v$Version published successfully!" -ForegroundColor Green
Write-Host "Release URL: https://github.com/$repoOwner/$repoName/releases/tag/v$Version" -ForegroundColor Cyan

