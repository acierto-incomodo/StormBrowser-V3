#!/bin/bash

# Script para construir en Linux y normalizar nombres de archivos
if [ -d "dist" ]; then
    echo "Limpiando dist (preservando archivos de Windows)..."
    # Eliminar todas las carpetas dentro de dist
    find dist -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
    # Eliminar archivos excepto los de Windows (.exe, .blockmap, latest.yml)
    find dist -maxdepth 1 -type f -not \( -name "*.exe" -o -name "latest.yml" -o -name "*.blockmap" \) -delete
fi

echo "Iniciando build para Linux..."
npm run build:linux

if [ -d "dist" ]; then
    echo "Renombrando archivos en la carpeta dist..."
    for file in dist/*; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            if [[ "$filename" == *" "* ]]; then
                new_filename="${filename// /-}"
                mv "$file" "dist/$new_filename"
                echo "Renombrado: $filename -> $new_filename"
            fi
        fi
    done
    echo "Proceso finalizado correctamente."
fi