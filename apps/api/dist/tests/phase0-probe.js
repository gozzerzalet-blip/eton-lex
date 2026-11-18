/**
 * Prueba real de las correcciones de la Fase 0 sobre una base temporal:
 *  - los documentos de IA no se filtran entre conversaciones del mismo usuario;
 *  - una conversación silenciada no genera notificaciones.
 */
import assert from 'node:assert/strict';
import { db, uuid } from '../db/index.js';
import { notifyMessage } from '../lib/notify.js';
import { retrieveForChat } from '../modules/ai/retrieval.js';
const userId = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .run(userId, 'fase0@prueba.local', 'hash-de-prueba', 'Estudiante Prueba');
// Documentos de IA: pertenecen a conversaciones de ETON AI.
const aiConvA = uuid();
const aiConvB = uuid();
for (const id of [aiConvA, aiConvB]) {
    db.prepare('INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, ?)').run(id, userId, `IA ${id}`);
}
const docA = uuid();
const docB = uuid();
const insertDoc = db.prepare(`
  INSERT INTO ai_documents (id, user_id, conversation_id, name, mime, size, path, extracted)
  VALUES (?, ?, ?, ?, 'text/plain', 12, '/tmp/prueba.txt', ?)
`);
insertDoc.run(docA, userId, aiConvA, 'Apunte A', 'SECRETO_DE_LA_CONVERSACION_A');
insertDoc.run(docB, userId, aiConvB, 'Apunte B', 'SECRETO_DE_LA_CONVERSACION_B');
const inA = await retrieveForChat('posesión', userId, aiConvA, 8);
const inB = await retrieveForChat('posesión', userId, aiConvB, 8);
const idsA = new Set(inA.map((b) => b.id));
const idsB = new Set(inB.map((b) => b.id));
assert.ok(idsA.has(`doc_${docA}`), 'la conversación A debe recuperar su propio documento');
assert.ok(!idsA.has(`doc_${docB}`), 'la conversación A no debe ver el documento de B');
assert.ok(idsB.has(`doc_${docB}`), 'la conversación B debe recuperar su propio documento');
assert.ok(!idsB.has(`doc_${docA}`), 'la conversación B no debe ver el documento de A');
// Mensajería: las preferencias de silencio viven en conversation_members.
const msgConvA = uuid();
const msgConvB = uuid();
for (const id of [msgConvA, msgConvB]) {
    db.prepare("INSERT INTO conversations (id, type, title) VALUES (?, 'direct', ?)").run(id, `Chat ${id}`);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, userId);
}
const countNotifications = () => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(userId).n;
const before = countNotifications();
db.prepare('UPDATE conversation_members SET muted = 1 WHERE conversation_id = ? AND user_id = ?').run(msgConvA, userId);
notifyMessage(userId, msgConvA, 'Mensaje silenciado', 'no debe notificar');
assert.equal(countNotifications(), before, 'una conversación silenciada no debe crear notificaciones');
notifyMessage(userId, msgConvB, 'Mensaje normal', 'debe notificar');
assert.equal(countNotifications(), before + 1, 'una conversación normal sí debe crear notificaciones');
console.log(JSON.stringify({
    ok: true,
    documentsIsolated: true,
    mutedRespected: true,
    blocksInA: inA.length,
    blocksInB: inB.length,
}));
db.close();
//# sourceMappingURL=phase0-probe.js.map