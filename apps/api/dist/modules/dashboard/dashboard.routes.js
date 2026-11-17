import { Router } from 'express';
import { db } from '../../db/index.js';
import { publicUser, requireAuth } from '../../lib/auth.js';
import { asyncHandler } from '../../lib/http.js';
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const one = (sql, ...p) => db.prepare(sql).get(...p).c;
    const interests = db.prepare('SELECT area FROM user_interests WHERE user_id = ?').all(uid).map((r) => r.area);
    const areaFilter = interests.length
        ? `AND (n.area IN (${interests.map(() => '?').join(',')}) OR n.area IS NULL)`
        : '';
    const news = db.prepare(`
    SELECT id, title, summary, source_name, source_url, image_url, scope, category, published_at, fetched_at
    FROM news ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 6
  `).all();
    const updates = db.prepare(`
    SELECT DISTINCT u.id, u.type, u.title, u.summary, u.published_at, u.detected_at, u.source_url,
      n.title AS norm_title, n.slug AS norm_slug, a.number AS article_number
    FROM norm_updates u
    LEFT JOIN norms n ON n.id = u.norm_id
    LEFT JOIN articles a ON a.id = u.article_id
    WHERE u.status = 'confirmed' ${areaFilter}
    ORDER BY COALESCE(u.published_at, u.detected_at) DESC LIMIT 5
  `).all(...interests);
    const aiConversations = db.prepare(`
    SELECT id, title, mode, updated_at FROM ai_conversations WHERE user_id = ?
    ORDER BY updated_at DESC LIMIT 4
  `).all(uid);
    const conversations = db.prepare(`
    SELECT c.id, c.type, c.title, c.last_message_at,
      (SELECT u2.name FROM conversation_members m2 JOIN users u2 ON u2.id = m2.user_id
        WHERE m2.conversation_id = c.id AND m2.user_id != ? LIMIT 1) AS other_name,
      (SELECT msg.body FROM messages msg WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
        ORDER BY msg.created_at DESC LIMIT 1) AS last_body
    FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id
    WHERE m.user_id = ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 4
  `).all(uid, uid);
    const documents = db.prepare(`
    SELECT id, name, mime, size, created_at FROM documents WHERE owner_id = ? AND kind = 'file'
    ORDER BY created_at DESC LIMIT 4
  `).all(uid);
    const activity = db.prepare(`
    SELECT p.id, p.title, p.body, p.kind, p.created_at, u.name AS author_name, u.avatar_url
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.author_id != ? AND p.visibility IN ('friends','public') AND EXISTS(
      SELECT 1 FROM friendships f WHERE f.status = 'accepted'
      AND ((f.requester_id = ? AND f.addressee_id = p.author_id) OR (f.addressee_id = ? AND f.requester_id = p.author_id))
    )
    ORDER BY p.created_at DESC LIMIT 5
  `).all(uid, uid, uid);
    const alerts = db.prepare(`
    SELECT id, type, title, body, link, priority, created_at FROM notifications
    WHERE user_id = ? AND read_at IS NULL ORDER BY priority DESC, created_at DESC LIMIT 4
  `).all(uid);
    const followedNorms = db.prepare(`
    SELECT n.slug, n.title, n.number, n.status FROM follows f JOIN norms n ON n.id = f.target_id
    WHERE f.user_id = ? AND f.target_type = 'norm' ORDER BY f.created_at DESC LIMIT 4
  `).all(uid);
    res.json({
        user: publicUser(uid, true),
        stats: {
            aiConversations: one('SELECT COUNT(*) c FROM ai_conversations WHERE user_id = ?', uid),
            savedNorms: one('SELECT COUNT(*) c FROM follows WHERE user_id = ?', uid),
            friends: one("SELECT COUNT(*) c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", uid, uid),
            documents: one('SELECT COUNT(*) c FROM documents WHERE owner_id = ?', uid),
            unreadNotifications: one('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL', uid),
            unreadMessages: one(`
        SELECT COUNT(*) c FROM messages msg
        JOIN conversation_members m ON m.conversation_id = msg.conversation_id AND m.user_id = ?
        WHERE msg.sender_id != ? AND msg.deleted_at IS NULL
          AND (msg.created_at > COALESCE(m.last_read_at, '1970-01-01'))
      `, uid, uid),
        },
        news,
        updates,
        aiConversations,
        conversations,
        documents,
        activity,
        alerts,
        followedNorms,
        interests,
        services: {
            ai: Boolean(process.env.AI_PROVIDER && process.env.AI_PROVIDER !== 'none'),
            news: Boolean((process.env.NEWS_FEEDS ?? '').trim() || process.env.NEWSAPI_KEY),
        },
    });
}));
//# sourceMappingURL=dashboard.routes.js.map