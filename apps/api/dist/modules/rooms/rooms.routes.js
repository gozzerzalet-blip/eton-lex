import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db, tx, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { emitToRoom, notify } from '../../lib/notify.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../../lib/http.js';
export const roomsRouter = Router();
roomsRouter.use(requireAuth);
function roomFor(roomId, userId) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room)
        throw notFound('Sala no encontrada.');
    if (room.ended_at)
        throw badRequest('La sala ya fue finalizada.');
    const member = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!member || member.left_at)
        throw forbidden('No perteneces a esta sala.');
    return { room, member };
}
function roomPayload(roomId, userId) {
    const room = db.prepare(`
    SELECT r.*, u.name AS owner_name FROM rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = ?
  `).get(roomId);
    const members = db.prepare(`
    SELECT rm.user_id AS id, u.name, u.avatar_url, u.university, rm.role, rm.hand_raised, rm.joined_at
    FROM room_members rm JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ? AND rm.left_at IS NULL ORDER BY rm.joined_at
  `).all(roomId);
    const pages = db.prepare('SELECT * FROM whiteboard_pages WHERE room_id = ? ORDER BY page_number').all(roomId);
    const elements = db.prepare(`
    SELECT e.id, e.page_id, e.author_id, e.type, e.data, e.created_at, u.name AS author_name
    FROM whiteboard_elements e JOIN users u ON u.id = e.author_id
    JOIN whiteboard_pages p ON p.id = e.page_id
    WHERE p.room_id = ? ORDER BY e.created_at
  `).all(roomId);
    const messages = db.prepare(`
    SELECT m.*, u.name AS sender_name, u.avatar_url AS sender_avatar
    FROM room_messages m JOIN users u ON u.id = m.sender_id
    WHERE m.room_id = ? ORDER BY m.created_at DESC LIMIT 100
  `).all(roomId).reverse().map((m) => ({
        id: m.id, roomId: m.room_id, body: m.body, kind: m.kind, createdAt: m.created_at,
        sender: { id: m.sender_id, name: m.sender_name, avatarUrl: m.sender_avatar },
    }));
    const screens = db.prepare(`
    SELECT s.*, u.name AS user_name FROM room_screen_shares s JOIN users u ON u.id = s.user_id
    WHERE s.room_id = ? AND s.stopped_at IS NULL ORDER BY s.started_at
  `).all(roomId);
    const me = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    return {
        room: {
            id: room.id, name: room.name, description: room.description, inviteCode: room.invite_code,
            visibility: room.visibility, ownerId: room.owner_id, ownerName: room.owner_name,
            whiteboard: Boolean(room.whiteboard), createdAt: room.created_at,
        },
        members,
        pages,
        elements,
        messages,
        screens,
        me: me ? { role: me.role, handRaised: Boolean(me.hand_raised) } : null,
    };
}
roomsRouter.get('/', asyncHandler(async (req, res) => {
    const rows = db.prepare(`
    SELECT r.id, r.name, r.invite_code, r.created_at, r.ended_at,
           (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id AND rm.left_at IS NULL) AS participants
    FROM rooms r JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ? AND m.left_at IS NULL ORDER BY r.created_at DESC
  `).all(req.user.id);
    res.json({ rooms: rows });
}));
roomsRouter.post('/', asyncHandler(async (req, res) => {
    const data = z.object({
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(240).optional(),
        visibility: z.enum(['link', 'community']).default('link'),
        whiteboard: z.boolean().default(true),
    }).parse(req.body);
    const id = uuid();
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    tx(() => {
        db.prepare(`
      INSERT INTO rooms (id, name, description, owner_id, invite_code, visibility, whiteboard)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.description ?? null, req.user.id, code, data.visibility, data.whiteboard ? 1 : 0);
        db.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user.id);
        db.prepare('INSERT INTO whiteboard_pages (id, room_id, page_number, title) VALUES (?, ?, 1, ?)')
            .run(uuid(), id, 'Página 1');
    });
    res.status(201).json({ room: roomPayload(id, req.user.id) });
}));
roomsRouter.post('/join', asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(4).max(20) }).parse(req.body);
    const room = db.prepare('SELECT * FROM rooms WHERE UPPER(invite_code) = ?').get(code.toUpperCase());
    if (!room)
        throw notFound('No existe una sala con ese código.');
    if (room.ended_at)
        throw badRequest('La sala ya fue finalizada.');
    db.prepare(`
    INSERT INTO room_members (room_id, user_id, role, left_at) VALUES (?, ?, 'participant', NULL)
    ON CONFLICT(room_id, user_id) DO UPDATE SET left_at = NULL, joined_at = datetime('now')
  `).run(room.id, req.user.id);
    emitToRoom(room.id, 'room:participant-joined', { roomId: room.id, user: { id: req.user.id, name: req.user.name, avatarUrl: req.user.avatar_url } });
    res.json({ room: roomPayload(room.id, req.user.id) });
}));
roomsRouter.get('/:id', asyncHandler(async (req, res) => {
    const { room } = roomFor(req.params.id, req.user.id);
    res.json(roomPayload(room.id, req.user.id));
}));
roomsRouter.post('/:id/leave', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    db.prepare("UPDATE room_members SET left_at = datetime('now') WHERE room_id = ? AND user_id = ?")
        .run(req.params.id, req.user.id);
    db.prepare("UPDATE room_screen_shares SET stopped_at = datetime('now') WHERE room_id = ? AND user_id = ? AND stopped_at IS NULL")
        .run(req.params.id, req.user.id);
    emitToRoom(req.params.id, 'room:participant-left', { roomId: req.params.id, userId: req.user.id });
    res.json({ ok: true });
}));
roomsRouter.post('/:id/messages', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    const data = z.object({
        body: z.string().trim().max(4000).optional(),
        attachmentId: z.string().uuid().optional().nullable(),
        kind: z.enum(['text', 'file', 'link']).default('text'),
    }).parse(req.body);
    if (!data.body && !data.attachmentId)
        throw badRequest('El mensaje está vacío.');
    const id = uuid();
    db.prepare('INSERT INTO room_messages (id, room_id, sender_id, body, attachment_id, kind) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, req.params.id, req.user.id, data.body ?? null, data.attachmentId ?? null, data.kind);
    emitToRoom(req.params.id, 'room:message', {
        id, roomId: req.params.id, body: data.body ?? null, kind: data.kind, createdAt: new Date().toISOString(),
        sender: { id: req.user.id, name: req.user.name, avatarUrl: req.user.avatar_url },
    });
    res.status(201).json({ ok: true, id });
}));
roomsRouter.post('/:id/pages', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    const next = db.prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM whiteboard_pages WHERE room_id = ?').get(req.params.id).n;
    const id = uuid();
    db.prepare('INSERT INTO whiteboard_pages (id, room_id, page_number, title) VALUES (?, ?, ?, ?)')
        .run(id, req.params.id, next, `Página ${next}`);
    emitToRoom(req.params.id, 'whiteboard:page', { roomId: req.params.id, page: { id, page_number: next, title: `Página ${next}` } });
    res.status(201).json({ page: { id, pageNumber: next, title: `Página ${next}` } });
}));
roomsRouter.post('/:id/elements', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    const data = z.object({
        pageId: z.string().uuid(),
        type: z.enum(['path', 'rect', 'ellipse', 'arrow', 'text', 'image']),
        data: z.record(z.unknown()),
    }).parse(req.body);
    const page = db.prepare('SELECT * FROM whiteboard_pages WHERE id = ? AND room_id = ?').get(data.pageId, req.params.id);
    if (!page)
        throw notFound('Página no encontrada.');
    const id = uuid();
    db.prepare('INSERT INTO whiteboard_elements (id, page_id, author_id, type, data) VALUES (?, ?, ?, ?, ?)')
        .run(id, data.pageId, req.user.id, data.type, JSON.stringify(data.data));
    emitToRoom(req.params.id, 'whiteboard:element', {
        roomId: req.params.id,
        element: { id, pageId: data.pageId, authorId: req.user.id, authorName: req.user.name, type: data.type, data: data.data },
    });
    res.status(201).json({ ok: true, id });
}));
roomsRouter.delete('/:id/elements/:elementId', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    const element = db.prepare(`
    SELECT e.id FROM whiteboard_elements e JOIN whiteboard_pages p ON p.id = e.page_id
    WHERE e.id = ? AND p.room_id = ?
  `).get(req.params.elementId, req.params.id);
    if (!element)
        throw notFound('Elemento no encontrado.');
    db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(req.params.elementId);
    emitToRoom(req.params.id, 'whiteboard:element-deleted', { roomId: req.params.id, elementId: req.params.elementId });
    res.json({ ok: true });
}));
roomsRouter.post('/:id/screens', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    const { label } = z.object({ label: z.string().trim().min(1).max(80) }).parse(req.body);
    const id = uuid();
    db.prepare('INSERT INTO room_screen_shares (id, room_id, user_id, label) VALUES (?, ?, ?, ?)')
        .run(id, req.params.id, req.user.id, label);
    emitToRoom(req.params.id, 'screen:start', {
        roomId: req.params.id, id, userId: req.user.id, userName: req.user.name, label,
    });
    res.status(201).json({ id });
}));
roomsRouter.post('/:id/screens/:shareId/stop', asyncHandler(async (req, res) => {
    roomFor(req.params.id, req.user.id);
    const share = db.prepare('SELECT * FROM room_screen_shares WHERE id = ? AND room_id = ?').get(req.params.shareId, req.params.id);
    if (!share)
        throw notFound('Compartición no encontrada.');
    if (share.user_id !== req.user.id)
        throw forbidden('Solo quien comparte puede detenerla.');
    db.prepare("UPDATE room_screen_shares SET stopped_at = datetime('now') WHERE id = ?").run(share.id);
    emitToRoom(req.params.id, 'screen:stop', { roomId: req.params.id, id: share.id });
    res.json({ ok: true });
}));
roomsRouter.post('/:id/end', asyncHandler(async (req, res) => {
    const { room } = roomFor(req.params.id, req.user.id);
    if (room.owner_id !== req.user.id)
        throw forbidden('Solo el anfitrión puede finalizar la sala.');
    db.prepare("UPDATE rooms SET ended_at = datetime('now') WHERE id = ?").run(room.id);
    emitToRoom(room.id, 'room:ended', { roomId: room.id });
    for (const member of db.prepare('SELECT user_id FROM room_members WHERE room_id = ? AND left_at IS NULL').all(room.id)) {
        if (member.user_id !== req.user.id) {
            notify(member.user_id, 'room', 'La sala terminó', `La sala «${room.name}» fue finalizada.`, '/salas');
        }
    }
    res.json({ ok: true });
}));
//# sourceMappingURL=rooms.routes.js.map