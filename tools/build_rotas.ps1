<#
  build_rotas.ps1 — monta data\rotas.geojson e data\pontos.json a partir de tools\rotas_entrada.json.

  Uso (na pasta do projeto):
    powershell -ExecutionPolicy Bypass -File tools\build_rotas.ps1 -Conferir    # confere os pontos no Nominatim (só relata)
    powershell -ExecutionPolicy Bypass -File tools\build_rotas.ps1              # traça as rotas e grava data\
  Opções:
    -Tol 10        tolerância da simplificação, em metros
    -Somente d03   só estas rotas (ou pontos, com -Conferir); não grava nada em data\
    -Renovar       ignora o cache (tools\cache) e pergunta de novo aos servidores
    -Vias          lista as vias de cada trecho (pede steps=true) para conferir por onde a rota passa

  Formato da entrada (além de pontos/rotas):
    rota.kmh          tempo pela velocidade dada em vez do tempo do servidor (ex.: shuttle de Zion)
    rota.trechos_alt  [{ de, para, perfil: "bike"|"pe"|"carro", kmh, motivo }] — trecho traçado por outro perfil
                      (via fechada no OSM, por exemplo); o tempo sai de kmh
    rota.km_planilha  só para conferir; rota.obs vai para properties.obs
    passagens         { id: { lat, lon, motivo } } — pontos só de passagem, usados na rota como "~id" para obrigar o
                      caminho (ex.: New Priest Grade em vez da Old Priest Grade); não entram em pontos.json nem em
                      properties.pontos, e os trechos em volta deles são somados
#>
param(
  [switch]$Conferir,
  [double]$Tol = 10,
  [string[]]$Somente,
  [switch]$Renovar,
  [switch]$Vias
)
$ErrorActionPreference = 'Stop'
# com -File a lista chega como um texto só ("d03,d12")
if ($Somente) { $Somente = @($Somente | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

$inv  = [Globalization.CultureInfo]::InvariantCulture   # ponto decimal sempre (a máquina está em pt-BR)
$utf8 = New-Object Text.UTF8Encoding $false               # UTF-8 sem BOM
$UA   = 'viagem-motorhome-app/0.1 (uso pessoal)'
$raiz       = Split-Path -Parent $PSScriptRoot
$entradaArq = Join-Path $PSScriptRoot 'rotas_entrada.json'
$cacheDir   = Join-Path $PSScriptRoot 'cache'
$dataDir    = Join-Path $raiz 'data'
# TLS: deixa o padrão do sistema (forçar só TLS 1.2 quebra o router.project-osrm.org); em .NET antigo, acrescenta 1.2
$sp = [Net.ServicePointManager]::SecurityProtocol
if ($sp -ne [Net.SecurityProtocolType]::SystemDefault) { [Net.ServicePointManager]::SecurityProtocol = $sp -bor [Net.SecurityProtocolType]::Tls12 }
Add-Type -AssemblyName System.Web.Extensions
$jss = New-Object Web.Script.Serialization.JavaScriptSerializer
$jss.MaxJsonLength = [int]::MaxValue

# servidores por perfil (o routing.openstreetmap.de usa "driving" no caminho para todos)
$PERFIS = @{
  carro = 'https://router.project-osrm.org/route/v1/driving/'
  pe    = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/'
  bike  = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/'
}

# ---------- utilidades ----------
function N([double]$v, [string]$fmt = '0.#####') { $v.ToString($fmt, $inv) }

function JStr([string]$s) {
  '"' + $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t') + '"'
}

function Dist([double]$la1, [double]$lo1, [double]$la2, [double]$lo2) {
  # distância em metros (haversine)
  $r = [Math]::PI / 180
  $sa = [Math]::Sin(($la2 - $la1) * $r / 2); $so = [Math]::Sin(($lo2 - $lo1) * $r / 2)
  $a = $sa * $sa + [Math]::Cos($la1 * $r) * [Math]::Cos($la2 * $r) * $so * $so
  2 * 6371008.8 * [Math]::Asin([Math]::Min(1.0, [Math]::Sqrt($a)))
}

function LerJson([string]$txt) { , $jss.DeserializeObject($txt) }

# pedido HTTP com cache em disco, ≥ 1,1 s entre pedidos e algumas tentativas
$script:ultimoPedido = [datetime]::MinValue
function Pedir([string]$url) {
  if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory $cacheDir | Out-Null }
  $sha = [Security.Cryptography.SHA1]::Create()
  $h = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($url)) | ForEach-Object { $_.ToString('x2') })
  $arq = Join-Path $cacheDir "$h.json"
  if (-not $Renovar -and (Test-Path $arq)) { return [IO.File]::ReadAllText($arq, [Text.Encoding]::UTF8) }
  for ($t = 1; $t -le 4; $t++) {
    $espera = 1100 - ((Get-Date) - $script:ultimoPedido).TotalMilliseconds
    if ($espera -gt 0) { Start-Sleep -Milliseconds ([int]$espera) }
    $script:ultimoPedido = Get-Date
    try {
      $wc = New-Object Net.WebClient
      $wc.Headers.Add('User-Agent', $UA)
      $wc.Encoding = [Text.Encoding]::UTF8
      $txt = $wc.DownloadString($url)
      [IO.File]::WriteAllText($arq, $txt, $utf8)
      return $txt
    } catch {
      $ex = $_.Exception
      while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }
      $cod = 0
      if ($ex -and $ex.Response) {
        $cod = [int]$ex.Response.StatusCode
        if ($cod -eq 400) {   # o OSRM responde 400 com JSON (NoRoute, NoSegment...)
          $sr = New-Object IO.StreamReader($ex.Response.GetResponseStream(), [Text.Encoding]::UTF8)
          return $sr.ReadToEnd()
        }
      }
      Write-Warning ("pedido falhou (HTTP {0}), tentativa {1}: {2}" -f $cod, $t, $url)
      Start-Sleep -Seconds (3 * $t)
    }
  }
  throw "sem resposta: $url"
}

