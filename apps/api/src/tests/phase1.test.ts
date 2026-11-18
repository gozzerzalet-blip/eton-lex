/** Pruebas del motor híbrido de la Fase 1 en bases y entornos aislados. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');

function runProbe(extra: Record<string, string> = {}, probeName = 'phase1-probe.ts'): Record<string, any> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-fase1-'));
  const env = {
    ...process.env,
    DATABASE_PATH: path.join(temp, 'prueba.db'),
    DATA_DIR: path.join(temp, 'data'),
    BACKUP_DIR: path.join(temp, 'backups'),
    EMBEDDING_MODEL: '',
    AI_PROVIDER: 'pollinations',
    AI_MODEL: 'openai-fast',
    ...extra,
  };
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, probeName)], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `phase1-probe falló:\n${result.stdout}\n${result.stderr}`);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  assert.ok(line, 'sin salida del probe');
  return JSON.parse(line);
}

test('con un solo modelo el router lo declara y las herramientas y verificación funcionan', () => {
  const out = runProbe();
  assert.equal(out.ok, true);
  assert.equal(out.reasoningDistinct, false);
  assert.equal(out.routerMode, 'single-model');
  assert.deepEqual(out.toolsExecuted, ['search_library', 'open_official_source', 'calculate_deadline']);
  assert.equal(out.usageRows, 1);
  for (const check of ['articulos_no_verificados', 'citas_no_verificadas', 'leyes_no_verificadas', 'referencias_invalidas', 'verificacion_sin_fuente', 'vigencia_no_confirmada']) {
    assert.ok(out.verificationChecks.includes(check), `falta la comprobación ${check}`);
  }
});

test('con un rol de razonamiento configurado el router pasa a modo híbrido real', () => {
  const out = runProbe({
    AI_REASONING_PROVIDER: 'pollinations',
    AI_REASONING_MODEL: 'openai-reasoning',
  });
  assert.equal(out.ok, true);
  assert.equal(out.reasoningDistinct, true);
  assert.equal(out.routerMode, 'hybrid');
});

test('/api/ai/status expone router/tools y el chat conserva su contrato SSE', () => {
  const out = runProbe({
    AI_PROVIDER: 'none',
    AI_MODEL: '',
    AI_FALLBACK_PROVIDER: 'none',
    AI_FALLBACK_MODEL: '',
    AI_WEB_RESEARCH: 'false',
  }, 'ai-contract-probe.ts');
  assert.equal(out.ok, true);
  assert.equal(out.status.router, 'single-model');
  assert.equal(out.status.tools, 3);
  assert.ok(out.status.modes >= 7);
  assert.deepEqual(out.sseEvents, ['meta', 'delta', 'done']);
  assert.deepEqual(out.toolRuns, ['search_library', 'open_official_source', 'calculate_deadline']);
  assert.equal(out.usageRows, 1);
});
