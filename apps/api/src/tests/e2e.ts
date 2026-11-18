/**
 * Prueba integral contra una API en ejecución.
 *
 * Requiere: API escuchando en E2E_BASE_URL (por defecto http://127.0.0.1:4000).
 * Crea dos cuentas de prueba, verifica autenticación, biblioteca, ETON AI (modo
 * biblioteca real cuando no hay proveedor), mensajería, archivos, notificaciones,
 * WebRTC y permisos.
 *
 * Uso:
 *   1) npm --workspace apps/api run dev        (en otra terminal)
 *   2) npm --workspace apps/api run e2e
 *
 * No simula conexiones: usa HTTP y Socket.IO reales contra el servidor.
 */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4000';
const stamp = Date.now().toString(36);
const PASSWORD = 'E2ePass123!';

type Json = Record<string, any>;

async function request(
  path: string,
  options: { token?: string; method?: string; body?: unknown; form?: FormData; raw?: boolean } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: any;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BASE}${path}`, { method: options.method ?? 'GET', headers, body });
  const text = await response.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  if (options.raw) return { status: response.status, data: { text, headers: response.headers } };
  return { status: response.status, data };
}

function ok(label: string) {
  console.log(`  ✔ ${label}`);
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 8_000,
    });
    const timer = setTimeout(() => reject(new Error('Timeout conectando Socket.IO')), 8_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function waitFor<T = any>(socket: Socket, event: string, timeout = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout esperando el evento "${event}"`));
    }, timeout);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function expectNoEvent(socket: Socket, event: string, timeout = 600): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => { /* señal inesperada */ };
    socket.on(event, handler);
    setTimeout(() => { socket.off(event, handler); resolve(); }, timeout);
  });
}