# Douglas-Peucker iterativo (pilha, sem recursão); devolve os índices mantidos
function Simplificar([double[]]$lon, [double[]]$lat, [double]$tol) {
  $n = $lon.Length
  if ($n -le 2) { return , ([int[]](0..($n - 1))) }
  $lat0 = 0.0; foreach ($v in $lat) { $lat0 += $v }; $lat0 /= $n
  $kx = 111320.0 * [Math]::Cos($lat0 * [Math]::PI / 180); $ky = 110574.0   # graus -> metros (local)
  $x = New-Object double[] $n; $y = New-Object double[] $n
  for ($i = 0; $i -lt $n; $i++) { $x[$i] = $lon[$i] * $kx; $y[$i] = $lat[$i] * $ky }
  $manter = New-Object bool[] $n; $manter[0] = $true; $manter[$n - 1] = $true
  $pilha = New-Object 'Collections.Generic.Stack[int]'
  $pilha.Push(0); $pilha.Push($n - 1)
  $tol2 = $tol * $tol
  while ($pilha.Count -gt 0) {
    $b = $pilha.Pop(); $a = $pilha.Pop()
    if ($b - $a -lt 2) { continue }
    $ax = $x[$a]; $ay = $y[$a]; $dx = $x[$b] - $ax; $dy = $y[$b] - $ay
    $L2 = $dx * $dx + $dy * $dy
    $dmax = -1.0; $imax = -1
    for ($i = $a + 1; $i -lt $b; $i++) {
      $px = $x[$i] - $ax; $py = $y[$i] - $ay
      if ($L2 -gt 0) {
        # distância ao SEGMENTO (vale para ida e volta, em que a = b)
        $t = ($px * $dx + $py * $dy) / $L2
        if ($t -lt 0) { $t = 0.0 } elseif ($t -gt 1) { $t = 1.0 }
        $px -= $t * $dx; $py -= $t * $dy
      }
      $d = $px * $px + $py * $py
      if ($d -gt $dmax) { $dmax = $d; $imax = $i }
    }
    if ($dmax -gt $tol2) {
      $manter[$imax] = $true
      $pilha.Push($a); $pilha.Push($imax)
      $pilha.Push($imax); $pilha.Push($b)
    }
  }
  $idx = New-Object 'Collections.Generic.List[int]'
  for ($i = 0; $i -lt $n; $i++) { if ($manter[$i]) { $idx.Add($i) } }
  , $idx.ToArray()
}

