import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Check, Copy, Hand, LogOut, MessageSquare, PenLine, Send, ShieldAlert,
  Users, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../lib/store';
import { Avatar, Badge, Skeleton } from '../components/ui';
import RoomCall from '../components/RoomCall';
import Whiteboard from '../components/Whiteboard';
import { cn } from '../lib/utils';

type Member = {
  id: string;
  name: string;
  avatar_url?: string | null;
  university?: string | null;
  role: string;
  hand_raised: number | boolean;
  joined_at?: string;
};
type RoomInfo = {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  visibility: string;
  ownerId: string;
  ownerName: string;
  whiteboard: boolean;
  createdAt: string;
};
type RoomMessage = {
  id: string;
  roomId?: string;
  body: string | null;
  kind: string;
  createdAt: string;
  sender: { id: string; name: string; avatarUrl?: string | null };
};
type Page = { id: string; page_number: number; title: string };
type ElementRow = { id: string; page_id: string; author_id: string; type: string; data: string | Record<string, unknown> };
type RoomPayload = {
  room: RoomInfo;
  members: Member[];
  pages: Page[];
  elements: ElementRow[];
  messages: RoomMessage[];
  screens: Array<{ id: string; user_id: string; user_name: string; label: string }>;
  me: { role: string; handRaised: boolean } | null;
};
type Tab = 'chat' | 'board' | 'members';
type Float = { id: string; emoji: string; left: number };

const REACTIONS = ['❤️', '👏', '😂', '😮', '🎉', '👍'];

