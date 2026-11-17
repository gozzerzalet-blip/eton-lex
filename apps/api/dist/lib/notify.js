import { db, uuid } from '../db/index.js';
let io = null;
export function setIo(server) {
    io = server;
}
export function emitToUser(userId, event, payload) {
    io?.to(`user:${userId}`).emit(event, payload);
}
export function emitToConversation(conversationId, event, payload) {
    io?.to(`conv:${conversationId}`).emit(event, payload);
}
export function emitToRoom(roomId, event, payload) {
    io?.to(`room:${roomId}`).emit(event, payload);
}
export function notify(userId, type, title, body, link, priority = 'normal') {
    const id = uuid();
    db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, type, title, body ?? null, link ?? null, priority);
    const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
    emitToUser(userId, 'notification:new', row);
    return row;
}
//# sourceMappingURL=notify.js.map