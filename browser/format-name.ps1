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