function formatTime(value: string) {
  const date = new Date(value.includes('T') || value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  const roomId = id ?? '';
  const { user } = useAuth();
  const socket = getSocket();

  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!roomId) return;
    setError(null);
    try {
      const data = await api<RoomPayload>(`/rooms/${roomId}`);
      setPayload(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'No se pudo cargar la sala.');
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  // Pertenencia y eventos de la sala.
  useEffect(() => {
    if (!roomId || !socket) return;
    socket.emit('room:join', { roomId });

    const onJoined = (event: { roomId: string }) => {
      if (event.roomId === roomId) void load();
    };
    const onParticipantJoined = (event: { roomId: string; user: { id: string; name: string; avatarUrl?: string | null } }) => {
      if (event.roomId !== roomId) return;
      setPayload((current) => {
        if (!current || current.members.some((member) => member.id === event.user.id)) return current;
        return { ...current, members: [...current.members, { ...event.user, role: 'participant', hand_raised: 0 }] };
      });
    };
    const onParticipantLeft = (event: { roomId: string; userId: string }) => {
      if (event.roomId !== roomId) return;
      setPayload((current) => current ? { ...current, members: current.members.filter((member) => member.id !== event.userId) } : current);
    };
    const onMessage = (message: RoomMessage) => {
      if (message.roomId !== roomId) return;
      setPayload((current) => {
        if (!current || current.messages.some((item) => item.id === message.id)) return current;
        return { ...current, messages: [...current.messages, message] };
      });
    };
    const onHand = (event: { roomId: string; userId: string; raised: boolean }) => {
      if (event.roomId !== roomId) return;
      setPayload((current) => {
        if (!current) return current;
        const members = current.members.map((member) => member.id === event.userId ? { ...member, hand_raised: event.raised } : member);
        const me = event.userId === user?.id && current.me ? { ...current.me, handRaised: event.raised } : current.me;
        return { ...current, members, me };
      });
    };
    const onReaction = (event: { roomId: string; emoji: string }) => {
      if (event.roomId !== roomId || !event.emoji) return;
      const item: Float = { id: `${Date.now()}-${Math.random()}`, emoji: event.emoji.slice(0, 8), left: 12 + Math.random() * 72 };
      setFloats((current) => [...current, item]);
      window.setTimeout(() => setFloats((current) => current.filter((float) => float.id !== item.id)), 3200);
    };
    const onScreenStart = (event: { roomId: string; id: string; user_name: string; label: string }) => {
      if (event.roomId !== roomId) return;
      toast.info(`${event.user_name} está compartiendo pantalla`);
    };
    const onEnded = (event: { roomId: string }) => {
      if (event.roomId !== roomId) return;
      toast.info('La sala fue finalizada por el anfitrión.');
      navigate('/salas');
    };

    socket.on('room:joined', onJoined);
    socket.on('room:participant-joined', onParticipantJoined);
    socket.on('room:participant-left', onParticipantLeft);
    socket.on('room:message', onMessage);
    socket.on('room:hand', onHand);
    socket.on('room:reaction', onReaction);
    socket.on('screen:start', onScreenStart);
    socket.on('room:ended', onEnded);
    return () => {
      socket.off('room:joined', onJoined);
      socket.off('room:participant-joined', onParticipantJoined);
      socket.off('room:participant-left', onParticipantLeft);
      socket.off('room:message', onMessage);
      socket.off('room:hand', onHand);
      socket.off('room:reaction', onReaction);
      socket.off('screen:start', onScreenStart);
      socket.off('room:ended', onEnded);
    };
  }, [load, navigate, roomId, socket, user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [payload?.messages.length, tab]);

  const isOwner = payload?.room.ownerId === user?.id || payload?.me?.role === 'owner';
  const members = payload?.members ?? [];
  const raised = members.filter((member) => Boolean(member.hand_raised));
  const handRaised = Boolean(payload?.me?.handRaised);

  const boardPages = payload?.pages ?? [];
  const boardElements = useMemo(
    () => (payload?.elements ?? []).map((element) => ({
      id: element.id,
      pageId: element.page_id,
      type: element.type,
      data: element.data,
      authorId: element.author_id,
    })),
    [payload?.elements],
  );

  const copyLink = async () => {
    const url = `${window.location.origin}/sala/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('textarea');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    toast.success('Enlace de invitación copiado.');
    window.setTimeout(() => setCopied(false), 2000);
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    setSending(true);
    try {
      await api(`/rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ body, kind: 'text' }) });
    } catch (err) {
      setDraft(body);
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const react = (emoji: string) => socket?.emit('room:reaction', { roomId, emoji });

  const toggleHand = () => {
    const next = !handRaised;
    socket?.emit('room:hand', { roomId, raised: next });
    setPayload((current) => {
      if (!current) return current;
      return {
        ...current,
        me: current.me ? { ...current.me, handRaised: next } : null,
        members: current.members.map((member) => member.id === user?.id ? { ...member, hand_raised: next } : member),
      };
    });
  };

  const leave = async () => {
    try {
      await api(`/rooms/${roomId}/leave`, { method: 'POST' });
      navigate('/salas');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo salir de la sala.');
    }
  };

  const end = async () => {
    if (!window.confirm('¿Finalizar la sala para todos los participantes? Esta acción no se puede deshacer.')) return;
    try {
      await api(`/rooms/${roomId}/end`, { method: 'POST' });
      toast.success('La sala fue finalizada.');
      navigate('/salas');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo finalizar la sala.');
    }
  };

  if (error) {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-fg/[.06] text-fg/50"><ShieldAlert size={22} /></div>
        <h1 className="mt-4 font-display text-2xl text-fg/90">No puedes entrar a esta sala</h1>
        <p className="mt-2 text-[13px] text-fg/45">{error}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => void load()} className="btn btn-sm">Reintentar</button>
          <Link to="/salas" className="btn btn-primary btn-sm">Volver a salas</Link>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-[520px] w-full rounded-[26px]" />
          <Skeleton className="h-[520px] w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <button onClick={() => navigate('/salas')} className="btn btn-ghost btn-sm !px-2" aria-label="Volver a salas"><ArrowLeft size={17} /></button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Video size={17} className="text-fg/45" />
            <h1 className="truncate font-display text-[26px] leading-tight text-fg/95">{payload.room.name}</h1>
            <Badge tone="neutral">{payload.room.visibility === 'community' ? 'Comunidad' : 'Por enlace'}</Badge>
          </div>
          {payload.room.description && <p className="mt-1 line-clamp-2 max-w-2xl text-[12.5px] text-fg/45">{payload.room.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void copyLink()} className="btn btn-sm">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar enlace'}
          </button>
          <button onClick={() => void leave()} className="btn btn-sm"><LogOut size={14} /> Salir</button>
          {isOwner && (
            <button onClick={() => void end()} className="btn btn-primary btn-sm">Finalizar sala</button>
          )}
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <div className="relative">
            {user && (
              <RoomCall
                roomId={roomId}
                members={members.map((member) => ({ id: member.id, name: member.name, avatar_url: member.avatar_url }))}
                userId={user.id}
                userName={user.name}
              />
            )}
            {/* Reacciones flotantes sobre el escenario */}
            <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
              <AnimatePresence>
                {floats.map((float) => (
                  <motion.span
                    key={float.id}
                    className="absolute bottom-8 text-3xl drop-shadow-lg"
                    style={{ left: `${float.left}%` }}
                    initial={{ opacity: 0, y: 20, scale: 0.5 }}
                    animate={{ opacity: 1, y: -220, scale: 1.25 }}
                    exit={{ opacity: 0, scale: 1.6 }}
                    transition={{ duration: 3, ease: 'easeOut' }}
                  >
                    {float.emoji}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="card flex flex-wrap items-center gap-2 p-3">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/30">Reacciones</span>
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => react(emoji)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line/70 bg-white/50 text-[16px] transition-transform hover:scale-110 dark:bg-white/[.05]"
                aria-label={`Enviar reacción ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {raised.length > 0 && (
                <span className="hidden items-center gap-1 text-[10px] text-fg/45 sm:flex">
                  <Hand size={12} className="text-fg/50" /> {raised.length} mano{raised.length > 1 ? 's' : ''} levantada{raised.length > 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={toggleHand}
                className={cn('btn btn-sm', handRaised && 'btn-primary')}
                title={handRaised ? 'Bajar la mano' : 'Levantar la mano'}
              >
                <Hand size={14} /> {handRaised ? 'Bajar mano' : 'Levantar mano'}
              </button>
            </div>
          </div>

          <div className="card flex h-[440px] min-h-0 flex-col overflow-hidden sm:h-[480px]">
            <div className="flex items-center gap-1 border-b border-line/70 px-3 pt-2">
              {([
                ['chat', 'Chat', MessageSquare],
                ['board', 'Pizarra', PenLine],
                ['members', 'Participantes', Users],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12px] transition-colors',
                    tab === value ? 'border-b-2 border-fg font-medium text-fg' : 'border-b-2 border-transparent text-fg/40 hover:text-fg/70',
                  )}
                >
                  <Icon size={14} /> {label}
                  {value === 'chat' && payload.messages.length > 0 && <span className="text-[10px] opacity-50">{payload.messages.length}</span>}
                  {value === 'members' && <span className="text-[10px] opacity-50">{members.length}</span>}
                </button>
              ))}
            </div>

            {tab === 'chat' && (
              <>
                <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3 sm:px-4">
                  {payload.messages.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-white/50 dark:bg-white/[.05]"><MessageSquare size={20} className="text-fg/35" /></div>
                      <p className="mt-3 text-[12.5px] text-fg/45">Aún no hay mensajes. Saluda a la sala.</p>
                    </div>
                  )}
                  {payload.messages.map((message) => {
                    const mine = message.sender.id === user?.id;
                    return (
                      <div key={message.id} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
                        <Avatar name={message.sender.name} url={message.sender.avatarUrl} size={24} />
                        <div className={cn('max-w-[76%]', mine && 'text-right')}>
                          <p className="mb-0.5 text-[9.5px] text-fg/35">
                            {mine ? 'Tú' : message.sender.name} · {formatTime(message.createdAt)}
                          </p>
                          <div className={cn(
                            'inline-block rounded-2xl px-3 py-1.5 text-left text-[12.5px] leading-relaxed',
                            mine ? 'rounded-br-sm bg-fg text-paper' : 'rounded-bl-sm border border-line bg-white/55 text-fg/85 dark:bg-white/[.05]',
                          )}>
                            <p className="whitespace-pre-wrap break-words">{message.body ?? (message.kind === 'file' ? 'Archivo adjunto' : '—')}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
                <form onSubmit={(event) => { void send(event); }} className="flex items-center gap-2 border-t border-line/70 p-2.5">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Escribe un mensaje para la sala…"
                    maxLength={4000}
                    className="input !py-2 !text-[12.5px]"
                  />
                  <button type="submit" disabled={!draft.trim() || sending} className="btn btn-primary !px-3" aria-label="Enviar mensaje"><Send size={15} /></button>
                </form>
              </>
            )}

            {tab === 'board' && (
              <div className="min-h-0 flex-1">
                {payload.room.whiteboard ? (
                  <Whiteboard
                    roomId={roomId}
                    initialPages={boardPages}
                    initialElements={boardElements}
                    userId={user?.id ?? ''}
                  />
                ) : (
                  <p className="flex h-full items-center justify-center text-[12px] text-fg/40">Esta sala no tiene pizarra habilitada.</p>
                )}
              </div>
            )}

            {tab === 'members' && (
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5 rounded-xl border border-line/70 px-2.5 py-2">
                    <Avatar name={member.name} url={member.avatar_url} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-fg/85">{member.name}{member.id === user?.id ? ' (tú)' : ''}</p>
                      <p className="truncate text-[10px] text-fg/35">{member.university ?? 'Estudiante de Derecho'}</p>
                    </div>
                    {member.role === 'owner' && <Badge tone="neutral">Anfitrión</Badge>}
                    {Boolean(member.hand_raised) && <Hand size={15} className="text-fg/70" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <div className="card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/30">Invitación</p>
            <h2 className="mt-1 font-display text-lg text-fg/90">{payload.room.name}</h2>
            <p className="mt-2 text-[10px] text-fg/35">Código de la sala</p>
            <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border border-line bg-white/50 px-3 py-2 dark:bg-white/[.05]">
              <span className="font-mono text-[15px] font-semibold tracking-[0.2em] text-fg/85">{payload.room.inviteCode}</span>
              <button onClick={() => void copyLink()} className="text-fg/40 hover:text-fg" title="Copiar enlace de invitación" aria-label="Copiar enlace">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <button onClick={() => void copyLink()} className="btn btn-sm mt-2 w-full"><Copy size={13} /> Copiar enlace de invitación</button>
            <p className="mt-2 break-all text-[10px] leading-relaxed text-fg/25">{window.location.origin}/sala/{roomId}</p>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/30">En la sala</p>
              <span className="text-[10px] text-fg/35">{members.length}</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {members.map((member) => (
                <div key={member.id} className="flex items-center gap-2 rounded-xl px-1.5 py-1">
                  <Avatar name={member.name} url={member.avatar_url} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg/75">{member.name}{member.id === user?.id ? ' (tú)' : ''}</span>
                  {Boolean(member.hand_raised) && <Hand size={13} className="text-fg/60" />}
                </div>
              ))}
            </div>
            {raised.length > 0 && (
              <p className="mt-3 rounded-lg bg-fg/[.04] px-2.5 py-1.5 text-[10.5px] text-fg/50">
                ✋ {raised.map((member) => member.name).join(', ')} tiene{raised.length > 1 ? 'n' : ''} la mano levantada.
              </p>
            )}
          </div>

          <div className="card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/30">Sala</p>
            <p className="mt-2 text-[11px] leading-relaxed text-fg/45">
              Audio y video entre participantes mediante WebRTC. Sin servidor TURN, algunas redes restrictivas pueden impedir la conexión.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{members.length} participantes</Badge>
              {payload.room.whiteboard && <Badge tone="neutral">Pizarra</Badge>}
              {isOwner && <Badge tone="gold">Anfitrión</Badge>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
