/**
 * Prueba real de la Fase 2 sobre una base temporal:
 *  - extracción con páginas, secciones y desplazamientos;
 *  - fragmentos citables y su aislamiento por conversación;
 *  - limpieza del índice FTS al borrar el documento.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, uuid } from '../db/index.js';
import { chunkDocument, extractDocument } from '../lib/files.js';
import { citationFor, retrieveForChat } from '../modules/ai/retrieval.js';
const paragraph = (theme, n) => `${theme} ${n}: la posesión y la restitución se analizan aquí con un ejemplo cotidiano del Perú. `.repeat(12);
const source = [
    `CAPÍTULO I — DE LA POSESIÓN\n\n${paragraph('Concepto', 1)}`,
    `CAPÍTULO II — DE LA RESTITUCIÓN\n\n${paragraph('Restitución', 2)}`,
    `CAPÍTULO III — DE LA DEFENSA POSESORIA\n\n${paragraph('Defensa', 3)}`,
].join('\n\f\n');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eton-fase2-'));
const file = path.join(temp, 'apunte.txt');
fs.writeFileSync(file, source, 'utf8');
const doc = await extractDocument(file, 'text/plain');
assert.ok(doc, 'debe extraerse texto del archivo');
assert.equal(doc.pages, 3, 'dos saltos de página deben producir tres páginas');
assert.equal(doc.pageStarts.length, 2);
assert.ok(doc.sections.length >= 3, 'deben detectarse los tres capítulos');
assert.deepEqual(doc.sections.map((s) => s.title), [
    'CAPÍTULO I — DE LA POSESIÓN',
    'CAPÍTULO II — DE LA RESTITUCIÓN',
    'CAPÍTULO III — DE LA DEFENSA POSESORIA',
]);
const chunks = chunkDocument(doc);
assert.ok(chunks.length >= 3, `se esperaban varios fragmentos, hay ${chunks.length}`);
assert.ok(chunks.every((c) => c.text.trim().length >= 40));
assert.ok(chunks.every((c, i) => i === 0 || c.charOffset > chunks[i - 1].charOffset));
for (const chunk of chunks) {
    assert.equal(doc.text.slice(chunk.charOffset, chunk.charOffset + 8), chunk.text.slice(0, 8), 'el offset debe apuntar al texto real');
    assert.ok(chunk.page !== null && chunk.page >= 1 && chunk.page <= 3, 'la página debe ser real');
    assert.match(chunk.section ?? '', /^CAPÍTULO/);
}
const userId = uuid();
const convA = uuid();
const convB = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .run(userId, 'fase2@prueba.local', 'hash-de-prueba', 'Estudiante Fase 2');
for (const id of [convA, convB]) {
    db.prepare('INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, ?)').run(id, userId, `IA ${id}`);
}
const documentId = uuid();
db.prepare(`INSERT INTO ai_documents (id, user_id, conversation_id, name, mime, size, path, extracted, pages)
  VALUES (?, ?, ?, ?, 'text/plain', ?, ?, ?, ?)`)
    .run(documentId, userId, convA, 'Apunte extenso', source.length, file, doc.text, doc.pages);
const insert = db.prepare(`
  INSERT INTO document_chunks (id, document_id, user_id, conversation_id, chunk_index,
    page, char_offset, section, label, text, chars)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const chunk of chunks) {
    insert.run(uuid(), documentId, userId, convA, chunk.index, chunk.page, chunk.charOffset, chunk.section, 'Apunte extenso', chunk.text, chunk.text.length);
}
const inA = await retrieveForChat('posesión restitución', userId, convA, 8);
const inB = await retrieveForChat('posesión restitución', userId, convB, 8);
const cited = inA.filter((b) => b.id.startsWith('chunk_'));
assert.ok(cited.length > 0, 'la conversación A debe recuperar fragmentos del documento');
assert.ok(cited.every((b) => b.page && b.section && b.documentName === 'Apunte extenso'), 'cada fragmento debe llevar página y sección');
assert.ok(!inB.some((b) => b.id.startsWith('chunk_')), 'la conversación B no debe ver fragmentos de A');
const citation = citationFor(cited[0], 0);
assert.equal(citation.documentId, documentId);
assert.equal(citation.page, cited[0].page);
assert.equal(citation.section, cited[0].section);
assert.equal(typeof citation.charOffset, 'number');
const ftsBefore = db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get().n;
assert.equal(ftsBefore, chunks.length, 'el índice FTS debe contener todos los fragmentos');
db.prepare('DELETE FROM ai_documents WHERE id = ?').run(documentId);
const chunksAfter = db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get().n;
const ftsAfter = db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get().n;
assert.equal(chunksAfter, 0, 'borrar el documento debe borrar sus fragmentos en cascada');
assert.equal(ftsAfter, 0, 'el trigger FTS debe limpiar el índice al borrar');
console.log(JSON.stringify({
    ok: true,
    pages: doc.pages,
    sections: doc.sections.length,
    chunks: chunks.length,
    citedInA: cited.length,
    citedInB: inB.filter((b) => b.id.startsWith('chunk_')).length,
    sample: { page: cited[0].page, section: cited[0].section, charOffset: cited[0].charOffset },
    ftsCleanup: ftsBefore > 0 && ftsAfter === 0,
}));
db.close();
//# sourceMappingURL=phase2-probe.js.map