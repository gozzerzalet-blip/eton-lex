/**
 * Ingesta real de textos legales desde los PDF oficiales de
 * «Normas Legales Actualizadas» del Diario Oficial El Peruano.
 *
 * Uso:
 *   npm run ingest:legal                 → todas las fuentes del registro
 *   npm run ingest:legal -- codigo-civil → una norma por slug
 *   npm run ingest:legal -- --force      → vuelve a procesar aunque el hash no cambie
 *   npm run ingest:legal -- --refresh    → descarga de nuevo los PDF oficiales
 *   npm run ingest:legal -- --list       → muestra el registro de fuentes
 *
 * Reglas:
 * - No inventa artículos: si la extracción no supera los mínimos de control,
 *   aborta sin tocar la base de datos.
 * - Conserva historial: si el texto de un artículo cambia, guarda la versión
 *   anterior en `article_history` antes de actualizar.
 * - No borra artículos por defecto; solo informa los que dejaron de aparecer.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { db, migrate, now, tx, uuid } from '../db/index.js';
import { parseLegalText, type ParseStats } from '../legal/parse.js';
import { LEGAL_SOURCES, officialPdfUrl, type LegalSource } from '../legal/registry.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (
  data: Buffer,
  options?: Record<string, unknown>,
) => Promise<{ text: string; numpages: number }>;

type Options = { force: boolean; prune: boolean; refresh: boolean };

type IngestOutcome = {
  slug: string;
  status: 'ok' | 'unchanged' | 'skipped' | 'error';
  message: string;
  articles?: number;
  versionId?: string;
  stats?: ParseStats;
};

const PDF_DIR = path.join(config.paths.data, 'legal-pdfs');

function log(line: string) {
  console.log(line);
}

async function downloadPdf(source: LegalSource, refresh: boolean): Promise<{ buffer: Buffer; cached: boolean }> {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const dest = path.join(PDF_DIR, `${source.slug}.pdf`);
  if (!refresh && fs.existsSync(dest) && fs.statSync(dest).size > 50_000) {
    return { buffer: fs.readFileSync(dest), cached: true };
  }

  const url = officialPdfUrl(source.idNorma);
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'ETON-LEX/1.0 (+biblioteca juridica; contacto: etonlex.pe)',
          accept: 'application/pdf',
        },
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const type = res.headers.get('content-type') ?? '';
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) throw new Error('respuesta vacía');
      if (!type.includes('pdf') && buffer.subarray(0, 4).toString() !== '%PDF') {
        throw new Error(`la respuesta no es un PDF (${type || 'sin content-type'})`);
      }
      fs.writeFileSync(dest, buffer);
      return { buffer, cached: false };
    } catch (err) {
      lastError = err as Error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`No se pudo descargar ${url}: ${lastError?.message ?? 'error desconocido'}`);
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureNorm(source: LegalSource): { id: string; slug: string } {
  const row = db.prepare('SELECT id, slug FROM norms WHERE slug = ?').get(source.slug) as
    | { id: string; slug: string }
    | undefined;
  if (!row) {
    throw new Error(
      `La norma "${source.slug}" no existe en el catálogo. Ejecuta primero: npm run db:seed`,
    );
  }
  return row;
}

async function processPdfAsync(
  source: LegalSource,
  norm: { id: string; slug: string },
  buffer: Buffer,
  cached: boolean,
  options: Options,
  runId: string,
): Promise<IngestOutcome> {
  const pdf = await pdfParse(buffer);
  const raw = pdf.text ?? '';
  if (!source.expected.test(raw.slice(0, 12_000))) {
    throw new Error(
      `El PDF oficial no corresponde a la norma esperada (${source.slug}); se aborta para no contaminar la biblioteca.`,
    );
  }

  const result = parseLegalText(raw, {
    lastArticle: source.lastArticle,
    stopAt: source.stopAt,
    derogatedRanges: source.derogatedRanges,
    supplements: source.supplements,
    pageHeaders: source.pageHeaders,
  });
  if (result.articles.length < source.minArticles) {
    throw new Error(
      `Extracción insuficiente: ${result.articles.length} artículos (mínimo ${source.minArticles}). Se conserva la versión anterior.`,
    );
  }

  const numeric = result.articles
    .map((a) => Number(a.number))
    .filter((n) => Number.isFinite(n) && n > 0);
  const maxNumeric = numeric.length ? Math.max(...numeric) : 0;
  if (source.lastArticle && maxNumeric < source.lastArticle - 5) {
    throw new Error(
      `El último artículo detectado (${maxNumeric}) no alcanza el esperado (${source.lastArticle}). Se aborta.`,
    );
  }

  const contentHash = hashText(raw);
  const existingVersion = db
    .prepare('SELECT id FROM norm_versions WHERE norm_id = ? AND content_hash = ?')
    .get(norm.id, contentHash) as { id: string } | undefined;

  const sourceUrl = officialPdfUrl(source.idNorma);
  const versionNotes = JSON.stringify({
    source: 'Diario Oficial El Peruano — Normas Legales Actualizadas',
    idNorma: source.idNorma,
    pages: pdf.numpages,
    chars: raw.length,
    cached,
    parsedAt: now(),
    totalArticles: result.stats.totalArticles,
    missing: result.stats.missing,
    derogated: result.stats.derogated,
    modified: result.stats.modified,
    supplemented: result.stats.supplemented,
    warnings: result.stats.warnings,
    notes: source.notes ?? null,
  });

  if (existingVersion && !options.force) {
    db.prepare(`
      UPDATE norms SET official_url = ?, verification = 'verified', verified_at = ?, updated_at = ?, status = ?
      WHERE id = ?
    `).run(sourceUrl, now(), now(), source.status, norm.id);
    db.prepare('UPDATE ingest_runs SET finished_at = ?, status = ?, stats = ? WHERE id = ?')
      .run(now(), 'unchanged', JSON.stringify({ articles: result.stats.totalArticles, version: existingVersion.id }), runId);
    return {
      slug: source.slug,
      status: 'unchanged',
      message: `Sin cambios (${result.stats.totalArticles} artículos ya almacenados).`,
      articles: result.stats.totalArticles,
      versionId: existingVersion.id,
      stats: result.stats,
    };
  }

  const versionId = uuid();
  const versionLabel = `Actualización oficial ${new Date().toLocaleDateString('es-PE')}`;

  const existingRows = db
    .prepare('SELECT id, number, text, status, provenance FROM articles WHERE norm_id = ?')
    .all(norm.id) as Array<{ id: string; number: string; text: string; status: string; provenance: string | null }>;
  const existing = new Map(existingRows.map((r) => [r.number, r]));

  const inserted: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  tx(() => {
    db.prepare(`
      INSERT INTO norm_versions (id, norm_id, label, published_at, source_url, content_hash, verification, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'verified', ?)
    `).run(versionId, norm.id, versionLabel, now().slice(0, 10), sourceUrl, contentHash, versionNotes);

    const insertArticle = db.prepare(`
      INSERT INTO articles
        (id, norm_id, version_id, number, heading, text, order_index, source_url, book, section, title, chapter, status, provenance, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateArticle = db.prepare(`
      UPDATE articles SET version_id = ?, heading = ?, text = ?, order_index = ?, source_url = ?,
        book = ?, section = ?, title = ?, chapter = ?, status = ?, provenance = ?, updated_at = ?
      WHERE id = ?
    `);
    const insertHistory = db.prepare(`
      INSERT INTO article_history (id, article_id, version_id, text, change_type, changed_at, source_url, norm_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const article of result.articles) {
      const previous = existing.get(article.number);
      const provenance = article.provenance ?? null;
      if (previous) {
        const changed =
          previous.text !== article.text ||
          previous.status !== article.status ||
          (previous.provenance ?? null) !== provenance;
        if (changed) {
          insertHistory.run(
            uuid(),
            previous.id,
            versionId,
            previous.text,
            article.status === 'derogado' ? 'derogacion' : 'modificacion',
            now(),
            sourceUrl,
            `PDF oficial idNorma=${source.idNorma}`,
          );
          updateArticle.run(
            versionId,
            article.heading,
            article.text,
            article.orderIndex,
            sourceUrl,
            article.book,
            article.section,
            article.title,
            article.chapter,
            article.status,
            provenance,
            now(),
            previous.id,
          );
          updated.push(article.number);
        } else {
          // Mantiene la versión vigente y la estructura más reciente.
          updateArticle.run(
            versionId,
            article.heading,
            article.text,
            article.orderIndex,
            sourceUrl,
            article.book,
            article.section,
            article.title,
            article.chapter,
            article.status,
            provenance,
            now(),
            previous.id,
          );
          unchanged.push(article.number);
        }
      } else {
        insertArticle.run(
          uuid(),
          norm.id,
          versionId,
          article.number,
          article.heading,
          article.text,
          article.orderIndex,
          sourceUrl,
          article.book,
          article.section,
          article.title,
          article.chapter,
          article.status,
          provenance,
          now(),
        );
        inserted.push(article.number);
      }
    }

    db.prepare(`
      UPDATE norms SET official_url = ?, verification = 'verified', verified_at = ?, updated_at = ?, status = ?
      WHERE id = ?
    `).run(sourceUrl, now(), now(), source.status, norm.id);

    const missingStored = existingRows
      .filter((row) => !result.articles.some((a) => a.number === row.number))
      .map((row) => row.number);

    db.prepare('UPDATE ingest_runs SET finished_at = ?, status = ?, stats = ? WHERE id = ?').run(
      now(),
      'ok',
      JSON.stringify({
        versionId,
        inserted: inserted.length,
        updated: updated.length,
        unchanged: unchanged.length,
        missingInSource: missingStored,
        parsed: result.stats,
      }),
      runId,
    );

    if (missingStored.length > 0) {
      log(`  ! Artículos almacenados que ya no aparecen en la fuente: ${missingStored.slice(0, 20).join(', ')}${missingStored.length > 20 ? '…' : ''}`);
      if (options.prune) {
        const del = db.prepare('DELETE FROM articles WHERE id = ?');
        for (const row of existingRows) {
          if (missingStored.includes(row.number)) del.run(row.id);
        }
        log(`  · Eliminados ${missingStored.length} artículos ausentes (--prune).`);
      }
    }
  });

  return {
    slug: source.slug,
    status: 'ok',
    message: `${result.stats.totalArticles} artículos (${inserted.length} nuevos, ${updated.length} actualizados, ${unchanged.length} sin cambios)`,
    articles: result.stats.totalArticles,
    versionId,
    stats: result.stats,
  };
}

async function ingestOneAsync(source: LegalSource, options: Options): Promise<IngestOutcome> {
  const norm = ensureNorm(source);
  const startedAt = now();
  const runId = uuid();
  db.prepare('INSERT INTO ingest_runs (id, source_key, started_at, status) VALUES (?, ?, ?, ?)')
    .run(runId, `legal:${source.slug}`, startedAt, 'running');
  try {
    const { buffer, cached } = await downloadPdf(source, options.refresh);
    return await processPdfAsync(source, norm, buffer, cached, options, runId);
  } catch (err) {
    const message = (err as Error).message;
    db.prepare('UPDATE ingest_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?')
      .run(now(), 'error', message, runId);
    return { slug: source.slug, status: 'error', message };
  }
}

async function main() {
  migrate();

  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    log('Registro de fuentes legales oficiales:');
    for (const s of LEGAL_SOURCES) {
      log(`  ${s.slug.padEnd(38)} idNorma=${String(s.idNorma).padEnd(7)} mínimo=${s.minArticles} estado=${s.status}`);
    }
    return;
  }

  const options: Options = {
    force: args.includes('--force'),
    prune: args.includes('--prune'),
    refresh: args.includes('--refresh'),
  };
  const requested = args.filter((a) => !a.startsWith('--'));
  const sources = requested.length
    ? requested.map((slug) => {
        const found = LEGAL_SOURCES.find((s) => s.slug === slug);
        if (!found) throw new Error(`Slug no registrado: ${slug}. Usa --list para ver las fuentes.`);
        return found;
      })
    : LEGAL_SOURCES;

  log(`ETON LEX · ingesta legal (${sources.length} norma${sources.length === 1 ? '' : 's'})`);
  log(`Base de datos: ${config.paths.db}`);
  log(`PDFs oficiales: ${PDF_DIR}`);
  log('');

  const outcomes: IngestOutcome[] = [];
  for (const source of sources) {
    log(`→ ${source.slug} (idNorma=${source.idNorma})`);
    const outcome = await ingestOneAsync(source, options);
    outcomes.push(outcome);
    if (outcome.status === 'error') log(`  ✗ ${outcome.message}`);
    else log(`  ✓ ${outcome.message}`);
    if (outcome.stats?.warnings.length) {
      for (const warning of outcome.stats.warnings) log(`    · ${warning}`);
    }
  }

  const ok = outcomes.filter((o) => o.status === 'ok').length;
  const unchanged = outcomes.filter((o) => o.status === 'unchanged').length;
  const errors = outcomes.filter((o) => o.status === 'error');
  log('');
  log(`Resumen: ${ok} ingestadas, ${unchanged} sin cambios, ${errors.length} con error.`);
  if (errors.length) {
    log('Errores:');
    for (const err of errors) log(`  - ${err.slug}: ${err.message}`);
    process.exitCode = 1;
  }

  const totals = db.prepare(`
    SELECT (SELECT COUNT(*) FROM articles) AS articles,
           (SELECT COUNT(*) FROM norms WHERE verification = 'verified') AS verified_norms,
           (SELECT COUNT(*) FROM norm_versions) AS versions
  `).get() as { articles: number; verified_norms: number; versions: number };
  log(`Total en base de datos: ${totals.articles} artículos · ${totals.verified_norms} normas verificadas · ${totals.versions} versiones.`);
}

main().catch((err) => {
  console.error('Ingesta legal fallida:', err);
  process.exitCode = 1;
});