# menor distância (m) de um ponto até a linha
function DistLinha([double]$la, [double]$lo, [double[]]$lon, [double[]]$lat) {
  $kx = 111320.0 * [Math]::Cos($la * [Math]::PI / 180); $ky = 110574.0
  $best = [double]::MaxValue
  for ($i = 0; $i -lt $lon.Length - 1; $i++) {
    $ax = ($lon[$i] - $lo) * $kx; $ay = ($lat[$i] - $la) * $ky
    $dx = ($lon[$i + 1] - $lon[$i]) * $kx; $dy = ($lat[$i + 1] - $lat[$i]) * $ky
    $L2 = $dx * $dx + $dy * $dy
    $t = 0.0
    if ($L2 -gt 0) { $t = - ($ax * $dx + $ay * $dy) / $L2; if ($t -lt 0) { $t = 0.0 } elseif ($t -gt 1) { $t = 1.0 } }
    $px = $ax + $t * $dx; $py = $ay + $t * $dy
    $d = $px * $px + $py * $py
    if ($d -lt $best) { $best = $d }
  }
  [Math]::Sqrt($best)
}

# ---------- entrada ----------
$cfg = Get-Content $entradaArq -Raw -Encoding UTF8 | ConvertFrom-Json
$pontos = [ordered]@{}
foreach ($p in $cfg.pontos.PSObject.Properties) { $pontos[$p.Name] = $p.Value }

# lugares que as rotas podem citar: os pontos e as passagens ("~id")
$lugares = @{}
foreach ($id in $pontos.Keys) { $lugares[$id] = $pontos[$id] }
if ($cfg.passagens) { foreach ($p in $cfg.passagens.PSObject.Properties) { $lugares['~' + $p.Name] = $p.Value } }

# ---------- 1. conferir os pontos no Nominatim ----------
if ($Conferir) {
  foreach ($id in $pontos.Keys) {
    if ($Somente -and $Somente -notcontains $id) { continue }
    $v = $pontos[$id]
    $busca = [string]$v.busca
    $url = 'https://nominatim.openstreetmap.org/search?q=' + [Uri]::EscapeDataString($busca) + '&format=jsonv2&limit=3&countrycodes=us'
    $res = LerJson (Pedir $url)
    if ((-not $res -or $res.Count -eq 0) -and $busca.Contains(',')) {
      # sem resultado: tenta só o nome (o Nominatim nem sempre liga o lugar ao parque/cidade do texto)
      $busca = $busca.Split(',')[0].Trim()
      $url = 'https://nominatim.openstreetmap.org/search?q=' + [Uri]::EscapeDataString($busca) + '&format=jsonv2&limit=3&countrycodes=us'
      $res = LerJson (Pedir $url)
    }
    Write-Output ('{0,-16} {1}  [{2}, {3}]' -f $id, $busca, (N $v.lat), (N $v.lon))
    if (-not $res -or $res.Count -eq 0) { Write-Output '      (nada encontrado)'; continue }
    foreach ($r in $res) {
      $rla = [double]::Parse($r['lat'], $inv); $rlo = [double]::Parse($r['lon'], $inv)
      $d = Dist $v.lat $v.lon $rla $rlo
      $marca = ''; if ($d -gt 300) { $marca = '   <<< longe' }
      $nome = [string]$r['display_name']; if ($nome.Length -gt 70) { $nome = $nome.Substring(0, 70) }
      Write-Output ('    {0,7} m  {1}/{2}  [{3}, {4}]  {5}{6}' -f (N $d '0'), $r['category'], $r['type'], (N $rla), (N $rlo), $nome, $marca)
    }
  }
  return
}

# ---------- 2. rotas ----------
$features = New-Object 'Collections.Generic.List[string]'
$problemas = New-Object 'Collections.Generic.List[string]'

