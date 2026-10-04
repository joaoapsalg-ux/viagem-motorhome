<#
  build_clima.ps1 — monta data\clima.json: a normal da época em cada pernoite da viagem (planos A e B) e em dois
  pontos de passagem do dia 9 (Tioga Pass e Badwater).

  Fonte: Open-Meteo Historical Weather API (https://archive-api.open-meteo.com/v1/archive), modelo ERA5 (~28 km,
  temperatura ajustada pela altitude do ponto), sem chave. Um pedido por lugar, do primeiro ao último ano de uma vez
  (só os dias em volta das datas contam), com pausa de ≥ 1 s entre pedidos. São 13 pedidos de ~140 KB (~1,8 MB).
  A Open-Meteo conta um pedido de 10 anos como centenas de "chamadas" (limite de 600 por minuto): depois de uns
  10 pedidos ela devolve 429 — aí o script espera 65 s e tenta de novo.

  Para cada lugar e data: anos 2016–2025, ±3 dias em volta da data (70 dias) →
    max / min      média das máximas e das mínimas (°C)
    min_abs        mínima mais baixa vista (°C), max_abs máxima mais alta vista
    chuva          % de dias com chuva ≥ 1 mm;  neve  % de dias com neve ≥ 1 cm (snowfall_sum)
    vento / rajada média do vento máximo e da rajada máxima do dia (km/h)

  Uso (na pasta do projeto):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build_clima.ps1
  Opções:
    -Renovar        pede de novo, ignorando as respostas guardadas (tools\cache\clima_<ponto>.json)
    -SoCache        não usa a rede: só as respostas guardadas (falha se faltar alguma)
    -Cache pasta    outra pasta para as respostas guardadas
    -Saida arquivo  grava em outro lugar (padrão: data\clima.json)
#>
param(
  [switch]$Renovar,
  [switch]$SoCache,
  [string]$Cache,
  [string]$Saida,
  [int]$Ano0 = 2016,
  [int]$Ano1 = 2025,
  [int]$Janela = 3
)
$ErrorActionPreference = 'Stop'

$inv  = [Globalization.CultureInfo]::InvariantCulture   # ponto decimal sempre (a máquina está em pt-BR)
$utf8 = New-Object Text.UTF8Encoding $false               # UTF-8 sem BOM
$UA   = 'viagem-motorhome-app/0.1 (uso pessoal)'
$raiz = Split-Path -Parent $PSScriptRoot
if (-not $Cache) { $Cache = Join-Path $PSScriptRoot 'cache' }
if (-not $Saida) { $Saida = Join-Path $raiz 'data\clima.json' }
$API  = 'https://archive-api.open-meteo.com/v1/archive'
$VARS = 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max'
# pontos de passagem com clima próprio (dia da viagem em que passam por eles)
$PASSAGEM = @(@{ ponto = 'tioga_pass'; dia = 9 }, @{ ponto = 'badwater'; dia = 9 })

$sp = [Net.ServicePointManager]::SecurityProtocol
if ($sp -ne [Net.SecurityProtocolType]::SystemDefault) { [Net.ServicePointManager]::SecurityProtocol = $sp -bor [Net.SecurityProtocolType]::Tls12 }
Add-Type -AssemblyName System.Web.Extensions
$jss = New-Object Web.Script.Serialization.JavaScriptSerializer
$jss.MaxJsonLength = [int]::MaxValue

function N([double]$v, [string]$fmt = '0.#') { $v.ToString($fmt, $inv) }
function LerJson([string]$arq) { , $jss.DeserializeObject([IO.File]::ReadAllText($arq, [Text.Encoding]::UTF8)) }
function Dia([string]$iso) { [datetime]::ParseExact($iso, 'yyyy-MM-dd', $inv) }

# ---------- quais lugares e datas ----------
$roteiro = LerJson (Join-Path $raiz 'data\roteiro.json')
$pontos  = LerJson (Join-Path $raiz 'data\pontos.json')
$datas = [ordered]@{}   # ponto -> lista de 'MM-dd'
function Juntar([string]$ponto, [string]$iso) {
  if (-not $pontos.ContainsKey($ponto)) { Write-Warning "ponto sem coordenadas: $ponto"; return }
  if (-not $datas.Contains($ponto)) { $datas[$ponto] = New-Object 'Collections.Generic.SortedSet[string]' }
  [void]$datas[$ponto].Add($iso.Substring(5))
}
foreach ($d in $roteiro['dias']) {
  Juntar $d['pernoite']['ponto'] $d['data']
  if ($d.ContainsKey('planoB') -and $d['planoB'].ContainsKey('pernoite')) { Juntar $d['planoB']['pernoite']['ponto'] $d['data'] }
}
foreach ($p in $PASSAGEM) {
  $d = $roteiro['dias'] | Where-Object { $_['n'] -eq $p.dia } | Select-Object -First 1
  Juntar $p.ponto $d['data']
}

