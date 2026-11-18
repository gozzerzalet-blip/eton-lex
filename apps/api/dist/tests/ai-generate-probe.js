/**
 * Prueba HTTP de extremo a extremo de la Fase 3: generar, listar, descargar y
 * borrar un archivo real, sin rutas ni secretos expuestos en la respuesta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { db, uuid } from '../db/index.js';
import { signAccess } from '../lib/auth.js';
assert.equal(config.ai.provider, 'none');
const userId = uuid();
const convId = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(userId, 'generar@prueba.local', 'hash-de-prueba', 'Prueba de exportación', 'student');
db.prepare('INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, ?)')
    .run(convId, userId, 'Consulta de posesión');
db.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)`)
    .run(uuid(), convId, 'La posesión es un poder de hecho protegido por el ordenamiento peruano.');
const token = signAccess({ id: userId, email: 'generar@prueba.local', name: 'Prueba de exportación', role: 'student' });
const app = createApp();
const server = http.createServer(app);
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
try {
    const status = await fetch(`${base}/api/ai/status`, { headers });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.deepEqual(statusBody.exports.map((e) => e.kind), ['docx', 'pptx', 'xlsx']);
    const create = await fetch(`${base}/api/ai/generated`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            kind: 'docx',
            title: 'Apunte de posesión',
            conversationId: convId,
        }),
    });
    const createText = await create.text();
    assert.equal(create.status, 201, createText);
    const { file } = JSON.parse(createText);
    assert.equal(file.kind, 'docx');
    assert.match(file.name, /^Apunte-de-posesion\.docx$/);
    assert.ok(file.size > 1000);
    assert.equal(file.downloadUrl, `/api/ai/generated/${file.id}/download`);
    assert.ok(!createText.includes('uploads'), 'la respuesta no debe revelar la ruta del servidor');
    const stored = db.prepare('SELECT path FROM generated_files WHERE id = ?').get(file.id);
    assert.ok(fs.existsSync(stored.path), 'el archivo debe existir en disco');
    assert.ok(stored.path.includes('generated'), 'debe guardarse en el directorio de generados');
    const download = await fetch(`${base}${file.downloadUrl}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type') ?? '', /wordprocessingml/);
    assert.match(download.headers.get('content-disposition') ?? '', /attachment;/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.length, file.size);
    assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304');
    const list = await fetch(`${base}/api/ai/generated`, { headers });
    assert.equal(list.status, 200);
    const { files } = await list.json();
    assert.ok(files.some((f) => f.id === file.id && f.kind === 'docx'));
    const other = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
        .run(other, 'otro@prueba.local', 'hash', 'Otro usuario');
    const otherToken = signAccess({ id: other, email: 'otro@prueba.local', name: 'Otro usuario', role: 'student' });
    const denied = await fetch(`${base}${file.downloadUrl}`, { headers: { authorization: `Bearer ${otherToken}` } });
    assert.equal(denied.status, 404, 'otro usuario no debe poder descargar el archivo');
    const remove = await fetch(`${base}/api/ai/generated/${file.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(remove.status, 200);
    assert.ok(!fs.existsSync(stored.path), 'el borrado debe retirar el archivo del disco');
    const after = await fetch(`${base}${file.downloadUrl}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(after.status, 404);
    console.log(JSON.stringify({ ok: true, size: file.size, exportedFromConversation: true, isolated: true, deleted: true }));
}
finally {
    await new Promise((resolve) => server.close(() => resolve()));
    db.close();
}
//# sourceMappingURL=ai-generate-probe.js.map