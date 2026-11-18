import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db/index.js';
import { acceptedContactIds, areAcceptedContacts } from './lib/auth.js';
import { setIo } from './lib/notify.js';
const online = new Map();
function isMember(conversationId, userId) {
    return Boolean(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId));
}
export function initRealtime(io) {
    setIo(io);
    const activeCalls = new Map();
    const clearCall = (callId) => {
        const call = activeCalls.get(callId);
        if (call?.timer)
            clearTimeout(call.timer);
        activeCalls.delete(callId);
    };
    const busyCallFor = (...userIds) => [...activeCalls.values()]
        .find((call) => userIds.includes(call.callerId) || userIds.includes(call.calleeId));
    const expireRingingCall = (callId) => {
        const call = activeCalls.get(callId);
        if (!call || call.status !== 'ringing')
            return;
        clearCall(callId);
        db.prepare("UPDATE call_history SET status = 'missed', ended_at = datetime('now') WHERE id = ? AND status = 'missed'")
            .run(callId);
        io.to(`user:${call.callerId}`).emit('call:missed', { callId });
    };
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.replace('Bearer ', '');
        if (!token)
            return next(new Error('No autorizado'));
        try {
            const payload = jwt.verify(token, config.jwtSecret);
            const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(payload.sub);
            if (!user)
                return next(new Error('Usuario no encontrado'));
            socket.userId = user.id;
            socket.userName = user.name;
            socket.data.userId = user.id;
            next();
        }
        catch {
            next(new Error('Token inválido'));
        }
    });
    io.on('connection', (socket) => {
        const userId = socket.userId;
        socket.join(`user:${userId}`);
        const conversations = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(userId);
        for (const c of conversations)
            socket.join(`conv:${c.conversation_id}`);
        const roomRows = db.prepare('SELECT room_id FROM room_members WHERE user_id = ? AND left_at IS NULL').all(userId);
        for (const r of roomRows)
            socket.join(`room:${r.room_id}`);
        const visibleOnline = () => acceptedContactIds(userId).filter((id) => online.has(id));
        const count = (online.get(userId) ?? 0) + 1;
        online.set(userId, count);
        if (count === 1) {
            for (const fid of acceptedContactIds(userId))
                io.to(`user:${fid}`).emit('presence:update', { userId, online: true });
        }
        socket.emit('presence:list', { online: visibleOnline() });
        socket.on('presence:sync', () => {
            socket.emit('presence:list', { online: visibleOnline() });
        });
        socket.on('conversation:join', (conversationId) => {
            if (isMember(conversationId, userId))
                socket.join(`conv:${conversationId}`);
        });
        socket.on('typing', (payload) => {
            if (!isMember(payload.conversationId, userId))
                return;
            socket.to(`conv:${payload.conversationId}`).emit('typing', {
                conversationId: payload.conversationId,
                userId,
                name: socket.userName,
                typing: Boolean(payload.typing),
            });
        });
        // ── Señalización WebRTC (llamadas reales P2P) ──────────────
        socket.on('call:invite', (payload) => {
            if (!isMember(payload.conversationId, userId))
                return;
            if (!isMember(payload.conversationId, payload.to))
                return;
            if (!areAcceptedContacts(userId, payload.to))
                return;
            if (!payload?.callId || busyCallFor(userId, payload.to)) {
                io.to(`user:${userId}`).emit('call:busy', { callId: payload?.callId });
                return;
            }
            db.prepare(`
        INSERT INTO call_history (id, conversation_id, caller_id, callee_id, kind, status)
        VALUES (?, ?, ?, ?, ?, 'missed')
      `).run(payload.callId, payload.conversationId, userId, payload.to, payload.kind);
            const state = {
                id: payload.callId,
                conversationId: payload.conversationId,
                callerId: userId,
                calleeId: payload.to,
                status: 'ringing',
            };
            state.timer = setTimeout(() => expireRingingCall(state.id), 60_000);
            activeCalls.set(state.id, state);
            io.to(`user:${payload.to}`).emit('call:incoming', {
                callId: payload.callId,
                from: { id: userId, name: socket.userName },
                conversationId: payload.conversationId,
                kind: payload.kind,
            });
        });
        socket.on('call:accept', (payload) => {
            const call = db.prepare('SELECT * FROM call_history WHERE id = ?').get(payload.callId);
            if (!call || call.callee_id !== userId)
                return;
            if (!areAcceptedContacts(userId, call.caller_id))
                return;
            const state = activeCalls.get(call.id);
            if (!state) {
                io.to(`user:${userId}`).emit('call:failed', { callId: call.id, reason: 'expired' });
                return;
            }
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = undefined;
            }
            state.status = 'active';
            io.to(`user:${call.caller_id}`).emit('call:accepted', { callId: call.id, by: userId });
        });
        socket.on('call:signal', (payload) => {
            const call = db.prepare('SELECT * FROM call_history WHERE id = ?').get(payload.callId);
            if (!call || (call.caller_id !== userId && call.callee_id !== userId))
                return;
            if (payload.to !== call.caller_id && payload.to !== call.callee_id)
                return;
            if (!areAcceptedContacts(userId, payload.to))
                return;
            io.to(`user:${payload.to}`).emit('call:signal', { from: userId, callId: payload.callId, signal: payload.signal });
        });
        socket.on('call:decline', (payload) => {
            const call = db.prepare('SELECT * FROM call_history WHERE id = ?').get(payload.callId);
            if (!call || call.callee_id !== userId)
                return;
            if (!areAcceptedContacts(userId, call.caller_id))
                return;
            db.prepare("UPDATE call_history SET status = 'declined', ended_at = datetime('now') WHERE id = ? AND status != 'completed'").run(call.id);
            clearCall(call.id);
            io.to(`user:${call.caller_id}`).emit('call:declined', { callId: call.id });
        });
        socket.on('call:end', (payload) => {
            const call = db.prepare('SELECT * FROM call_history WHERE id = ?').get(payload.callId);
            if (!call || (call.caller_id !== userId && call.callee_id !== userId))
                return;
            const otherParty = call.caller_id === userId ? call.callee_id : call.caller_id;
            if (!areAcceptedContacts(userId, otherParty))
                return;
            const duration = Math.max(0, Number(payload.durationS ?? 0));
            db.prepare("UPDATE call_history SET status = 'completed', ended_at = datetime('now'), duration_s = ? WHERE id = ? AND status != 'declined'")
                .run(duration, call.id);
            clearCall(call.id);
            io.to(`user:${otherParty}`).emit('call:ended', { callId: call.id });
        });
        // ── Salas: pertenencia, señalización y colaboración ──────────
        const isRoomMember = (roomId) => Boolean(db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL').get(roomId, userId));
        socket.on('room:join', (payload) => {
            if (!payload?.roomId || !isRoomMember(payload.roomId))
                return;
            socket.join(`room:${payload.roomId}`);
            socket.emit('room:joined', { roomId: payload.roomId });
        });
        socket.on('room:signal', (payload) => {
            if (!payload?.roomId || !isRoomMember(payload.roomId))
                return;
            if (payload.to) {
                if (!isRoomMember(payload.roomId) || payload.to === userId)
                    return;
                const targetMember = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL')
                    .get(payload.roomId, payload.to);
                if (!targetMember)
                    return;
                io.to(`user:${payload.to}`).emit('room:signal', { from: userId, roomId: payload.roomId, signal: payload.signal });
            }
            else {
                socket.to(`room:${payload.roomId}`).emit('room:signal', { from: userId, roomId: payload.roomId, signal: payload.signal });
            }
        });
        socket.on('room:reaction', (payload) => {
            if (!payload?.roomId || !isRoomMember(payload.roomId))
                return;
            io.to(`room:${payload.roomId}`).emit('room:reaction', { roomId: payload.roomId, userId, emoji: String(payload.emoji).slice(0, 8) });
        });
        socket.on('room:hand', (payload) => {
            if (!payload?.roomId || !isRoomMember(payload.roomId))
                return;
            db.prepare('UPDATE room_members SET hand_raised = ? WHERE room_id = ? AND user_id = ?')
                .run(payload.raised ? 1 : 0, payload.roomId, userId);
            io.to(`room:${payload.roomId}`).emit('room:hand', { roomId: payload.roomId, userId, raised: Boolean(payload.raised) });
        });
        socket.on('whiteboard:draft', (payload) => {
            if (!payload?.roomId || !isRoomMember(payload.roomId))
                return;
            socket.to(`room:${payload.roomId}`).emit('whiteboard:draft', payload);
        });
        socket.on('disconnect', () => {
            const next = (online.get(userId) ?? 1) - 1;
            if (next <= 0) {
                online.delete(userId);
                for (const fid of acceptedContactIds(userId))
                    io.to(`user:${fid}`).emit('presence:update', { userId, online: false });
            }
            else {
                online.set(userId, next);
            }
            // Una desconección (cierre de pestaña, pérdida de red o refresco de token)
            // no debe dejar llamadas colgadas en memoria ni marcarlas como fallidas.
            for (const call of [...activeCalls.values()]) {
                if (call.callerId !== userId && call.calleeId !== userId)
                    continue;
                const other = call.callerId === userId ? call.calleeId : call.callerId;
                clearCall(call.id);
                if (call.status === 'ringing') {
                    db.prepare("UPDATE call_history SET status = 'missed', ended_at = datetime('now') WHERE id = ? AND status = 'missed'")
                        .run(call.id);
                    io.to(`user:${other}`).emit('call:missed', { callId: call.id });
                }
                else {
                    db.prepare("UPDATE call_history SET status = 'completed', ended_at = datetime('now') WHERE id = ? AND status NOT IN ('declined', 'completed')")
                        .run(call.id);
                    io.to(`user:${other}`).emit('call:ended', { callId: call.id });
                }
            }
        });
    });
}
//# sourceMappingURL=realtime.js.map