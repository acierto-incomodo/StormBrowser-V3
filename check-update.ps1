Write-Host "🚀 Iniciando limpieza del proyecto..." -ForegroundColor Cyan

Write-Host "🗑️ Eliminando node_modules..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue

Write-Host "🗑️ Eliminando package-lock.json..." -ForegroundColor Yellow
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

Write-Host "🔄 Actualizando dependencias con ncu..." -ForegroundColor Magenta
ncu -u

Write-Host "📦 Instalando dependencias nuevas..." -ForegroundColor Green
npm install

Write-Host "✅ Todo listo! Proyecto actualizado correctamente." -ForegroundColor Green