import { Router } from 'express';
import { db } from '../../db/index.js';
import { acceptedContactIds, fieldAllowed, parsePrivacyFields, publicUser, relationsFor, requireAuth } from '../../lib/auth.js';
import { asyncHandler, notFound } from '../../lib/http.js';
export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get('/', asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
    const contacts = acceptedContactIds(req.user.id);
    if (contacts.length === 0) {
        res.json({ users: [], contactsOnly: true });
        return;
    }
    const placeholders = contacts.map(() => '?').join(',');
    const where = [`u.id IN (${placeholders})`];
    const params = [...contacts];
    if (q) {
        // Búsqueda restringida al propio conjunto de contactos aceptados.
        where.push(`(u.name LIKE ? OR u.username LIKE ? OR u.public_id LIKE ? OR u.email LIKE ?)`);
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.public_id, u.avatar_url, u.university,
           u.cycle, u.privacy, u.privacy_fields
    FROM users u WHERE ${where.join(' AND ')}
    ORDER BY u.name LIMIT ?
  `).all(...params, limit);
    const relations = relationsFor(req.user.id);
    const users = rows.map((u) => {
        const privacy = parsePrivacyFields(u.privacy_fields);
        const visible = (key) => fieldAllowed(privacy[key] ?? 'everyone', false, true);
        return {
            id: u.id,
            name: u.name,
            username: u.username,
            publicId: u.public_id,
            avatarUrl: u.avatar_url,
            university: visible('university') ? u.university : undefined,
            cycle: visible('cycle') ? u.cycle : undefined,
            relation: relations.get(u.id)?.status ?? 'accepted',
            affinity: 0,
        };
    });
    res.json({ users, contactsOnly: true });
}));
usersRouter.get('/universities', asyncHandler(async (req, res) => {
    const contacts = acceptedContactIds(req.user.id);
    if (contacts.length === 0) {
        res.json({ universities: [] });
        return;
    }
    const placeholders = contacts.map(() => '?').join(',');
    const rows = db.prepare(`
    SELECT university, COUNT(*) AS students FROM users
    WHERE university IS NOT NULL AND university != '' AND id IN (${placeholders})
    GROUP BY university ORDER BY students DESC, university ASC
  `).all(...contacts);
    res.json({ universities: rows });
}));
/** Búsqueda exacta para agregar contactos: nunca devuelve listados generales. */
usersRouter.get('/lookup', asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 4) {
        res.json({ user: null });
        return;
    }
    const row = db.prepare(`
    SELECT id, name, username, public_id, avatar_url, university, cycle
    FROM users WHERE public_id = ? OR username = ? OR email = ? LIMIT 1
  `).get(q, q, q);
    if (!row || row.id === req.user.id) {
        res.json({ user: null });
        return;
    }
    res.json({
        user: {
            id: row.id,
            name: row.name,
            username: row.username,
            publicId: row.public_id,
            avatarUrl: row.avatar_url,
            university: row.university,
            cycle: row.cycle,
            relation: relationsFor(req.user.id).get(row.id)?.status ?? null,
        },
    });
}));
/**
 * Búsqueda global parcial de personas.
 * Solo devuelve datos públicos del perfil (nombre, usuario, foto y universidad)
 * y nunca mensajes, archivos, correos ni conversaciones. Está disponible aunque
 * no exista amistad ni conexión en tiempo real: cualquier cuenta registrada se
 * puede encontrar y agregar, esté en línea o no.
 */
usersRouter.get('/search', asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
        res.json({ users: [] });
        return;
    }
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
    const pattern = `%${q}%`;
    const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.public_id, u.avatar_url, u.university
    FROM users u
    WHERE u.id != ?
      AND (u.name LIKE ? OR u.username LIKE ? OR u.public_id LIKE ?)
    ORDER BY u.name ASC
    LIMIT ?
  `).all(req.user.id, pattern, pattern, pattern, limit);
    const users = rows.map((row) => {
        const friendship = db.prepare(`
      SELECT requester_id, status FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
      LIMIT 1
    `).get(req.user.id, row.id, row.id, req.user.id);
        const status = friendship?.status;
        const relation = status === 'accepted' ? 'accepted'
            : status === 'pending' ? 'pending'
                : status === 'blocked' ? 'blocked'
                    : 'none';
        const direction = friendship?.status === 'pending'
            ? (friendship.requester_id === row.id ? 'incoming' : 'outgoing')
            : undefined;
        return {
            id: row.id,
            name: row.name,
            username: row.username ?? null,
            publicId: row.public_id ?? null,
            avatarUrl: row.avatar_url ?? null,
            university: row.university ?? null,
            relation,
            ...(direction ? { direction } : {}),
        };
    });
    res.json({ users });
}));
usersRouter.get('/:id', asyncHandler(async (req, res) => {
    const viewerId = req.user.id;
    const targetId = req.params.id;
    // La ficha pública debe estar disponible aunque todavía no haya amistad;
    // de lo contrario no se podría enviar una solicitud desde el perfil.
    const basic = db.prepare(`
    SELECT id, name, username, public_id, avatar_url, university, cycle
    FROM users WHERE id = ?
  `).get(targetId);
    if (!basic)
        throw notFound('Estudiante no encontrado.');
    const full = publicUser(targetId, false, viewerId);
    const relation = db.prepare(`
    SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(viewerId, targetId, targetId, viewerId);
    const relationResponse = relation
        ? { id: relation.id, status: relation.status, direction: relation.requester_id === viewerId ? 'outgoing' : 'incoming' }
        : null;
    if (!full) {
        // Perfil privado o sin amistad: solo datos públicos mínimos, sin correo,
        // documentos, grupos ni campos personales.
        res.json({
            user: {
                id: basic.id,
                name: basic.name,
                username: basic.username ?? null,
                publicId: basic.public_id ?? null,
                avatarUrl: basic.avatar_url ?? null,
                online: false,
                friends: 0,
            },
            relation: relationResponse,
            groups: [],
            documents: [],
            limited: true,
        });
        return;
    }
    const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.visibility FROM study_groups g
    JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?
  `).all(targetId);
    const shared = db.prepare(`
    SELECT d.id, d.name, d.mime, d.size, d.created_at FROM documents d
    WHERE d.owner_id = ? AND d.visibility = 'shared' ORDER BY d.created_at DESC LIMIT 20
  `).all(targetId);
    res.json({
        user: { ...full, email: full.id === viewerId ? full.email : undefined },
        relation: relationResponse,
        groups,
        documents: shared,
        limited: false,
    });
}));
usersRouter.get('/me/stats', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const one = (sql, ...params) => db.prepare(sql).get(...params).c;
    res.json({
        stats: {
            aiConversations: one('SELECT COUNT(*) c FROM ai_conversations WHERE user_id = ?', uid),
            savedNorms: one('SELECT COUNT(*) c FROM follows WHERE user_id = ?', uid),
            friends: one("SELECT COUNT(*) c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", uid, uid),
            documents: one('SELECT COUNT(*) c FROM documents WHERE owner_id = ?', uid),
        },
    });
}));
//# sourceMappingURL=users.routes.js.map