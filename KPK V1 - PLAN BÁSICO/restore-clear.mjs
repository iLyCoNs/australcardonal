/**
 * restore-clear.mjs — Restaura JS desde _clear_backup/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(ROOT, '_clear_backup');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(BACKUP, '.ok'))) {
  console.error('No hay backup en _clear_backup/');
  process.exit(1);
}

copyRecursive(path.join(BACKUP, 'js'), path.join(ROOT, 'js'));
if (fs.existsSync(path.join(BACKUP, 'config.js'))) {
  fs.copyFileSync(path.join(BACKUP, 'config.js'), path.join(ROOT, 'config.js'));
}
console.log('Restaurado desde _clear_backup/');
