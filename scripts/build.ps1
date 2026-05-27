$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Dist = Join-Path $Root "dist"

if (Test-Path -LiteralPath $Dist) {
  Remove-Item -LiteralPath $Dist -Recurse -Force
}

New-Item -ItemType Directory -Path $Dist | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "index.html") -Destination (Join-Path $Dist "index.html")
Copy-Item -LiteralPath (Join-Path $Root "src") -Destination (Join-Path $Dist "src") -Recurse

Write-Host "Built static app to dist/"
