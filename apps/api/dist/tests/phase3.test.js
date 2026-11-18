/** Pruebas de la Fase 3 (Word/PowerPoint/Excel) en entornos aislados. */
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
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-fase3-'));
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
test('los tres formatos son OOXML real y pueden leerse de vuelta', () => {
    const out = runProbe('phase3-probe.ts');
    assert.equal(out.ok, true);
    assert.ok(out.sizes.docx > 1000);
    assert.ok(out.sizes.pptx > 1000);
    assert.ok(out.sizes.xlsx > 1000);
    assert.ok(out.rereadDocxChars > 100);
    assert.equal(out.xlsxRows, 3, 'la hoja debe tener encabezado y dos filas de datos');
    assert.match(out.mimes.docx, /wordprocessingml/);
    assert.match(out.mimes.pptx, /presentationml/);
    assert.match(out.mimes.xlsx, /spreadsheetml/);
});
test('la API genera desde una conversación, descarga con aislamiento y borra el archivo', () => {
    const out = runProbe('ai-generate-probe.ts');
    assert.equal(out.ok, true);
    assert.ok(out.size > 1000);
    assert.equal(out.exportedFromConversation, true);
    assert.equal(out.isolated, true);
    assert.equal(out.deleted, true);
});
//# sourceMappingURL=phase3.test.js.map