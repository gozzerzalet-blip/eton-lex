/** Pruebas de la Fase 5 (tutor jurídico y evaluación) en entorno aislado. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
function runProbe(name) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-fase5-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(temp, 'prueba.db'),
        DATA_DIR: path.join(temp, 'data'),
        BACKUP_DIR: path.join(temp, 'backups'),
        EMBEDDING_MODEL: '',
        AI_PROVIDER: 'none',
        AI_MODEL: '',
        AI_FALLBACK_PROVIDER: 'none',
        AI_FALLBACK_MODEL: '',
        AI_WEB_RESEARCH: 'false',
    };
    const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, name)], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${name} falló:\n${result.stdout}\n${result.stderr}`);
    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    assert.ok(line, `${name} no produjo salida`);
    return JSON.parse(line);
}
test('el tutor genera preguntas reales, oculta la respuesta y evalúa con fuentes', () => {
    const out = runProbe('tutor-probe.ts');
    assert.equal(out.ok, true);
    assert.ok(out.questions >= 4);
    assert.equal(out.correctFirst, true);
    assert.equal(out.wrongSecond, true);
    assert.equal(out.completed, true);
    assert.equal(out.isolated, true);
    assert.equal(out.documentCitation, true);
    assert.equal(out.deleted, true);
});
//# sourceMappingURL=phase5.test.js.map