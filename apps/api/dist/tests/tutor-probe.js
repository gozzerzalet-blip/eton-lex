/**
 * Prueba HTTP de extremo a extremo de la Fase 5.
 *
 * Se usa una base temporal: las normas y artículos son fixtures aisladas, no
 * contenido publicado. Se comprueba que el tutor solo use texto almacenado,
 * que no filtre la respuesta antes de responder y que cada sesión quede
 * aislada por usuario.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { db, uuid } from '../db/index.js';
import { signAccess } from '../lib/auth.js';
assert.equal(config.ai.provider, 'none');
const userId = uuid();
const otherId = uuid();
const area = 'civil-prueba';
const normId = uuid();
const documentId = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(userId, 'tutor@prueba.local', 'hash', 'Estudiante de prueba', 'student');
db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(otherId, 'tutor-otro@prueba.local', 'hash', 'Otro estudiante', 'student');
db.prepare('INSERT INTO legal_areas (slug, name, description) VALUES (?, ?, ?)')
    .run(area, 'Derecho Civil de prueba', 'Fixture aislada de la prueba');
db.prepare(`INSERT INTO norms (id, slug, title, short_title, number, type, area, status, verification, official_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(normId, 'codigo-civil-prueba', 'Código Civil de prueba', 'Código Civil de prueba', '000', 'codigo', area, 'vigente', 'verified', 'https://example.org/norma-de-prueba');
/**
 * Texto de relleno con vocabulario jurídico variado. Cada frase supera los 45
 * caracteres para que el generador pueda ocultar una palabra literal.
 */
