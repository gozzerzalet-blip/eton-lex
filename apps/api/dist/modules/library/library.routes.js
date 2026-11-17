import { Router } from 'express';
import { db } from '../../db/index.js';
import { canViewProfile, fieldAllowed, optionalAuth, parsePrivacyFields, relationsFor, requireAuth } from '../../lib/auth.js';
import { asyncHandler, notFound } from '../../lib/http.js';
export const libraryRouter = Router();
const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Consulta FTS tolerante: une términos con OR en lugar de exigir la frase exacta. */
function ftsQuery(input) {
    const tokens = input
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .slice(0, 10);
    return tokens.map((t) => `${t}*`).join(' OR ');
}
/**
 * Detecta consultas del tipo «artículo 140 del Código Civil» o
 * «art. 108-B Código Penal» para responder con el artículo exacto.
 * La comparación de la norma se hace sin tildes ni mayúsculas, porque
 * «Codigo Civil» debe encontrar «Código Civil».
 */
function exactArticleRows(input) {
    const match = input.match(/\bart(?:[íi]culo|\.)\s*([0-9]+[a-z]?(?:\s*-\s*[a-z])?)/i);
    if (!match)
        return null;
    const number = match[1].replace(/\s*-\s*/g, '-').toUpperCase();
    const hintTokens = input
        .replace(match[0], ' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1 && !/^(de|del|la|el|los|las|un|una|y|o|en|al|por|para)$/.test(t));
    const candidates = db.prepare(`
    SELECT a.id, a.number, a.heading, a.status, a.text,
           n.slug, n.short_title, n.title
    FROM articles a JOIN norms n ON n.id = a.norm_id
    WHERE a.number = ?
    ORDER BY n.title
    LIMIT 400
  `).all(number);
    const fold = (value) => value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const hintText = hintTokens.join(' ');
    const scored = candidates.map((r) => {
        const normName = fold(r.short_title || r.title);
        const haystack = fold([r.title, r.short_title, r.slug].filter(Boolean).join(' '));
        const hits = hintTokens.filter((t) => haystack.includes(t)).length;
        const ratio = hintTokens.length === 0 ? 1 : hits / hintTokens.length;
        const score = hintText === '' ? 1 : normName === hintText ? 3 : normName.startsWith(hintText) ? 2.5 : ratio;
        return { row: r, score, hits };
    });
    const best = scored.reduce((max, s) => Math.max(max, s.score), 0);
    const threshold = hintTokens.length === 0 ? 0 : best >= 2.5 ? best : 0.5;
    return scored
        .filter((s) => hintTokens.length === 0 || s.score >= threshold)
        .sort((a, b) => b.score - a.score || b.hits - a.hits || a.row.title.localeCompare(b.row.title))
        .slice(0, 8)
        .map((s) => s.row);
}
function normSummary(row) {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        shortTitle: row.short_title,
        number: row.number,
        type: row.type,
        area: row.area,
        areaName: row.area_name ?? null,
        entity: row.entity,
        publishedAt: row.published_at,
        effectiveAt: row.effective_at,
        status: row.status,
        officialUrl: row.official_url,
        summary: row.summary,
        verification: row.verification,
        verifiedAt: row.verified_at,
        articleCount: row.article_count ?? 0,
        updatedAt: row.updated_at,
    };
}
libraryRouter.get('/areas', asyncHandler(async (_req, res) => {
    const rows = db.prepare(`
    SELECT a.slug, a.name, a.description, COUNT(n.id) AS norms
    FROM legal_areas a LEFT JOIN norms n ON n.area = a.slug
    GROUP BY a.slug ORDER BY a.name
  `).all();
    res.json({ areas: rows });
}));
libraryRouter.get('/', optionalAuth, asyncHandler((async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const area = String(req.query.area ?? '').trim();
    const type = String(req.query.type ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 24) || 24, 60);
    const where = ['1=1'];
    const params = [];
    if (area) {
        where.push('n.area = ?');
        params.push(area);
    }
    if (type) {
        where.push('n.type = ?');
        params.push(type);
    }
    if (status) {
        where.push('n.status = ?');
        params.push(status);
    }
    if (q) {
        where.push(`(n.title LIKE ? OR n.short_title LIKE ? OR n.number LIKE ? OR EXISTS (
      SELECT 1 FROM articles_fts f JOIN articles a ON a.rowid = f.rowid
      WHERE a.norm_id = n.id AND articles_fts MATCH ?
    ))`);
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `"${q.replace(/"/g, '')}"`);
    }
    const total = db.prepare(`SELECT COUNT(*) c FROM norms n WHERE ${where.join(' AND ')}`).get(...params).c;
    const rows = db.prepare(`
    SELECT n.*, la.name AS area_name,
      (SELECT COUNT(*) FROM articles a WHERE a.norm_id = n.id) AS article_count
    FROM norms n LEFT JOIN legal_areas la ON la.slug = n.area
    WHERE ${where.join(' AND ')}
    ORDER BY CASE n.status WHEN 'vigente' THEN 0 WHEN 'modificado' THEN 1 ELSE 2 END, n.title
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({
        norms: rows.map(normSummary),
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
    });
})));
libraryRouter.get('/norms/:slug', optionalAuth, asyncHandler((async (req, res) => {
    const norm = db.prepare(`
    SELECT n.*, la.name AS area_name FROM norms n LEFT JOIN legal_areas la ON la.slug = n.area WHERE n.slug = ?
  `).get(req.params.slug);
    if (!norm)
        throw notFound('Norma no encontrada en la biblioteca.');
    const articles = db.prepare(`
    SELECT id, number, heading, text, order_index, source_url, book, section, title, chapter, status, provenance, updated_at
    FROM articles WHERE norm_id = ? ORDER BY order_index, CAST(number AS INTEGER)
  `).all(norm.id);
    const versions = db.prepare('SELECT * FROM norm_versions WHERE norm_id = ? ORDER BY created_at DESC').all(norm.id);
    const updates = db.prepare(`
    SELECT * FROM norm_updates WHERE norm_id = ? AND status = 'confirmed' ORDER BY published_at DESC LIMIT 20
  `).all(norm.id);
    let followed = false;
    if (req.user) {
        followed = Boolean(db.prepare("SELECT 1 FROM follows WHERE user_id = ? AND target_type = 'norm' AND target_id = ?").get(req.user.id, norm.id));
    }
    // Control de integridad visible en la UI: huecos reales y artículos
    // recuperados de otra fuente oficial.
    const numbers = new Set(articles.map((a) => a.number));
    const numericMax = Math.max(0, ...articles
        .map((a) => Number(a.number))
        .filter((n) => Number.isFinite(n) && n > 0));
    const gaps = [];
    for (let i = 1; i <= numericMax; i++)
        if (!numbers.has(String(i)))
            gaps.push(String(i));
    const supplemented = articles
        .filter((a) => a.provenance)
        .map((a) => a.number);
    const derogated = articles.filter((a) => a.status === 'derogado').length;
    const modified = articles.filter((a) => a.status === 'modificado').length;
    res.json({
        norm: normSummary(norm),
        articles,
        versions,
        updates,
        followed,
        // Transparencia: si aún no se sincronizó el texto oficial, la UI debe decirlo.
        textAvailable: articles.length > 0,
        textStats: {
            articleCount: articles.length,
            derogated,
            modified,
            gaps,
            supplemented,
        },
    });
})));
libraryRouter.get('/articles/:id', optionalAuth, asyncHandler((async (req, res) => {
    const article = db.prepare(`
    SELECT a.*, n.title AS norm_title, n.short_title, n.slug AS norm_slug, n.number AS norm_number,
           n.status AS norm_status, n.official_url, n.verification
    FROM articles a JOIN norms n ON n.id = a.norm_id WHERE a.id = ?
  `).get(req.params.id);
    if (!article)
        throw notFound('Artículo no encontrado.');
    const history = db.prepare(`
    SELECT h.*, nv.label AS version_label FROM article_history h
    LEFT JOIN norm_versions nv ON nv.id = h.version_id
    WHERE h.article_id = ? ORDER BY h.changed_at DESC
  `).all(article.id);
    res.json({ article, history });
})));
libraryRouter.post('/norms/:slug/follow', requireAuth, asyncHandler(async (req, res) => {
    const norm = db.prepare('SELECT id FROM norms WHERE slug = ?').get(req.params.slug);
    if (!norm)
        throw notFound('Norma no encontrada.');
    const exists = db.prepare("SELECT 1 FROM follows WHERE user_id = ? AND target_type = 'norm' AND target_id = ?").get(req.user.id, norm.id);
    if (exists) {
        db.prepare("DELETE FROM follows WHERE user_id = ? AND target_type = 'norm' AND target_id = ?").run(req.user.id, norm.id);
        res.json({ followed: false });
        return;
    }
    db.prepare("INSERT INTO follows (user_id, target_type, target_id) VALUES (?, 'norm', ?)").run(req.user.id, norm.id);
    res.json({ followed: true });
}));
libraryRouter.get('/follows', requireAuth, asyncHandler(async (req, res) => {
    const norms = db.prepare(`
    SELECT n.*, la.name AS area_name FROM follows f
    JOIN norms n ON n.id = f.target_id AND f.target_type = 'norm'
    LEFT JOIN legal_areas la ON la.slug = n.area
    WHERE f.user_id = ? ORDER BY f.created_at DESC
  `).all(req.user.id);
    const areas = db.prepare("SELECT target_id FROM follows WHERE user_id = ? AND target_type = 'area'").all(req.user.id).map((r) => r.target_id);
    res.json({ norms: norms.map(normSummary), areas });
}));
libraryRouter.post('/areas/:slug/follow', requireAuth, asyncHandler(async (req, res) => {
    const exists = db.prepare("SELECT 1 FROM follows WHERE user_id = ? AND target_type = 'area' AND target_id = ?").get(req.user.id, req.params.slug);
    if (exists) {
        db.prepare("DELETE FROM follows WHERE user_id = ? AND target_type = 'area' AND target_id = ?").run(req.user.id, req.params.slug);
        res.json({ followed: false });
        return;
    }
    db.prepare("INSERT INTO follows (user_id, target_type, target_id) VALUES (?, 'area', ?)").run(req.user.id, req.params.slug);
    res.json({ followed: true });
}));
// Búsqueda global: normas, artículos, noticias y estudiantes.
libraryRouter.get('/search', optionalAuth, asyncHandler((async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
        res.json({ norms: [], articles: [], news: [], users: [] });
        return;
    }
    const like = `%${q}%`;
    const norms = db.prepare(`
    SELECT n.slug, n.title, n.number, n.status, n.area,
           (SELECT COUNT(*) FROM articles a WHERE a.norm_id = n.id) AS article_count
    FROM norms n
    WHERE n.title LIKE ? OR n.short_title LIKE ? OR n.number LIKE ?
    ORDER BY CASE WHEN n.title = ? THEN 0 WHEN n.short_title = ? THEN 1 ELSE 2 END, n.title
    LIMIT 6
  `).all(like, like, like, q, q);
    let articles = [];
    const exactRows = exactArticleRows(q);
    if (exactRows) {
        articles = exactRows.map((r) => ({
            id: r.id,
            number: r.number,
            heading: r.heading,
            slug: r.slug,
            short_title: r.short_title,
            norm_title: r.title,
            status: r.status,
            snippet: escapeHtml(r.text.slice(0, 360)) + (r.text.length > 360 ? '…' : ''),
        }));
    }
    if (articles.length === 0) {
        const fts = ftsQuery(q);
        if (fts) {
            try {
                const rows = db.prepare(`
          SELECT a.id, a.number, a.heading, a.status, n.slug, n.short_title, n.title,
                 snippet(articles_fts, 2, '«', '»', '…', 18) AS snippet
          FROM articles_fts JOIN articles a ON a.rowid = articles_fts.rowid
          JOIN norms n ON n.id = a.norm_id
          WHERE articles_fts MATCH ?
          ORDER BY bm25(articles_fts) LIMIT 8
        `).all(fts);
                articles = rows.map((r) => ({
                    id: r.id,
                    number: r.number,
                    heading: r.heading,
                    slug: r.slug,
                    short_title: r.short_title,
                    norm_title: r.title,
                    status: r.status,
                    snippet: escapeHtml(r.snippet ?? ''),
                }));
            }
            catch {
                articles = [];
            }
        }
    }
    const news = db.prepare(`
    SELECT id, title, source_name, published_at, scope, category FROM news
    WHERE title LIKE ? OR summary LIKE ?
    ORDER BY published_at DESC LIMIT 5
  `).all(like, like);
    const viewerId = req.user?.id;
    const userRows = viewerId
        ? db.prepare(`
        SELECT id, name, avatar_url, university, privacy, privacy_fields FROM users
        WHERE name LIKE ? OR university LIKE ? OR username LIKE ? OR public_id LIKE ? LIMIT 12
      `).all(like, like, like, like)
        : [];
    const relations = viewerId ? relationsFor(viewerId) : undefined;
    const users = userRows
        .filter((row) => canViewProfile(row, viewerId, relations))
        .slice(0, 4)
        .map((row) => {
        const privacy = parsePrivacyFields(row.privacy_fields);
        const isFriend = relations?.get(row.id)?.status === 'accepted';
        return {
            id: row.id,
            name: row.name,
            avatarUrl: row.avatar_url,
            university: fieldAllowed(privacy.university ?? 'everyone', false, Boolean(isFriend)) ? row.university : undefined,
        };
    });
    res.json({ norms, articles, news, users, exact: Boolean(exactRows) });
})));
//# sourceMappingURL=library.routes.js.map