# ---------- pedidos (guardados em tools\cache; ≥ 1 s entre eles) ----------
if (-not (Test-Path $Cache)) { New-Item -ItemType Directory $Cache | Out-Null }
$script:ultimo = [datetime]::MinValue
function Baixar([string]$url, [string]$arq) {
  for ($t = 1; $t -le 3; $t++) {
    $espera = 1100 - ((Get-Date) - $script:ultimo).TotalMilliseconds
    if ($espera -gt 0) { Start-Sleep -Milliseconds ([int]$espera) }
    $script:ultimo = Get-Date
    try {
      $wc = New-Object Net.WebClient
      $wc.Headers.Add('User-Agent', $UA)
      $wc.Encoding = [Text.Encoding]::UTF8
      $txt = $wc.DownloadString($url)
      [IO.File]::WriteAllText($arq, $txt, $utf8)
      Write-Host ("  {0:N0} KB" -f ($txt.Length / 1024))
      return
    } catch {
      Write-Warning "pedido falhou (tentativa $t): $($_.Exception.Message)"
      # 429 = passou do limite por minuto: espera o minuto virar
      if ("$($_.Exception.Message)" -match '429') { Start-Sleep -Seconds 65 } else { Start-Sleep -Seconds (3 * $t) }
    }
  }
  throw "sem resposta: $url"
}
# a resposta guardada cobre o intervalo pedido?
function Cobre($resp, [string]$ini, [string]$fim) {
  $t = $resp['daily']['time']
  return $t.Count -gt 0 -and $t[0] -le $ini -and $t[$t.Count - 1] -ge $fim
}

# ---------- normais ----------
function Media($l) { if ($l.Count) { ($l | Measure-Object -Average).Average } else { $null } }
$saidaLugares = [ordered]@{}
foreach ($ponto in $datas.Keys) {
  $P = $pontos[$ponto]
  $mds = @($datas[$ponto])
  # intervalo: da primeira data − janela à última + janela, do primeiro ao último ano
  $ini = "$Ano0-" + (Dia "$Ano0-$($mds[0])").AddDays(-$Janela).ToString('MM-dd', $inv)
  $fim = "$Ano1-" + (Dia "$Ano1-$($mds[-1])").AddDays($Janela).ToString('MM-dd', $inv)
  $arq = Join-Path $Cache "clima_$ponto.json"
  $resp = $null
  if (-not $Renovar -and (Test-Path $arq)) { $resp = LerJson $arq; if (-not (Cobre $resp $ini $fim)) { $resp = $null } }
  if (-not $resp) {
    if ($SoCache) { throw "falta a resposta guardada de $ponto ($ini a $fim) em $arq" }
    $url = "$API`?latitude=$(N $P['lat'] '0.####')&longitude=$(N $P['lon'] '0.####')&start_date=$ini&end_date=$fim" +
      "&daily=$VARS&timezone=auto&models=era5"
    Write-Host "$ponto ($ini a $fim)"
    Baixar $url $arq
    $resp = LerJson $arq
    if (-not (Cobre $resp $ini $fim)) { throw "resposta de $ponto não cobre $ini a $fim" }
  }
  $D = $resp['daily']
  $idx = @{}
  for ($i = 0; $i -lt $D['time'].Count; $i++) { $idx[$D['time'][$i]] = $i }

  $normais = [ordered]@{}
  foreach ($md in $mds) {
    $tx = New-Object Collections.ArrayList; $tn = New-Object Collections.ArrayList
    $ve = New-Object Collections.ArrayList; $ra = New-Object Collections.ArrayList
    $nChuva = 0; $nNeve = 0; $nPrec = 0; $nNev = 0; $nDias = 0
    $minAbs = [double]::MaxValue; $anoMin = 0; $maxAbs = [double]::MinValue
    for ($y = $Ano0; $y -le $Ano1; $y++) {
      $c = Dia "$y-$md"
      for ($k = -$Janela; $k -le $Janela; $k++) {
        $iso = $c.AddDays($k).ToString('yyyy-MM-dd', $inv)
        if (-not $idx.ContainsKey($iso)) { continue }
        $i = $idx[$iso]
        $x = $D['temperature_2m_max'][$i]; $n = $D['temperature_2m_min'][$i]
        if ($null -eq $x -or $null -eq $n) { continue }
        $nDias++
        [void]$tx.Add([double]$x); [void]$tn.Add([double]$n)
        if ([double]$n -lt $minAbs) { $minAbs = [double]$n; $anoMin = $y }
        if ([double]$x -gt $maxAbs) { $maxAbs = [double]$x }
        $pr = $D['precipitation_sum'][$i]; if ($null -ne $pr) { $nPrec++; if ([double]$pr -ge 1) { $nChuva++ } }
        # neve ≥ 1 cm: a célula do ERA5 (~28 km) pega o planalto em volta e marca "traço" de neve até em Zion
        $sn = $D['snowfall_sum'][$i]; if ($null -ne $sn) { $nNev++; if ([double]$sn -ge 1) { $nNeve++ } }
        $w = $D['wind_speed_10m_max'][$i]; if ($null -ne $w) { [void]$ve.Add([double]$w) }
        $g = $D['wind_gusts_10m_max'][$i]; if ($null -ne $g) { [void]$ra.Add([double]$g) }
      }
    }
    if (-not $nDias) { Write-Warning "$ponto $md sem dados"; continue }
    $normais[$md] = [ordered]@{
      n = $nDias; max = (Media $tx); min = (Media $tn); min_abs = $minAbs; ano_min = $anoMin; max_abs = $maxAbs
      chuva = $(if ($nPrec) { 100.0 * $nChuva / $nPrec } else { $null })
      neve  = $(if ($nNev) { 100.0 * $nNeve / $nNev } else { $null })
      vento = (Media $ve); rajada = (Media $ra)
    }
    $v = $normais[$md]
    Write-Host ("  {0} {1}: máx {2} · mín {3} (mais baixa {4} em {5}) · chuva {6}% · neve {7}% · rajada {8} km/h" -f $ponto, $md,
      (N $v.max), (N $v.min), (N $v.min_abs), $v.ano_min, (N $v.chuva '0'), (N $v.neve '0'), (N $v.rajada '0'))
  }
  $saidaLugares[$ponto] = @{ elev = $resp['elevation']; normais = $normais }
}

