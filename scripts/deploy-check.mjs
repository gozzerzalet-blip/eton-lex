#!/usr/bin/env node
/**
 * Verificación posterior al despliegue. No modifica datos: solo comprueba que
 * el enlace público sea realmente directo, HTTPS, indexable y funcional.
 *
 * Uso: node scripts/deploy-check.mjs --url https://etonlex.com
 */
import process from 'node:process';

const args = process.argv.slice(2);
const urlArg = args.find((_, i) => args[i - 1] === '--url');
const raw = urlArg ?? process.env.PUBLIC_WEB_URL ?? '';
const base = raw.replace(/\/+$/, '');

const problems = [];
const notes = [];

const TEMP_HOSTS = [
  'loca.lt',
  'trycloudflare.com',
  'ngrok.io',
  'ngrok-free.app',
  'serveousercontent.com',
  'localhost.run',
  'localxpose.io',
  'is.gd',
  'tinyurl.com',
];

if (!base) problems.push('Falta la URL pública (--url o PUBLIC_WEB_URL).');
if (!/^https:\/\//i.test(base)) problems.push('La URL pública no usa HTTPS.');
if (/^https:\/\/\d+\.\d+\.\d+\.\d+/i.test(base)) problems.push('La URL pública es una IP, no un dominio.');
if (TEMP_HOSTS.some((h) => base.includes(h))) problems.push('La URL pública pertenece a un servicio de túnel/acortador temporal.');

const get = async (pathname) => {
  try {
    const res = await fetch(`${base}${pathname}`, {
      redirect: 'manual',
      headers: { 'user-agent': 'ETON-LEX-deploy-check/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    return { status: res.status, headers: res.headers, body };
  } catch (err) {
    problems.push(`No se pudo consultar ${pathname}: ${err.message}`);
    return null;
  }
};

if (base) {
  const health = await get('/api/system/health');
  if (health?.status !== 200 || !health.body.includes('eton-lex-api')) {
    problems.push(`/api/system/health respondió ${health?.status ?? 'sin respuesta'}.`);
  }

  const caps = await get('/api/system/capabilities');
  if (caps?.status === 200) {
    try {
      const c = JSON.parse(caps.body);
      notes.push(`IA: ${c.ai?.configured ? `${c.ai.provider}/${c.ai.model}` : 'no configurada'}`);
      notes.push(`Correo: ${c.email?.configured ? 'configurado' : 'PENDIENTE (SMTP)'}`);
      notes.push(`Demo: ${c.demoMode ? 'ACTIVO (no apto para producción)' : 'desactivado'}`);
      if (c.demoMode) problems.push('DEMO_MODE está activo en producción.');
    } catch {
      problems.push('/api/system/capabilities no devolvió JSON válido.');
    }
  } else {
    problems.push(`/api/system/capabilities respondió ${caps?.status ?? 'sin respuesta'}.`);
  }

  for (const pathname of ['/', '/login', '/registro', '/manifest.webmanifest']) {
    const r = await get(pathname);
    if (!r) continue;
    if (r.status === 511) problems.push(`${pathname}: HTTP 511 (página intermedia del túnel).`);
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get('location') ?? '';
      problems.push(`${pathname}: redirección ${r.status} → ${location}.`);
    } else if (r.status !== 200) {
      problems.push(`${pathname}: HTTP ${r.status}.`);
    }
    if (/Tunnel website ahead|enter the IP|You are about to visit/i.test(r.body)) {
      problems.push(`${pathname}: contiene una pantalla intermedia de túnel.`);
    }
  }

  const home = await get('/login');
  if (home?.body) {
    if (!/ETON LEX/i.test(home.body)) problems.push('/login no contiene el nombre ETON LEX.');
    const canonical = home.body.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (!canonical?.startsWith(base)) {
      problems.push(`Canonical incorrecto: ${canonical ?? 'ausente'}.`);
    } else {
      notes.push(`Canonical: ${canonical}`);
    }
  }

  const robots = await get('/robots.txt');
  if (robots?.status !== 200 || !robots.body.includes(`Sitemap: ${base}/sitemap.xml`)) {
    problems.push('robots.txt no expone el sitemap con la URL definitiva.');
  }

  const sitemap = await get('/sitemap.xml');
  if (sitemap?.status !== 200 || (sitemap.body.match(/<loc>/g) ?? []).length < 3) {
    problems.push('sitemap.xml no contiene las páginas públicas esperadas.');
  }
}

console.log(`ETON LEX · verificación de despliegue: ${base || '(sin URL)'}\n`);
for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  console.error('\nNo apto para lanzamiento:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\nOK: enlace directo, HTTPS, health, SEO básico y PWA responden.');
