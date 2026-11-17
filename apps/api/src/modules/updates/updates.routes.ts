import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { optionalAuth, requireAuth, requireRole } from '../../lib/auth.js';
import { asyncHandler, notFound } from '../../lib/http.js';
import { confirmUpdate, ingestOfficialUpdates } from './ingest.js';

export const updatesRouter = Router();

updatesRouter.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const status = String(req.query.status ?? 'confirmed').trim();
  const area = String(req.query.area ?? '').trim();
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 50);

  const where: string[] = ['u.status = ?'];
  const params: any[] = [status];
  if (area) { where.push('n.area = ?'); params.push(area); }

  const total = (db.prepare(`
    SELECT COUNT(*) c FROM norm_updates u LEFT JOIN norms n ON n.id = u.norm_id WHERE ${where.join(' AND ')}
  `).get(...params) as { c: number }).c;

  const rows = db.prepare(`
    SELECT u.*, n.title AS norm_title, n.slug AS norm_slug, n.area AS norm_area, n.number AS norm_number,
           a.number AS article_number
    FROM norm_updates u
    LEFT JOIN norms n ON n.id = u.norm_id
    LEFT JOIN articles a ON a.id = u.article_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(u.published_at, u.detected_at) DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  res.json({ updates: rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) });
}));

// Feed personalizado: sigue áreas e intereses del usuario.
updatesRouter.get('/for-me', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT u.*, n.title AS norm_title, n.slug AS norm_slug, n.area AS norm_area, a.number AS article_number
    FROM norm_updates u
    LEFT JOIN norms n ON n.id = u.norm_id
    LEFT JOIN articles a ON a.id = u.article_id
    WHERE u.status = 'confirmed' AND (
      n.area IN (SELECT target_id FROM follows WHERE user_id = ? AND target_type = 'area')
      OR n.area IN (SELECT area FROM user_interests WHERE user_id = ?)
      OR u.norm_id IN (SELECT target_id FROM follows WHERE user_id = ? AND target_type = 'norm')
    )
    ORDER BY COALESCE(u.published_at, u.detected_at) DESC LIMIT 30
  `).all(req.user!.id, req.user!.id, req.user!.id);
  res.json({ updates: rows });
}));

updatesRouter.get('/queue', requireAuth, requireRole('admin', 'moderator'), asyncHandler(async (_req, res) => {
  const rows = db.prepare(`
    SELECT u.*, s.name AS source_name FROM norm_updates u
    LEFT JOIN sources s ON s.key = u.source_key
    WHERE u.status = 'pending' ORDER BY COALESCE(u.published_at, u.detected_at) DESC LIMIT 100
  `).all();
  const stats = db.prepare("SELECT status, COUNT(*) c FROM norm_updates GROUP BY status").all();
  res.json({ queue: rows, stats });
}));

updatesRouter.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const row = db.prepare(`
    SELECT u.*, n.title AS norm_title, n.slug AS norm_slug, n.number AS norm_number, a.number AS article_number
    FROM norm_updates u LEFT JOIN norms n ON n.id = u.norm_id LEFT JOIN articles a ON a.id = u.article_id
    WHERE u.id = ?
  `).get(req.params.id);
  if (!row) throw notFound('Actualización no encontrada.');
  res.json({ update: row });
}));

updatesRouter.post('/refresh', requireAuth, requireRole('admin', 'moderator'), asyncHandler(async (_req, res) => {
  const result = await ingestOfficialUpdates();
  res.json({ result });
}));

updatesRouter.post('/:id/confirm', requireAuth, requireRole('admin', 'moderator'), asyncHandler(async (req, res) => {
  const data = z.object({
    normId: z.string().uuid().nullable().optional(),
    articleNumber: z.string().max(30).nullable().optional(),
    previousText: z.string().max(60_000).nullable().optional(),
    currentText: z.string().max(60_000).nullable().optional(),
    title: z.string().max(300).nullable().optional(),
    summary: z.string().max(2000).nullable().optional(),
  }).parse(req.body);
  const update = confirmUpdate(req.params.id, req.user!.id, data);
  res.json({ update });
}));

updatesRouter.post('/:id/reject', requireAuth, requireRole('admin', 'moderator'), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
  db.prepare("UPDATE norm_updates SET status = 'rejected', confirmed_by = ?, summary = COALESCE(?, summary) WHERE id = ?")
    .run(req.user!.id, reason ?? null, req.params.id);
  res.json({ ok: true });
}));
