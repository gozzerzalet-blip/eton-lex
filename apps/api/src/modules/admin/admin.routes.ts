import { Router } from 'express';
import { z } from 'zod';
import { db, tx, uuid } from '../../db/index.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { asyncHandler, badRequest, notFound } from '../../lib/http.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'moderator'));

adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
  res.json({
    stats: {
      users: one('SELECT COUNT(*) c FROM users'),
      norms: one('SELECT COUNT(*) c FROM norms'),
      articles: one('SELECT COUNT(*) c FROM articles'),
      verifiedNorms: one("SELECT COUNT(*) c FROM norms WHERE verification = 'verified'"),
      pendingUpdates: one("SELECT COUNT(*) c FROM norm_updates WHERE status = 'pending'"),
      confirmedUpdates: one("SELECT COUNT(*) c FROM norm_updates WHERE status = 'confirmed'"),
      news: one('SELECT COUNT(*) c FROM news'),
      posts: one('SELECT COUNT(*) c FROM posts'),
      messages: one('SELECT COUNT(*) c FROM messages'),
      openReports: one("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
    },
    recentRuns: db.prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 10').all(),
  });
}));

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = db.prepare(`
    SELECT id, name, email, university, role, email_verified, created_at, last_seen_at
    FROM users WHERE (? = '' OR name LIKE ? OR email LIKE ?)
    ORDER BY created_at DESC LIMIT 100
  `).all(q, `%${q}%`, `%${q}%`);
  res.json({ users: rows });
}));

adminRouter.patch('/users/:id/role', requireRole('admin'), asyncHandler(async (req, res) => {
  const { role } = z.object({ role: z.enum(['student', 'moderator', 'admin']) }).parse(req.body);
  if (req.params.id === req.user!.id) throw badRequest('No puedes cambiar tu propio rol.');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
}));

