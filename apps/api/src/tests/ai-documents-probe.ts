/**
 * Prueba HTTP de extremo a extremo de la Fase 2: subida real de un documento,
 * consulta de fragmentos y cita con página/sección en el SSE del chat.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { db, uuid } from '../db/index.js';
import { signAccess } from '../lib/auth.js';

assert.equal(config.ai.provider, 'none');
assert.equal(config.webResearch.enabled, false);

const userId = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
  .run(userId, 'docs@prueba.local', 'hash-de-prueba', 'Prueba documentos', 'student');
const token = signAccess({ id: userId, email: 'docs@prueba.local', name: 'Prueba documentos', role: 'student' });
const convId = uuid();
db.prepare('INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, ?)').run(convId, userId, 'Prueba documentos');

const app = createApp();
const server = http.createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const auth = { authorization: `Bearer ${token}` };

const paragraph = (theme: string) =>
  `${theme}: la posesión y la restitución se explican con ejemplos cotidianos del Perú. `.repeat(30);
const content = [
  'CAPÍTULO I — DE LA POSESIÓN',
  paragraph('Concepto'),
  '\f',
  'CAPÍTULO II — DE LA RESTITUCIÓN',
  paragraph('Restitución'),
].join('\n\n');

try {
  const form = new FormData();
  form.set('conversationId', convId);
  form.set('files', new Blob([content], { type: 'text/plain' }), 'apunte-extenso.txt');
  const upload = await fetch(`${base}/api/ai/documents`, { method: 'POST', headers: auth, body: form });
  const uploadText = await upload.text();
  assert.equal(upload.status, 201, uploadText);
  const { documents } = JSON.parse(uploadText) as { documents: Array<{ id: string; pages: number | null; chunks: number; extracted: boolean }> };
  assert.equal(documents.length, 1);
  assert.equal(documents[0].extracted, true);
  assert.equal(documents[0].pages, 2);
  assert.ok(documents[0].chunks >= 2, `deben generarse fragmentos, hay ${documents[0].chunks}`);

  const chunkRes = await fetch(`${base}/api/ai/documents/${documents[0].id}/chunks`, { headers: auth });
  assert.equal(chunkRes.status, 200);
  const { chunks } = await chunkRes.json() as { chunks: Array<{ page: number; section: string; charOffset: number; text: string }> };
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.page >= 1 && c.page <= 2));
  assert.ok(chunks.every((c) => /^CAPÍTULO/.test(c.section)));
  assert.ok(chunks.every((c) => c.text.trim().length >= 40));

  const chat = await fetch(`${base}/api/ai/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ content: '¿qué dice el apunte sobre posesión y restitución?' }),
  });
  assert.equal(chat.status, 200);
  const events: Array<{ event: string; data: any }> = [];
  for (const block of (await chat.text()).split(/\r?\n\r?\n/)) {
    const event = block.split(/\r?\n/).find((l) => l.startsWith('event: '));
    const data = block.split(/\r?\n/).find((l) => l.startsWith('data: '));
    if (event && data) events.push({ event: event.slice(7), data: JSON.parse(data.slice(6)) });
  }
  const meta = events.find((e) => e.event === 'meta')!.data;
  const docCitations = meta.citations.filter((c: any) => c.kind === 'userdoc');
  assert.ok(docCitations.length > 0, 'el SSE debe citar fragmentos del documento');
  assert.ok(docCitations.some((c: any) => c.page && c.section && c.documentId === documents[0].id), 'la cita debe incluir página y sección reales');

  console.log(JSON.stringify({
    ok: true,
    pages: documents[0].pages,
    chunks: documents[0].chunks,
    citedChunks: docCitations.length,
    sampleCitation: {
      page: docCitations[0].page,
      section: docCitations[0].section,
      charOffset: docCitations[0].charOffset,
    },
  }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
