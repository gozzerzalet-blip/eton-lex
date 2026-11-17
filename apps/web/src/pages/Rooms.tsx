import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Check, Copy, Plus, Users, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { Badge, EmptyState, SectionHeader, Skeleton } from '../components/ui';
import { formatDate } from '../lib/utils';

type RoomRow = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  ended_at: string | null;
  participants: number;
};

export default function Rooms() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'link' | 'community'>('link');
  const [whiteboard, setWhiteboard] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['rooms'],
    queryFn: () => api<{ rooms: RoomRow[] }>('/rooms'),
  });

  const rooms = roomsQuery.data?.rooms ?? [];

  const copyLink = async (id: string) => {
    const url = `${window.location.origin}/sala/${id}`;
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
    setCopied(id);
    toast.success('Enlace de invitación copiado.');
    window.setTimeout(() => setCopied(null), 2000);
  };

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || busy) return;
    setBusy('create');
    try {
      const response = await api<{ room: { id: string } }>('/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          visibility,
          whiteboard,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/sala/${response.room.id}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo crear la sala.');
    } finally {
      setBusy(null);
    }
  };

  const joinRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.trim().length < 4 || busy) return;
    setBusy('join');
    try {
      const response = await api<{ room: { id: string } }>('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/sala/${response.room.id}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo ingresar a la sala.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Videoconferencias"
        title="Salas de estudio"
        description="Reúnete con otros estudiantes por videollamada, comparte tu pantalla y trabaja en una pizarra colaborativa en tiempo real."
        action={<Badge tone="neutral"><Video size={12} /> WebRTC · Pizarra</Badge>}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/30">Tus salas</p>
              <h2 className="mt-0.5 font-display text-lg text-fg/90">Salas disponibles</h2>
            </div>
            <span className="text-[11px] text-fg/35">{rooms.length}</span>
          </div>

          {roomsQuery.isLoading && (
            <div className="space-y-2 p-4">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-20 w-full" />)}</div>
          )}

          {!roomsQuery.isLoading && rooms.length === 0 && (
            <div className="p-4">
              <EmptyState
                icon={<Video size={22} />}
                title="Aún no tienes salas"
                description="Crea una sala nueva o ingresa con el código que te compartió un compañero."
              />
            </div>
          )}

          <div className="divide-y divide-line/70">
            {rooms.map((room) => (
              <div key={room.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-fg/[.025]">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-white/55 text-fg/55 dark:bg-white/[.05]">
                  <Video size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13.5px] font-medium text-fg/85">{room.name}</p>
                    {room.ended_at && <Badge tone="neutral">Finalizada</Badge>}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10.5px] text-fg/35">
                    <span className="flex items-center gap-1"><Users size={11} /> {room.participants} participante{room.participants === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>{formatDate(room.created_at)}</span>
                    <span>·</span>
                    <span className="font-mono tracking-wider">{room.invite_code}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { void copyLink(room.id); }}
                    className="btn btn-ghost btn-sm !px-2"
                    title="Copiar enlace de invitación"
                    aria-label="Copiar enlace de invitación"
                  >
                    {copied === room.id ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  {room.ended_at ? (
                    <button onClick={() => { void copyLink(room.id); }} className="btn btn-sm">Copiar enlace</button>
                  ) : (
                    <Link to={`/sala/${room.id}`} className="btn btn-primary btn-sm">
                      Entrar <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-3">
          <form onSubmit={(event) => { void createRoom(event); }} className="card p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg/[.06] text-fg/60"><Plus size={16} /></div>
              <div>
                <h2 className="font-display text-lg text-fg/90">Nueva sala</h2>
                <p className="text-[10.5px] text-fg/35">Crea un espacio de videoconferencia.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">Nombre</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ej. Sala de estudio de Derecho Penal"
                  minLength={2}
                  maxLength={80}
                  required
                  className="input !text-[12.5px]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">Descripción (opcional)</span>
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Tema o consigna de la sesión"
                  maxLength={240}
                  className="input !text-[12.5px]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">Visibilidad</span>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'link' | 'community')} className="input !text-[12.5px]">
                  <option value="link">Solo por enlace</option>
                  <option value="community">Visible para la comunidad</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12px] text-fg/60">
                <input type="checkbox" checked={whiteboard} onChange={(event) => setWhiteboard(event.target.checked)} className="accent-current" />
                Incluir pizarra colaborativa
              </label>
              <button type="submit" disabled={busy === 'create' || name.trim().length < 2} className="btn btn-primary w-full">
                <Plus size={14} /> {busy === 'create' ? 'Creando…' : 'Crear sala'}
              </button>
            </div>
          </form>

          <form onSubmit={(event) => { void joinRoom(event); }} className="card p-4">
            <h2 className="font-display text-lg text-fg/90">Unirse por código</h2>
            <p className="mt-0.5 text-[10.5px] text-fg/35">Ingresa el código de 8 caracteres que te compartieron.</p>
            <div className="mt-3 flex gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="CÓDIGO"
                minLength={4}
                maxLength={20}
                required
                className="input flex-1 !text-center !text-[13px] font-mono tracking-[0.18em] uppercase"
              />
              <button type="submit" disabled={busy === 'join' || code.trim().length < 4} className="btn btn-primary !px-3">
                Entrar
              </button>
            </div>
          </form>
        </div>
      </div>

      <p className="px-1 text-[10px] leading-relaxed text-fg/20">
        Las salas usan conexiones P2P cifradas por WebRTC. Para copiar un enlace, usa el botón junto a cada sala y compártelo con tus compañeros.
      </p>
    </div>
  );
}
