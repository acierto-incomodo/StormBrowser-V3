# Script para construir en Windows y normalizar nombres de archivos
if (Test-Path "dist") {
    Write-Host "Limpiando dist (preservando archivos de Linux)..." -ForegroundColor Magenta
    # Eliminar todas las carpetas
    Get-ChildItem -Path "dist" -Directory | Remove-Item -Recurse -Force
    # Eliminar archivos excepto los de Linux (AppImage, deb, rpm, y su yml)
    Get-ChildItem -Path "dist" -File | Where-Object {
        $_.Name -notmatch "\.AppImage$|\.deb$|\.rpm$|latest-linux\.yml$"
    } | Remove-Item -Force
}

Write-Host "Iniciando build para Windows..." -ForegroundColor Cyan
npm run build:win

if (Test-Path "dist") {
    Write-Host "Renombrando archivos en la carpeta dist..." -ForegroundColor Yellow
    Get-ChildItem -Path "dist" -File | ForEach-Object {
        if ($_.Name -match ' ') {
            $newName = $_.Name -replace ' ', '-'
            Rename-Item -Path $_.FullName -NewName $newName
            Write-Host "Renombrado: $($_.Name) -> $newName"
        }
    }
    Write-Host "Proceso finalizado correctamente." -ForegroundColor Green
}