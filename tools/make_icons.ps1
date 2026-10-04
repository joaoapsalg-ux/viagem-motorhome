# Desenha os ícones PNG do app (o mesmo desenho do icons/icon.svg) com o System.Drawing do Windows:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/make_icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'

function Desenhar([int]$size, [string]$arquivo, [bool]$maskable, [bool]$cheio = $false) {
  $bmp = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([Drawing.Color]::Transparent)
  # fundo: quadrado de cantos redondos; cheio no "maskable" e no do iPhone (o sistema recorta)
  $r = if ($maskable -or $cheio) { 0 } else { [int]($size * 14 / 64) }
  $fundo = New-Object Drawing.Drawing2D.GraphicsPath
  if ($r -gt 0) {
    $d = 2 * $r
    $fundo.AddArc(0, 0, $d, $d, 180, 90); $fundo.AddArc($size - $d, 0, $d, $d, 270, 90)
    $fundo.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $fundo.AddArc(0, $size - $d, $d, $d, 90, 90); $fundo.CloseFigure()
  } else { $fundo.AddRectangle((New-Object Drawing.Rectangle 0, 0, $size, $size)) }
  # degradê radial: elipse maior que o quadrado, com o centro claro em cima à esquerda (sem as emendas em "X"
  # que o degradê sobre um retângulo deixa)
  $g.FillPath((New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#174a6b'))), $fundo)
  $elipse = New-Object Drawing.Drawing2D.GraphicsPath
  $elipse.AddEllipse([single](-0.75 * $size), [single](-0.8 * $size), [single](2.1 * $size), [single](2.1 * $size))
  $grad = New-Object Drawing.Drawing2D.PathGradientBrush $elipse
  $grad.CenterPoint = New-Object Drawing.PointF ($size * 0.3), ($size * 0.25)
  $grad.CenterColor = [Drawing.ColorTranslator]::FromHtml('#5fb0dd')
  $grad.SurroundColors = @([Drawing.ColorTranslator]::FromHtml('#123d58'))
  $g.SetClip($fundo)
  $g.FillPath($grad, $elipse)
  $g.ResetClip()
  # motorhome: desenho de 24 unidades; no maskable fica menor (área segura de 80%)
  $esc = if ($maskable) { $size * 0.52 / 24 } else { $size * 0.73 / 24 }
  $ox = ($size - 24 * $esc) / 2; $oy = ($size - 24 * $esc) / 2 - $esc * 0.6
  $P = { param($x, $y) New-Object Drawing.PointF ($ox + $x * $esc), ($oy + $y * $esc) }
  $pen = New-Object Drawing.Pen ([Drawing.Color]::White), ([single](1.7 * $esc))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $corpo = New-Object Drawing.Drawing2D.GraphicsPath
  $corpo.AddLine((& $P 2.5 17), (& $P 2.5 8.5))
  $corpo.AddArc([single]($ox + 2.5 * $esc), [single]($oy + 6.5 * $esc), [single](4 * $esc), [single](4 * $esc), 180, 90)
  $corpo.AddLine((& $P 4.5 6.5), (& $P 14.7 6.5))
  $corpo.AddLine((& $P 14.7 6.5), (& $P 19 10.9))
  $corpo.AddLine((& $P 19 10.9), (& $P 20 10.9))
  $corpo.AddArc([single]($ox + 18.5 * $esc), [single]($oy + 10.9 * $esc), [single](3 * $esc), [single](3 * $esc), 270, 90)
  $corpo.AddLine((& $P 21.5 12.4), (& $P 21.5 17))
  $g.DrawPath($pen, $corpo)
  $g.DrawLine($pen, (& $P 2.5 17), (& $P 21.5 17))
  $g.DrawRectangle($pen, [single]($ox + 5.5 * $esc), [single]($oy + 10 * $esc), [single](4 * $esc), [single](3 * $esc))
  $g.DrawLine($pen, (& $P 12 10), (& $P 12 13))
  $roda = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#1e5d86'))
  foreach ($cx in 7, 17) {
    $rr = 1.9 * $esc
    $g.FillEllipse($roda, [single]($ox + $cx * $esc - $rr), [single]($oy + 17.6 * $esc - $rr), [single](2 * $rr), [single](2 * $rr))
    $g.DrawEllipse($pen, [single]($ox + $cx * $esc - $rr), [single]($oy + 17.6 * $esc - $rr), [single](2 * $rr), [single](2 * $rr))
  }
  $bmp.Save((Join-Path $dir $arquivo), [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "$arquivo ($size px)"
}

Desenhar 180 'icon-180.png' $false $true   # iPhone: quadrado cheio, sem transparência
Desenhar 192 'icon-192.png' $false
Desenhar 512 'icon-512.png' $false
Desenhar 512 'icon-maskable-512.png' $true
