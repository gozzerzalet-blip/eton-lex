import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { db } from '../db/index.js';
/**
 * Respaldo consistente de SQLite (WAL) + archivos subidos.
 * `VACUUM INTO` produce una copia transaccional sin detener la API.
 */
const started = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(config.backup.dir, stamp);
fs.mkdirSync(target, { recursive: true });
const sqlFile = path.join(target, 'eton-lex.db');
const escaped = sqlFile.replace(/'/g, "''");
db.exec(`VACUUM INTO '${escaped}'`);
let uploadsCopied = false;
if (fs.existsSync(config.paths.uploads)) {
    fs.cpSync(config.paths.uploads, path.join(target, 'uploads'), { recursive: true });
    uploadsCopied = true;
}
const probe = new DatabaseSync(sqlFile);
const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .map((r) => r.name)
    .sort();
const users = probe.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const norms = probe.prepare('SELECT COUNT(*) AS n FROM norms').get().n;
probe.close();
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    database: path.relative(config.backup.dir, sqlFile),
    uploadsCopied,
    users,
    norms,
    tables,
}, null, 2));
const maxAge = config.backup.retentionDays * 24 * 60 * 60 * 1000;
let removed = 0;
for (const entry of fs.readdirSync(config.backup.dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === stamp)
        continue;
    const dir = path.join(config.backup.dir, entry.name);
    if (!fs.existsSync(path.join(dir, 'manifest.json')))
        continue;
    const age = Date.now() - fs.statSync(dir).mtimeMs;
    if (age > maxAge) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed += 1;
    }
}
console.log(`[backup] ${stamp}: SQLite +${uploadsCopied ? ' uploads' : ' sin uploads'} ` +
    `(${users} usuarios, ${norms} normas) en ${target} · ${removed} respaldos antiguos eliminados · ` +
    `${Date.now() - started} ms`);
//# sourceMappingURL=backup.js.map