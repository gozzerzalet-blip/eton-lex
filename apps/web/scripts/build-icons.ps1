# Genera los iconos PNG de ETON LEX a partir de los SVG de `public/`.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-icons.ps1
#
# Fuentes:
#   public/icon.svg            -> icon-192.png, icon-512.png
#   public/icon-maskable.svg   -> icon-maskable-512.png, apple-touch-icon.png
#   public/favicon.svg         -> favicon-32.png, favicon-16.png
#
# Usa Chrome en modo headless para rasterizar (misma geometría y trazos que el
# SVG, sin dependencias de npm). Si Chrome no está en la ruta habitual, ajusta
# $chrome.

param(
  [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)

if (-not (Test-Path $Chrome)) { throw "Chrome no encontrado en $Chrome. Ajusta el parámetro -Chrome." }

$public = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public'))

function Render-Svg([string]$svgName, [int]$size, [string]$pngName, [int]$width = 0, [int]$height = 0) {
  $svgPath = Join-Path $public $svgName
  $outPath = Join-Path $public $pngName
  if ($width -le 0) { $width = $size }
  if ($height -le 0) { $height = $size }

  $svg = Get-Content -LiteralPath $svgPath -Raw -Encoding UTF8
  $svg = $svg -replace '<svg ', "<svg width=""$width"" height=""$height"" "

  $tmp = Join-Path $env:TEMP ("eton-icon-" + [guid]::NewGuid().ToString('N') + ".html")
  $html = "<!doctype html><html><head><meta charset=""utf-8"" /><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>$svg</body></html>"
  [System.IO.File]::WriteAllText($tmp, $html, (New-Object System.Text.UTF8Encoding($false)))

  $uri = ([System.Uri]$tmp).AbsoluteUri
  & $Chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    --window-size="$width,$height" --default-background-color=00000000 `
    --screenshot="$outPath" "$uri" 2>$null | Out-Null

  Start-Sleep -Milliseconds 200
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path $outPath)) { throw "No se generó $pngName" }
  Write-Host "generado: $pngName ($width x $height)"
}

Render-Svg 'icon.svg' 512 'icon-512.png'
Render-Svg 'icon.svg' 192 'icon-192.png'
Render-Svg 'icon-maskable.svg' 512 'icon-maskable-512.png'
Render-Svg 'icon-maskable.svg' 180 'apple-touch-icon.png'
Render-Svg 'favicon.svg' 32 'favicon-32.png'
Render-Svg 'favicon.svg' 16 'favicon-16.png'
# Tarjeta para compartir en redes y resultados enriquecidos (Open Graph)
Render-Svg 'og-image.svg' 0 'og-image.png' -width 1200 -height 630