# ---------- grava (uma linha por data, para dar para ler e comparar no git) ----------
function Num($v, [string]$fmt = '0.#') { if ($null -eq $v) { 'null' } else { N $v $fmt } }
$sb = New-Object Text.StringBuilder
[void]$sb.Append("{`n")
[void]$sb.Append("  `"fonte`": `"Open-Meteo Historical Weather API (archive-api.open-meteo.com), modelo ERA5 (~28 km), temperatura ajustada pela altitude do ponto`",`n")
[void]$sb.Append("  `"descricao`": `"Normal da época: anos $Ano0–$Ano1, ±$Janela dias em volta da data. max/min = médias das máximas e mínimas (°C); min_abs/max_abs = extremos vistos; chuva = % de dias com ≥ 1 mm; neve = % de dias com ≥ 1 cm de neve; vento/rajada = médias dos máximos do dia (km/h). Estimativa para o ponto, não é previsão.`",`n")
[void]$sb.Append("  `"anos`": [$Ano0, $Ano1],`n  `"janela_dias`": $Janela,`n")
[void]$sb.Append("  `"gerado_em`": `"$((Get-Date).ToString('yyyy-MM-dd', $inv))`",`n")
[void]$sb.Append("  `"lugares`": {`n")
$i = 0
foreach ($ponto in $saidaLugares.Keys) {
  $L = $saidaLugares[$ponto]
  [void]$sb.Append("    `"$ponto`": { `"elev`": $(Num $L.elev '0'), `"normais`": {`n")
  $j = 0
  foreach ($md in $L.normais.Keys) {
    $v = $L.normais[$md]
    $campos = @("`"n`": $($v.n)", "`"max`": $(Num $v.max)", "`"min`": $(Num $v.min)", "`"min_abs`": $(Num $v.min_abs)", "`"ano_min`": $($v.ano_min)",
      "`"max_abs`": $(Num $v.max_abs)", "`"chuva`": $(Num $v.chuva '0')", "`"neve`": $(Num $v.neve '0')", "`"vento`": $(Num $v.vento '0')", "`"rajada`": $(Num $v.rajada '0')")
    $j++
    [void]$sb.Append("      `"$md`": { $($campos -join ', ') }$(if ($j -lt $L.normais.Count) { ',' })`n")
  }
  $i++
  [void]$sb.Append("    } }$(if ($i -lt $saidaLugares.Count) { ',' })`n")
}
[void]$sb.Append("  }`n}`n")
[IO.File]::WriteAllText($Saida, $sb.ToString(), $utf8)
Write-Host "gravado: $Saida ($($saidaLugares.Count) lugares)"
