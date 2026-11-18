/** Pruebas de la Fase 2 (documentos extensos) en entornos aislados. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
function runProbe(name, extra = {}) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-fase2-'));
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
        ...extra,
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
test('la extracción conserva páginas y secciones, y los fragmentos son citables y se aíslan', () => {
    const out = runProbe('phase2-probe.ts');
    assert.equal(out.ok, true);
    assert.equal(out.pages, 3);
    assert.ok(out.sections >= 3);
    assert.ok(out.chunks >= 3);
    assert.ok(out.citedInA > 0);
    assert.equal(out.citedInB, 0);
    assert.equal(typeof out.sample.page, 'number');
    assert.match(out.sample.section, /^CAPÍTULO/);
    assert.equal(out.ftsCleanup, true);
});
test('la subida HTTP indexa fragmentos y el SSE cita página y sección reales', () => {
    const out = runProbe('ai-documents-probe.ts');
    assert.equal(out.ok, true);
    assert.equal(out.pages, 2);
    assert.ok(out.chunks >= 2);
    assert.ok(out.citedChunks > 0);
    assert.ok([1, 2].includes(out.sampleCitation.page), 'la página citada debe ser una de las dos reales');
    assert.match(out.sampleCitation.section, /^CAPÍTULO/);
    assert.equal(typeof out.sampleCitation.charOffset, 'number');
});
test('una base con el FTS antiguo se reindexa y conserva la limpieza en cascada', () => {
    const out = runProbe('legacy-fts-probe.ts');
    assert.equal(out.ok, true);
    assert.equal(out.rebuilt, true);
    assert.equal(out.triggers, 3);
    assert.equal(out.idempotent, true);
    assert.equal(out.cascadeCleanup, true);
});
//# sourceMappingURL=phase2.test.js.map