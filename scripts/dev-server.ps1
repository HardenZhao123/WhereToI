param(
  [int]$Port = 4173
)

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Listener = [System.Net.HttpListener]::new()
$Prefix = "http://localhost:$Port/"
$Listener.Prefixes.Add($Prefix)

try {
  $Listener.Start()
  Write-Host "WHERE Toi dev server running at $Prefix"
  Write-Host "Press Ctrl+C to stop."

  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    $RequestPath = [System.Uri]::UnescapeDataString($Context.Request.Url.AbsolutePath)

    if ($RequestPath -eq "/") {
      $RequestPath = "/index.html"
    }

    $RelativePath = $RequestPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
    $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))

    if (-not $FullPath.StartsWith($Root)) {
      $Context.Response.StatusCode = 403
      $Context.Response.Close()
      continue
    }

    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
      $Context.Response.StatusCode = 404
      $Context.Response.Close()
      continue
    }

    $Extension = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
    $ContentType = switch ($Extension) {
      ".html" { "text/html; charset=utf-8" }
      ".css" { "text/css; charset=utf-8" }
      ".js" { "text/javascript; charset=utf-8" }
      ".json" { "application/json; charset=utf-8" }
      default { "application/octet-stream" }
    }

    $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
    $Context.Response.ContentType = $ContentType
    $Context.Response.ContentLength64 = $Bytes.Length
    $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Context.Response.Close()
  }
}
finally {
  if ($Listener.IsListening) {
    $Listener.Stop()
  }

  $Listener.Close()
}
