<#
  build_perfil.ps1 — monta data\perfis.json: o perfil de altitude de cada linha de data\rotas.geojson (dias, planos B
  e etapas opcionais), usado pelo módulo src\mod\perfil.js.

  Fonte: Open-Meteo Elevation API (https://api.open-meteo.com/v1/elevation), modelo Copernicus DEM GLO-90 (90 m), sem
  chave; até 100 coordenadas por pedido. A Open-Meteo conta cada coordenada como uma chamada (limite de 600 por
  minuto): por isso a pausa de 11 s entre pedidos (com 1 s, ela devolve 429 depois de uns 10 pedidos). As altitudes
  que vieram ficam guardadas em tools\cache\perfil_altitudes.json: rodar de novo só pede o que falta.

  Amostras: a cada ~1 km ao longo da linha (a cada 250 m nas curtas, < 80 km: d04, d07, d10), mais o começo, o fim e
  os pontos da rota (paradas, Tioga Pass, New Priest Grade). Onde duas linhas passam pela mesma estrada (planos B,
  opcionais, ida e volta), as amostras de uma servem para a outra: menos pedidos e o mesmo desenho nos dois perfis.

  Limpeza: o modelo de relevo vê o morro em cima dos túneis, o fundo do cânion embaixo das pontes (Glen Canyon Bridge,
  no dia 6) e mistura o paredão à estrada nos cânions (shuttle de Zion). Lombada curta (até 2,5 km) que entra e sai com
  rampa acima de -Rampa (12%; a mais forte da viagem, na Towne Pass, tem ~9%) vira a reta entre as bordas; as amostras
  dos pontos da rota que ficam na estrada (Tunnel View, Tioga Pass) não mudam.

  Em 04/10/2026: 5.494 amostras, 55 pedidos (5.477 coordenadas), data\perfis.json com ~69 KB.

  Saída (uma linha por rota; "_info" diz a fonte e a data):
    "<id>": { "d": [km, 1 casa], "z": [m], "sobe": m, "desce": m, "max": [km, m], "min": [km, m] }
    d vai de 0 ao km oficial da rota (properties.km): a linha simplificada é um pouco mais curta que a estrada.
    sobe/desce = soma das subidas e descidas do perfil suavizado (média de ±0,6 km) ignorando oscilações < 10 m.

  Uso (na pasta do projeto):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build_perfil.ps1 -Seco    # só conta amostras e pedidos
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build_perfil.ps1          # pede o que falta e grava
  Opções:
    -Renovar        pede tudo de novo (ignora as altitudes guardadas)
    -SoCache        não usa a rede (falha se faltar alguma altitude)
    -Passo 1 -PassoCurto 0.25 -Curta 80   km entre amostras; linhas com menos de -Curta km usam o passo curto
    -Pausa 11       segundos entre pedidos
    -Ver d06:0-12   mostra as amostras desse pedaço da rota, antes e depois da limpeza (para conferir)
    -Saida arquivo  grava em outro lugar (padrão: data\perfis.json)
#>
param(
  [switch]$Seco,
  [switch]$Renovar,
  [switch]$SoCache,
  [double]$Passo = 1.0,
  [double]$PassoCurto = 0.25,
  [double]$Curta = 80,
  [double]$Rampa = 0.12,
  [double]$Pausa = 11,
  [string[]]$Ver,          # ex.: d06:0-12 — mostra as amostras desse pedaço (antes e depois da limpeza)
  [string]$Saida
)
$ErrorActionPreference = 'Stop'
# com -File a lista chega como um texto só ("d06:0-12,d09:420-445")
if ($Ver) { $Ver = @($Ver | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

$inv  = [Globalization.CultureInfo]::InvariantCulture   # ponto decimal sempre (a máquina está em pt-BR)
$utf8 = New-Object Text.UTF8Encoding $false               # UTF-8 sem BOM
$UA   = 'viagem-motorhome-app/0.1 (uso pessoal)'
$raiz = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $PSScriptRoot 'cache'
$cacheArq = Join-Path $cacheDir 'perfil_altitudes.json'
if (-not $Saida) { $Saida = Join-Path $raiz 'data\perfis.json' }
$API = 'https://api.open-meteo.com/v1/elevation'
$LOTE = 100   # coordenadas por pedido (limite da API)

$sp = [Net.ServicePointManager]::SecurityProtocol
if ($sp -ne [Net.SecurityProtocolType]::SystemDefault) { [Net.ServicePointManager]::SecurityProtocol = $sp -bor [Net.SecurityProtocolType]::Tls12 }
Add-Type -AssemblyName System.Web.Extensions
$jss = New-Object Web.Script.Serialization.JavaScriptSerializer
$jss.MaxJsonLength = [int]::MaxValue

function N([double]$v, [string]$fmt = '0.#') { $v.ToString($fmt, $inv) }
function LerJson([string]$arq) { , $jss.DeserializeObject([IO.File]::ReadAllText($arq, [Text.Encoding]::UTF8)) }

# ---------- geometria (plano local: bom para trechos de poucos km) ----------
$KM_GRAU = 6371.0088 * [math]::PI / 180   # km por grau de latitude
$RAD = [math]::PI / 180
function Dist([double]$x1, [double]$y1, [double]$x2, [double]$y2) {
  $dx = ($x2 - $x1) * [math]::Cos(($y1 + $y2) / 2 * $RAD) * $KM_GRAU
  $dy = ($y2 - $y1) * $KM_GRAU
  [math]::Sqrt($dx * $dx + $dy * $dy)
}
# grade de busca dos segmentos de cada linha (células de 0,02°, segmento com folga de ~60 m)
$CEL = 0.02; $FOLGA = 0.0006
function Indice($R) {
  $g = @{}
  for ($i = 0; $i -lt $R.x.Length - 1; $i++) {
    $cx0 = [math]::Floor(([math]::Min($R.x[$i], $R.x[$i + 1]) - $FOLGA) / $CEL); $cx1 = [math]::Floor(([math]::Max($R.x[$i], $R.x[$i + 1]) + $FOLGA) / $CEL)
    $cy0 = [math]::Floor(([math]::Min($R.y[$i], $R.y[$i + 1]) - $FOLGA) / $CEL); $cy1 = [math]::Floor(([math]::Max($R.y[$i], $R.y[$i + 1]) + $FOLGA) / $CEL)
    for ($cx = $cx0; $cx -le $cx1; $cx++) { for ($cy = $cy0; $cy -le $cy1; $cy++) {
      $k = "$cx,$cy"
      if (-not $g.ContainsKey($k)) { $g[$k] = New-Object 'Collections.Generic.List[int]' }
      $g[$k].Add($i)
    } }
  }
  $R.grade = $g
}
<# posições ao longo da linha (km) onde ela passa a até tolKm do ponto; a mesma estrada pode passar duas vezes
   (ida e volta): devolve uma posição por passagem #>
function Projetar($R, [double]$lon, [double]$lat, [double]$tolKm) {
  $segs = $R.grade["$([math]::Floor($lon / $CEL)),$([math]::Floor($lat / $CEL))"]
  if (-not $segs) { return ,@() }
  $cl = [math]::Cos($lat * $RAD) * $KM_GRAU
  $achados = New-Object 'Collections.Generic.List[double[]]'
  foreach ($i in $segs) {
    $ax = ($R.x[$i] - $lon) * $cl; $ay = ($R.y[$i] - $lat) * $KM_GRAU
    $dx = ($R.x[$i + 1] - $lon) * $cl - $ax; $dy = ($R.y[$i + 1] - $lat) * $KM_GRAU - $ay
    $LL = $dx * $dx + $dy * $dy
    $t = 0.0; if ($LL -gt 0) { $t = [math]::Max(0.0, [math]::Min(1.0, - ($ax * $dx + $ay * $dy) / $LL)) }
    $px = $ax + $t * $dx; $py = $ay + $t * $dy
    $dd = [math]::Sqrt($px * $px + $py * $py)
    if ($dd -le $tolKm) { $achados.Add([double[]]@(($R.cum[$i] + $t * ($R.cum[$i + 1] - $R.cum[$i])), $dd)) }
  }
  if ($achados.Count -eq 0) { return ,@() }
  $ord = @($achados | Sort-Object { $_[0] })
  $res = New-Object 'Collections.Generic.List[double]'
  $melhor = $ord[0]
  for ($k = 1; $k -lt $ord.Count; $k++) {
    if ($ord[$k][0] - $ord[$k - 1][0] -gt 0.2) { $res.Add($melhor[0]); $melhor = $ord[$k] }
    elseif ($ord[$k][1] -lt $melhor[1]) { $melhor = $ord[$k] }
  }
  $res.Add($melhor[0])
  return ,$res.ToArray()
}
# ponto da linha a s km do começo
function PontoEm($R, [double]$s) {
  $c = $R.cum; $a = 0; $b = $c.Length - 1
  if ($s -le 0) { return @($R.x[0], $R.y[0]) }
  if ($s -ge $c[$b]) { return @($R.x[$b], $R.y[$b]) }
  while ($b - $a -gt 1) { $m = [int](($a + $b) / 2); if ($c[$m] -le $s) { $a = $m } else { $b = $m } }
  $t = if ($c[$b] -gt $c[$a]) { ($s - $c[$a]) / ($c[$b] - $c[$a]) } else { 0 }
  @(($R.x[$a] + $t * ($R.x[$b] - $R.x[$a])), ($R.y[$a] + $t * ($R.y[$b] - $R.y[$a])))
}

# ---------- linhas ----------
$geo    = LerJson (Join-Path $raiz 'data\rotas.geojson')
$pontos = LerJson (Join-Path $raiz 'data\pontos.json')
$TIPO = @{ principal = 0; shuttle = 0; planoB = 1; opcional = 2 }
$rotas = New-Object Collections.ArrayList
$ix = 0
foreach ($f in $geo['features']) {
  $p = $f['properties']; $c = $f['geometry']['coordinates']; $n = $c.Count
  $x = New-Object double[] $n; $y = New-Object double[] $n; $cum = New-Object double[] $n
  for ($i = 0; $i -lt $n; $i++) { $x[$i] = [double]$c[$i][0]; $y[$i] = [double]$c[$i][1] }
  for ($i = 1; $i -lt $n; $i++) { $cum[$i] = $cum[$i - 1] + (Dist $x[$i - 1] $y[$i - 1] $x[$i] $y[$i]) }
  $L = $cum[$n - 1]
  [void]$rotas.Add(@{ id = [string]$p['id']; tipo = [string]$p['tipo']; km = [double]$p['km']; pontos = @($p['pontos']); ix = $ix++
    x = $x; y = $y; cum = $cum; L = $L; passo = $(if ($L -lt $Curta) { $PassoCurto } else { $Passo })
    minx = ($x | Measure-Object -Minimum).Minimum - 0.01; maxx = ($x | Measure-Object -Maximum).Maximum + 0.01
    miny = ($y | Measure-Object -Minimum).Minimum - 0.01; maxy = ($y | Measure-Object -Maximum).Maximum + 0.01 })
}

# ---------- amostras (as das linhas já feitas servem para as seguintes) ----------
$S_lon = New-Object 'Collections.Generic.List[double]'
$S_lat = New-Object 'Collections.Generic.List[double]'
function Chave([int]$j) { '{0},{1}' -f $S_lat[$j].ToString('0.00000', $inv), $S_lon[$j].ToString('0.00000', $inv) }
function NovaAmostra($R, [double]$s) {
  $pt = PontoEm $R $s
  $S_lon.Add($pt[0]); $S_lat.Add($pt[1])
  return $S_lon.Count - 1
}
# as curtas primeiro (amostras densas reaproveitadas pelas outras), depois principais, planos B e opcionais
$ordem = @($rotas | Sort-Object { $_.passo }, { $TIPO[$_.tipo] }, { $_.ix })
foreach ($R in $ordem) {
  Indice $R
  $marc = New-Object 'Collections.Generic.List[double[]]'   # [km na linha, índice da amostra]
  # 1) amostras de outras linhas que caem nesta estrada (a até 25 m)
  $nGlob = $S_lon.Count
  for ($j = 0; $j -lt $nGlob; $j++) {
    $lo = $S_lon[$j]; $la = $S_lat[$j]
    if ($lo -lt $R.minx -or $lo -gt $R.maxx -or $la -lt $R.miny -or $la -gt $R.maxy) { continue }
    foreach ($s in (Projetar $R $lo $la 0.025)) { $marc.Add([double[]]@($s, $j)) }
  }
  $R.reuso = $marc.Count
  # 2) começo, fim e pontos da rota (a altitude exata do passo da Tioga, por exemplo), se não houver amostra perto
  $fixos = New-Object 'Collections.Generic.List[double]'
  $fixos.Add(0); $fixos.Add($R.L)
  $presos = New-Object 'Collections.Generic.List[double]'
  foreach ($pp in $R.pontos) {
    $P = $pontos[$pp]
    if (-not $P) { continue }
    foreach ($s in (Projetar $R ([double]$P['lon']) ([double]$P['lat']) 0.3)) { $fixos.Add($s) }
    # o ponto que fica na própria estrada (a até 60 m) não passa pela limpeza
    foreach ($s in (Projetar $R ([double]$P['lon']) ([double]$P['lat']) 0.06)) { $presos.Add($s) }
  }
  $R.presos = $presos.ToArray()
  foreach ($s in $fixos) {
    $perto = $false
    foreach ($m in $marc) { if ([math]::Abs($m[0] - $s) -lt 0.04) { $perto = $true; break } }
    if (-not $perto) { $marc.Add([double[]]@($s, (NovaAmostra $R $s))) }
  }
  # 3) ordena, tira as repetidas (a menos de 40 m) e preenche os vãos maiores que 1,5 passo
  $ord = @($marc | Sort-Object { $_[0] })
  $lim = New-Object 'Collections.Generic.List[double[]]'
  foreach ($m in $ord) { if ($lim.Count -eq 0 -or $m[0] - $lim[$lim.Count - 1][0] -ge 0.04) { $lim.Add($m) } }
  $am = New-Object 'Collections.Generic.List[double[]]'
  for ($k = 0; $k -lt $lim.Count; $k++) {
    $am.Add($lim[$k])
    if ($k -eq $lim.Count - 1) { break }
    $a = $lim[$k][0]; $b = $lim[$k + 1][0]
    if ($b - $a -gt 1.5 * $R.passo) {
      $nv = [math]::Round(($b - $a) / $R.passo)
      for ($q = 1; $q -lt $nv; $q++) { $s = $a + ($b - $a) * $q / $nv; $am.Add([double[]]@($s, (NovaAmostra $R $s))) }
    }
  }
  $R.amostras = $am
  $R.novas = $S_lon.Count - $nGlob
}

# ---------- altitudes: as guardadas e as que faltam ----------
$alt = @{}
if (-not $Renovar -and (Test-Path $cacheArq)) {
  $g = LerJson $cacheArq
  foreach ($k in $g.Keys) { $alt[$k] = [double]$g[$k] }
}
$falta = New-Object 'Collections.Generic.List[string]'
$vistas = @{}
for ($j = 0; $j -lt $S_lon.Count; $j++) {
  $k = Chave $j
  if (-not $alt.ContainsKey($k) -and -not $vistas.ContainsKey($k)) { $falta.Add($k); $vistas[$k] = 1 }
}
$nPed = [math]::Ceiling($falta.Count / $LOTE)
Write-Host ''
Write-Host 'linha  km     passo  amostras  reaproveitadas  novas'
foreach ($R in $rotas) {
  Write-Host ('{0,-6} {1,6} {2,5}  {3,8}  {4,14}  {5,5}' -f $R.id, (N $R.km '0.0'), (N $R.passo '0.00'), $R.amostras.Count, $R.reuso, $R.novas)
}
Write-Host ("amostras: {0} · guardadas: {1} · faltam: {2} → {3} pedido(s) de até {4}" -f $S_lon.Count, ($S_lon.Count - $falta.Count), $falta.Count, $nPed, $LOTE)
if ($Seco) { return }

if ($falta.Count) {
  if ($SoCache) { throw "faltam $($falta.Count) altitudes no cache ($cacheArq)" }
  if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory $cacheDir | Out-Null }
  $ultimo = [datetime]::MinValue
  for ($b = 0; $b -lt $falta.Count; $b += $LOTE) {
    $grupo = $falta.GetRange($b, [math]::Min($LOTE, $falta.Count - $b))
    $lats = ($grupo | ForEach-Object { $_.Split(',')[0] }) -join ','
    $lons = ($grupo | ForEach-Object { $_.Split(',')[1] }) -join ','
    $url = "$API`?latitude=$lats&longitude=$lons"
    $ok = $false
    for ($t = 1; $t -le 3 -and -not $ok; $t++) {
      $espera = $Pausa * 1000 - ((Get-Date) - $ultimo).TotalMilliseconds
      if ($espera -gt 0) { Start-Sleep -Milliseconds ([int]$espera) }
      $ultimo = Get-Date
      try {
        $wc = New-Object Net.WebClient
        $wc.Headers.Add('User-Agent', $UA)
        $txt = $wc.DownloadString($url)
        $el = @($jss.DeserializeObject($txt)['elevation'])
        if ($el.Count -ne $grupo.Count) { throw "vieram $($el.Count) altitudes de $($grupo.Count)" }
        for ($i = 0; $i -lt $grupo.Count; $i++) { $alt[$grupo[$i]] = [double]$el[$i] }
        $ok = $true
        Write-Host ("pedido {0}/{1}: {2} pontos, {3:N1} KB" -f ([math]::Floor($b / $LOTE) + 1), $nPed, $grupo.Count, ($txt.Length / 1024))
      } catch {
        Write-Warning "pedido falhou (tentativa $t): $($_.Exception.Message)"
        if ("$($_.Exception.Message)" -match '429') { Start-Sleep -Seconds 65 } else { Start-Sleep -Seconds (3 * $t) }
      }
    }
    if (-not $ok) { throw "sem resposta: $url" }
    # guarda a cada pedido (se cair no meio, a próxima vez continua daqui)
    $dic = New-Object 'Collections.Generic.Dictionary[string,object]'
    foreach ($k in $alt.Keys) { $dic[$k] = $alt[$k] }
    [IO.File]::WriteAllText($cacheArq, $jss.Serialize($dic), $utf8)
  }
}

# ---------- perfis ----------
<# tira as lombadas falsas: um trecho curto (até 2,5 km) que entra e sai com rampa acima de G, em sentidos opostos, e
   fica todo do mesmo lado da reta entre os vizinhos, a mais de 20 m dela, vira essa reta. É o morro em cima de um
   túnel, o fundo do cânion embaixo de uma ponte ou o paredão misturado à estrada numa célula de 90 m. Começa pelos
   trechos mais largos e repete até não sobrar nenhum. As amostras nos pontos da rota não mudam: no fim de um bate-volta
   (o mirante do Tunnel View, por exemplo) a estrada sobe e "desce" de verdade. #>
function Limpar([double[]]$d, [double[]]$z, [bool[]]$fixo, [double]$G, [string]$id) {
  $z = [double[]]$z.Clone(); $n = $z.Length; $Gm = $G * 1000   # rampa em m por km
  for ($volta = 0; $volta -lt 6; $volta++) {
    $mudou = $false
    for ($w = 11; $w -ge 0; $w--) {   # os mais largos primeiro: uma lombada de 2 amostras sai inteira
      for ($i = 1; $i + $w -lt $n - 1; $i++) {
        $j = $i + $w; $a = $i - 1; $b = $j + 1
        if ($d[$j] - $d[$i] -gt 2.5) { continue }
        $preso = $false; for ($k = $i; $k -le $j; $k++) { if ($fixo[$k]) { $preso = $true } }
        if ($preso) { continue }   # os pontos da rota (mirante, passo) ficam como vieram
        $gEnt = ($z[$i] - $z[$a]) / ($d[$i] - $d[$a]); $gSai = ($z[$b] - $z[$j]) / ($d[$b] - $d[$j])
        $sg = 0
        if ($gEnt -gt $Gm -and $gSai -lt -$Gm) { $sg = 1 } elseif ($gEnt -lt -$Gm -and $gSai -gt $Gm) { $sg = -1 }
        if ($sg -eq 0) { continue }
        # as bordas têm de ser confiáveis (sem rampa forte do lado de fora); senão o vão entre dois picos vira um "buraco"
        if ($a -gt 0 -and [math]::Abs(($z[$a] - $z[$a - 1]) / ($d[$a] - $d[$a - 1])) -gt $Gm) { continue }
        if ($b -lt $n - 1 -and [math]::Abs(($z[$b + 1] - $z[$b]) / ($d[$b + 1] - $d[$b])) -gt $Gm) { continue }
        $minDev = [double]::MaxValue; $maxDev = 0.0
        for ($k = $i; $k -le $j; $k++) {
          $c = $z[$a] + ($z[$b] - $z[$a]) * ($d[$k] - $d[$a]) / ($d[$b] - $d[$a])
          $dv = $sg * ($z[$k] - $c); $minDev = [math]::Min($minDev, $dv); $maxDev = [math]::Max($maxDev, $dv)
        }
        if ($minDev -le 20) { continue }
        if (-not $script:Quieto) { Write-Host ('  {0}: {1} de {2} m entre km {3} e {4}' -f $id, $(if ($sg -gt 0) { 'pico' } else { 'buraco' }), [math]::Round($maxDev), (N $d[$a] '0.0'), (N $d[$b] '0.0')) }
        for ($k = $i; $k -le $j; $k++) { $z[$k] = $z[$a] + ($z[$b] - $z[$a]) * ($d[$k] - $d[$a]) / ($d[$b] - $d[$a]) }
        $mudou = $true
      }
    }
    if (-not $mudou) { break }
  }
  , $z
}
# média móvel ponderada pela distância (janela de ±meia km)
function Suavizar([double[]]$d, [double[]]$z, [double]$meia) {
  $n = $z.Length; $s = New-Object double[] $n; $a = 0; $b = 0
  for ($i = 0; $i -lt $n; $i++) {
    while ($d[$i] - $d[$a] -gt $meia) { $a++ }
    while ($b -lt $n - 1 -and $d[$b + 1] - $d[$i] -le $meia) { $b++ }
    $sw = 0.0; $sz = 0.0
    for ($k = $a; $k -le $b; $k++) { $w = 1 - [math]::Abs($d[$k] - $d[$i]) / ($meia * 1.01); $sw += $w; $sz += $w * $z[$k] }
    $s[$i] = $sz / $sw
  }
  , $s
}
# soma das subidas e descidas, ignorando oscilações menores que lim metros
function Desnivel([double[]]$z, [double]$lim) {
  $sobe = 0.0; $desce = 0.0; $ref = $z[0]
  foreach ($v in $z) {
    if ($v - $ref -ge $lim) { $sobe += $v - $ref; $ref = $v }
    elseif ($ref - $v -ge $lim) { $desce += $ref - $v; $ref = $v }
  }
  @($sobe, $desce)
}
# altitude no km s (reta entre amostras)
function ZEm([double[]]$d, [double[]]$z, [double]$s) {
  $a = 0; $b = $d.Length - 1
  if ($s -le $d[0]) { return $z[0] }
  if ($s -ge $d[$b]) { return $z[$b] }
  while ($b - $a -gt 1) { $m = [int](($a + $b) / 2); if ($d[$m] -le $s) { $a = $m } else { $b = $m } }
  $z[$a] + ($z[$b] - $z[$a]) * ($s - $d[$a]) / ($d[$b] - $d[$a])
}
<# maior subida e maior descida médias numa janela de J km: inclinação da reta que melhor passa pelas amostras da
   janela (uma amostra ruim na ponta pesa menos). O app faz a mesma conta. #>
function Rampas([double[]]$d, [double[]]$z, [double]$J) {
  $up = @(0, 0.0); $dn = @(0, 0.0); $n = $d.Length
  for ($i = 0; $i -lt $n; $i++) {
    if ($d[$i] + $J -gt $d[$n - 1] + 1e-9) { break }
    $sx = 0.0; $sz = 0.0; $m = 0
    for ($k = $i; $k -lt $n -and $d[$k] -le $d[$i] + $J + 1e-9; $k++) { $sx += $d[$k]; $sz += $z[$k]; $m++ }
    if ($m -lt 3) { continue }
    $mx = $sx / $m; $mz = $sz / $m; $sxx = 0.0; $sxz = 0.0
    for ($k = $i; $k -lt $i + $m; $k++) { $sxx += ($d[$k] - $mx) * ($d[$k] - $mx); $sxz += ($d[$k] - $mx) * ($z[$k] - $mz) }
    $g = $sxz / $sxx / 10   # m por km → %
    if ($g -gt $up[1]) { $up = @($d[$i], $g) }
    if ($g -lt $dn[1]) { $dn = @($d[$i], $g) }
  }
  @($up, $dn)
}
$sb = New-Object Text.StringBuilder
[void]$sb.Append("{`n")
[void]$sb.Append("  `"_info`": { `"fonte`": `"Open-Meteo Elevation API (Copernicus DEM GLO-90, 90 m)`", `"gerado_em`": `"$((Get-Date).ToString('yyyy-MM-dd', $inv))`", `"passo_km`": [$(N $Passo '0.##'), $(N $PassoCurto '0.##')], `"rampa_max`": $(N $Rampa '0.##') },`n")
Write-Host ''
$linhas = New-Object 'Collections.Generic.List[string]'
foreach ($R in $rotas) {
  $esc = $R.km / $R.L   # leva a linha simplificada ao km oficial
  $n = $R.amostras.Count
  $d = New-Object double[] $n; $z = New-Object double[] $n; $fx = New-Object bool[] $n
  for ($i = 0; $i -lt $n; $i++) {
    $d[$i] = $R.amostras[$i][0] * $esc
    $z[$i] = $alt[(Chave ([int]$R.amostras[$i][1]))]
    foreach ($s in $R.presos) { if ([math]::Abs($s - $R.amostras[$i][0]) -lt 0.045) { $fx[$i] = $true } }
  }
  $bruto = [double[]]$z.Clone()
  $z = Limpar $d $z $fx $Rampa $R.id
  foreach ($v in $Ver) {
    if ($v -notmatch "^$($R.id):([\d.]+)-([\d.]+)$") { continue }
    $k0 = [double]::Parse($Matches[1], $inv); $k1 = [double]::Parse($Matches[2], $inv)
    for ($i = 0; $i -lt $n; $i++) { if ($d[$i] -ge $k0 -and $d[$i] -le $k1) { Write-Host ('    {0} km {1,7}  bruto {2,6}  limpo {3,6}' -f $R.id, (N $d[$i] '0.00'), [math]::Round($bruto[$i]), [math]::Round($z[$i])) } }
  }
  # saída: d com 1 casa (sem repetir) e z inteiro
  $dOut = New-Object 'Collections.Generic.List[string]'; $zOut = New-Object 'Collections.Generic.List[string]'
  $dd = New-Object 'Collections.Generic.List[double]'; $zz = New-Object 'Collections.Generic.List[double]'
  $ult = ''
  for ($i = 0; $i -lt $n; $i++) {
    $t = N $d[$i] '0.0'
    if ($t -eq $ult) { continue }
    $ult = $t; $dOut.Add(($t -replace '\.0$', '')); $zOut.Add((N ([math]::Round($z[$i])) '0'))
    $dd.Add([double]$t); $zz.Add([math]::Round($z[$i]))
  }
  $dA = $dd.ToArray(); $zA = $zz.ToArray()
  $sv = Suavizar $dA $zA 0.6
  $sd = Desnivel $sv 10
  $iMax = 0; $iMin = 0
  for ($i = 1; $i -lt $zA.Length; $i++) { if ($zA[$i] -gt $zA[$iMax]) { $iMax = $i }; if ($zA[$i] -lt $zA[$iMin]) { $iMin = $i } }
  $rp = Rampas $dA $sv 3
  Write-Host ('{0,-5} {1,4} pts · sobe {2,5} m · desce {3,5} m · máx {4,5} m (km {5}) · mín {6,5} m (km {7}) · rampa +{8}% (km {9}) / {10}% (km {11})' -f $R.id, $dA.Length,
    [math]::Round($sd[0]), [math]::Round($sd[1]), $zA[$iMax], (N $dA[$iMax] '0.0'), $zA[$iMin], (N $dA[$iMin] '0.0'),
    (N $rp[0][1] '0.0'), (N $rp[0][0] '0'), (N $rp[1][1] '0.0'), (N $rp[1][0] '0'))
  $linhas.Add(("  `"{0}`": {{ `"d`": [{1}], `"z`": [{2}], `"sobe`": {3}, `"desce`": {4}, `"max`": [{5}, {6}], `"min`": [{7}, {8}] }}" -f $R.id,
    ($dOut -join ','), ($zOut -join ','), (N ([math]::Round($sd[0])) '0'), (N ([math]::Round($sd[1])) '0'),
    (N $dA[$iMax] '0.#'), (N $zA[$iMax] '0'), (N $dA[$iMin] '0.#'), (N $zA[$iMin] '0')))
}
[void]$sb.Append(($linhas -join ",`n"))
[void]$sb.Append("`n}`n")
[IO.File]::WriteAllText($Saida, $sb.ToString(), $utf8)
Write-Host ("gravado: {0} ({1:N1} KB, {2} linhas)" -f $Saida, ((Get-Item $Saida).Length / 1024), $rotas.Count)
