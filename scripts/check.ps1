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

$RequiredCopy = @("Map", "Account", "Wallet balance", "Directions")
$MissingCopy = $RequiredCopy | Where-Object { -not $Html.Contains($_) }

if ($MissingCopy.Count -gt 0) {
  throw "Missing expected UI copy: $($MissingCopy -join ', ')"
}

if ($Html.Contains("Access QR") -or $Html.Contains("activate-pass")) {
  throw "QR access UI and activation flow should not be present."
}

if (-not $Html.Contains("openstreetmap.org/export/embed") -or -not $Js.Contains("navigator.geolocation") -or -not $Js.Contains("google.com/maps/dir")) {
  throw "Expected real map, geolocation, and directions integration."
}

if (-not $Html.Contains("close-details") -or -not $Js.Contains("closeDetailsButton")) {
  throw "Expected closable toilet details panel."
}

if (-not $Html.Contains('data-detail-section="features"') -or -not $Html.Contains('data-detail-panel="survey"')) {
  throw "Expected toilet details to switch between linked detail sections."
}

if (-not $Css.Contains("@media") -or -not $Js.Contains("setTab")) {
  throw "Expected responsive CSS and tab interaction code."
}

if (-not $Css.Contains(".map-frame") -or -not $Css.Contains(".map-marker")) {
  throw "Expected stable map frame and marker overlay CSS."
}

Write-Host "Static app checks passed."
