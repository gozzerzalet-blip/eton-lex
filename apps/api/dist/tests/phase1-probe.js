/**
 * Prueba real del motor de la Fase 1 sobre una base temporal: router honesto,
 * herramientas ejecutadas, verificación reforzada y registro de consumo.
 */
import assert from 'node:assert/strict';
import { db, uuid } from '../db/index.js';
import { route, routerStatus } from '../modules/ai/router.js';
import { runLegalTools } from '../modules/ai/tools.js';
import { verifyAnswer } from '../modules/ai/verify.js';
const userId = uuid();
db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .run(userId, 'fase1@prueba.local', 'hash-de-prueba', 'Estudiante Fase 1');
db.prepare(`INSERT INTO norms (id, slug, title, short_title, number, type, status, summary, verification)
  VALUES (?, ?, ?, ?, ?, 'ley', 'vigente', ?, 'verified')`)
    .run('norma-prueba', 'ley-de-prueba', 'Ley de prueba', 'Ley de prueba', '12345', 'Norma creada solo para esta prueba.');
const tools = await runLegalTools('¿qué dice la ley 12345 y cuál es el plazo de 5 días hábiles desde 01/01/2026?', userId, null, 5);
assert.ok(tools.runs.some((r) => r.name === 'search_library' && r.ok), 'search_library debe ejecutarse');
assert.ok(tools.runs.some((r) => r.name === 'open_official_source' && r.ok), 'open_official_source debe encontrar la norma');
assert.ok(tools.runs.some((r) => r.name === 'calculate_deadline' && r.ok), 'calculate_deadline debe calcular');
assert.ok(tools.blocks.some((b) => b.kind === 'tool' && b.text.includes('2026-01-')), 'el cómputo debe incluir una fecha real');
const answer = [
    'Según el artículo 99999 del Código Civil [F9]',
    'La norma «texto inventado que no aparece en ninguna fuente consultada por esto».',
    'Además rige la Ley 99999.',
].join('\n');
const verification = verifyAnswer(answer, tools.blocks);
const unsupportedClaims = verifyAnswer('Esto está verificado y vigente.', []);
const checks = [...verification.checks, ...unsupportedClaims.checks];
const expected = ['articulos_no_verificados', 'citas_no_verificadas', 'leyes_no_verificadas', 'referencias_invalidas', 'verificacion_sin_fuente', 'vigencia_no_confirmada'];
for (const check of expected) {
    assert.ok(checks.includes(check), `la verificación debió detectar ${check}`);
}
assert.ok(verification.warnings.length >= 3);
db.prepare(`INSERT INTO ai_usage (id, user_id, conversation_id, role, provider, model, prompt_chars, completion_chars, latency_ms, ok)
  VALUES (?, ?, ?, 'single', 'pollinations', 'openai-fast', 100, 200, 15, 1)`)
    .run(uuid(), userId, uuid());
const usage = db.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ?').get(userId);
assert.equal(usage.n, 1);
console.log(JSON.stringify({
    ok: true,
    routerMode: routerStatus().mode,
    reasoningDistinct: route('reasoning').distinct,
    toolsExecuted: tools.runs.map((r) => r.name),
    verificationChecks: checks,
    usageRows: usage.n,
}));
db.close();
//# sourceMappingURL=phase1-probe.js.map