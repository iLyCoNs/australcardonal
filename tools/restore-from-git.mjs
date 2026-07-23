import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Get list of all files in git commit 9b3a0bd~1 under _clear_backup
const filesRaw = execSync('git ls-tree -r --name-only -z 9b3a0bd~1', { encoding: 'buffer' });
// Split by null byte
const rawEntries = filesRaw.toString('utf8').split('\0').filter(Boolean);

console.log('Total files in commit:', rawEntries.length);

const clearBackupFiles = rawEntries.filter(f => f.includes('_clear_backup'));
console.log('Found clear backup files:', clearBackupFiles.length);

for (const gitPath of clearBackupFiles) {
  // e.g. "KPK V1 - PLAN BÁSICO/_clear_backup/js/ui/f-lote-panel.js"
  const relPath = gitPath.replace(/^.*\/_clear_backup\//, '');
  
  const content = execSync(`git show "9b3a0bd~1:${gitPath}"`, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });

  // Save into _clear_backup/
  const backupDest = path.join(process.cwd(), '_clear_backup', relPath);
  fs.mkdirSync(path.dirname(backupDest), { recursive: true });
  fs.writeFileSync(backupDest, content);

  // Save into current project root (js/ or config.js)
  const targetDest = path.join(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(targetDest), { recursive: true });
  fs.writeFileSync(targetDest, content);

  console.log('Restored clear file:', relPath);
}

fs.writeFileSync(path.join(process.cwd(), '_clear_backup', '.ok'), new Date().toISOString(), 'utf8');

console.log('SUCCESS! Restored all clear files.');
