import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { db } from '../db/index.js';

/**
 * Restaura un respaldo creado por `scripts/backup.ts`.
 *
 * Uso:
 *   npm run db:restore -- <directorio-del-respaldo> [--dry-run] [--confirm]
 *
 * El directorio puede ser absoluto o relativo a BACKUP_DIR. La restauración
 * sobrescribe la base de datos y fusiona los uploads; por eso exige --confirm
 * y guarda antes una copia de seguridad del estado actual.
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirm = args.includes('--confirm');
const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length === 0) {
  console.error('Uso: npm run db:restore -- <directorio-del-respaldo> [--dry-run] [--confirm]');
  process.exit(1);
}

const requested = positional[0];
const source = path.isAbsolute(requested) ? requested : path.join(config.backup.dir, requested);
const manifestPath = path.join(source, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`No se encontró manifest.json en ${source}.`);
  process.exit(1);
}

type Manifest = {
  createdAt?: string;
  database?: string;
  uploadsCopied?: boolean;
  users?: number;
  norms?: number;
  tables?: string[];
};

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
if (!manifest.database || typeof manifest.database !== 'string') {
  console.error('El respaldo no declara una base de datos válida en manifest.json.');
  process.exit(1);
}

// `backup.ts` guarda `database` como ruta relativa a BACKUP_DIR.
const sourceDb = path.isAbsolute(manifest.database)
  ? manifest.database
  : path.resolve(config.backup.dir, manifest.database);
if (!fs.existsSync(sourceDb)) {
  console.error(`No se encontró la base de datos del respaldo: ${sourceDb}`);
  process.exit(1);
}

// Verificación antes de tocar nada: integridad SQLite y contenido mínimo.
const probe = new DatabaseSync(sourceDb);
let integrity = 'unknown';
let users = 0;
let norms = 0;
try {
  integrity = String((probe.prepare('PRAGMA integrity_check').get() as { integrity_check?: string })?.integrity_check ?? 'unknown');
  users = (probe.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  norms = (probe.prepare('SELECT COUNT(*) AS n FROM norms').get() as { n: number }).n;
} finally {
  probe.close();
}

if (integrity !== 'ok') {
  console.error(`El respaldo no pasó PRAGMA integrity_check (${integrity}). No se restaurará.`);
  process.exit(1);
}
if (users === 0) {
  console.error('El respaldo no contiene usuarios. Se rechaza para no vaciar la plataforma por accidente.');
  process.exit(1);
}
if (manifest.users !== undefined && manifest.users !== users) {
  console.error(`El respaldo declara ${manifest.users} usuarios pero contiene ${users}. No se restaurará.`);
  process.exit(1);
}

const targetDb = config.paths.db;
const sourceUploads = path.join(source, 'uploads');

console.log(`[restore] respaldo: ${manifest.createdAt ?? 'fecha desconocida'}`);
console.log(`[restore] contenido: ${users} usuarios, ${norms} normas, integridad ${integrity}`);
console.log(`[restore] destino:  ${targetDb}`);

if (dryRun) {
  console.log('[restore] modo --dry-run: no se modificó ningún archivo.');
  process.exit(0);
}
if (!confirm) {
  console.error('Esta operación sobrescribe la base de datos actual. Vuelve a ejecutar con --confirm.');
  process.exit(1);
}

// Copia de seguridad del estado actual antes de reemplazarlo.
const stamp = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const safetyDir = path.join(config.backup.dir, stamp);
fs.mkdirSync(safetyDir, { recursive: true });
const safetyDb = path.join(safetyDir, 'eton-lex.db');
db.exec(`VACUUM INTO '${safetyDb.replace(/'/g, "''")}'`);
db.close();

// SQLite WAL: al reemplazar el archivo principal hay que retirar sus satélites.
fs.copyFileSync(sourceDb, targetDb);
for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${targetDb}${suffix}`;
  if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
}

// Los uploads se fusionan: nunca se borran archivos que no estén en el respaldo.
if (manifest.uploadsCopied && fs.existsSync(sourceUploads)) {
  fs.cpSync(sourceUploads, config.paths.uploads, { recursive: true, force: true });
}

const verify = new DatabaseSync(targetDb);
try {
  const restoredUsers = (verify.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const restoredNorms = (verify.prepare('SELECT COUNT(*) AS n FROM norms').get() as { n: number }).n;
  if (restoredUsers !== users || restoredNorms !== norms) {
    console.error(`[restore] verificación fallida: ${restoredUsers} usuarios, ${restoredNorms} normas.`);
    process.exit(1);
  }
} finally {
  verify.close();
}

console.log(`[restore] completado. Estado anterior guardado en ${safetyDir}. Reinicia la API.`);
