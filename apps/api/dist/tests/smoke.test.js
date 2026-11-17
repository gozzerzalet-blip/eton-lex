/**
 * Pruebas de humo de la API.
 *
 * Levanta la aplicación real en un puerto efímero y verifica los contratos
 * básicos: salud, capacidades, catálogo público y protección de rutas privadas.
 * No escribe datos ni simula respuestas.
 *
 * Ejecutar: npm run test (workspace apps/api)
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after } from 'node:test';
import { createApp } from '../app.js';
import { parseElPeruanoNormas } from '../modules/updates/ingest.js';
const app = createApp();
const server = http.createServer(app);
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
after(() => {
    server.close();
});
async function get(path) {
    return fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
}
test('GET /api/system/health responde con base de datos operativa', async () => {
    const response = await get('/api/system/health');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.database, 'ok');
    assert.equal(body.service, 'eton-lex-api');
});
test('GET /api/system/capabilities informa la configuración real', async () => {
    const response = await get('/api/system/capabilities');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.ai.configured, 'boolean');
    assert.equal(typeof body.ai.provider, 'string');
    assert.equal(typeof body.news.configured, 'boolean');
    assert.equal(typeof body.webrtc.turn, 'boolean');
});
test('GET /api/library devuelve un catálogo paginado', async () => {
    const response = await get('/api/library?pageSize=5');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.norms));
    assert.equal(typeof body.total, 'number');
    assert.equal(body.page, 1);
    assert.ok(body.norms.length <= 5);
});
test('GET /api/library/areas devuelve las materias jurídicas', async () => {
    const response = await get('/api/library/areas');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.areas));
});
test('GET /api/news responde sin inventar noticias', async () => {
    const response = await get('/api/news');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.news));
    assert.equal(typeof body.total, 'number');
});
test('las rutas privadas exigen autenticación', async () => {
    for (const path of ['/api/dashboard', '/api/messaging/conversations', '/api/notifications']) {
        const response = await get(path);
        assert.equal(response.status, 401, `${path} debería responder 401`);
    }
});
test('ETON AI no responde sin autenticación', async () => {
    const response = await get('/api/ai/status');
    assert.equal(response.status, 401);
});
test('una ruta inexistente devuelve JSON de error', async () => {
    const response = await get('/api/no-existe');
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error?.code);
});
test('el parser oficial de El Peruano extrae normas reales sin inventar datos', () => {
    const article = (id) => `
    <article class="edicionesoficiales_articulos">
      <div class="ediciones_texto">
        <h4>MINISTERIO DE JUSTICIA</h4>
        <h5><a href="https://busquedas.elperuano.pe/dispositivo/NL/${id}-1">RESOLUCI&Oacute;N N&ordm; ${id}-2026-JUS</a></h5>
        <p><b>Fecha: 17/11/2026</b></p>
        <p>Modifican el reglamento institucional.</p>
      </div>
    </article>`;
    const items = parseElPeruanoNormas([1, 2, 3].map(article).join(''));
    assert.equal(items.length, 3);
    assert.equal(items[0].title, 'RESOLUCIÓN Nº 1-2026-JUS');
    assert.equal(items[0].type, 'modificacion');
    assert.equal(items[0].publishedAt, '2026-11-17T00:00:00.000Z');
    assert.match(items[0].sourceUrl, /^https:\/\/busquedas\.elperuano\.pe\//);
});
//# sourceMappingURL=smoke.test.js.map