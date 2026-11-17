import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { asyncHandler } from '../../lib/http.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === '1';
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
    ORDER BY created_at DESC LIMIT 100
  `).all(req.user!.id);
  const unread = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(req.user!.id) as { c: number }).c;
  res.json({ notifications: rows, unread });
}));

notificationsRouter.get('/count', asyncHandler(async (req, res) => {
  const unread = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(req.user!.id) as { c: number }).c;
  res.json({ unread });
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  res.json({ ok: true });
}));

notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user!.id);
  res.json({ ok: true });
}));

notificationsRouter.delete('/:id', asyncHandler(async (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
}));
