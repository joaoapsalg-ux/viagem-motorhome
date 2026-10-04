<#
  Abre o app num Chrome sem janela (headless), roda passos em JavaScript e tira prints — para conferir mudanças
  sem Node/Playwright (a máquina não tem). Fala com o Chrome pelo protocolo DevTools (CDP) via WebSocket.

  Uso (com o tools/serve.ps1 rodando):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/dev/navegador.ps1 -Saida shot.png
    ... -Celular -Escuro -Espera 15 -Js "return document.title"
    ... -Passos passos.json      # [{ "js": "app.abrirDia(5)", "espera": 4, "png": "dia5.png" }, ...]
  O JavaScript roda dentro de uma função async (pode usar await e return); o retorno sai em JSON.
  Mensagens do console e erros da página também aparecem.
#>
param(
  [string]$Url = 'http://localhost:8001/',
  [string]$Saida,
  [int]$Largura = 1280,
  [int]$Altura = 800,
  [switch]$Celular,
  [switch]$Escuro,
  [int]$Espera = 12,
  [string]$Js,
  [string]$Passos,
  [int]$Porta = 9333,
  [switch]$ManterPerfil,   # usa o mesmo perfil da execução anterior (cache e service worker guardados)
  [switch]$SemRede         # a página fica sem internet (para testar o uso sem sinal)
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$jss = New-Object Web.Script.Serialization.JavaScriptSerializer
$jss.MaxJsonLength = [int]::MaxValue

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome/Edge não encontrado' }
$perfil = Join-Path $env:TEMP "viagem-cdp-$Porta"
if ((Test-Path $perfil) -and -not $ManterPerfil) { Remove-Item $perfil -Recurse -Force -ErrorAction SilentlyContinue }
if ($Celular) { if ($Largura -eq 1280) { $Largura = 390 }; if ($Altura -eq 800) { $Altura = 844 } }
$argv = @('--headless=new', "--remote-debugging-port=$Porta", "--user-data-dir=$perfil", '--no-first-run', '--no-default-browser-check',
  "--window-size=$Largura,$Altura", '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--hide-scrollbars', '--mute-audio')
# sem rede de verdade: um proxy que não existe derruba tudo, inclusive o service worker e o próprio localhost
if ($SemRede) { $argv += @('--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=<-loopback>') }
$argv += 'about:blank'
$proc = Start-Process -FilePath $chrome -ArgumentList $argv -PassThru -WindowStyle Hidden

try {
  # espera o Chrome abrir a porta de depuração
  $alvo = $null
  for ($i = 0; $i -lt 50 -and -not $alvo; $i++) {
    Start-Sleep -Milliseconds 200
    try { $alvo = (Invoke-RestMethod -UseBasicParsing "http://127.0.0.1:$Porta/json/list") | Where-Object { $_.type -eq 'page' } | Select-Object -First 1 } catch { }
  }
  if (-not $alvo) { throw 'Chrome não respondeu na porta de depuração' }

  $ws = New-Object Net.WebSockets.ClientWebSocket
  $ct = [Threading.CancellationToken]::None
  $ws.ConnectAsync([Uri]$alvo.webSocketDebuggerUrl, $ct).Wait()
  $script:n = 0

  # uma leitura pendente fica guardada entre as chamadas (o WebSocket não aceita duas ao mesmo tempo)
  $script:rx = $null; $script:mem = $null
  function Receber([int]$ms = 0) {
    while ($true) {
      if (-not $script:rx) {
        $b = New-Object byte[] 262144
        $script:rx = @{ buf = $b; task = $ws.ReceiveAsync((New-Object 'ArraySegment[byte]' (, $b)), $ct) }
        if (-not $script:mem) { $script:mem = New-Object IO.MemoryStream }
      }
      if ($ms -gt 0 -and -not $script:rx.task.Wait($ms)) { return $null }
      $r = $script:rx.task.Result
      $script:mem.Write($script:rx.buf, 0, $r.Count)
      $script:rx = $null
      if ($r.EndOfMessage) { $txt = [Text.Encoding]::UTF8.GetString($script:mem.ToArray()); $script:mem = $null; return $txt }
    }
  }
  function Evento($o) {
    $m = $o['method']
    if ($m -eq 'Runtime.consoleAPICalled') {
      $p = $o['params']; $txt = ($p['args'] | ForEach-Object { if ($_.ContainsKey('value')) { "$($_['value'])" } else { $_['description'] } }) -join ' '
      Write-Host "  [console.$($p['type'])] $txt"
    } elseif ($m -eq 'Runtime.exceptionThrown') {
      $d = $o['params']['exceptionDetails']; Write-Host "  [erro] $($d['text']) $($d['exception']['description'])"
    } elseif ($m -eq 'Log.entryAdded') {
      $e = $o['params']['entry']; if ($e['level'] -ne 'verbose') { Write-Host "  [log.$($e['level'])] $($e['text']) $($e['url'])" }
    }
  }
  function Cdp([string]$metodo, $params = @{}) {
    $script:n++
    $id = $script:n
    $msg = $jss.Serialize(@{ id = $id; method = $metodo; params = $params })
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync((New-Object 'ArraySegment[byte]' (, $bytes)), [Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
    while ($true) {
      $o = $jss.DeserializeObject((Receber))
      if ($o.ContainsKey('id') -and $o['id'] -eq $id) {
        if ($o.ContainsKey('error')) { throw "$metodo`: $($o['error']['message'])" }
        return $o['result']
      }
      Evento $o
    }
  }
  function Esperar([double]$s) {   # espera mostrando o console
    $fim = (Get-Date).AddSeconds($s)
    while ((Get-Date) -lt $fim) {
      $falta = [int]([Math]::Max(50, ($fim - (Get-Date)).TotalMilliseconds))
      $t = Receber $falta
      if ($t) { Evento ($jss.DeserializeObject($t)) }
    }
  }
  function Rodar([string]$codigo) {
    $r = Cdp 'Runtime.evaluate' @{ expression = "(async () => { $codigo })()"; awaitPromise = $true; returnByValue = $true; timeout = 60000 }
    if ($r.ContainsKey('exceptionDetails')) { Write-Host "  [js erro] $($r['exceptionDetails']['exception']['description'])"; return }
    $v = $r['result']['value']
    if ($null -ne $v) { Write-Host ($jss.Serialize($v)) }
  }
  function Print([string]$arq) {
    $r = Cdp 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes($arq, [Convert]::FromBase64String($r['data']))
    Write-Host "  print: $arq"
  }

  Cdp 'Runtime.enable' | Out-Null
  Cdp 'Log.enable' | Out-Null
  Cdp 'Page.enable' | Out-Null
  Cdp 'Emulation.setDeviceMetricsOverride' @{ width = $Largura; height = $Altura; deviceScaleFactor = 1; mobile = [bool]$Celular } | Out-Null
  if ($Celular) {
    Cdp 'Emulation.setUserAgentOverride' @{ userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } | Out-Null
    Cdp 'Emulation.setTouchEmulationEnabled' @{ enabled = $true; maxTouchPoints = 5 } | Out-Null
  }
  if ($Escuro) { Cdp 'Emulation.setEmulatedMedia' @{ features = @(@{ name = 'prefers-color-scheme'; value = 'dark' }) } | Out-Null }
  if ($SemRede) {
    Cdp 'Network.enable' | Out-Null
    Cdp 'Network.clearBrowserCache' | Out-Null
    Cdp 'Network.emulateNetworkConditions' @{ offline = $true; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    Write-Host '  (sem rede: proxy morto + página offline + cache HTTP limpo)'
  }
  Cdp 'Page.navigate' @{ url = $Url } | Out-Null
  Esperar $Espera

  if ($Passos) {
    foreach ($p in ($jss.DeserializeObject([IO.File]::ReadAllText($Passos, [Text.Encoding]::UTF8)))) {
      if ($p['nome']) { Write-Host "- $($p['nome'])" }
      if ($p['js']) { Rodar $p['js'] }
      if ($p['espera']) { Esperar ([double]$p['espera']) }
      if ($p['depois']) { Rodar $p['depois'] }
      if ($p['png']) { Print $p['png'] }
    }
  } else {
    if ($Js) { Rodar $Js }
    if ($Saida) { Print $Saida }
  }
  try { Cdp 'Browser.close' | Out-Null } catch { }
} finally {
  if ($proc -and -not $proc.HasExited) { Start-Sleep -Milliseconds 300; try { Stop-Process -Id $proc.Id -Force } catch { } }
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*viagem-cdp-$Porta*" } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch { } }
}
