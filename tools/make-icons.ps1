# Draws the kang-notes icon (a small glowing graph on a dark tile) and writes
#   web\icons\*.png      for the phone app and the browser tab
#   desktop\app.ico      for KangNotes.exe
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-icons.ps1
param([string]$Root = (Split-Path $PSScriptRoot -Parent))
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function Color([string]$hex, [int]$alpha = 255) {
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

function New-Art([int]$size, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 512.0

  # Tile: rounded square (full square for Android's maskable icon, which it crops itself).
  $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($maskable) {
    $tile.AddRectangle((New-Object System.Drawing.RectangleF(0, 0, $size, $size)))
  } else {
    $r = 116 * $s; $m = 8 * $s; $w = $size - 2 * $m
    $tile.AddArc($m, $m, $r, $r, 180, 90)
    $tile.AddArc($m + $w - $r, $m, $r, $r, 270, 90)
    $tile.AddArc($m + $w - $r, $m + $w - $r, $r, $r, 0, 90)
    $tile.AddArc($m, $m + $w - $r, $r, $r, 90, 90)
    $tile.CloseFigure()
  }
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.RectangleF(0, 0, $size, $size)), (Color '#18213f'), (Color '#05070d'), 65)
  $g.FillPath($bg, $tile)
  $g.SetClip($tile)

  $k = if ($maskable) { 0.7 } else { 1.0 }
  $pt = { param($x, $y) New-Object System.Drawing.PointF(((256 + ($x - 256) * $k) * $s), ((256 + ($y - 256) * $k) * $s)) }
  $nodes = @(
    @{ x = 150; y = 160; r = 52; c = '#5ee6c9' },
    @{ x = 382; y = 196; r = 44; c = '#ffb547' },
    @{ x = 222; y = 396; r = 44; c = '#a78bfa' }
  )
  $center = & $pt 262 266

  foreach ($n in $nodes) {
    $p = & $pt $n.x $n.y
    $pen = New-Object System.Drawing.Pen((Color '#ffffff' 120), [single](13 * $s * $k))
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $g.DrawLine($pen, $center, $p)
  }
  $all = $nodes + @(@{ x = 262; y = 266; r = 30; c = '#ffffff' })
  foreach ($n in $all) {
    $p = & $pt $n.x $n.y
    $r = $n.r * $s * $k
    for ($i = 7; $i -ge 1; $i--) {
      $gr = $r * (1 + $i * 0.22)
      $brush = New-Object System.Drawing.SolidBrush((Color $n.c ([int](10 + (7 - $i) * 4))))
      $g.FillEllipse($brush, $p.X - $gr, $p.Y - $gr, 2 * $gr, 2 * $gr)
    }
    $g.FillEllipse((New-Object System.Drawing.SolidBrush((Color $n.c))), $p.X - $r, $p.Y - $r, 2 * $r, 2 * $r)
    $hr = $r * 0.42
    $g.FillEllipse((New-Object System.Drawing.SolidBrush((Color '#ffffff' 90))), $p.X - $r * 0.55, $p.Y - $r * 0.6, $hr * 2, $hr * 2)
  }
  $g.Dispose()
  return $bmp
}

function Save-Png($bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$icons = Join-Path $Root 'web\icons'
New-Item -ItemType Directory -Force $icons | Out-Null
Save-Png (New-Art 32 $false) (Join-Path $icons 'favicon-32.png')
Save-Png (New-Art 180 $false) (Join-Path $icons 'apple-touch-180.png')
Save-Png (New-Art 192 $false) (Join-Path $icons 'icon-192.png')
Save-Png (New-Art 512 $false) (Join-Path $icons 'icon-512.png')
Save-Png (New-Art 512 $true) (Join-Path $icons 'maskable-512.png')

# .ico with PNG-compressed images (supported since Windows Vista).
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($size in $sizes) {
  $ms = New-Object System.IO.MemoryStream
  (New-Art $size $false).Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  , $ms.ToArray()
}
$ico = Join-Path $Root 'desktop\app.ico'
$fs = [System.IO.File]::Create($ico)
$w = New-Object System.IO.BinaryWriter($fs)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$images[$i].Length); $w.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) { $w.Write($img) }
$w.Close()
"Icons written to $icons and $ico"
