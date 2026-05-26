$RequiredFiles = @(
  "index.html",
  "src/main.js",
  "src/styles.css",
  "scripts/build.ps1"
)

foreach ($File in $RequiredFiles) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
    throw "Missing required file: $File"
  }
}

$Html = Get-Content -LiteralPath "index.html" -Raw
$Css = Get-Content -LiteralPath "src/styles.css" -Raw
$Js = Get-Content -LiteralPath "src/main.js" -Raw

$RequiredCopy = @("Map", "Access QR", "Account", "Wallet balance", "Toilet Access Pass")
$MissingCopy = $RequiredCopy | Where-Object { -not $Html.Contains($_) }

if ($MissingCopy.Count -gt 0) {
  throw "Missing expected UI copy: $($MissingCopy -join ', ')"
}

if (-not $Css.Contains("@media") -or -not $Js.Contains("setTab")) {
  throw "Expected responsive CSS and tab interaction code."
}

Write-Host "Static app checks passed."
