# Catálogo Bluefishing.cl

- **wc-product-export.csv** — Export WooCommerce (no se sube a Git). Copia aquí tu export cuando lo descargues.
- **catalogo_para_bot.txt** — Resumen generado para el bot (nombre | precio | categoría | URL). Lo usa Matías en cada respuesta.

## Regenerar el catálogo para el bot

Cuando tengas un CSV nuevo de WooCommerce:

1. Copia el CSV a esta carpeta como `wc-product-export.csv`.
2. En la raíz del proyecto: `npm run build-catalogo`
3. Haz commit de `catalogo_para_bot.txt` y despliega.