foreach ($rota in $cfg.rotas) {
  if ($Somente -and $Somente -notcontains $rota.id) { continue }
  $ids = @($rota.pontos)
  foreach ($id in $ids) { if (-not $lugares.ContainsKey($id)) { throw "rota $($rota.id): ponto desconhecido '$id'" } }
  $nLegs = $ids.Count - 1

  # perfil e velocidade de cada trecho
  $legPerfil = New-Object string[] $nLegs
  $legKmh = New-Object double[] $nLegs
  $notas = New-Object 'Collections.Generic.List[string]'
  if ($rota.obs) { $notas.Add([string]$rota.obs) }
  foreach ($id in $ids) { if ($id.StartsWith('~') -and $lugares[$id].motivo) { $notas.Add([string]$lugares[$id].motivo) } }
  for ($k = 0; $k -lt $nLegs; $k++) {
    $legPerfil[$k] = $rota.perfil
    if ($rota.kmh) { $legKmh[$k] = [double]$rota.kmh }
    foreach ($alt in @($rota.trechos_alt)) {
      if ($alt -and $alt.de -eq $ids[$k] -and $alt.para -eq $ids[$k + 1]) {
        $legPerfil[$k] = $alt.perfil
        if ($alt.kmh) { $legKmh[$k] = [double]$alt.kmh }
        if ($alt.motivo) { $notas.Add([string]$alt.motivo) }
      }
    }
    if (-not $PERFIS.ContainsKey($legPerfil[$k])) { throw "rota $($rota.id): perfil desconhecido '$($legPerfil[$k])'" }
  }

  # pede ao servidor por grupos de trechos seguidos com o mesmo perfil
  $lonL = New-Object 'Collections.Generic.List[double]'
  $latL = New-Object 'Collections.Generic.List[double]'
  $trechos = New-Object 'Collections.Generic.List[object]'
  $encaixes = New-Object 'Collections.Generic.List[object]'
  $k = 0
  while ($k -lt $nLegs) {
    $j = $k
    while ($j + 1 -lt $nLegs -and $legPerfil[$j + 1] -eq $legPerfil[$k] -and $legKmh[$j + 1] -eq $legKmh[$k]) { $j++ }
    $coords = (($k..($j + 1)) | ForEach-Object { $q = $lugares[$ids[$_]]; (N $q.lon '0.######') + ',' + (N $q.lat '0.######') }) -join ';'
    $url = $PERFIS[$legPerfil[$k]] + $coords + '?overview=full&geometries=geojson&continue_straight=false'
    if ($Vias) { $url += '&steps=true' }
    $r = LerJson (Pedir $url)
    if ($r['code'] -ne 'Ok') { throw "rota $($rota.id): servidor respondeu $($r['code']) $($r['message'])" }
    $rt = $r['routes'][0]
    $wps = $r['waypoints']
    for ($w = 0; $w -lt $wps.Count; $w++) {
      $loc = $wps[$w]['location']
      $encaixes.Add(@{ id = $ids[$k + $w]; m = [double]$wps[$w]['distance']; via = [string]$wps[$w]['name']; lon = [double]$loc[0]; lat = [double]$loc[1] })
    }
    $cc = $rt['geometry']['coordinates']
    for ($i = 0; $i -lt $cc.Count; $i++) {
      $clo = [double]$cc[$i][0]; $cla = [double]$cc[$i][1]
      if ($lonL.Count -gt 0 -and $clo -eq $lonL[$lonL.Count - 1] -and $cla -eq $latL[$latL.Count - 1]) { continue }
      $lonL.Add($clo); $latL.Add($cla)
    }
    $legs = $rt['legs']
    for ($l = 0; $l -lt $legs.Count; $l++) {
      $km = [double]$legs[$l]['distance'] / 1000
      $seg = [double]$legs[$l]['duration']
      if ($legKmh[$k + $l] -gt 0) { $seg = $km / $legKmh[$k + $l] * 3600 }
      # vias do trecho (só com -Vias): nomes seguidos iguais juntos, só os que somam ≥ 1 km
      $listaVias = ''
      if ($Vias) {
        $vs = New-Object 'Collections.Generic.List[object]'
        foreach ($st in $legs[$l]['steps']) {
          $nm = [string]$st['name']; if ($st['ref']) { $nm = ($nm + ' ' + $st['ref']).Trim() }
          if (-not $nm) { $nm = '?' }
          if ($vs.Count -gt 0 -and $vs[$vs.Count - 1].n -eq $nm) { $vs[$vs.Count - 1].d += [double]$st['distance'] }
          else { $vs.Add(@{ n = $nm; d = [double]$st['distance'] }) }
        }
        $listaVias = (($vs | Where-Object { $_.d -ge 1000 } | ForEach-Object { '{0} {1}' -f $_.n, (N ($_.d / 1000) '0') }) -join ' > ')
      }
      $trechos.Add(@{ de = $ids[$k + $l]; para = $ids[$k + $l + 1]; km = $km; seg = $seg; perfil = $legPerfil[$k + $l]; vias = $listaVias })
    }
    $k = $j + 1
  }

  # totais e conferências
  $kmTot = 0.0; $segTot = 0.0; foreach ($t in $trechos) { $kmTot += $t.km; $segTot += $t.seg }
  $reta = 0.0
  for ($i = 0; $i -lt $nLegs; $i++) {
    $a = $lugares[$ids[$i]]; $b = $lugares[$ids[$i + 1]]
    $reta += (Dist $a.lat $a.lon $b.lat $b.lon) / 1000
  }
  $razao = $kmTot / [Math]::Max($reta, 0.001)

  $lonA = $lonL.ToArray(); $latA = $latL.ToArray()
  $idx = Simplificar $lonA $latA $Tol
  # arredonda para 5 casas e tira repetidos seguidos
  $sb = New-Object Text.StringBuilder
  $sLon = New-Object 'Collections.Generic.List[double]'; $sLat = New-Object 'Collections.Generic.List[double]'
  $parAnt = ''
  foreach ($i in $idx) {
    $par = '[' + (N $lonA[$i]) + ',' + (N $latA[$i]) + ']'
    if ($par -eq $parAnt) { continue }
    if ($sb.Length -gt 0) { [void]$sb.Append(',') }
    [void]$sb.Append($par); $parAnt = $par
    $sLon.Add([Math]::Round($lonA[$i], 5)); $sLat.Add([Math]::Round($latA[$i], 5))
  }
  $sLonA = $sLon.ToArray(); $sLatA = $sLat.ToArray()

  # relatório
  $planilha = ''; if ($rota.km_planilha) { $planilha = '  planilha ' + $rota.km_planilha }
  Write-Output ('{0,-5} {1,7} km {2,5} h{3}  razão {4}  vértices {5} -> {6}' -f $rota.id, (N $kmTot '0.0'), (N ($segTot / 3600) '0.0'), $planilha, (N $razao '0.00'), $lonA.Length, $sLonA.Length)
  if ($razao -gt 1.8) { $problemas.Add("$($rota.id): razão km/linha reta $(N $razao '0.00')") }
  foreach ($t in $trechos) {
    $extra = ''; if ($t.perfil -ne $rota.perfil) { $extra = "  (perfil $($t.perfil))" }
    Write-Output ('        {0,-15} -> {1,-15} {2,7} km {3,5} min{4}' -f $t.de, $t.para, (N $t.km '0.0'), (N ($t.seg / 60) '0'), $extra)
    if ($t.vias) { Write-Output ('            vias (km): ' + $t.vias) }
  }
  $piores = @($encaixes | Sort-Object { $_.m } -Descending | Select-Object -First 2)
  Write-Output ('        encaixe na via (maior): ' + (($piores | ForEach-Object { '{0} {1} m ({2})' -f $_.id, (N $_.m '0'), $_.via }) -join ' · '))
  foreach ($e in $encaixes) {
    if ($e.m -gt 150) { $problemas.Add("$($rota.id): ponto $($e.id) encaixou a $(N $e.m '0') m da via ($(N $e.lat), $(N $e.lon) '$($e.via)')") }
  }
  # meia-volta nos pontos do meio: normal num mirante no fim de um ramal, estranho num ponto de passagem
  $voltas = New-Object 'Collections.Generic.List[string]'
  $vistos = @{}
  foreach ($e in $encaixes) {
    if ($e.id -eq $ids[0] -or $e.id -eq $ids[$ids.Count - 1] -or $vistos.ContainsKey($e.id)) { continue }
    $vistos[$e.id] = 1
    $bi = 0; $bd = [double]::MaxValue
    for ($i = 0; $i -lt $lonA.Length; $i++) {
      $dx = ($lonA[$i] - $e.lon) * 0.8; $dy = $latA[$i] - $e.lat; $d = $dx * $dx + $dy * $dy
      if ($d -lt $bd) { $bd = $d; $bi = $i }
    }
    $ia = $bi; $acc = 0.0
    while ($ia -gt 0 -and $acc -lt 400) { $acc += Dist $latA[$ia] $lonA[$ia] $latA[$ia - 1] $lonA[$ia - 1]; $ia-- }
    $ib = $bi; $acc = 0.0
    while ($ib -lt $lonA.Length - 1 -and $acc -lt 400) { $acc += Dist $latA[$ib] $lonA[$ib] $latA[$ib + 1] $lonA[$ib + 1]; $ib++ }
    if ((Dist $latA[$ia] $lonA[$ia] $latA[$ib] $lonA[$ib]) -lt 150) { $voltas.Add($e.id) }
  }
  if ($voltas.Count -gt 0) { Write-Output ('        meia-volta em: ' + ($voltas -join ', ')) }
  foreach ($id in ($ids | Select-Object -Unique)) {
    $q = $lugares[$id]
    $d = DistLinha $q.lat $q.lon $sLonA $sLatA
    if ($d -gt 200) { $problemas.Add("$($rota.id): linha passa a $(N $d '0') m de $id") }
  }

  # feature GeoJSON (escrita à mão: ConvertTo-Json desembrulha arrays de 1 elemento e é lento)
  $props = New-Object Text.StringBuilder
  [void]$props.Append('"id":' + (JStr $rota.id) + ',"tipo":' + (JStr $rota.tipo) + ',"dia":' + [int]$rota.dia)
  [void]$props.Append(',"km":' + (N ([Math]::Round($kmTot, 1)) '0.#') + ',"horas":' + (N ([Math]::Round($segTot / 3600, 1)) '0.#'))
  [void]$props.Append(',"pontos":[' + (($ids | Where-Object { -not $_.StartsWith('~') } | ForEach-Object { JStr $_ }) -join ',') + ']')
  # trechos entre pontos de verdade (soma o que passa pelas passagens)
  $finais = New-Object 'Collections.Generic.List[object]'; $acc = $null
  foreach ($t in $trechos) {
    if ($null -eq $acc) { $acc = @{ de = $t.de; para = $t.para; km = $t.km; seg = $t.seg } }
    else { $acc.para = $t.para; $acc.km += $t.km; $acc.seg += $t.seg }
    if (-not $t.para.StartsWith('~')) { $finais.Add($acc); $acc = $null }
  }
  $tj = foreach ($t in $finais) {
    '{"de":' + (JStr $t.de) + ',"para":' + (JStr $t.para) + ',"km":' + (N ([Math]::Round($t.km, 1)) '0.#') + ',"min":' + (N ([Math]::Round($t.seg / 60)) '0') + '}'
  }
  [void]$props.Append(',"trechos":[' + ($tj -join ',') + ']')
  if ($notas.Count -gt 0) { [void]$props.Append(',"obs":' + (JStr ($notas -join ' '))) }
  $features.Add('{"type":"Feature","properties":{' + $props.ToString() + '},"geometry":{"type":"LineString","coordinates":[' + $sb.ToString() + ']}}')
}

