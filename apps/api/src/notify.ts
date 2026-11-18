import type { Server } from 'socket.io';
import { db, uuid } from '../db/index.js';

let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToConversation(conversationId: string, event: string, payload: unknown) {
  io?.to(`conv:${conversationId}`).emit(event, payload);
}

/** Suscribe las sesiones abiertas de un usuario a una conversación recién creada. */
export function joinUserToConversation(userId: string, conversationId: string) {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if ((socket.data.userId as string | undefined) === userId) socket.join(`conv:${conversationId}`);
  }
}

export function emitToRoom(roomId: string, event: string, payload: unknown) {
  io?.to(`room:${roomId}`).emit(event, payload);
}

/** Aviso global (por ejemplo, noticias nuevas) a todas las sesiones abiertas. */
export function broadcast(event: string, payload: unknown) {
  io?.emit(event, payload);
}

export function notify(
  userId: string,
  type: string,
  title: string,
  body?: string | null,
  link?: string | null,
  priority: 'normal' | 'high' = 'normal',
) {
  const id = uuid();
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, type, title, body ?? null, link ?? null, priority);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  emitToUser(userId, 'notification:new', row);
  return row;
}
