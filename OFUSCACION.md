# Ofuscación Plan Básico

- JS vital ofuscado (41 archivos).
- Backup legible: `_clear_backup/`
- NO ofuscado: pannellum.js, HTML, CSS, data/*.json, admin.html

## Restaurar código claro
```
node -e "..." 
```
O copia `_clear_backup/js` → `js` y `_clear_backup/config.js` → `config.js`.

## Importante
Esto dificulta el robo, pero NO lo hace imposible en el navegador.
