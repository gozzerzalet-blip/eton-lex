/**
 * Prueba del contrato HTTP de ETON AI sobre una base temporal:
 *  - /api/ai/status expone router, tools y modes reales;
 *  - el chat SSE conserva meta → delta → done y añade `tools` sin romper nada.
 * Se fuerza AI_PROVIDER=none para no depender de servicios externos.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { db, uuid } from '../db/index.js';
import { signAccess } from '../lib/auth.js';

assert.equal(config.ai.provider, 'none', 'este probe debe ejecutarse con AI_PROVIDER=none');
assert.equal(config.webResearch.enabled, false, 'este probe no debe consultar la web');

const userId = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
  .run(userId, 'contrato@prueba.local', 'hash-de-prueba', 'Prueba de contrato', 'student');
db.prepare(`INSERT INTO norms (id, slug, title, short_title, number, type, status, summary, verification)
  VALUES (?, ?, ?, ?, ?, 'ley', 'vigente', ?, 'verified')`)
  .run('norma-contrato', 'ley-de-contrato', 'Ley de contrato', 'Ley de contrato', '12345', 'Norma de prueba del contrato SSE.');
const token = signAccess({
  id: userId,
  email: 'contrato@prueba.local',
  name: 'Prueba de contrato',
  role: 'student',
});

const app = createApp();
const server = http.createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json',
};

try {
  const statusRes = await fetch(`${base}/api/ai/status`, { headers });
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json() as any;
  assert.equal(status.configured, false);
  assert.equal(status.provider, 'none');
  assert.equal(status.router.mode, 'single-model');
  assert.equal(status.router.roles.length, 3);
  assert.deepEqual(status.tools.map((t: any) => t.name), ['search_library', 'open_official_source', 'calculate_deadline']);
  assert.ok(status.modes.some((m: any) => m.id === 'principiante'));

  const convRes = await fetch(`${base}/api/ai/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Prueba de contrato', mode: 'principiante' }),
  });
  assert.equal(convRes.status, 201);
  const { conversation } = await convRes.json() as { conversation: { id: string } };

  const chatRes = await fetch(`${base}/api/ai/conversations/${conversation.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: '¿qué dice la ley 12345 y cuál es el plazo de 5 días hábiles desde 01/01/2026?' }),
  });
  assert.equal(chatRes.status, 200);
  assert.match(chatRes.headers.get('content-type') ?? '', /text\/event-stream/);

  const raw = await chatRes.text();
  const events: Array<{ event: string; data: any }> = [];
  for (const chunk of raw.split(/\r?\n\r?\n/)) {
    const eventLine = chunk.split(/\r?\n/).find((l) => l.startsWith('event: '));
    const dataLine = chunk.split(/\r?\n/).find((l) => l.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    events.push({ event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) });
  }

  const names = events.map((e) => e.event);
  assert.ok(names.includes('meta'), 'debe emitir meta');
  assert.ok(names.filter((n) => n === 'meta').length === 2, 'el modo biblioteca emite meta al inicio y al responder');
  assert.ok(names.includes('delta'), 'debe emitir delta');
  assert.ok(names.includes('done'), 'debe emitir done');
  assert.ok(!names.includes('error'), `no debe emitir error: ${raw.slice(0, 500)}`);

  const firstMeta = events.find((e) => e.event === 'meta')!.data;
  assert.equal(firstMeta.libraryMode, true);
  assert.ok(Array.isArray(firstMeta.tools), 'meta debe incluir herramientas ejecutadas');
  assert.ok(firstMeta.tools.some((t: any) => t.name === 'search_library'));
  assert.ok(Array.isArray(firstMeta.citations));

  const done = events.find((e) => e.event === 'done')!.data;
  assert.equal(done.libraryMode, true);
  assert.match(done.content, /Modo biblioteca/);

  const usage = db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND role = 'biblioteca'").get(userId) as { n: number };
  assert.equal(usage.n, 1, 'el modo biblioteca debe registrar consumo real');

  const explainRes = await fetch(`${base}/api/ai/conversations/${conversation.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: 'Explícame qué es la ley 12345' }),
  });
  assert.equal(explainRes.status, 200);
  const explainRaw = await explainRes.text();
  const explainEvents: Array<{ event: string; data: any }> = [];
  for (const chunk of explainRaw.split(/\r?\n\r?\n/)) {
    const eventLine = chunk.split(/\r?\n/).find((l) => l.startsWith('event: '));
    const dataLine = chunk.split(/\r?\n/).find((l) => l.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    explainEvents.push({ event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) });
  }
  const explainDone = explainEvents.find((e) => e.event === 'done');
  assert.ok(explainDone, 'la explicación debe terminar con done');
  assert.match(explainDone!.data.content, /Explicación guiada/);
  assert.doesNotMatch(explainDone!.data.content, /Modo biblioteca/);
  assert.equal(explainDone!.data.mode, 'guiada');
  assert.ok(explainDone!.data.content.length < 1400, 'no debe transcribir la norma completa');

  console.log(JSON.stringify({
    ok: true,
    status: { router: status.router.mode, tools: status.tools.length, modes: status.modes.length },
    sseEvents: [...new Set(names)],
    toolRuns: firstMeta.tools.map((t: any) => t.name),
    usageRows: usage.n,
    guidedExplanation: true,
  }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
