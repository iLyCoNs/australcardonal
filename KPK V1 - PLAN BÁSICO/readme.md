# KPK V1 — Plan Básico (ofuscado)

Tour 360°: viewer + fichas + contacto + CTA.

## Estado
- JS vital **ofuscado** (34 archivos).
- Backup legible: `_clear_backup/`
- Restaurar: `npm run restore-clear`
- Re-ofuscar: `npm run obfuscate` (desde backup si restauraste)

## Arranque
Abre `index.html` (servidor local recomendado).
Admin: `admin.html` (sigue en claro para editar lotes/contacto).

## No ofuscado (a propósito)
pannellum.js · HTML/CSS · data/*.json · admin.html

## Nota de seguridad
La ofuscación dificulta el robo; en el navegador **no es imposible** extraer lógica.
Para producción dura: hosting propio + no publicar keys.
