import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db, uuid } from '../db/index.js';
import { unauthorized, forbidden } from './http.js';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function signAccess(user) {
    return jwt.sign({ sub: user.id, role: user.role, email: user.email }, config.jwtSecret, {
        expiresIn: config.accessTtl,
    });
}
export function createRefreshToken(userId, req) {
    const token = crypto.randomBytes(48).toString('base64url');
    const expires = new Date(Date.now() + config.refreshTtlDays * 86_400_000);
    db.prepare(`
    INSERT INTO sessions (id, user_id, refresh_hash, user_agent, ip, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), userId, sha(token), (req.headers['user-agent'] ?? '').slice(0, 300), req.ip ?? null, expires.toISOString());
    return token;
}
export function setRefreshCookie(res, token) {
    res.cookie('eton_refresh', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        path: '/api/auth',
        maxAge: config.refreshTtlDays * 86_400_000,
    });
}
export function clearRefreshCookie(res) {
    res.clearCookie('eton_refresh', { path: '/api/auth' });
}
export function rotateRefreshToken(rawToken, req) {
    const hash = sha(rawToken);
    const row = db.prepare(`
    SELECT s.*, u.id as uid, u.email, u.name, u.role, u.avatar_url
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.refresh_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')
  `).get(hash);
    if (!row)
        return null;
    db.prepare('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE id = ?').run(row.id);
    const user = { id: row.uid, email: row.email, name: row.name, role: row.role, avatar_url: row.avatar_url };
    const refresh = createRefreshToken(user.id, req);
    return { user, access: signAccess(user), refresh };
}
export function revokeSession(rawToken) {
    db.prepare('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE refresh_hash = ?').run(sha(rawToken));
}
export function revokeAllSessions(userId) {
    db.prepare('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE user_id = ? AND revoked_at IS NULL').run(userId);
}
function readUser(id) {
    return db.prepare('SELECT id, email, name, role, avatar_url FROM users WHERE id = ?').get(id);
}
export function optionalAuth(req, _res, next) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
        try {
            const payload = jwt.verify(header.slice(7), config.jwtSecret);
            const user = readUser(payload.sub);
            if (user)
                req.user = user;
        }
        catch {
            /* token inválido: se trata como anónimo */
        }
    }
    next();
}
export function requireAuth(req, _res, next) {
    if (!req.user)
        return next(unauthorized());
    next();
}
export function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user)
            return next(unauthorized());
        if (!roles.includes(req.user.role))
            return next(forbidden('Requiere rol: ' + roles.join(', ')));
        next();
    };
}
export function parsePrivacyFields(raw) {
    const base = {
        university: 'everyone', career: 'everyone', faculty: 'everyone', cycle: 'everyone',
        city: 'everyone', bio: 'everyone', links: 'everyone', interests: 'everyone',
    };
    if (!raw)
        return base;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, value] of Object.entries(parsed)) {
                if (value === 'everyone' || value === 'friends' || value === 'private')
                    base[key] = value;
            }
        }
    }
    catch { /* valores antiguos inválidos: se ignoran */ }
    return base;
}
export function parsePrivacy(raw) {
    try {
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            profile: parsed?.profile === 'friends' || parsed?.profile === 'private' ? parsed.profile : 'community',
            activity: parsed?.activity === 'private' ? 'private' : 'friends',
        };
    }
    catch {
        return { profile: 'community', activity: 'friends' };
    }
}
export function relationsFor(viewerId) {
    const rows = db.prepare(`
    SELECT requester_id, addressee_id, status FROM friendships
    WHERE requester_id = ? OR addressee_id = ?
  `).all(viewerId, viewerId);
    const map = new Map();
    for (const row of rows) {
        const other = row.requester_id === viewerId ? row.addressee_id : row.requester_id;
        map.set(other, {
            status: row.status,
            direction: row.requester_id === viewerId ? 'outgoing' : 'incoming',
        });
    }
    return map;
}
export function canViewProfile(target, viewerId, relations) {
    if (!viewerId)
        return false;
    if (viewerId === target.id)
        return true;
    const relation = relations?.get(target.id);
    if (relation?.status === 'blocked')
        return false;
    const privacy = parsePrivacy(target.privacy);
    if (privacy.profile === 'private')
        return false;
    if (privacy.profile === 'friends')
        return relation?.status === 'accepted';
    return true;
}
export function fieldAllowed(level, isSelf, isFriend) {
    return isSelf || level === 'everyone' || (level === 'friends' && isFriend);
}
export function publicUser(userId, includePrivate = false, viewerId) {
    const row = db.prepare(`
    SELECT id, name, email, avatar_url, cover_url, username, public_id, university, university_id, campus_id,
           university_type, faculty, career, country, city, cycle, bio, links, privacy_fields,
           role, created_at, last_seen_at, theme, privacy, onboarded, email_verified
    FROM users WHERE id = ?
  `).get(userId);
    if (!row)
        return null;
    const interests = db.prepare('SELECT area FROM user_interests WHERE user_id = ?').all(userId).map((r) => r.area);
    const friends = db.prepare(`
    SELECT COUNT(*) c FROM friendships
    WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
  `).get(userId, userId).c;
    const privacy = parsePrivacy(row.privacy);
    const fields = parsePrivacyFields(row.privacy_fields);
    const isSelf = includePrivate || viewerId === userId;
    const relations = viewerId ? relationsFor(viewerId) : undefined;
    const relation = relations?.get(userId);
    if (!isSelf && (relation?.status === 'blocked' || !canViewProfile(row, viewerId, relations)))
        return null;
    const isFriend = relation?.status === 'accepted';
    const visible = (key) => fieldAllowed(fields[key] ?? 'everyone', isSelf, isFriend);
    return {
        id: row.id,
        name: row.name,
        username: row.username,
        publicId: row.public_id,
        email: isSelf ? row.email : undefined,
        avatarUrl: row.avatar_url,
        coverUrl: row.cover_url,
        university: visible('university') ? row.university : undefined,
        universityId: visible('university') ? row.university_id : undefined,
        campusId: visible('university') ? row.campus_id : undefined,
        universityType: visible('university') ? row.university_type : undefined,
        faculty: visible('faculty') ? row.faculty : undefined,
        career: visible('career') ? row.career : undefined,
        country: row.country,
        city: visible('city') ? row.city : undefined,
        cycle: visible('cycle') ? row.cycle : undefined,
        bio: visible('bio') ? row.bio : undefined,
        links: visible('links') ? JSON.parse(row.links || '[]') : undefined,
        interests: visible('interests') ? interests : undefined,
        role: row.role,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        online: false,
        friends,
        ...(isSelf
            ? {
                theme: row.theme ?? 'dark',
                privacy,
                privacyFields: fields,
                onboarded: Boolean(row.onboarded),
                emailVerified: Boolean(row.email_verified),
            }
            : {}),
    };
}
//# sourceMappingURL=auth.js.map