import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { db, tx, uuid } from '../../db/index.js';
import { safeUnlink } from '../../lib/files.js';
import { acceptedContactIds, requireAuth } from '../../lib/auth.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../../lib/http.js';
import { emitToConversation, emitToUser, joinUserToConversation, notify } from '../../lib/notify.js';

export const messagingRouter = Router();
messagingRouter.use(requireAuth);

function memberIds(conversationId: string): string[] {
  return db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId).map((r: any) => r.user_id);
}

function ensureMember(conversationId: string, userId: string) {
  const row = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!row) throw forbidden('No perteneces a esta conversación.');
}

function mapMessage(m: any) {
  const reactions = db.prepare(`
    SELECT emoji, COUNT(*) AS count, GROUP_CONCAT(user_id) AS users
    FROM message_reactions WHERE message_id = ? GROUP BY emoji
  `).all(m.id).map((r: any) => ({ emoji: r.emoji, count: r.count, users: String(r.users).split(',') }));

  const attachment = m.attachment_id
    ? db.prepare('SELECT id, name, mime, size FROM documents WHERE id = ?').get(m.attachment_id)
    : null;

  const reply = m.reply_to
    ? db.prepare(`
        SELECT msg.id, msg.body, msg.kind, u.name AS sender_name
        FROM messages msg JOIN users u ON u.id = msg.sender_id WHERE msg.id = ?
      `).get(m.reply_to)
    : null;

  return {
    id: m.id,
    conversationId: m.conversation_id,
    body: m.deleted_at ? null : m.body,
    kind: m.kind,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    deleted: Boolean(m.deleted_at),
    sender: { id: m.sender_id, name: m.sender_name, avatarUrl: m.sender_avatar },
    attachment,
    replyTo: reply ?? null,
    reactions,
    oneTime: Boolean(m.one_time),
    viewed: Boolean(m.viewed_at),
    stickerPack: m.sticker_pack ?? null,
  };
}

function conversationForUser(conversationId: string, userId: string) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) throw notFound('Conversación no encontrada.');
  ensureMember(conversationId, userId);

  const members = db.prepare(`
    SELECT u.id, u.name, u.avatar_url, u.university, m.role, m.last_read_at, m.pinned, m.archived, m.muted
    FROM conversation_members m JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
  `).all(conversationId) as any[];

  const me = members.find((m) => m.id === userId);
  const last = db.prepare(`
    SELECT msg.*, u.name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages msg JOIN users u ON u.id = msg.sender_id
    WHERE msg.conversation_id = ? ORDER BY msg.created_at DESC LIMIT 1
  `).get(conversationId) as any;

  const unread = (db.prepare(`
    SELECT COUNT(*) c FROM messages
    WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL
      AND (created_at > COALESCE(?, '1970-01-01'))
  `).get(conversationId, userId, me?.last_read_at ?? null) as { c: number }).c;

  const other = conv.type === 'direct' ? members.find((m) => m.id !== userId) : null;

  return {
    id: conv.id,
    type: conv.type,
    title: conv.type === 'direct' ? other?.name ?? 'Conversación' : conv.title ?? 'Grupo',
    avatarUrl: conv.type === 'direct' ? other?.avatar_url ?? null : conv.avatar_url,
    members: members.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatar_url, university: m.university, role: m.role, lastReadAt: m.last_read_at })),
    lastMessage: last ? mapMessage(last) : null,
    unread,
    lastMessageAt: conv.last_message_at,
    pinned: Boolean(me?.pinned),
    archived: Boolean(me?.archived),
    muted: Boolean(me?.muted),
  };
}