const articleTexts = [
    'La posesión constituye un poder de hecho ejercido sobre una cosa con intención de conservarla como propia. El poseedor conserva su situación frente a perturbaciones ajenas sin necesidad de acreditar dominio. La restitución protege al poseedor despojado violenta o clandestinamente del bien. El juez evalúa la posesión anterior sin examinar títulos de propiedad.',
    'La propiedad es un derecho real que permite al titular usar, disfrutar y disponer del bien. El dominio se adquiere por tradición mediante la entrega de la cosa con animo de transferir. La prescripción adquisitiva requiere posesión continua, pacifica y publica durante el plazo legal. El registro protege a terceros de buena fe que confian en la apariencia jurídica.',
    'El contrato es un acuerdo de voluntades que genera obligaciones entre las partes intervinientes. La obligación de dar determina la transferencia de un bien determinado al acreedor. El incumplimiento doloso genera responsabilidad civil y la indemnización de daños efectivos. La buena fe exige declarar la verdad y respetar lo convenido libremente.',
    'La responsabilidad civil obliga a reparar el daño causado a otro mediante dolo o culpa. El nexo causal vincula la conducta del agente con el resultado lesivo producido. La indemnización comprende el daño emergente y el lucro cesante debidamente acreditado. El juez dosifica la reparación conforme a la gravedad del hecho.',
    'El recurso de restitución puede interponerse dentro del plazo que señala la ley. El demandante debe acreditar la posesión previa y el despojo sufrido recientemente. La medida cautelar protege al poseedor mientras se tramita el proceso judicial. El actor puede pedir el secuestro del bien controvertido.',
    'La sentencia declara el derecho del poseedor y ordena la devolución inmediata del bien. Los costos del proceso se imponen a la parte que resiste sin fundamento legal. La apelación permite revisar la decisión ante el órgano jurisdiccional superior. El fallo debe motivar la valoración de la prueba actuada.',
];
articleTexts.forEach((text, index) => {
    db.prepare(`INSERT INTO articles (id, norm_id, number, heading, text, order_index, status, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuid(), normId, String(index + 1), `Fragmento ${index + 1}`, text, index, 'vigente', 'https://example.org/norma-de-prueba');
});
const documentText = 'La restitución judicial exige acreditar una posesión anterior y un despojo reciente. El juez debe disponer la devolución inmediata del bien al poseedor afectado. Esta afirmación pertenece al apunte privado del estudiante y no a la norma oficial.';
db.prepare(`INSERT INTO ai_documents (id, user_id, name, mime, size, path, extracted)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(documentId, userId, 'apunte-prueba.txt', 'text/plain', documentText.length, '/tmp/apunte-prueba.txt', documentText);
db.prepare(`INSERT INTO document_chunks (id, document_id, user_id, chunk_index, page, char_offset, section, label, text, chars)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), documentId, userId, 0, 4, 128, 'CAPÍTULO II', 'apunte-prueba.txt', documentText, documentText.length);
const token = signAccess({ id: userId, email: 'tutor@prueba.local', name: 'Estudiante de prueba', role: 'student' });
const otherToken = signAccess({ id: otherId, email: 'tutor-otro@prueba.local', name: 'Otro estudiante', role: 'student' });
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
const otherHeaders = { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' };
const allText = db.prepare('SELECT text FROM articles').all();
try {
    const areas = await fetch(`${base}/api/tutor/areas`, { headers });
    assert.equal(areas.status, 200);
    const areasBody = await areas.json();
    assert.ok(areasBody.areas.some((a) => a.slug === area));
    const anonymous = await fetch(`${base}/api/tutor/sessions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(anonymous.status, 401, 'el tutor exige sesión');
    const created = await fetch(`${base}/api/tutor/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ area, topic: '', questionCount: 5 }),
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const session = JSON.parse(createdText);
    assert.equal(session.progress.total >= 4, true, 'deben generarse varias preguntas reales');
    assert.equal(session.progress.answered, 0);
    assert.ok(session.next?.id, 'la primera pregunta debe venir en la respuesta');
    assert.equal(Array.isArray(session.next.options), true);
    assert.equal(session.next.options.length, 4);
    const publicKeys = JSON.stringify(session.next);
    assert.equal('correctIndex' in session.next, false, 'no se debe filtrar la respuesta correcta');
    assert.equal('explanation' in session.next, false, 'no se debe filtrar la explicación');
    assert.equal('sourceText' in session.next, false, 'no se debe filtrar el texto de origen');
    assert.ok(session.next.citations[0]?.label, 'la pregunta debe citar su fuente');
    const questions = db.prepare('SELECT * FROM tutor_questions WHERE session_id = ? ORDER BY position')
        .all(session.session.id);
    assert.equal(questions.length, session.progress.total);
    for (const q of questions) {
        assert.ok(allText.some((a) => a.text.includes(q.source_text)), 'la frase debe existir literalmente en la biblioteca');
        assert.equal(q.correct_index >= 0 && q.correct_index <= 3, true);
    }
    const first = questions[0];
    const right = await fetch(`${base}/api/tutor/sessions/${session.session.id}/answers`, {
        method: 'POST', headers,
        body: JSON.stringify({ questionId: first.id, answerIndex: first.correct_index }),
    });
    const rightBody = await right.json();
    assert.equal(right.status, 200);
    assert.equal(rightBody.correct, true);
    assert.equal(rightBody.answerIndex, first.correct_index);
    assert.equal(rightBody.progress.answered, 1);
    assert.equal(rightBody.progress.correct, 1);
    assert.ok(rightBody.feedback.includes(first.explanation));
    const second = questions[1];
    const wrongIndex = (second.correct_index + 1) % 4;
    const wrong = await fetch(`${base}/api/tutor/sessions/${session.session.id}/answers`, {
        method: 'POST', headers,
        body: JSON.stringify({ questionId: second.id, answerIndex: wrongIndex }),
    });
    const wrongBody = await wrong.json();
    assert.equal(wrong.status, 200);
    assert.equal(wrongBody.correct, false);
    assert.equal(wrongBody.correctIndex, second.correct_index);
    const deniedRead = await fetch(`${base}/api/tutor/sessions/${session.session.id}`, { headers: otherHeaders });
    assert.equal(deniedRead.status, 404, 'otro usuario no debe leer la sesión');
    const deniedAnswer = await fetch(`${base}/api/tutor/sessions/${session.session.id}/answers`, {
        method: 'POST', headers: otherHeaders,
        body: JSON.stringify({ questionId: first.id, answerIndex: 0 }),
    });
    assert.equal(deniedAnswer.status, 404);
    for (const q of questions.slice(2)) {
        const res = await fetch(`${base}/api/tutor/sessions/${session.session.id}/answers`, {
            method: 'POST', headers,
            body: JSON.stringify({ questionId: q.id, answerIndex: q.correct_index }),
        });
        assert.equal(res.status, 200);
    }
    const storedSession = db.prepare('SELECT status FROM tutor_sessions WHERE id = ?').get(session.session.id);
    assert.equal(storedSession.status, 'completed', 'la sesión se marca terminada al responder todo');
    const result = await fetch(`${base}/api/tutor/sessions/${session.session.id}/result`, { headers });
    assert.equal(result.status, 200);
    const resultBody = await result.json();
    assert.equal(resultBody.questions.length, questions.length);
    assert.equal(resultBody.progress.completed, true);
    for (const q of resultBody.questions) {
        assert.equal(typeof q.correctIndex, 'number');
        assert.ok(q.explanation && q.sourceText);
        assert.ok(q.citations[0]?.ref);
    }
    const duplicate = await fetch(`${base}/api/tutor/sessions/${session.session.id}/answers`, {
        method: 'POST', headers,
        body: JSON.stringify({ questionId: first.id, answerIndex: first.correct_index }),
    });
    assert.equal(duplicate.status, 409, 'no se permite responder dos veces');
    const docSession = await fetch(`${base}/api/tutor/sessions`, {
        method: 'POST', headers,
        body: JSON.stringify({ area: '', topic: '', documentId, questionCount: 3 }),
    });
    const docText = await docSession.text();
    assert.equal(docSession.status, 201, docText);
    const docBody = JSON.parse(docText);
    const docRow = db.prepare('SELECT citations_json FROM tutor_questions WHERE session_id = ? LIMIT 1')
        .get(docBody.session.id);
    const docCitation = JSON.parse(docRow.citations_json)[0];
    assert.equal(docCitation.kind, 'userdoc');
    assert.equal(docCitation.page, 4);
    assert.equal(docCitation.charOffset, 128);
    assert.equal(docCitation.documentId, documentId);
    const deniedDoc = await fetch(`${base}/api/tutor/sessions`, {
        method: 'POST', headers: otherHeaders,
        body: JSON.stringify({ area: '', topic: '', documentId, questionCount: 3 }),
    });
    assert.equal(deniedDoc.status, 404, 'otro usuario no debe usar el documento privado');
    const list = await fetch(`${base}/api/tutor/sessions`, { headers });
    const listBody = await list.json();
    assert.equal(listBody.sessions.length >= 2, true);
    const removed = await fetch(`${base}/api/tutor/sessions/${session.session.id}`, {
        method: 'DELETE', headers,
    });
    assert.equal(removed.status, 200);
    const after = await fetch(`${base}/api/tutor/sessions/${session.session.id}`, { headers });
    assert.equal(after.status, 404);
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM tutor_questions WHERE session_id = ?').get(session.session.id);
    assert.equal(remaining.n, 0, 'el borrado debe retirar preguntas e intentos en cascada');
    console.log(JSON.stringify({
        ok: true,
        questions: questions.length,
        correctFirst: rightBody.correct,
        wrongSecond: wrongBody.correct === false,
        completed: resultBody.progress.completed,
        isolated: deniedRead.status === 404 && deniedAnswer.status === 404 && deniedDoc.status === 404,
        documentCitation: docCitation.kind === 'userdoc' && docCitation.page === 4,
        deleted: after.status === 404 && remaining.n === 0,
    }));
}
finally {
    await new Promise((resolve) => server.close(() => resolve()));
    db.close();
}
//# sourceMappingURL=tutor-probe.js.map