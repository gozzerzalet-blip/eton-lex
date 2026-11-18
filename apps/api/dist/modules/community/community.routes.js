import { Router } from 'express';
import { z } from 'zod';
import { db, tx, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/http.js';
export const communityRouter = Router();
communityRouter.use(requireAuth);
const postSchema = z.object({
    kind: z.enum(['note', 'question', 'document', 'news', 'norm']).default('note'),
    title: z.string().trim().max(140).optional().nullable(),
    body: z.string().trim().min(1, 'El contenido no puede estar vacío.').max(8000),
    groupId: z.string().uuid().optional().nullable(),
    refType: z.string().max(30).optional().nullable(),
    refId: z.string().max(80).optional().nullable(),
    visibility: z.enum(['friends', 'group', 'public']).default('friends'),
});
// ── Amistades ───────────────────────────────────────────────────
communityRouter.get('/friends', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const friends = db.prepare(`
    SELECT u.id, u.name, u.avatar_url, u.university, u.cycle, f.status, f.created_at
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
    ORDER BY u.name
  `).all(uid, uid, uid);
    const incoming = db.prepare(`
    SELECT f.id AS request_id, u.id, u.name, u.avatar_url, u.university, u.cycle, f.created_at
    FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC
  `).all(uid);
    const outgoing = db.prepare(`
    SELECT f.id AS request_id, u.id, u.name, u.avatar_url, u.university, f.created_at
    FROM friendships f JOIN users u ON u.id = f.addressee_id
    WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC
  `).all(uid);
    res.json({ friends, incoming, outgoing });
}));
communityRouter.post('/friends/request', asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    if (userId === req.user.id)
        throw badRequest('No puedes agregarte a ti mismo.');
    const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!target)
        throw notFound('Estudiante no encontrado.');
    const existing = db.prepare(`
    SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.user.id, userId, userId, req.user.id);
    if (existing) {
        if (existing.status === 'accepted')
            throw conflict('Ya son amigos.');
        if (existing.status === 'pending' && existing.requester_id === req.user.id)
            throw conflict('Solicitud ya enviada.');
        if (existing.status === 'pending' && existing.addressee_id === req.user.id) {
            db.prepare("UPDATE friendships SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(existing.id);
            res.json({ status: 'accepted' });
            return;
        }
        db.prepare("UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending', responded_at = NULL WHERE id = ?")
            .run(req.user.id, userId, existing.id);
        res.json({ status: 'pending' });
        return;
    }
    db.prepare('INSERT INTO friendships (id, requester_id, addressee_id) VALUES (?, ?, ?)').run(uuid(), req.user.id, userId);
    db.prepare('INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuid(), userId, 'friend_request', 'Nueva solicitud de amistad', `${req.user.name} quiere conectar contigo.`, '/comunidad');
    res.json({ status: 'pending' });
}));
communityRouter.post('/friends/:id/respond', asyncHandler(async (req, res) => {
    const { action } = z.object({ action: z.enum(['accept', 'reject', 'block']) }).parse(req.body);
    const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(req.params.id);
    if (!row)
        throw notFound('Solicitud no encontrada.');
    if (row.addressee_id !== req.user.id && row.requester_id !== req.user.id)
        throw forbidden();
    if (action === 'accept') {
        if (row.addressee_id !== req.user.id)
            throw forbidden();
        db.prepare("UPDATE friendships SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(row.id);
    }
    else if (action === 'reject') {
        // Solo quien recibió la solicitud puede rechazarla. Conservamos el estado
        // 'rejected' para que la otra persona pueda volver a solicitar amistad.
        if (row.addressee_id !== req.user.id)
            throw forbidden();
        db.prepare("UPDATE friendships SET status = 'rejected', responded_at = datetime('now') WHERE id = ?").run(row.id);
    }
    else {
        db.prepare("UPDATE friendships SET status = 'blocked', responded_at = datetime('now') WHERE id = ?").run(row.id);
    }
    res.json({ ok: true, status: action });
}));
communityRouter.delete('/friends/:userId', asyncHandler(async (req, res) => {
    db.prepare(`
    DELETE FROM friendships WHERE status != 'blocked' AND
    ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
  `).run(req.user.id, req.params.userId, req.params.userId, req.user.id);
    res.json({ ok: true });
}));
// ── Feed y publicaciones ────────────────────────────────────────
communityRouter.get('/feed', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const rows = db.prepare(`
    SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar, u.university AS author_university,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comments,
      EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.group_id IS NULL AND (
      p.author_id = ?
      OR (
        COALESCE(json_extract(u.privacy, '$.activity'), 'friends') != 'private'
        AND (
          COALESCE(json_extract(u.privacy, '$.activity'), 'friends') != 'friends'
          OR EXISTS(
            SELECT 1 FROM friendships f WHERE f.status = 'accepted'
            AND ((f.requester_id = ? AND f.addressee_id = p.author_id) OR (f.addressee_id = ? AND f.requester_id = p.author_id))
          )
        )
        AND (
          p.visibility = 'public'
          OR (p.visibility = 'friends' AND EXISTS(
            SELECT 1 FROM friendships f WHERE f.status = 'accepted'
            AND ((f.requester_id = ? AND f.addressee_id = p.author_id) OR (f.addressee_id = ? AND f.requester_id = p.author_id))
          ))
        )
      )
    )
    ORDER BY p.created_at DESC LIMIT 40
  `).all(uid, uid, uid, uid, uid, uid);
    res.json({ posts: rows.map(mapPost) });
}));
communityRouter.post('/posts', asyncHandler(async (req, res) => {
    const data = postSchema.parse(req.body);
    if (data.groupId) {
        const member = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(data.groupId, req.user.id);
        if (!member)
            throw forbidden('Debes pertenecer al grupo para publicar en él.');
    }
    const id = uuid();
    db.prepare(`
    INSERT INTO posts (id, author_id, group_id, kind, title, body, ref_type, ref_id, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, data.groupId ?? null, data.kind, data.title ?? null, data.body, data.refType ?? null, data.refId ?? null, data.visibility);
    res.status(201).json({ id });
}));
communityRouter.delete('/posts/:id', asyncHandler(async (req, res) => {
    const post = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(req.params.id);
    if (!post)
        throw notFound('Publicación no encontrada.');
    if (post.author_id !== req.user.id && req.user.role !== 'admin')
        throw forbidden();
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
}));
communityRouter.post('/posts/:id/like', asyncHandler(async (req, res) => {
    const exists = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (exists)
        db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    else
        db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
    const likes = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(req.params.id).c;
    res.json({ liked: !exists, likes });
}));
communityRouter.get('/posts/:id/comments', asyncHandler(async (req, res) => {
    const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.id AS author_id, u.name AS author_name, u.avatar_url
    FROM post_comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(req.params.id);
    res.json({ comments });
}));
communityRouter.post('/posts/:id/comments', asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    const id = uuid();
    db.prepare('INSERT INTO post_comments (id, post_id, author_id, body) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.user.id, body);
    res.status(201).json({ id });
}));
// ── Grupos de estudio ───────────────────────────────────────────
communityRouter.get('/groups', asyncHandler(async (req, res) => {
    const rows = db.prepare(`
    SELECT g.*, u.name AS owner_name,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS joined
    FROM study_groups g JOIN users u ON u.id = g.owner_id
    WHERE g.visibility = 'public' OR g.owner_id = ? OR EXISTS(
      SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?
    )
    ORDER BY g.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
    res.json({ groups: rows });
}));
communityRouter.post('/groups', asyncHandler(async (req, res) => {
    const data = z.object({
        name: z.string().trim().min(3).max(80),
        description: z.string().trim().max(500).optional().nullable(),
        visibility: z.enum(['private', 'public']).default('private'),
        area: z.string().max(40).optional().nullable(),
    }).parse(req.body);
    const id = uuid();
    tx(() => {
        db.prepare('INSERT INTO study_groups (id, name, description, owner_id, visibility, area) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, data.name, data.description ?? null, req.user.id, data.visibility, data.area ?? null);
        db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user.id);
    });
    res.status(201).json({ id });
}));
communityRouter.get('/groups/:id', asyncHandler(async (req, res) => {
    const group = db.prepare(`
    SELECT g.*, u.name AS owner_name FROM study_groups g JOIN users u ON u.id = g.owner_id WHERE g.id = ?
  `).get(req.params.id);
    if (!group)
        throw notFound('Grupo no encontrado.');
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, req.user.id);
    if (group.visibility === 'private' && !isMember)
        throw forbidden('Este grupo es privado.');
    const members = db.prepare(`
    SELECT u.id, u.name, u.avatar_url, u.university, m.role FROM group_members m
    JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.role DESC, u.name
  `).all(group.id);
    const posts = db.prepare(`
    SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comments,
      EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.author_id WHERE p.group_id = ?
    ORDER BY p.created_at DESC LIMIT 40
  `).all(req.user.id, group.id);
    res.json({ group: { ...group, joined: Boolean(isMember) }, members, posts: posts.map(mapPost) });
}));
communityRouter.post('/groups/:id/join', asyncHandler(async (req, res) => {
    const group = db.prepare('SELECT * FROM study_groups WHERE id = ?').get(req.params.id);
    if (!group)
        throw notFound('Grupo no encontrado.');
    const exists = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, req.user.id);
    if (exists) {
        if (group.owner_id === req.user.id)
            throw badRequest('El creador no puede salir de su propio grupo.');
        db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, req.user.id);
        res.json({ joined: false });
        return;
    }
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group.id, req.user.id);
    res.json({ joined: true });
}));
communityRouter.get('/activity', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const rows = db.prepare(`
    SELECT p.id, p.title, p.body, p.kind, p.created_at, u.name AS author_name, u.avatar_url
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.author_id != ? AND EXISTS(
      SELECT 1 FROM friendships f WHERE f.status = 'accepted'
      AND ((f.requester_id = ? AND f.addressee_id = p.author_id) OR (f.addressee_id = ? AND f.requester_id = p.author_id))
    )
    ORDER BY p.created_at DESC LIMIT 8
  `).all(uid, uid, uid);
    res.json({ activity: rows });
}));
communityRouter.post('/reports', asyncHandler(async (req, res) => {
    const data = z.object({
        targetType: z.enum(['user', 'post', 'message', 'comment']),
        targetId: z.string().min(1).max(80),
        reason: z.string().trim().min(5).max(500),
    }).parse(req.body);
    db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?)')
        .run(uuid(), req.user.id, data.targetType, data.targetId, data.reason);
    res.status(201).json({ ok: true });
}));
function mapPost(p) {
    return {
        id: p.id,
        kind: p.kind,
        title: p.title,
        body: p.body,
        refType: p.ref_type,
        refId: p.ref_id,
        visibility: p.visibility,
        createdAt: p.created_at,
        groupId: p.group_id,
        author: { id: p.author_id, name: p.author_name, avatarUrl: p.author_avatar, university: p.author_university ?? null },
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        liked: Boolean(p.liked),
    };
}
//# sourceMappingURL=community.routes.js.map