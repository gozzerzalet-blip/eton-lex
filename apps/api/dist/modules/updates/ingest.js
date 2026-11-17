import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { db, uuid } from '../../db/index.js';
import { notify } from '../../lib/notify.js';
const parser = new Parser({ timeout: 15_000 });
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', oacute: 'ó', aacute: 'á',
    eacute: 'é', iacute: 'í', uacute: 'ú', ntilde: 'ñ', ordm: 'º', ordf: 'ª',
    auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', deg: '°',
};
function decodeEntities(value) {
    return value
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (match, name) => {
        const decoded = ENTITIES[name.toLowerCase()];
        if (!decoded)
            return match;
        // En HTML, &Oacute; y &oacute; son caracteres distintos (Ó vs ó).
        return /[A-Z]/.test(name[0])
            ? decoded.charAt(0).toUpperCase() + decoded.slice(1)
            : decoded;
    });
}
function cleanHtml(value) {
    return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function inferType(value) {
    const t = value.toLowerCase();
    if (/derogan|deroga|derogaci/.test(t))
        return 'derogacion';
    if (/modifican|modifica|modificaci/.test(t))
        return 'modificacion';
    if (/incorporan|incorpora|incorporaci/.test(t))
        return 'incorporacion';
    if (/jurisprudencia|casaci/.test(t))
        return 'jurisprudencia';
    if (/precedente/.test(t))
        return 'precedente';
    return 'nueva_norma';
}
function isoDate(raw) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
    if (!match)
        return null;
    const [, day, month, year] = match;
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
/**
 * Parser del fragmento oficial que El Peruano sirve en
 * /Normas/LoadNormasLegales. No usa librerías de terceros ni hipótesis sobre
 * el texto: solo extrae titulo, sumilla, organismo, fecha y enlace publicados.
 */
export function parseElPeruanoNormas(html) {
    const articlePattern = /<article\b[^>]*class=["'][^"']*edicionesoficiales_articulos[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
    const items = [];
    for (const match of html.matchAll(articlePattern)) {
        const block = match[1];
        const linkMatch = /<h5\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
        if (!linkMatch)
            continue;
        const href = /href\s*=\s*["']([^"']+)["']/i.exec(linkMatch[1])?.[1];
        const title = cleanHtml(linkMatch[2]);
        if (!href || !title)
            continue;
        const entity = cleanHtml(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i.exec(block)?.[1] ?? '');
        const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
            .map((p) => cleanHtml(p[1]))
            .filter(Boolean);
        const publishedAt = isoDate(paragraphs.find((p) => /^Fecha:/i.test(p))?.replace(/^Fecha:\s*/i, '') ?? '');
        const summary = paragraphs.find((p) => !/^Fecha:/i.test(p)) ?? '';
        const sourceUrl = new URL(href, 'https://diariooficial.elperuano.pe').toString();
        const fullText = `${title} ${entity} ${summary}`;
        items.push({
            type: inferType(fullText),
            title,
            summary: [entity, summary].filter(Boolean).join(' — ').slice(0, 1200),
            publishedAt,
            sourceUrl,
            externalId: hash(sourceUrl),
        });
    }
    if (items.length < 3) {
        throw new Error('La página oficial de El Peruano no devolvió normas legales interpretables.');
    }
    return items;
}
async function loadHtmlItems(source) {
    if (source.key !== 'elperuano' && !/elperuano\.pe/i.test(source.url)) {
        throw new Error(`El tipo html solo tiene parser oficial para El Peruano (${source.key}).`);
    }
    const res = await fetch(source.url, {
        headers: {
            'user-agent': 'ETON-LEX/1.0 (actualizaciones legislativa; contacto: etonlex.pe)',
            accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok)
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return parseElPeruanoNormas(await res.text());
}
async function loadRssItems(source) {
    const feed = await parser.parseURL(source.url);
    return feed.items.slice(0, 60).flatMap((item) => {
        const title = (item.title ?? '').trim();
        const link = item.link ?? '';
        if (!title || !link)
            return [];
        return [{
                type: inferType(title),
                title,
                summary: (item.contentSnippet ?? '').slice(0, 1200),
                publishedAt: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null),
                sourceUrl: link,
                externalId: hash(`${source.key}::${item.guid ?? link}`),
            }];
    });
}
export async function ingestOfficialUpdates() {
    const sources = db.prepare("SELECT * FROM sources WHERE enabled = 1 AND kind IN ('rss','html')").all();
    const result = { sources: sources.length, inserted: 0, skipped: 0, errors: [] };
    if (sources.length === 0)
        return result;
    const runId = uuid();
    db.prepare('INSERT INTO ingest_runs (id, source_key, status) VALUES (?, ?, ?)').run(runId, 'official-updates', 'running');
    const insert = db.prepare(`
    INSERT INTO norm_updates
      (id, type, title, summary, published_at, source_url, source_key, external_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);
    for (const source of sources) {
        try {
            const items = source.kind === 'html' ? await loadHtmlItems(source) : await loadRssItems(source);
            for (const item of items) {
                const exists = db.prepare('SELECT 1 FROM norm_updates WHERE source_key = ? AND external_id = ?')
                    .get(source.key, item.externalId);
                if (exists) {
                    result.skipped++;
                    continue;
                }
                insert.run(uuid(), item.type, item.title, item.summary, item.publishedAt, item.sourceUrl, source.key, item.externalId);
                result.inserted++;
            }
            db.prepare("UPDATE sources SET last_checked_at = datetime('now'), last_error = NULL WHERE id = ?").run(source.id);
        }
        catch (err) {
            const message = err.message;
            result.errors.push({ source: source.key, error: message });
            db.prepare("UPDATE sources SET last_checked_at = datetime('now'), last_error = ? WHERE id = ?")
                .run(message.slice(0, 500), source.id);
        }
    }
    db.prepare("UPDATE ingest_runs SET status = 'done', finished_at = datetime('now'), stats = ? WHERE id = ?")
        .run(JSON.stringify(result), runId);
    if (result.inserted > 0) {
        const staff = db.prepare("SELECT id FROM users WHERE role IN ('admin','moderator')").all();
        for (const s of staff) {
            notify(s.id, 'legislative', 'Actualizaciones por validar', `${result.inserted} publicaciones oficiales requieren revisión.`, '/admin', 'high');
        }
    }
    return result;
}
export function confirmUpdate(updateId, actorId, input) {
    const update = db.prepare('SELECT * FROM norm_updates WHERE id = ?').get(updateId);
    if (!update)
        throw new Error('Actualización no encontrada');
    let articleId = update.article_id ?? null;
    const normId = input.normId ?? update.norm_id ?? null;
    if (normId && input.articleNumber && input.currentText) {
        const article = db.prepare('SELECT * FROM articles WHERE norm_id = ? AND number = ?')
            .get(normId, String(input.articleNumber).trim());
        if (article) {
            articleId = article.id;
            db.prepare('INSERT INTO article_history (id, article_id, text, change_type, source_url, norm_ref) VALUES (?, ?, ?, ?, ?, ?)')
                .run(uuid(), article.id, article.text, 'modificacion', update.source_url, update.modifying_norm ?? update.title);
            db.prepare("UPDATE articles SET text = ?, updated_at = datetime('now') WHERE id = ?")
                .run(input.currentText, article.id);
        }
        else {
            const newId = uuid();
            db.prepare(`
        INSERT INTO articles (id, norm_id, number, heading, text, order_index, source_url)
        VALUES (?, ?, ?, NULL, ?, 9999, ?)
      `).run(newId, normId, String(input.articleNumber).trim(), input.currentText, update.source_url);
            articleId = newId;
        }
        db.prepare("UPDATE norms SET status = 'modificado', updated_at = datetime('now') WHERE id = ?").run(normId);
    }
    db.prepare(`
    UPDATE norm_updates SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = ?,
      norm_id = ?, article_id = ?, previous_text = COALESCE(?, previous_text),
      current_text = COALESCE(?, current_text), title = COALESCE(?, title), summary = COALESCE(?, summary)
    WHERE id = ?
  `).run(actorId, normId, articleId, input.previousText ?? null, input.currentText ?? null, input.title ?? null, input.summary ?? null, updateId);
    const followers = new Set();
    if (normId) {
        for (const r of db.prepare("SELECT user_id FROM follows WHERE target_type = 'norm' AND target_id = ?").all(normId))
            followers.add(r.user_id);
        const norm = db.prepare('SELECT area, slug, title FROM norms WHERE id = ?').get(normId);
        if (norm?.area) {
            for (const r of db.prepare("SELECT user_id FROM follows WHERE target_type = 'area' AND target_id = ?").all(norm.area))
                followers.add(r.user_id);
        }
        for (const uid of followers) {
            notify(uid, 'legislative', 'Actualización legislativa confirmada', update.title, norm ? `/biblioteca/${norm.slug}` : '/actualizaciones', 'high');
        }
    }
    return db.prepare('SELECT * FROM norm_updates WHERE id = ?').get(updateId);
}
//# sourceMappingURL=ingest.js.map