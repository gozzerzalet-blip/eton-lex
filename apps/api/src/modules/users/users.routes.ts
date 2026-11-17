import { Router } from 'express';
import { db } from '../../db/index.js';
import { canViewProfile, fieldAllowed, parsePrivacyFields, publicUser, relationsFor, requireAuth } from '../../lib/auth.js';
import { asyncHandler, notFound } from '../../lib/http.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/', asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const university = String(req.query.university ?? '').trim();
  const career = String(req.query.career ?? '').trim();
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);

  const where: string[] = ['u.id != ?'];
  const params: any[] = [req.user!.id];
  if (q) {
    where.push(`(u.name LIKE ? OR u.username LIKE ? OR u.public_id LIKE ? OR u.university LIKE ? OR u.career LIKE ? OR u.email LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (university) { where.push('(u.university = ? OR u.university_id = ?)'); params.push(university, university); }
  if (career) { where.push('u.career LIKE ?'); params.push(`%${career}%`); }

  const me = db.prepare('SELECT university_id, career FROM users WHERE id = ?').get(req.user!.id) as any;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.public_id, u.avatar_url, u.university, u.university_id,
           u.university_type, u.faculty, u.career, u.city, u.cycle, u.bio,
           u.privacy, u.privacy_fields,
           CASE WHEN u.university_id = ? THEN 2 ELSE 0 END +
           CASE WHEN u.career = ? THEN 1 ELSE 0 END AS affinity
    FROM users u WHERE ${where.join(' AND ')}
    ORDER BY affinity DESC, u.name LIMIT ?
  `).all(me?.university_id ?? null, me?.career ?? null, ...params, limit) as any[];

  const relations = relationsFor(req.user!.id);
  const users = rows
    .filter((row) => canViewProfile(row, req.user!.id, relations))
    .map((u) => {
      const privacy = parsePrivacyFields(u.privacy_fields);
      const isFriend = relations.get(u.id)?.status === 'accepted';
      const visible = (key: string) => fieldAllowed(privacy[key] ?? 'everyone', false, isFriend);
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        publicId: u.public_id,
        avatarUrl: u.avatar_url,
        university: visible('university') ? u.university : undefined,
        universityId: visible('university') ? u.university_id : undefined,
        universityType: visible('university') ? u.university_type : undefined,
        faculty: visible('faculty') ? u.faculty : undefined,
        career: visible('career') ? u.career : undefined,
        city: visible('city') ? u.city : undefined,
        cycle: visible('cycle') ? u.cycle : undefined,
        bio: visible('bio') ? u.bio : undefined,
        relation: relations.get(u.id)?.status ?? null,
        affinity: u.affinity,
      };
    });

  res.json({ users });
}));

usersRouter.get('/universities', asyncHandler(async (_req, res) => {
  const rows = db.prepare(`
    SELECT university, COUNT(*) AS students FROM users
    WHERE university IS NOT NULL AND university != ''
    GROUP BY university ORDER BY students DESC, university ASC
  `).all();
  res.json({ universities: rows });
}));

usersRouter.get('/:id', asyncHandler(async (req, res) => {
  const profile = publicUser(req.params.id, false, req.user!.id);
  if (!profile) throw notFound('Estudiante no encontrado.');

  const relation = db.prepare(`
    SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.user!.id, req.params.id, req.params.id, req.user!.id) as any;

  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.visibility FROM study_groups g
    JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?
  `).all(req.params.id);

  const shared = db.prepare(`
    SELECT d.id, d.name, d.mime, d.size, d.created_at FROM documents d
    WHERE d.owner_id = ? AND d.visibility = 'shared' ORDER BY d.created_at DESC LIMIT 20
  `).all(req.params.id);

  res.json({
    user: { ...profile, email: profile.id === req.user!.id ? profile.email : undefined },
    relation: relation ? { id: relation.id, status: relation.status, direction: relation.requester_id === req.user!.id ? 'outgoing' : 'incoming' } : null,
    groups,
    documents: shared,
  });
}));

usersRouter.get('/me/stats', asyncHandler(async (req, res) => {
  const uid = req.user!.id;
  const one = (sql: string, ...params: any[]) => (db.prepare(sql).get(...params) as { c: number }).c;
  res.json({
    stats: {
      aiConversations: one('SELECT COUNT(*) c FROM ai_conversations WHERE user_id = ?', uid),
      savedNorms: one('SELECT COUNT(*) c FROM follows WHERE user_id = ?', uid),
      friends: one("SELECT COUNT(*) c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", uid, uid),
      documents: one('SELECT COUNT(*) c FROM documents WHERE owner_id = ?', uid),
    },
  });
}));
