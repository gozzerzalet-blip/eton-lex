/** Los enlaces antiguos apuntan a una sola URL pública permanente. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');

test('un enlace anterior redirige al canonical conservando ruta y parámetros', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-enlace-'));
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: path.join(temp, 'data'),
    DATABASE_PATH: path.join(temp, 'prueba.db'),
    BACKUP_DIR: path.join(temp, 'backups'),
    JWT_SECRET: 'a'.repeat(96),
    PUBLIC_WEB_URL: 'https://etonlex.com',
    WEB_ORIGIN: 'https://etonlex.com',
    LEGACY_PUBLIC_URLS: 'https://antiguo.suga.run, https://tunnel-antes.trycloudflare.com',
    AI_PROVIDER: 'none',
    AI_MODEL: '',
    AI_FALLBACK_PROVIDER: 'none',
    AI_FALLBACK_MODEL: '',
    AI_WEB_RESEARCH: 'false',
  };
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, 'legacy-link-probe.ts')], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `legacy-link-probe falló:\n${result.stdout}\n${result.stderr}`);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  assert.ok(line, 'sin salida del probe');
  const out = JSON.parse(line);
  assert.equal(out.oldStatus, 308);
  assert.equal(out.oldLocation, 'https://etonlex.com/registro?invitado=ana&fuente=antigua');
  assert.equal(out.canonicalStatus, 200);
});
