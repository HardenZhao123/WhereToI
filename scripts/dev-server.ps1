param(
  [int]$Port = 4173
)

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$MimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
}

function Write-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body
  )

  $Header = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
  $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

try {
  $Listener.Start()
  Write-Host "WhereToI dev server running at http://localhost:$Port/"
  Write-Host "Press Ctrl+C to stop."

  while ($true) {
    $Client = $Listener.AcceptTcpClient()

    try {
      $Stream = $Client.GetStream()
      $Buffer = New-Object byte[] 4096
      $Read = $Stream.Read($Buffer, 0, $Buffer.Length)
      $Request = [System.Text.Encoding]::ASCII.GetString($Buffer, 0, $Read)
      $RequestLine = ($Request -split "`r`n")[0]
      $Parts = $RequestLine -split " "
      $RequestPath = if ($Parts.Length -ge 2) { $Parts[1] } else { "/" }
      $RequestPath = ($RequestPath -split "\?")[0]

      if ($RequestPath -eq "/") {
        $RequestPath = "/index.html"
      }

      $DecodedPath = [System.Uri]::UnescapeDataString($RequestPath)
      $RelativePath = $DecodedPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))

      if (-not $FullPath.StartsWith($Root)) {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Write-Response $Stream 403 "Forbidden" "text/plain; charset=utf-8" $Body
        continue
      }

      if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        Write-Response $Stream 404 "Not Found" "text/plain; charset=utf-8" $Body
        continue
      }

      $Extension = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
      $ContentType = if ($MimeTypes.ContainsKey($Extension)) { $MimeTypes[$Extension] } else { "application/octet-stream" }
      $Body = [System.IO.File]::ReadAllBytes($FullPath)
      Write-Response $Stream 200 "OK" $ContentType $Body
    }
    finally {
      $Client.Close()
    }
  }
}
finally {
  $Listener.Stop()
}
