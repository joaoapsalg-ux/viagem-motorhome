# Servidor local para desenvolvimento (a máquina não tem Python nem Node):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 [porta]   →  http://localhost:8001
# Serve os arquivos do projeto sem cache (para o service worker e os dados sempre virem novos).
param([int]$Port = 8001)

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.geojson' = 'application/geo+json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
  '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'; '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Viagem de motorhome em http://localhost:$Port"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $Root $path.TrimStart('/')))
    if (-not $file.StartsWith($Root) -or -not [IO.File]::Exists($file)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('404')
    } else {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($Types.ContainsKey($ext)) { $Types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store')
    }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    Write-Host "$($res.StatusCode) $path"
  } catch {
    Write-Host "erro: $_"
  } finally {
    $res.Close()
  }
}
