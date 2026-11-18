/** La configuración gratuita debe activar un modelo antes de caer en modo biblioteca. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');

function readConfig(extra: Record<string, string>): Record<string, any> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-ai-config-'));
  const env = {
    ...process.env,
    DATA_DIR: path.join(temp, 'data'),
    DATABASE_PATH: path.join(temp, 'prueba.db'),
    BACKUP_DIR: path.join(temp, 'backups'),
    AI_PROVIDER: 'none',
    AI_MODEL: '',
    AI_API_KEY: '',
    AI_BASE_URL: '',
    AI_FALLBACK_PROVIDER: '',
    AI_FALLBACK_MODEL: '',
    AI_FALLBACK_BASE_URL: '',
    AI_FALLBACK_API_KEY: '',
    ...extra,
  };
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, 'ai-config-probe.ts')], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `ai-config-probe falló:\n${result.stdout}\n${result.stderr}`);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  assert.ok(line, 'sin salida del probe');
  return JSON.parse(line);
}

test('un respaldo gratuito se promueve a principal cuando no hay proveedor', () => {
  const out = readConfig({
    AI_FALLBACK_PROVIDER: 'pollinations',
    AI_FALLBACK_MODEL: 'openai-fast',
    AI_FALLBACK_BASE_URL: 'https://text.pollinations.ai',
  });
  assert.equal(out.configured, true, 'el chat debe ver un proveedor activo');
  assert.equal(out.provider, 'pollinations');
  assert.equal(out.model, 'openai-fast');
  assert.equal(out.fallbackConfigured, false, 'no debe repetirse el mismo destino como respaldo');
});

test('sin proveedor ni respaldo el modo degradado sigue siendo honesto', () => {
  const out = readConfig({});
  assert.equal(out.configured, false);
  assert.equal(out.provider, 'none');
});

test('un proveedor sin modelo no se anuncia como conectado', () => {
  const out = readConfig({ AI_PROVIDER: 'pollinations' });
  assert.equal(out.configured, false);
});
