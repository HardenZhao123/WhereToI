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
$JsFiles = @("src/main.js") + (Get-ChildItem -LiteralPath "src/app" -Recurse -Filter "*.js" | ForEach-Object { $_.FullName })
$Js = ($JsFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n"

$RequiredCopy = @("Map", "Account", "Directions")
$MissingCopy = $RequiredCopy | Where-Object { -not $Html.Contains($_) }

if ($MissingCopy.Count -gt 0) {
  throw "Missing expected UI copy: $($MissingCopy -join ', ')"
}

if ($Html.Contains("Access QR") -or $Html.Contains("activate-pass")) {
  throw "QR access UI and activation flow should not be present."
}

if (
  -not $Html.Contains("leaflet@1.9.4/dist/leaflet.css") -or
  -not $Html.Contains("leaflet@1.9.4/dist/leaflet.js") -or
  -not $Js.Contains("window.L.map") -or
  -not $Js.Contains("navigator.geolocation") -or
  -not $Js.Contains("google.com/maps/dir")
) {
  throw "Expected interactive map, geolocation, and directions integration."
}

if (-not $Html.Contains("close-details") -or -not $Js.Contains("closeDetailsButton")) {
  throw "Expected closable toilet details panel."
}

if (
  -not $Html.Contains('data-detail-section="overview"') -or
  -not $Html.Contains('data-detail-panel="overview"') -or
  -not $Html.Contains("overview-features-disclosure")
) {
  throw "Expected toilet details to switch between linked detail sections."
}

if (
  $Html.Contains("0 clean (0%) | 0 not clean (0%)") -or
  $Html.Contains('data-detail-panel="survey"') -or
  $Html.Contains("data-survey-rating=") -or
  $Html.Contains("data-open-visual-feedback") -or
  $Html.Contains("Rate visually") -or
  -not $Html.Contains('id="visual-cleanliness-stars"') -or
  -not $Html.Contains('data-visual-rating="4.5"') -or
  -not $Html.Contains('data-visual-rating="5"') -or
  -not $Css.Contains(".visual-star-rating")
) {
  throw "Expected Write feedback cleanliness to use the 0.5-5 visual star rating."
}

if (-not $Css.Contains("@media") -or -not $Js.Contains("setTab")) {
  throw "Expected responsive CSS and tab interaction code."
}

if (-not $Css.Contains(".map-canvas") -or -not $Css.Contains(".map-marker") -or -not $Css.Contains(".map-marker-icon")) {
  throw "Expected stable map frame and marker overlay CSS."
}

Write-Host "Static app checks passed."