messagingRouter.get('/conversations', asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id
    WHERE m.user_id = ?
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  `).all(req.user!.id) as Array<{ id: string }>;
  res.json({ conversations: rows.map((r) => conversationForUser(r.id, req.user!.id)) });
}));

messagingRouter.post('/conversations', asyncHandler(async (req, res) => {
  const data = z.object({
    type: z.enum(['direct', 'group']).default('direct'),
    memberIds: z.array(z.string().uuid()).min(1).max(50),
    title: z.string().trim().max(80).optional(),
  }).parse(req.body);

  const unique = [...new Set(data.memberIds.filter((id) => id !== req.user!.id))];
  if (unique.length === 0) throw badRequest('Selecciona al menos un estudiante.');
  const contacts = new Set(acceptedContactIds(req.user!.id));
  if (unique.some((id) => !contacts.has(id))) {
    throw forbidden('Solo puedes iniciar conversaciones con contactos aceptados.');
  }

  if (data.type === 'direct') {
    if (unique.length !== 1) throw badRequest('Una conversación directa requiere exactamente una persona.');
    const existing = db.prepare(`
      SELECT c.id FROM conversations c
      WHERE c.type = 'direct'
        AND (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
        AND EXISTS(SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ?)
        AND EXISTS(SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ?)
      LIMIT 1
    `).get(req.user!.id, unique[0]) as { id: string } | undefined;
    if (existing) { res.json({ conversation: conversationForUser(existing.id, req.user!.id) }); return; }
  }

  const id = uuid();
  tx(() => {
    db.prepare('INSERT INTO conversations (id, type, title, created_by) VALUES (?, ?, ?, ?)')
      .run(id, data.type, data.title ?? null, req.user!.id);
    db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user!.id);
    for (const uid of unique) {
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, uid);
    }
  });

  joinUserToConversation(req.user!.id, id);
  for (const uid of unique) {
    joinUserToConversation(uid, id);
    emitToUser(uid, 'conversation:new', { conversationId: id });
    notify(uid, 'message', 'Nueva conversación', `${req.user!.name} inició una conversación contigo.`, '/mensajes');
  }
  res.status(201).json({ conversation: conversationForUser(id, req.user!.id) });
}));

messagingRouter.get('/conversations/:id', asyncHandler(async (req, res) => {
  res.json({ conversation: conversationForUser(req.params.id, req.user!.id) });
}));

messagingRouter.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  ensureMember(req.params.id, req.user!.id);
  const limit = Math.min(Number(req.query.limit ?? 40) || 40, 100);
  const before = String(req.query.before ?? '');
  const rows = db.prepare(`
    SELECT msg.*, u.name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages msg JOIN users u ON u.id = msg.sender_id
    WHERE msg.conversation_id = ? ${before ? 'AND msg.created_at < ?' : ''}
    ORDER BY msg.created_at DESC LIMIT ?
  `).all(...(before ? [req.params.id, before, limit] : [req.params.id, limit])) as any[];
  res.json({ messages: rows.reverse().map(mapMessage), hasMore: rows.length === limit });
}));

messagingRouter.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const data = z.object({
    body: z.string().trim().max(6000).optional(),
    kind: z.enum(['text', 'image', 'file', 'audio', 'link', 'norm', 'news']).default('text'),
    attachmentId: z.string().uuid().optional().nullable(),
    replyTo: z.string().uuid().optional().nullable(),
    oneTime: z.boolean().optional().default(false),
    stickerPack: z.string().max(60).optional().nullable(),
  }).parse(req.body);
  if (!data.body && !data.attachmentId) throw badRequest('El mensaje está vacío.');
  ensureMember(req.params.id, req.user!.id);

  if (data.attachmentId) {
    const doc = db.prepare('SELECT owner_id, mime FROM documents WHERE id = ?').get(data.attachmentId) as { owner_id: string; mime: string } | undefined;
    if (!doc || doc.owner_id !== req.user!.id) throw forbidden('El archivo adjunto no te pertenece.');
    if (data.oneTime && !doc.mime.startsWith('image/')) throw badRequest('Las fotos de visualización única deben ser imágenes.');
  }
  if (data.oneTime && !data.attachmentId) throw badRequest('Selecciona una imagen para enviarla como visualización única.');
  if (data.replyTo) {
    const reply = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(data.replyTo) as { conversation_id: string } | undefined;
    if (!reply || reply.conversation_id !== req.params.id) throw badRequest('La respuesta no pertenece a esta conversación.');
  }

  const id = uuid();
  tx(() => {
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, body, kind, attachment_id, reply_to, sticker_pack, one_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.params.id, req.user!.id, data.body ?? null, data.kind, data.attachmentId ?? null,
      data.replyTo ?? null, data.stickerPack ?? null, data.oneTime ? 1 : 0,
    );
    db.prepare('UPDATE conversations SET last_message_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  });

  const row = db.prepare(`
    SELECT msg.*, u.name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages msg JOIN users u ON u.id = msg.sender_id WHERE msg.id = ?
  `).get(id) as any;
  const message = mapMessage(row);
  emitToConversation(req.params.id, 'message:new', message);

  for (const uid of memberIds(req.params.id)) {
    if (uid !== req.user!.id) {
      emitToUser(uid, 'conversation:activity', { conversationId: req.params.id });
      notify(uid, 'message', `Mensaje de ${req.user!.name}`, data.body?.slice(0, 120) ?? 'Te envió un archivo.', '/mensajes');
    }
  }
  res.status(201).json({ message });
}));

messagingRouter.patch('/messages/:id', asyncHandler(async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(6000) }).parse(req.body);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) throw notFound('Mensaje no encontrado.');
  ensureMember(msg.conversation_id, req.user!.id);
  if (msg.sender_id !== req.user!.id) throw forbidden();
  db.prepare("UPDATE messages SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, msg.id);
  emitToConversation(msg.conversation_id, 'message:updated', { id: msg.id, body, editedAt: new Date().toISOString() });
  res.json({ ok: true });
}));

messagingRouter.delete('/messages/:id', asyncHandler(async (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) throw notFound('Mensaje no encontrado.');
  // La privacidad de las conversaciones se aplica también a administradores:
  // solo un participante puede borrar un mensaje.
  ensureMember(msg.conversation_id, req.user!.id);
  if (msg.sender_id !== req.user!.id) throw forbidden();
  db.prepare("UPDATE messages SET deleted_at = datetime('now') WHERE id = ?").run(msg.id);
  emitToConversation(msg.conversation_id, 'message:deleted', { id: msg.id });
  res.json({ ok: true });
}));

messagingRouter.post('/messages/:id/reactions', asyncHandler(async (req, res) => {
  const { emoji } = z.object({ emoji: z.string().min(1).max(8) }).parse(req.body);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) throw notFound('Mensaje no encontrado.');
  ensureMember(msg.conversation_id, req.user!.id);
  const exists = db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
    .get(msg.id, req.user!.id, emoji);
  if (exists) db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(msg.id, req.user!.id, emoji);
  else db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(msg.id, req.user!.id, emoji);
  emitToConversation(msg.conversation_id, 'message:reaction', { messageId: msg.id });
  res.json({ ok: true });
}));

messagingRouter.post('/conversations/:id/read', asyncHandler(async (req, res) => {
  ensureMember(req.params.id, req.user!.id);
  db.prepare("UPDATE conversation_members SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?")
    .run(req.params.id, req.user!.id);
  emitToConversation(req.params.id, 'conversation:read', { conversationId: req.params.id, userId: req.user!.id });
  res.json({ ok: true });
}));

messagingRouter.get('/conversations/:id/search', asyncHandler(async (req, res) => {
  ensureMember(req.params.id, req.user!.id);
  const q = String(req.query.q ?? '').trim();
  if (!q) { res.json({ messages: [] }); return; }
  const rows = db.prepare(`
    SELECT msg.*, u.name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages msg JOIN users u ON u.id = msg.sender_id
    WHERE msg.conversation_id = ? AND msg.body LIKE ? AND msg.deleted_at IS NULL
    ORDER BY msg.created_at DESC LIMIT 30
  `).all(req.params.id, `%${q}%`) as any[];
  res.json({ messages: rows.map(mapMessage) });
}));

messagingRouter.patch('/conversations/:id/preferences', asyncHandler(async (req, res) => {
  const data = z.object({ pinned: z.boolean().optional(), archived: z.boolean().optional(), muted: z.boolean().optional() }).parse(req.body);
  ensureMember(req.params.id, req.user!.id);
  const fields: string[] = [];
  const values: any[] = [];
  if (data.pinned !== undefined) { fields.push('pinned = ?'); values.push(data.pinned ? 1 : 0); }
  if (data.archived !== undefined) { fields.push('archived = ?'); values.push(data.archived ? 1 : 0); }
  if (data.muted !== undefined) { fields.push('muted = ?'); values.push(data.muted ? 1 : 0); }
  if (fields.length) {
    db.prepare(`UPDATE conversation_members SET ${fields.join(', ')} WHERE conversation_id = ? AND user_id = ?`)
      .run(...values, req.params.id, req.user!.id);
  }
  res.json({ ok: true });
}));

messagingRouter.get('/messages/:id/one-time', asyncHandler(async (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!message) throw notFound('Mensaje no encontrado.');
  ensureMember(message.conversation_id, req.user!.id);
  if (!message.one_time) throw badRequest('Esta imagen no es de visualización única.');
  if (message.sender_id === req.user!.id) throw forbidden('No puedes abrir tu propia imagen de visualización única.');
  if (message.viewed_at) throw badRequest('Esta imagen ya fue visualizada y ya no está disponible.');
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(message.attachment_id) as any;
  if (!doc) throw notFound('La imagen ya no está disponible.');

  const claimed = db.prepare("UPDATE messages SET viewed_at = datetime('now') WHERE id = ? AND viewed_at IS NULL").run(message.id);
  if (claimed.changes === 0) throw badRequest('Esta imagen ya fue visualizada y ya no está disponible.');

  emitToConversation(message.conversation_id, 'message:updated', { id: message.id, viewed: true });
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => {
    safeUnlink(doc.path);
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    db.prepare('UPDATE messages SET attachment_id = NULL WHERE id = ?').run(message.id);
  });
  res.send(fs.readFileSync(doc.path));
}));

messagingRouter.get('/calls', asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT ch.*, caller.name AS caller_name, callee.name AS callee_name
    FROM call_history ch
    JOIN users caller ON caller.id = ch.caller_id
    LEFT JOIN users callee ON callee.id = ch.callee_id
    WHERE ch.caller_id = ? OR ch.callee_id = ?
    ORDER BY ch.started_at DESC LIMIT 50
  `).all(req.user!.id, req.user!.id);
  res.json({ calls: rows });
}));
