import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { db, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { uploader, safeUnlink } from '../../lib/files.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../../lib/http.js';

export const stickersRouter = Router();
stickersRouter.use(requireAuth);

const upload = uploader('documents');

stickersRouter.get('/packs', asyncHandler(async (req, res) => {
  const packs = db.prepare(`
    SELECT p.*, COUNT(s.id) AS sticker_count FROM sticker_packs p
    LEFT JOIN stickers s ON s.pack_id = p.id
    WHERE p.owner_id = ? GROUP BY p.id ORDER BY p.created_at DESC
  `).all(req.user!.id);
  res.json({ packs });
}));

stickersRouter.post('/packs', asyncHandler(async (req, res) => {
  const { name, description } = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(180).optional() }).parse(req.body);
  const id = uuid();
  db.prepare('INSERT INTO sticker_packs (id, owner_id, name, description) VALUES (?, ?, ?, ?)')
    .run(id, req.user!.id, name, description ?? null);
  res.status(201).json({ pack: { id, name, description: description ?? null } });
}));

stickersRouter.get('/packs/:id/stickers', asyncHandler(async (req, res) => {
  const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND owner_id = ?').get(req.params.id, req.user!.id);
  if (!pack) throw notFound('Paquete no encontrado.');
  const stickers = db.prepare('SELECT id, pack_id, name, mime, size, keywords FROM stickers WHERE pack_id = ? ORDER BY name')
    .all(req.params.id);
  res.json({ stickers: stickers.map((s: any) => ({ ...s, url: `/api/stickers/file/${s.id}` })) });
}));

stickersRouter.post('/packs/:id/stickers', upload.single('file'), asyncHandler(async (req, res) => {
  const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND owner_id = ?').get(req.params.id, req.user!.id);
  if (!pack) throw notFound('Paquete no encontrado.');
  const file = req.file;
  if (!file) throw badRequest('Selecciona una imagen.');
  if (!file.mimetype.startsWith('image/')) throw badRequest('Los stickers deben ser imágenes.');
  const id = uuid();
  const keywords = String(req.body.keywords ?? '').slice(0, 200);
  db.prepare(`
    INSERT INTO stickers (id, pack_id, owner_id, name, mime, size, path, keywords)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pack.id, req.user!.id, file.originalname.slice(0, 100), file.mimetype, file.size, file.path, keywords);
  res.status(201).json({ sticker: { id, name: file.originalname, url: `/api/stickers/file/${id}` } });
}));

stickersRouter.get('/file/:id', asyncHandler(async (req, res) => {
  const sticker = db.prepare('SELECT * FROM stickers WHERE id = ?').get(req.params.id) as any;
  if (!sticker) throw notFound('Sticker no encontrado.');
  if (sticker.owner_id !== req.user!.id) throw forbidden('No tienes acceso a este sticker.');
  if (!fs.existsSync(sticker.path)) throw notFound('El archivo ya no está disponible.');
  res.setHeader('Content-Type', sticker.mime);
  res.sendFile(sticker.path);
}));

stickersRouter.delete('/stickers/:id', asyncHandler(async (req, res) => {
  const sticker = db.prepare('SELECT * FROM stickers WHERE id = ? AND owner_id = ?').get(req.params.id, req.user!.id) as any;
  if (!sticker) throw notFound('Sticker no encontrado.');
  safeUnlink(sticker.path);
  db.prepare('DELETE FROM stickers WHERE id = ?').run(sticker.id);
  res.json({ ok: true });
}));
