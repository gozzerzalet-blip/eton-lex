import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const listeners = new Set<(value: Socket | null) => void>();

function emitChange() {
  for (const listener of listeners) listener(socket);
}

/** Suscripción al socket actual; permite reaccionar cuando se crea tras el refresh de sesión. */
export function subscribeSocket(listener: (value: Socket | null) => void) {
  listeners.add(listener);
  listener(socket);
  return () => { listeners.delete(listener); };
}

/** Hook para componentes que necesitan el socket, incluso si se crea después de montar. */
export function useSocket(): Socket | null {
  const [current, setCurrent] = useState<Socket | null>(socket);
  useEffect(() => subscribeSocket(setCurrent), []);
  return current;
}

export function connectSocket(token: string): Socket {
  if (socket) {
    socket.auth = { token };
    if (socket.connected) return socket;
    socket.connect();
    return socket;
  }
  socket = io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });
  emitChange();
  return socket;
}

/** Actualiza la credencial del socket tras un refresh de access token. */
export function updateSocketToken(token: string): void {
  if (socket) socket.auth = { token };
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  emitChange();
}