Write-Output ''
if ($problemas.Count -gt 0) { Write-Output 'Avisos:'; $problemas | ForEach-Object { Write-Output "  - $_" } } else { Write-Output 'Sem avisos.' }

if ($Somente) { Write-Output '(-Somente: nada gravado)'; return }

# ---------- 3. gravar ----------
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory $dataDir | Out-Null }
$geo = '{"type":"FeatureCollection","features":[' + "`n" + ($features -join ",`n") + "`n]}`n"
$geoArq = Join-Path $dataDir 'rotas.geojson'
[IO.File]::WriteAllText($geoArq, $geo, $utf8)

$pl = foreach ($id in $pontos.Keys) {
  $q = $pontos[$id]
  '  ' + (JStr $id) + ': {"nome":' + (JStr $q.nome) + ',"lat":' + (N ([Math]::Round([double]$q.lat, 5))) + ',"lon":' + (N ([Math]::Round([double]$q.lon, 5))) + '}'
}
$ptArq = Join-Path $dataDir 'pontos.json'
[IO.File]::WriteAllText($ptArq, "{`n" + ($pl -join ",`n") + "`n}`n", $utf8)

Write-Output ('rotas.geojson {0:0} KB · pontos.json {1:0} KB (tolerância {2} m)' -f ((Get-Item $geoArq).Length / 1KB), ((Get-Item $ptArq).Length / 1KB), (N $Tol))
