/**
 * Pruebas de la Fase 0 (blindaje) ejecutadas en bases temporales aisladas.
 * No tocan la base de datos de desarrollo ni la de producción.
 */
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
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-fase0-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(temp, 'prueba.db'),
        DATA_DIR: path.join(temp, 'data'),
        BACKUP_DIR: path.join(temp, 'backups'),
        EMBEDDING_MODEL: '',
        AI_PROVIDER: 'none',
        AI_FALLBACK_PROVIDER: 'none',
        AI_FALLBACK_MODEL: '',
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
test('la migración es idempotente y crea los triggers FTS necesarios', () => {
    const out = runProbe('migration-probe.ts');
    assert.equal(out.secondRunOk, true, out.secondRunError);
    assert.ok(out.tables >= 40, `se esperaban al menos 40 tablas, hay ${out.tables}`);
    for (const trigger of ['articles_ai', 'articles_ad', 'articles_au', 'news_ai', 'news_ad', 'news_au', 'norms_ai', 'norms_ad', 'norms_au']) {
        assert.equal(out.triggers.filter((t) => t === trigger).length, 1, `falta o duplica ${trigger}`);
    }
    assert.deepEqual(out.schemaMeta, ['news_sources_spanish']);
    assert.equal(out.hasConversationColumn, true);
    assert.equal(out.newsHasHash, true);
});
test('los documentos de IA quedan aislados por conversación y muted suprime avisos', () => {
    const out = runProbe('phase0-probe.ts');
    assert.equal(out.ok, true);
    assert.equal(out.documentsIsolated, true);
    assert.equal(out.mutedRespected, true);
});
//# sourceMappingURL=migration.test.js.map