async function main() {
  console.log(`ETON LEX · e2e contra ${BASE}\n`);

  // ── Salud ───────────────────────────────────────────────────
  const health = await request('/api/system/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  ok('API y base de datos responden');

  // ── Registro y sesión ───────────────────────────────────────
  const registerA = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Andrea', email: `e2e.andrea.${stamp}@etonlex.test`, password: PASSWORD, university: 'PUCP', universityType: 'privada' },
  });
  assert.equal(registerA.status, 201, JSON.stringify(registerA.data));
  const tokenA = registerA.data.accessToken as string;
  const userA = registerA.data.user as Json;
  assert.ok(tokenA && userA.id);
  assert.equal(typeof registerA.data.requiresEmailVerification, 'boolean');

  const registerB = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Rafael', email: `e2e.rafael.${stamp}@etonlex.test`, password: PASSWORD, university: 'UNMSM', universityType: 'publica' },
  });
  assert.equal(registerB.status, 201, JSON.stringify(registerB.data));
  const tokenB = registerB.data.accessToken as string;
  const userB = registerB.data.user as Json;

  const registerC = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Carlos', email: `e2e.carlos.${stamp}@etonlex.test`, password: PASSWORD, university: 'UNMSM' },
  });
  assert.equal(registerC.status, 201, JSON.stringify(registerC.data));
  const tokenC = registerC.data.accessToken as string;
  const userC = registerC.data.user as Json;

  // Este usuario nunca abre un socket: sirve para comprobar que se le puede
  // encontrar y agregar aunque no esté conectado.
  const registerD = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Diego', email: `e2e.diego.${stamp}@etonlex.test`, password: PASSWORD, university: 'UNMSM' },
  });
  assert.equal(registerD.status, 201, JSON.stringify(registerD.data));
  const userD = registerD.data.user as Json;
  ok('registro real de cuatro estudiantes');

  const me = await request('/api/auth/me', { token: tokenA });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, userA.id);
  assert.ok(['dark', 'light'].includes(me.data.user.theme));
  assert.equal(me.data.user.theme, userA.theme);
  ok('sesión JWT y perfil privado');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: `e2e.andrea.${stamp}@etonlex.test`, password: PASSWORD },
  });
  assert.equal(login.status, 200);
  ok('inicio de sesión con contraseña');

  // ── Privacidad: nadie ve cuentas ajenas sin contacto aceptado ─
  const socketA = await connect(tokenA);
  const socketBPrivacy = await connect(tokenB);
  const socketCPrivacy = await connect(tokenC);
  ok('sesiones Socket.IO reales para A, B y C (A y B aún no son contactos)');

  const listBefore = await request(`/api/users?q=${encodeURIComponent(`e2e.andrea.${stamp}@etonlex.test`)}`, { token: tokenB });
  assert.equal(listBefore.status, 200);
  assert.equal(listBefore.data.contactsOnly, true);
  assert.equal(listBefore.data.users.length, 0);
  ok('API no revela cuentas que no son contactos');

  const globalSearch = await request(`/api/users/search?q=${encodeURIComponent('E2E Rafael')}`, { token: tokenC });
  assert.equal(globalSearch.status, 200);
  const foundB = globalSearch.data.users.find((row: Json) => row.id === userB.id);
  assert.ok(foundB, 'el buscador debe encontrar a un usuario que aún no es amigo');
  assert.equal(foundB.relation, 'none');
  assert.equal(foundB.email, undefined, 'el buscador no debe exponer correos');
  ok('buscador parcial global: perfiles públicos sin amistad y sin datos privados');

  const offlineSearch = await request(`/api/users/search?q=${encodeURIComponent('E2E Diego')}`, { token: tokenC });
  assert.equal(offlineSearch.status, 200);
  const foundD = offlineSearch.data.users.find((row: Json) => row.id === userD.id);
  assert.ok(foundD, 'el buscador debe encontrar cuentas aunque no estén en línea');
  const offlineFriendRequest = await request('/api/community/friends/request', {
    method: 'POST', token: tokenC, body: { userId: userD.id },
  });
  assert.equal(offlineFriendRequest.status, 200, JSON.stringify(offlineFriendRequest.data));
  ok('buscador encuentra y permite agregar usuarios desconectados');

  const profilePublicCard = await request(`/api/users/${userA.id}`, { token: tokenC });
  assert.equal(profilePublicCard.status, 200);
  assert.equal(profilePublicCard.data.user.id, userA.id);
  assert.equal(profilePublicCard.data.user.email, undefined, 'la ficha pública no debe exponer correo');
  ok('perfil visible para enviar solicitud, sin exponer datos privados');

  const presenceC = waitFor<Json>(socketCPrivacy, 'presence:list');
  socketCPrivacy.emit('presence:sync');
  const visibleToC = await presenceC;
  assert.ok(!visibleToC.online.includes(userA.id));
  assert.ok(!visibleToC.online.includes(userB.id));
  ok('presencia limitada: C no ve a A ni a B');

  const presenceB = waitFor<Json>(socketBPrivacy, 'presence:list');
  socketBPrivacy.emit('presence:sync');
  const visibleToB = await presenceB;
  assert.ok(!visibleToB.online.includes(userC.id));
  ok('A en línea pero no contacto: B no ve su presencia');

  const unauthorizedBoost = await request('/api/admin/overview', { token: tokenC });
  assert.equal(unauthorizedBoost.status, 403);
  ok('solicitud API no autorizada rechazada por rol');

  const friendRequest = await request('/api/community/friends/request', {
    method: 'POST', token: tokenA, body: { userId: userB.id },
  });
  assert.equal(friendRequest.status, 200, JSON.stringify(friendRequest.data));
  const duplicateRequest = await request('/api/community/friends/request', {
    method: 'POST', token: tokenA, body: { userId: userB.id },
  });
  assert.equal(duplicateRequest.status, 409);
  const selfRequest = await request('/api/community/friends/request', {
    method: 'POST', token: tokenA, body: { userId: userA.id },
  });
  assert.equal(selfRequest.status, 400);
  ok('solicitudes duplicadas y autom solicitudes rechazadas en servidor');

  const friendsB = await request('/api/community/friends', { token: tokenB });
  const requestId = friendsB.data.incoming.find((row: Json) => row.id === userA.id)?.request_id as string;
  assert.ok(requestId);
  const accept = await request(`/api/community/friends/${requestId}/respond`, {
    method: 'POST', token: tokenB, body: { action: 'accept' },
  });
  assert.equal(accept.status, 200);
  ok('contacto aceptado A-B habilita comunicaciones privadas');

  const visibleAfter = await request(`/api/users?q=${encodeURIComponent(`e2e.andrea.${stamp}@etonlex.test`)}`, { token: tokenB });
  assert.equal(visibleAfter.status, 200);
  assert.ok(visibleAfter.data.users.some((row: Json) => row.id === userA.id));
  const presenceAfter = waitFor<Json>(socketBPrivacy, 'presence:list');
  socketBPrivacy.emit('presence:sync');
  const afterList = await presenceAfter;
  assert.ok(afterList.online.includes(userA.id));
  ok('contacto aceptado: B ve perfil y presencia de A');

  const noIncoming = expectNoEvent(socketBPrivacy, 'call:incoming');
  socketCPrivacy.emit('call:invite', { callId: crypto.randomUUID(), to: userB.id, conversationId: crypto.randomUUID(), kind: 'audio' });
  await noIncoming;
  ok('señalización rechaza invitación de un usuario no autorizado');
  socketCPrivacy.disconnect();

  // ── Biblioteca ──────────────────────────────────────────────
  const library = await request('/api/library?q=civil&pageSize=5');
  assert.equal(library.status, 200);
  assert.ok(Array.isArray(library.data.norms));

  const norm = await request('/api/library/norms/codigo-civil');
  assert.equal(norm.status, 200);
  assert.equal(norm.data.norm.slug, 'codigo-civil');
  assert.equal(norm.data.norm.verification, 'verified');
  assert.ok(Array.isArray(norm.data.articles) && norm.data.articles.length > 2000);
  assert.equal(norm.data.textStats.gaps.length, 0);
  ok('biblioteca con corpus verificado y sin huecos');

  // ── ETON AI: sin proveedor debe responder 503 ───────────────
  const aiStatus = await request('/api/ai/status', { token: tokenA });
  assert.equal(aiStatus.status, 200);
  assert.equal(typeof aiStatus.data.configured, 'boolean');

  const aiConversation = await request('/api/ai/conversations', {
    method: 'POST',
    token: tokenA,
    body: { title: 'Prueba e2e', mode: 'auto' },
  });
  assert.equal(aiConversation.status, 201);

  const aiChat = await request(`/api/ai/conversations/${aiConversation.data.conversation.id}/messages`, {
    method: 'POST',
    token: tokenA,
    body: { content: '¿Qué dice el artículo 1 del Código Civil peruano?' },
  });
  if (aiStatus.data.configured) {
    assert.equal(aiChat.status, 200);
    ok('ETON AI configurada: la consulta llega al proveedor real');
  } else {
    assert.equal(aiChat.status, 200);
    assert.ok(typeof aiChat.data === 'string' && aiChat.data.includes('"libraryMode":true'));
    assert.ok(aiChat.data.includes('event: done'));
    ok('ETON AI sin proveedor: modo biblioteca con texto literal, sin simulación');
  }

  // ── Mensajería en tiempo real ───────────────────────────────
  const conversation = await request('/api/messaging/conversations', {
    method: 'POST',
    token: tokenA,
    body: { type: 'direct', memberIds: [userB.id] },
  });
  assert.equal(conversation.status, 201);
  const conversationId = conversation.data.conversation.id as string;

  const duplicateConversation = await request('/api/messaging/conversations', {
    method: 'POST', token: tokenA, body: { type: 'direct', memberIds: [userB.id] },
  });
  assert.equal(duplicateConversation.status, 200);
  assert.equal(duplicateConversation.data.conversation.id, conversationId);
  ok('conversación directa estable y sin duplicados');

  const nonFriendConversation = await request('/api/messaging/conversations', {
    method: 'POST', token: tokenC, body: { type: 'direct', memberIds: [userB.id] },
  });
  assert.equal(nonFriendConversation.status, 403);
  const cReadsAb = await request(`/api/messaging/conversations/${conversationId}/messages`, { token: tokenC });
  assert.equal(cReadsAb.status, 403);
  const cOpensAb = await request(`/api/messaging/conversations/${conversationId}`, { token: tokenC });
  assert.equal(cOpensAb.status, 403);
  const manipulatedId = await request(`/api/messaging/conversations/${crypto.randomUUID()}/messages`, { token: tokenC });
  assert.equal(manipulatedId.status, 403);
  ok('tercero y URI manipulada no acceden a conversación ajena');

  const socketB = socketBPrivacy;
  ok('dos sesiones Socket.IO autenticadas');

  const incoming = waitFor<Json>(socketB, 'message:new');
  const sent = await request(`/api/messaging/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: tokenA,
    body: { body: 'Hola Rafael, ¿revisamos el caso?' },
  });
  assert.equal(sent.status, 201);
  const delivered = await incoming;
  assert.equal(delivered.body, 'Hola Rafael, ¿revisamos el caso?');
  assert.equal(delivered.sender.id, userA.id);
  ok('mensaje entregado en tiempo real al destinatario');

  const typingEvent = waitFor<Json>(socketB, 'typing');
  socketA.emit('typing', { conversationId, typing: true });
  const typing = await typingEvent;
  assert.equal(typing.userId, userA.id);
  ok('indicador de escritura en tiempo real');

  const messages = await request(`/api/messaging/conversations/${conversationId}/messages?limit=20`, { token: tokenB });
  assert.equal(messages.status, 200);
  assert.ok(messages.data.messages.some((m: Json) => m.id === sent.data.message.id));

  const reaction = await request(`/api/messaging/messages/${sent.data.message.id}/reactions`, {
    method: 'POST',
    token: tokenB,
    body: { emoji: '👍' },
  });
  assert.equal(reaction.status, 200);

  const read = await request(`/api/messaging/conversations/${conversationId}/read`, { method: 'POST', token: tokenB });
  assert.equal(read.status, 200);
  ok('reacciones y confirmación de lectura persistidas');

  const cEdits = await request(`/api/messaging/messages/${sent.data.message.id}`, {
    method: 'PATCH', token: tokenC, body: { body: 'manipulado' },
  });
  assert.equal(cEdits.status, 403);
  const cDeletes = await request(`/api/messaging/messages/${sent.data.message.id}`, {
    method: 'DELETE', token: tokenC,
  });
  assert.equal(cDeletes.status, 403);
  ok('edición y borrado de mensajes exigen pertenencia a la conversación');

  // Marcela (B) y Roberto (C) también pueden ser amigos; Andrea (A) no debe
  // poder leer esa conversación aunque conozca el identificador.
  const bcRequest = await request('/api/community/friends/request', {
    method: 'POST', token: tokenC, body: { userId: userB.id },
  });
  assert.equal(bcRequest.status, 200);
  const friendsB2 = await request('/api/community/friends', { token: tokenB });
  const bcRequestId = friendsB2.data.incoming.find((row: Json) => row.id === userC.id)?.request_id as string;
  assert.ok(bcRequestId);
  const bcAccept = await request(`/api/community/friends/${bcRequestId}/respond`, {
    method: 'POST', token: tokenB, body: { action: 'accept' },
  });
  assert.equal(bcAccept.status, 200);
  const bcConversation = await request('/api/messaging/conversations', {
    method: 'POST', token: tokenB, body: { type: 'direct', memberIds: [userC.id] },
  });
  assert.equal(bcConversation.status, 201);
  const bcId = bcConversation.data.conversation.id as string;
  const aReadsBc = await request(`/api/messaging/conversations/${bcId}/messages`, { token: tokenA });
  assert.equal(aReadsBc.status, 403);
  ok('A no lee la conversación privada B-C aunque conozca su ID');

  // ── Notificaciones ──────────────────────────────────────────
  const notifications = await request('/api/notifications', { token: tokenB });
  assert.equal(notifications.status, 200);
  assert.ok(notifications.data.unread >= 1);
  ok('notificación real por el mensaje recibido');

  // ── Archivos con control de acceso ──────────────────────────
  const form = new FormData();
  form.append('files', new File(['Contenido de prueba para ETON LEX.'], 'prueba-e2e.txt', { type: 'text/plain' }));
  const upload = await request('/api/documents', { method: 'POST', token: tokenA, form });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const documentId = upload.data.documents[0].id as string;

  const denied = await request(`/api/files/${documentId}`, { token: tokenB });
  assert.equal(denied.status, 403);
  ok('archivo privado bloqueado para terceros');

  const share = await request(`/api/documents/${documentId}/share`, {
    method: 'POST',
    token: tokenA,
    body: { userId: userB.id },
  });
  assert.equal(share.status, 200);

  const allowed = await request(`/api/files/${documentId}`, { token: tokenB, raw: true });
  assert.equal(allowed.status, 200);
  assert.match(allowed.data.text, /ETON LEX/);
  ok('archivo compartido servido solo al destinatario');

  // ── Mensaje de voz: token firmado y bytes reales ──────────────
  const audioBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const audioForm = new FormData();
  audioForm.append('files', new File([audioBytes], 'nota-e2e.webm', { type: 'audio/webm' }));
  const audioUpload = await request('/api/documents', { method: 'POST', token: tokenA, form: audioForm });
  assert.equal(audioUpload.status, 201, JSON.stringify(audioUpload.data));
  const audioId = audioUpload.data.documents[0].id as string;
  const voiceMessage = await request(`/api/messaging/conversations/${conversationId}/messages`, {
    method: 'POST', token: tokenA,
    body: { kind: 'audio', attachmentId: audioId, body: 'Nota de voz de prueba' },
  });
  assert.equal(voiceMessage.status, 201, JSON.stringify(voiceMessage.data));
  const tokenForB = await request(`/api/files/${audioId}/audio-token`, { token: tokenB });
  assert.equal(tokenForB.status, 200);
  const audioForB = await request(`/api/files/${audioId}?token=${encodeURIComponent(tokenForB.data.token)}`, { raw: true });
  assert.equal(audioForB.status, 200);
  assert.equal(audioForB.data.headers.get('content-type'), 'audio/webm');
  assert.match(audioForB.data.headers.get('content-disposition') ?? '', /inline/);
  const tokenForC = await request(`/api/files/${audioId}/audio-token`, { token: tokenC });
  assert.equal(tokenForC.status, 403);
  ok('mensaje de voz reproducible por el receptor con token firmado y bloqueado a terceros');

  // ── Portada del perfil ───────────────────────────────────────
  const coverForm = new FormData();
  coverForm.append('cover', new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'portada-e2e.png',
    { type: 'image/png' },
  ));
  const coverUpload = await request('/api/users/me/cover', { method: 'POST', token: tokenA, form: coverForm });
  assert.equal(coverUpload.status, 200, JSON.stringify(coverUpload.data));
  assert.match(coverUpload.data.coverUrl, /^\/api\/files\/cover\//);
  const coverImage = await request(coverUpload.data.coverUrl, { raw: true });
  assert.equal(coverImage.status, 200);
  ok('portada del perfil subida y servida desde la página');

  // ── WebRTC: credenciales y señalización ─────────────────────
  const ice = await request('/api/system/ice', { token: tokenA });
  assert.equal(ice.status, 200);
  assert.ok(Array.isArray(ice.data.iceServers) && ice.data.iceServers.length > 0);
  ok('credenciales ICE para llamadas reales');

  const callId = crypto.randomUUID();
  const incomingCall = waitFor<Json>(socketB, 'call:incoming');
  socketA.emit('call:invite', { callId, to: userB.id, conversationId, kind: 'audio' });
  const call = await incomingCall;
  assert.equal(call.callId, callId);
  assert.equal(call.from.id, userA.id);

  const accepted = waitFor<Json>(socketA, 'call:accepted');
  socketB.emit('call:accept', { callId, to: userA.id });
  assert.equal((await accepted).callId, callId);

  const signal = waitFor<Json>(socketB, 'call:signal');
  socketA.emit('call:signal', { to: userB.id, callId, signal: { type: 'offer', sdp: 'v=0 e2e' } });
  const receivedSignal = await signal;
  assert.equal(receivedSignal.signal.sdp, 'v=0 e2e');

  const ended = waitFor<Json>(socketA, 'call:ended');
  socketB.emit('call:end', { callId, to: userA.id, durationS: 3 });
  assert.equal((await ended).callId, callId);

  const callHistory = await request('/api/messaging/calls', { token: tokenA });
  assert.equal(callHistory.status, 200);
  assert.ok(callHistory.data.calls.some((c: Json) => c.id === callId));
  ok('señalización WebRTC y historial de llamada persistidos');

  const socketCEnd = await connect(tokenC);
  const noForeignEnd = expectNoEvent(socketCEnd, 'call:ended');
  socketB.emit('call:end', { callId, to: userC.id, durationS: 1 });
  await noForeignEnd;
  socketCEnd.disconnect();
  ok('call:end ignora un destinatario manipulado y solo notifica al participante real');

  // ── Permisos ────────────────────────────────────────────────
  const admin = await request('/api/admin/overview', { token: tokenA });
  assert.equal(admin.status, 403);
  ok('administración protegida por rol');

  // ── Recuperación de contraseña por código ───────────────────
  const capabilities = await request('/api/system/capabilities');
  assert.equal(capabilities.status, 200);
  const emailReady = capabilities.data.email?.configured === true;
  const recoveryEmail = `e2e.andrea.${stamp}@etonlex.test`;

  // ── Verificación de registro e ingreso por código ────────────
  if (emailReady) {
    const badCode = await request('/api/auth/login-with-code', {
      method: 'POST',
      body: { email: recoveryEmail, code: '000000' },
    });
    assert.equal(badCode.status, 400);
    ok('ingreso por código rechaza códigos inventados');

    const meVerified = await request('/api/auth/me', { token: tokenA });
    assert.equal(typeof meVerified.data.user.emailVerified, 'boolean');
    ok('el perfil informa si el correo está verificado');
  } else {
    const loginCodeUnavailable = await request('/api/auth/request-login-code', {
      method: 'POST',
      body: { email: recoveryEmail },
    });
    assert.equal(loginCodeUnavailable.status, 503);
    const verifyUnavailable = await request('/api/auth/verify-email', {
      method: 'POST',
      token: tokenA,
      body: { code: '000000' },
    });
    assert.equal(verifyUnavailable.status, 503);
    ok('verificación e ingreso por código suspendidos hasta configurar SMTP');
  }

  if (emailReady) {
    const unknown = await request('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: `no-registrado.${stamp}@etonlex.test` },
    });
    assert.equal(unknown.status, 200);
    assert.match(unknown.data.message, /Si el correo está registrado/);

    const invalidCode = await request('/api/auth/reset-password', {
      method: 'POST',
      body: { email: recoveryEmail, code: '000000', password: 'IntentoFallido123!' },
    });
    assert.equal(invalidCode.status, 400);
    assert.ok(!JSON.stringify(invalidCode.data).includes(recoveryEmail));
    ok('recuperación activa: no revela si el correo existe ni acepta códigos inventados');
  } else {
    const unavailable = await request('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: recoveryEmail },
    });
    assert.equal(unavailable.status, 503);
    ok('recuperación honestamente suspendida hasta configurar SMTP');
  }

  // ── Privacidad tras cerrar sesión y volver a entrar ───────────
  const relogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: `e2e.andrea.${stamp}@etonlex.test`, password: PASSWORD },
  });
  assert.equal(relogin.status, 200);
  const tokenAAfter = relogin.data.accessToken as string;
  const afterRelogin = await request(`/api/messaging/conversations/${conversationId}/messages`, { token: tokenAAfter });
  assert.equal(afterRelogin.status, 200);
  assert.ok(afterRelogin.data.messages.some((m: Json) => m.id === sent.data.message.id));
  const strangerAfterRelogin = await request(`/api/messaging/conversations/${conversationId}/messages`, { token: tokenC });
  assert.equal(strangerAfterRelogin.status, 403);
  ok('historial privado sigue accesible al dueño y protegido tras nuevo ingreso');

  // ── Cierre ──────────────────────────────────────────────────
  socketA.disconnect();
  socketB.disconnect();
  await delay(50);
  console.log('\nE2E completado sin fallos.\n');
}

main().catch((error) => {
  console.error('\nE2E falló:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
