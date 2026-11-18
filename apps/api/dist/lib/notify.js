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
/** Suscribe las sesiones abiertas de un usuario a una conversación recién creada. */
export function joinUserToConversation(userId, conversationId) {
    if (!io)
        return;
    for (const socket of io.sockets.sockets.values()) {
        if (socket.data.userId === userId)
            socket.join(`conv:${conversationId}`);
    }
}
export function emitToRoom(roomId, event, payload) {
    io?.to(`room:${roomId}`).emit(event, payload);
}
/** Aviso global (por ejemplo, noticias nuevas) a todas las sesiones abiertas. */
export function broadcast(event, payload) {
    io?.emit(event, payload);
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
/**
 * Aviso de mensaje que respeta el «silenciar conversación» de cada miembro.
 * El mensaje llega igual; solo se suprime la notificación. Este es el punto
 * central para que el futuro Web Push herede la misma preferencia.
 */
export function notifyMessage(userId, conversationId, title, body, link, priority = 'normal') {
    const member = db.prepare('SELECT muted FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
        .get(conversationId, userId);
    if (member?.muted)
        return null;
    return notify(userId, 'message', title, body, link, priority);
}
//# sourceMappingURL=notify.js.map