adminRouter.get('/reports', asyncHandler(async (_req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.name AS reporter_name FROM reports r JOIN users u ON u.id = r.reporter_id
    ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100
  `).all();
  res.json({ reports: rows });
}));

adminRouter.patch('/reports/:id', asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['open', 'reviewed', 'dismissed', 'actioned']) }).parse(req.body);
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
}));

adminRouter.get('/sources', asyncHandler(async (_req, res) => {
  res.json({ sources: db.prepare('SELECT * FROM sources ORDER BY name').all() });
}));

adminRouter.post('/sources', asyncHandler(async (req, res) => {
  const data = z.object({
    key: z.string().trim().regex(/^[a-z0-9_-]+$/).max(40),
    name: z.string().trim().min(3).max(120),
    url: z.string().url(),
    kind: z.enum(['rss', 'html', 'api', 'manual']).default('rss'),
    enabled: z.boolean().default(true),
    notes: z.string().max(500).optional().nullable(),
  }).parse(req.body);
  db.prepare('INSERT INTO sources (id, key, name, url, kind, enabled, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), data.key, data.name, data.url, data.kind, data.enabled ? 1 : 0, data.notes ?? null);
  res.status(201).json({ ok: true });
}));

adminRouter.patch('/sources/:id', asyncHandler(async (req, res) => {
  const data = z.object({
    name: z.string().min(3).max(120).optional(),
    url: z.string().url().optional(),
    kind: z.enum(['rss', 'html', 'api', 'manual']).optional(),
    enabled: z.boolean().optional(),
  }).parse(req.body);
  const fields: string[] = [];
  const values: any[] = [];
  if (data.name) { fields.push('name = ?'); values.push(data.name); }
  if (data.url) { fields.push('url = ?'); values.push(data.url); }
  if (data.kind) { fields.push('kind = ?'); values.push(data.kind); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (!fields.length) throw badRequest('Nada que actualizar.');
  db.prepare(`UPDATE sources SET ${fields.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  res.json({ ok: true });
}));

adminRouter.get('/audit', asyncHandler(async (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT 200
  `).all();
  res.json({ audit: rows });
}));

// ── Carga y verificación de normas ─────────────────────────────
adminRouter.post('/norms', asyncHandler(async (req, res) => {
  const data = z.object({
    title: z.string().trim().min(4).max(240),
    shortTitle: z.string().trim().max(120).optional().nullable(),
    number: z.string().trim().max(80).optional().nullable(),
    type: z.enum(['constitucion', 'codigo', 'ley', 'decreto_legislativo', 'decreto_supremo', 'resolucion', 'reglamento', 'tratado']),
    area: z.string().max(40).optional().nullable(),
    entity: z.string().trim().max(160).optional().nullable(),
    publishedAt: z.string().max(20).optional().nullable(),
    effectiveAt: z.string().max(20).optional().nullable(),
    status: z.enum(['vigente', 'modificado', 'parcialmente_derogado', 'derogado', 'por_verificar']).default('por_verificar'),
    officialUrl: z.string().url().optional().nullable(),
    summary: z.string().max(2000).optional().nullable(),
  }).parse(req.body);

  const slug = data.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

  const id = uuid();
  db.prepare(`
    INSERT INTO norms (id, slug, title, short_title, number, type, area, entity, published_at, effective_at, status, official_url, summary, verification, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, slug, data.title, data.shortTitle ?? null, data.number ?? null, data.type, data.area ?? null,
    data.entity ?? null, data.publishedAt ?? null, data.effectiveAt ?? null, data.status,
    data.officialUrl ?? null, data.summary ?? null,
    data.officialUrl ? 'verified' : 'pending',
    data.officialUrl ? new Date().toISOString() : null,
  );
  res.status(201).json({ id, slug });
}));

adminRouter.post('/norms/:id/articles', asyncHandler(async (req, res) => {
  const data = z.object({
    versionLabel: z.string().max(60).default('Texto vigente'),
    sourceUrl: z.string().url().optional().nullable(),
    replace: z.boolean().default(false),
    articles: z.array(z.object({
      number: z.string().trim().min(1).max(40),
      heading: z.string().max(300).optional().nullable(),
      text: z.string().trim().min(1).max(80_000),
    })).min(1).max(2000),
  }).parse(req.body);

  const norm = db.prepare('SELECT * FROM norms WHERE id = ?').get(req.params.id) as any;
  if (!norm) throw notFound('Norma no encontrada.');

  const versionId = uuid();
  tx(() => {
    db.prepare('INSERT INTO norm_versions (id, norm_id, label, source_url, verification) VALUES (?, ?, ?, ?, ?)')
      .run(versionId, norm.id, data.versionLabel, data.sourceUrl ?? norm.official_url, data.sourceUrl ? 'verified' : 'pending');
    if (data.replace) db.prepare('DELETE FROM articles WHERE norm_id = ?').run(norm.id);
    const insert = db.prepare(`
      INSERT INTO articles (id, norm_id, version_id, number, heading, text, order_index, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    data.articles.forEach((a, index) => {
      insert.run(uuid(), norm.id, versionId, a.number, a.heading ?? null, a.text, index, data.sourceUrl ?? norm.official_url);
    });
    db.prepare("UPDATE norms SET updated_at = datetime('now') WHERE id = ?").run(norm.id);
  });
  res.status(201).json({ versionId, inserted: data.articles.length });
}));

adminRouter.patch('/norms/:id/verify', asyncHandler(async (req, res) => {
  const data = z.object({
    officialUrl: z.string().url(),
    status: z.enum(['vigente', 'modificado', 'parcialmente_derogado', 'derogado']).optional(),
  }).parse(req.body);
  const norm = db.prepare('SELECT * FROM norms WHERE id = ?').get(req.params.id);
  if (!norm) throw notFound('Norma no encontrada.');
  db.prepare(`
    UPDATE norms SET verification = 'verified', verified_at = datetime('now'), official_url = ?,
      status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?
  `).run(data.officialUrl, data.status ?? null, req.params.id);
  res.json({ ok: true });
}));

adminRouter.post('/notifications/broadcast', requireRole('admin'), asyncHandler(async (req, res) => {
  const data = z.object({
    title: z.string().trim().min(3).max(160),
    body: z.string().max(1000).optional().nullable(),
    link: z.string().max(300).optional().nullable(),
    area: z.string().max(40).optional().nullable(),
  }).parse(req.body);
  const users = data.area
    ? db.prepare('SELECT user_id FROM user_interests WHERE area = ?').all(data.area) as Array<{ user_id: string }>
    : db.prepare('SELECT id AS user_id FROM users').all() as Array<{ user_id: string }>;
  const insert = db.prepare('INSERT INTO notifications (id, user_id, type, title, body, link, priority) VALUES (?, ?, ?, ?, ?, ?, ?)');
  tx(() => {
    for (const u of users) insert.run(uuid(), u.user_id, 'broadcast', data.title, data.body ?? null, data.link ?? null, 'high');
  });
  res.json({ sent: users.length });
}));
