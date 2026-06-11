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

function Get-HtmlWithIncludes {
  param(
    [string]$Path,
    [hashtable]$Seen = @{}
  )

  $FullPath = (Resolve-Path -LiteralPath $Path).Path
  if ($Seen.ContainsKey($FullPath)) {
    return ""
  }
  $Seen[$FullPath] = $true

  $Content = Get-Content -LiteralPath $FullPath -Raw
  $Output = $Content
  $IncludeMatches = [regex]::Matches($Content, '<template\b[^>]*\bdata-html-include=["'']([^"'']+)["''][^>]*>\s*</template>')
  foreach ($Match in $IncludeMatches) {
    $Specifier = ($Match.Groups[1].Value -split "\?")[0]
    $IncludePath = Join-Path -Path (Split-Path -Parent $FullPath) -ChildPath $Specifier
    $Output += "`n" + (Get-HtmlWithIncludes -Path $IncludePath -Seen $Seen)
  }

  return $Output
}

$Html = Get-HtmlWithIncludes -Path "index.html"
function Get-CssWithImports {
  param(
    [string]$Path,
    [hashtable]$Seen = @{}
  )

  $FullPath = (Resolve-Path -LiteralPath $Path).Path
  if ($Seen.ContainsKey($FullPath)) {
    return ""
  }
  $Seen[$FullPath] = $true

  $Content = Get-Content -LiteralPath $FullPath -Raw
  $Output = $Content
  $ImportMatches = [regex]::Matches($Content, '@import\s+(?:url\(\s*)?["'']([^"'']+)["'']\s*\)?[^;]*;')
  foreach ($Match in $ImportMatches) {
    $Specifier = ($Match.Groups[1].Value -split "\?")[0]
    if ($Specifier -notmatch '^(?:https?:)?//') {
      $ImportPath = Join-Path -Path (Split-Path -Parent $FullPath) -ChildPath $Specifier
      $Output += "`n" + (Get-CssWithImports -Path $ImportPath -Seen $Seen)
    }
  }

  return $Output
}

$Css = Get-CssWithImports -Path "src/styles.css"
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
