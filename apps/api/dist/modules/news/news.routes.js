import { Router } from 'express';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { optionalAuth, requireAuth, requireRole } from '../../lib/auth.js';
import { asyncHandler, notFound } from '../../lib/http.js';
import { ingestNews, parseFeedList } from './ingest.js';
export const newsRouter = Router();
newsRouter.get('/', optionalAuth, asyncHandler(async (req, res) => {
    const scope = String(req.query.scope ?? '').trim();
    const category = String(req.query.category ?? '').trim();
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 50);
    const where = ['1=1'];
    const params = [];
    if (scope) {
        where.push('scope = ?');
        params.push(scope);
    }
    if (category) {
        where.push('category = ?');
        params.push(category);
    }
    if (q) {
        where.push('(title LIKE ? OR summary LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
    }
    const total = db.prepare(`SELECT COUNT(*) c FROM news WHERE ${where.join(' AND ')}`).get(...params).c;
    const rows = db.prepare(`
    SELECT id, title, summary, source_name, source_url, image_url, country, scope, category, relevance, published_at, fetched_at
    FROM news WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({
        news: rows,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        sources: {
            configured: config.news.feeds.length > 0 || Boolean(config.news.newsApiKey),
            feeds: parseFeedList(config.news.feeds).map((f) => ({ url: f.url, scope: f.scope, category: f.category, name: f.name ?? null })),
            newsApi: Boolean(config.news.newsApiKey),
        },
    });
}));
newsRouter.get('/categories', asyncHandler(async (_req, res) => {
    const rows = db.prepare('SELECT category, COUNT(*) AS count FROM news WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC').all();
    res.json({ categories: rows });
}));
newsRouter.get('/:id', asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
    if (!row)
        throw notFound('Noticia no encontrada.');
    res.json({ news: row });
}));
newsRouter.post('/refresh', requireAuth, requireRole('admin', 'moderator'), asyncHandler(async (_req, res) => {
    const result = await ingestNews();
    res.json({ result });
}));
newsRouter.get('/sources/status', asyncHandler(async (_req, res) => {
    const runs = db.prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 20').all();
    res.json({
        configured: config.news.feeds.length > 0 || Boolean(config.news.newsApiKey),
        feeds: parseFeedList(config.news.feeds),
        runs,
    });
}));
//# sourceMappingURL=news.routes.js.map