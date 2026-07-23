/**
 * obfuscate-basic.mjs — Ofusca JS vital del Plan Básico (in-place + backup).
 * Uso: node obfuscate-basic.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const BACKUP = path.join(ROOT, '_clear_backup');

const SKIP = new Set([
  'pannellum.js',
  'obfuscate-basic.mjs',
]);

const OBFUSCATE_DIRS = [
  path.join(ROOT, 'js'),
];
const EXTRA_FILES = [
  path.join(ROOT, 'config.js'),
];

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 6,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  reservedNames: [
    '^Ferrari',
    '^KPK_',
    '^pannellum',
    '^allDrawnLines',
    '^Viewer',
    '^Pannellum',
  ],
  reservedStrings: [],
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === '_clear_backup' || name === 'node_modules') continue;
      walk(p, out);
    } else if (name.endsWith('.js') && !SKIP.has(name)) {
      out.push(p);
    }
  }
  return out;
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function ensureBackup() {
  const marker = path.join(BACKUP, '.ok');
  if (fs.existsSync(marker)) {
    console.log('[obf] Backup ya existe →', BACKUP);
    return;
  }
  console.log('[obf] Creando backup claro en _clear_backup/ …');
  fs.mkdirSync(BACKUP, { recursive: true });
  copyRecursive(path.join(ROOT, 'js'), path.join(BACKUP, 'js'));
  if (fs.existsSync(path.join(ROOT, 'config.js'))) {
    fs.copyFileSync(path.join(ROOT, 'config.js'), path.join(BACKUP, 'config.js'));
  }
  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
}

function obfuscateFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  if (!code.trim()) return { file, skipped: true };
  const result = JavaScriptObfuscator.obfuscate(code, options);
  fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
  return { file, bytes: Buffer.byteLength(result.getObfuscatedCode()) };
}

function bumpIndexCache() {
  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace(/(\.js)\?v=[^"']+/g, '$1?v=obf1');
  html = html.replace(/(config\.js)\?v=[^"']+/g, '$1?v=obf1');
  html = html.replace(/(ferrari\.css)\?v=[^"']+/g, '$1?v=obf1');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('[obf] index.html cache → ?v=obf1');
}

ensureBackup();

const files = [];
for (const d of OBFUSCATE_DIRS) files.push(...walk(d));
for (const f of EXTRA_FILES) if (fs.existsSync(f)) files.push(f);

console.log(`[obf] Ofuscando ${files.length} archivos…`);
let ok = 0;
for (const f of files) {
  try {
    const r = obfuscateFile(f);
    if (!r.skipped) {
      ok++;
      console.log('  ✓', path.relative(ROOT, f));
    }
  } catch (e) {
    console.error('  ✗', path.relative(ROOT, f), e.message);
  }
}

bumpIndexCache();

const note = `# Ofuscación Plan Básico

- JS vital ofuscado (${ok} archivos).
- Backup legible: \`_clear_backup/\`
- NO ofuscado: pannellum.js, HTML, CSS, data/*.json, admin.html

## Restaurar código claro
\`\`\`
node -e "..." 
\`\`\`
O copia \`_clear_backup/js\` → \`js\` y \`_clear_backup/config.js\` → \`config.js\`.

## Importante
Esto dificulta el robo, pero NO lo hace imposible en el navegador.
`;
fs.writeFileSync(path.join(ROOT, 'OFUSCACION.md'), note, 'utf8');
console.log(`[obf] Listo. ${ok}/${files.length} ofuscados.`);
