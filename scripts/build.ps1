$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Dist = Join-Path $Root "dist"

if (Test-Path -LiteralPath $Dist) {
  Remove-Item -LiteralPath $Dist -Recurse -Force
}

New-Item -ItemType Directory -Path $Dist | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "index.html") -Destination (Join-Path $Dist "index.html")
Copy-Item -LiteralPath (Join-Path $Root "src") -Destination (Join-Path $Dist "src") -Recurse
Remove-Item -LiteralPath (Join-Path $Dist "src\data\toilets.csv") -Force -ErrorAction SilentlyContinue

$ToiletLevelsDist = Join-Path $Dist "toilet_levels"
New-Item -ItemType Directory -Path $ToiletLevelsDist | Out-Null
Get-ChildItem -LiteralPath (Join-Path $Root "toilet_levels") -File -Filter "*_small.jpg" |
  ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ToiletLevelsDist $_.Name)
  }

Write-Host "Built static app to dist/"
