# Script to setup GitHub token for release uploads
# This script helps you set the GITHUB_TOKEN environment variable

Write-Host "=== GitHub Token Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if token is already set
$currentToken = [System.Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "User")
if ($currentToken) {
    Write-Host "Current GITHUB_TOKEN is already set (length: $($currentToken.Length))" -ForegroundColor Yellow
    $overwrite = Read-Host "Do you want to overwrite it? (y/n)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Setup cancelled." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "To create a GitHub Personal Access Token:" -ForegroundColor Cyan
Write-Host "1. Go to: https://github.com/settings/tokens" -ForegroundColor White
Write-Host "2. Click 'Generate new token' -> 'Generate new token (classic)'" -ForegroundColor White
Write-Host "3. Give it a name (e.g., 'Release Upload')" -ForegroundColor White
Write-Host "4. Select expiration (recommended: 90 days or No expiration)" -ForegroundColor White
Write-Host "5. Check the 'repo' scope (full control of private repositories)" -ForegroundColor White
Write-Host "6. Click 'Generate token'" -ForegroundColor White
Write-Host "7. Copy the token (you won't see it again!)" -ForegroundColor White
Write-Host ""

$token = Read-Host "Paste your GitHub token here" -AsSecureString
$tokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
)

if ([string]::IsNullOrWhiteSpace($tokenPlain)) {
    Write-Host "Error: Token cannot be empty" -ForegroundColor Red
    exit 1
}

# Set environment variable for current user (persistent)
[System.Environment]::SetEnvironmentVariable("GITHUB_TOKEN", $tokenPlain, "User")

Write-Host ""
Write-Host "GitHub token has been set successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Note: You may need to restart your terminal/PowerShell for the change to take effect." -ForegroundColor Yellow
Write-Host "Or run this command in your current session:" -ForegroundColor Yellow
Write-Host '  $env:GITHUB_TOKEN = "your_token_here"' -ForegroundColor Cyan
Write-Host ""

# Test if gh CLI is authenticated
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

if (-not $ghPath) {
    $ghPath = Get-Command gh -ErrorAction SilentlyContinue
    if ($ghPath) {
        $ghPath = $ghPath.Source
    }
}

if ($ghPath) {
    Write-Host "Testing GitHub CLI authentication..." -ForegroundColor Cyan
    $env:GITHUB_TOKEN = $tokenPlain
    $authStatus = & $ghPath auth status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "GitHub CLI is authenticated!" -ForegroundColor Green
    } else {
        Write-Host "GitHub CLI is not authenticated. Run: gh auth login" -ForegroundColor Yellow
    }
} else {
    Write-Host "GitHub CLI not found. Install it from: https://cli.github.com/" -ForegroundColor Yellow
}

