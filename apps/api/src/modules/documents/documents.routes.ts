import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { db, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { extractText, safeUnlink, storageFor, uploader } from '../../lib/files.js';
import { asyncHandler, forbidden, notFound } from '../../lib/http.js';

export const documentsRouter = Router();

// Archivos servidos con control de acceso (no hay carpeta pública).
documentsRouter.get('/files/avatar/:name', asyncHandler(async (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(config.paths.uploads, 'avatars', name);
  if (!fs.existsSync(file)) throw notFound('Imagen no encontrada.');
  res.sendFile(file);
}));

documentsRouter.get('/files/cover/:name', asyncHandler(async (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(config.paths.uploads, 'covers', name);
  if (!fs.existsSync(file)) throw notFound('Imagen no encontrada.');
  res.sendFile(file);
}));

documentsRouter.get('/files/:id', requireAuth, asyncHandler(async (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id) as any;
  if (!doc) throw notFound('Archivo no encontrado.');
  const uid = req.user!.id;

  let allowed = doc.owner_id === uid;
  if (!allowed && doc.visibility === 'shared') allowed = true;
  if (!allowed) {
    allowed = Boolean(db.prepare('SELECT 1 FROM document_shares WHERE document_id = ? AND user_id = ?').get(doc.id, uid));
  }
  if (!allowed) {
    allowed = Boolean(db.prepare(`
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE m.attachment_id = ? AND cm.user_id = ?
    `).get(doc.id, uid));
  }
  if (!allowed) throw forbidden('No tienes acceso a este archivo.');
  if (!fs.existsSync(doc.path)) throw notFound('El archivo ya no está disponible en el servidor.');

  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `${doc.mime.startsWith('image/') || doc.mime.startsWith('audio/') ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.name)}"`);
  res.sendFile(doc.path);
}));

// Cada ruta privada declara su propia autenticación para que las rutas
// inexistentes bajo /api lleguen al manejador 404 y no a un 401 engañoso.
documentsRouter.post('/documents', requireAuth, uploader('documents').array('files', 5), asyncHandler(async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) throw notFound('No se recibió ningún archivo.');
  const out = [];
  for (const file of files) {
    const extracted = await extractText(file.path, file.mimetype);
    const id = uuid();
    db.prepare(`
      INSERT INTO documents (id, owner_id, name, mime, size, path, kind, extracted)
      VALUES (?, ?, ?, ?, ?, ?, 'file', ?)
    `).run(id, req.user!.id, file.originalname.slice(0, 200), file.mimetype, file.size, file.path, extracted);
    out.push({ id, name: file.originalname, mime: file.mimetype, size: file.size });
  }
  res.status(201).json({ documents: out });
}));

documentsRouter.get('/documents', requireAuth, asyncHandler(async (req, res) => {
  const mine = db.prepare(`
    SELECT d.*, 'owner' AS access FROM documents d WHERE d.owner_id = ? AND d.kind = 'file'
    ORDER BY d.created_at DESC
  `).all(req.user!.id) as any[];
  const shared = db.prepare(`
    SELECT d.*, 'shared' AS access, u.name AS owner_name FROM document_shares s
    JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
    WHERE s.user_id = ? ORDER BY d.created_at DESC
  `).all(req.user!.id) as any[];
  res.json({
    documents: [...mine, ...shared].map((d) => ({
      id: d.id, name: d.name, mime: d.mime, size: d.size, access: d.access,
      ownerName: d.owner_name ?? null, visibility: d.visibility, createdAt: d.created_at,
      hasText: Boolean(d.extracted),
    })),
  });
}));

documentsRouter.post('/documents/:id/share', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?').get(req.params.id, req.user!.id) as any;
  if (!doc) throw notFound('Documento no encontrado.');
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!target) throw notFound('Estudiante no encontrado.');
  db.prepare('INSERT OR IGNORE INTO document_shares (document_id, user_id) VALUES (?, ?)').run(doc.id, userId);
  db.prepare("UPDATE documents SET visibility = 'shared' WHERE id = ?").run(doc.id);
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), userId, 'document', 'Documento compartido', `${req.user!.name} compartió "${doc.name}" contigo.`, '/perfil');
  res.json({ ok: true });
}));

documentsRouter.delete('/documents/:id', requireAuth, asyncHandler(async (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?').get(req.params.id, req.user!.id) as any;
  if (!doc) throw notFound('Documento no encontrado.');
  safeUnlink(doc.path);
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
}));

documentsRouter.post('/users/me/avatar', requireAuth, uploader('avatars').single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) throw notFound('No se recibió imagen.');
  const previous = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user!.id) as { avatar_url: string | null };
  if (previous.avatar_url?.startsWith('/api/files/avatar/')) {
    safeUnlink(path.join(config.paths.uploads, 'avatars', path.basename(previous.avatar_url)));
  }
  const url = `/api/files/avatar/${req.file.filename}`;
  db.prepare("UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?").run(url, req.user!.id);
  res.json({ avatarUrl: url });
}));

documentsRouter.post('/users/me/cover', requireAuth, uploader('covers').single('cover'), asyncHandler(async (req, res) => {
  if (!req.file) throw notFound('No se recibió imagen.');
  const previous = db.prepare('SELECT cover_url FROM users WHERE id = ?').get(req.user!.id) as { cover_url: string | null };
  if (previous.cover_url?.startsWith('/api/files/cover/')) {
    safeUnlink(path.join(config.paths.uploads, 'covers', path.basename(previous.cover_url)));
  }
  const url = `/api/files/cover/${req.file.filename}`;
  db.prepare("UPDATE users SET cover_url = ?, updated_at = datetime('now') WHERE id = ?").run(url, req.user!.id);
  res.json({ coverUrl: url });
}));
