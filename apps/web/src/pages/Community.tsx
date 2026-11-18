import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check, MessageSquare, Plus, Search, Send, UserMinus, UserPlus, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import type { Post } from '../lib/types';
import { Avatar, Badge, EmptyState, Modal, SectionHeader, Skeleton, Tabs } from '../components/ui';
import { cn, timeAgo } from '../lib/utils';

type FriendsResponse = {
  friends: Array<{ id: string; name: string; avatar_url?: string; university?: string; cycle?: string }>;
  incoming: Array<{ request_id: string; id: string; name: string; avatar_url?: string; university?: string; cycle?: string; created_at: string }>;
  outgoing: Array<{ request_id: string; id: string; name: string; avatar_url?: string; university?: string; created_at: string }>;
};

type StudentLookup = {
  user: { id: string; name: string; avatarUrl?: string; university?: string; cycle?: string; relation: string | null } | null;
};

type GroupsResponse = {
  groups: Array<{ id: string; name: string; description?: string; owner_name: string; members: number; joined: number; visibility: string; area?: string }>;
};

export default function Community() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'feed' | 'friends' | 'groups'>('feed');
  const [postText, setPostText] = useState('');
  const [postTitle, setPostTitle] = useState('');
  const [search, setSearch] = useState('');
  const [groupModal, setGroupModal] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', visibility: 'private' as 'private' | 'public' });

  const feedQuery = useQuery({ queryKey: ['community-feed'], queryFn: () => api<{ posts: Post[] }>('/community/feed') });
  const friendsQuery = useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsResponse>('/community/friends') });
  const studentsQuery = useQuery({
    queryKey: ['student-lookup', search.trim()],
    queryFn: () => api<StudentLookup>(`/users/lookup?q=${encodeURIComponent(search.trim())}`),
    enabled: tab === 'friends' && search.trim().length >= 4,
  });
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => api<GroupsResponse>('/community/groups'), enabled: tab === 'groups' });

  const createPost = useMutation({
    mutationFn: () => api('/community/posts', {
      method: 'POST',
      body: JSON.stringify({ kind: 'note', title: postTitle || null, body: postText, visibility: 'friends' }),
    }),
    onSuccess: () => {
      setPostText(''); setPostTitle('');
      toast.success('Publicación compartida con tus amigos.');
      queryClient.invalidateQueries({ queryKey: ['community-feed'] });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'No se pudo publicar.'),
  });

  const like = async (postId: string) => {
    await api(`/community/posts/${postId}/like`, { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['community-feed'] });
  };

  const request = useMutation({
    mutationFn: (userId: string) => api('/community/friends/request', { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: () => {
      toast.success('Solicitud enviada.');
      queryClient.invalidateQueries({ queryKey: ['student-lookup'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'No se pudo enviar la solicitud.'),
  });

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api(`/community/friends/${id}/respond`, { method: 'POST', body: JSON.stringify({ action }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['student-lookup'] });
      queryClient.invalidateQueries({ queryKey: ['community-feed'] });
    },
  });

  const removeFriend = useMutation({
    mutationFn: (userId: string) => api(`/community/friends/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Amistad eliminada.');
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['student-lookup'] });
    },
  });

  const startChat = async (userId: string) => {
    try {
      const res = await api<{ conversation: { id: string } }>('/messaging/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [userId] }),
      });
      window.location.assign(`/mensajes/${res.conversation.id}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo abrir la conversación.');
    }
  };

  const createGroup = useMutation({
    mutationFn: () => api<{ id: string }>('/community/groups', {
      method: 'POST',
      body: JSON.stringify({ ...groupForm, description: groupForm.description || null }),
    }),
    onSuccess: () => {
      toast.success('Grupo de estudio creado.');
      setGroupModal(false);
      setGroupForm({ name: '', description: '', visibility: 'private' });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'No se pudo crear el grupo.'),
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Comunidad privada"
        title="Estudiantes de Derecho, conectados"
        description="Perfiles académicos, amigos, grupos de estudio y apuntes compartidos. Tu actividad solo es visible según tus ajustes de privacidad."
        action={<Badge tone="gold">{user?.university ?? 'Comunidad ETON LEX'}</Badge>}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'feed', label: 'Actividad' },
          { id: 'friends', label: 'Amigos', count: friendsQuery.data?.friends.length },
          { id: 'groups', label: 'Grupos de estudio' },
        ]}
      />

      {tab === 'feed' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex gap-3">
                <Avatar name={user?.name} url={user?.avatarUrl} size={34} />
                <div className="min-w-0 flex-1 space-y-2">
                  <input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} placeholder="Título (opcional)" className="input !py-2 !text-[12.5px]" maxLength={140} />
                  <textarea
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    rows={3}
                    placeholder="Comparte un apunte, una pregunta o un hallazgo jurídico…"
                    className="input resize-none !py-2.5 !text-[13px]"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-fg/25">Visible para tus amigos</p>
                    <button onClick={() => createPost.mutate()} disabled={!postText.trim() || createPost.isPending} className="btn btn-primary btn-sm">
                      <Send size={12} /> Publicar
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {feedQuery.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>}

            {!feedQuery.isLoading && (feedQuery.data?.posts.length ?? 0) === 0 && (
              <EmptyState
                icon={<Users size={20} />}
                title="Tu feed está vacío"
                description="Agrega amigos o comparte tu primer apunte para empezar la conversación académica."
                action={<button onClick={() => setTab('friends')} className="btn btn-sm"><UserPlus size={13} /> Buscar estudiantes</button>}
              />
            )}

            <div className="space-y-3">
              {feedQuery.data?.posts.map((p) => (
                <article key={p.id} className="card p-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={p.author.name} url={p.author.avatarUrl} size={32} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/perfil/${p.author.id}`} className="text-[12.5px] font-medium text-fg/85 hover:underline">{p.author.name}</Link>
                      <p className="text-[10px] text-fg/30">{p.author.university ?? 'Estudiante de Derecho'} · {timeAgo(p.createdAt)}</p>
                    </div>
                    <Badge>{p.kind === 'question' ? 'Pregunta' : p.kind === 'document' ? 'Documento' : 'Nota'}</Badge>
                  </div>
                  {p.title && <h3 className="mt-3 font-display text-[16px] text-fg/90">{p.title}</h3>}
                  <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-fg/60">{p.body}</p>
                  <div className="mt-3 flex items-center gap-4 text-[11px] text-fg/35">
                    <button onClick={() => like(p.id)} className={cn('inline-flex items-center gap-1.5 hover:text-fg/70', p.liked && 'text-fg')}>
                      <Check size={12} /> {p.likes} útil{p.likes === 1 ? '' : 'es'}
                    </button>
                    <span className="inline-flex items-center gap-1.5"><MessageSquare size={12} /> {p.comments}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="card p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg/40">Solicitudes pendientes</h3>
              {(friendsQuery.data?.incoming.length ?? 0) === 0 && <p className="mt-2 text-[11.5px] text-fg/30">No tienes solicitudes nuevas.</p>}
              <div className="mt-2 space-y-2">
                {friendsQuery.data?.incoming.map((f) => (
                  <div key={f.request_id} className="flex items-center gap-2">
                    <Avatar name={f.name} url={f.avatar_url} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg/70">{f.name}</span>
                    <button onClick={() => respond.mutate({ id: f.request_id, action: 'accept' })} className="rounded-lg bg-ok/10 p-1.5 text-ok hover:bg-ok/20" aria-label="Aceptar"><Check size={12} /></button>
                    <button onClick={() => respond.mutate({ id: f.request_id, action: 'reject' })} className="rounded-lg bg-bad/10 p-1.5 text-bad hover:bg-bad/20" aria-label="Rechazar"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg/40">Tus amigos</h3>
              {(friendsQuery.data?.friends.length ?? 0) === 0 && <p className="mt-2 text-[11.5px] text-fg/30">Aún no tienes amigos agregados.</p>}
              <div className="mt-2 space-y-1">
                {friendsQuery.data?.friends.slice(0, 8).map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-fg/[.03]">
                    <Avatar name={f.name} url={f.avatar_url} size={26} />
                    <Link to={`/perfil/${f.id}`} className="min-w-0 flex-1 truncate text-[12px] text-fg/70 hover:underline">{f.name}</Link>
                    <button onClick={() => startChat(f.id)} className="p-1 text-fg/30 hover:text-fg/70" title="Enviar mensaje"><MessageSquare size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'friends' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
          <section className="card p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg/40">Amigos ({friendsQuery.data?.friends.length ?? 0})</h3>
            <div className="mt-3 space-y-1.5">
              {friendsQuery.data?.friends.map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                  <Avatar name={f.name} url={f.avatar_url} size={30} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/perfil/${f.id}`} className="block truncate text-[12.5px] text-fg/80 hover:underline">{f.name}</Link>
                    <p className="truncate text-[10px] text-fg/30">{f.university ?? '—'} {f.cycle ? `· ${f.cycle}` : ''}</p>
                  </div>
                  <button onClick={() => startChat(f.id)} className="p-1.5 text-fg/30 hover:text-fg/70" title="Mensaje"><MessageSquare size={13} /></button>
                  <button onClick={() => removeFriend.mutate(f.id)} className="p-1.5 text-fg/20 hover:text-bad" title="Eliminar amistad"><UserMinus size={13} /></button>
                </div>
              ))}
              {(friendsQuery.data?.friends.length ?? 0) === 0 && <p className="py-6 text-center text-[11.5px] text-fg/30">Busca estudiantes y envía tu primera solicitud.</p>}
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg/40">Buscar estudiantes</h3>
            </div>
            <div className="relative mt-3">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID público, usuario o correo exacto…" className="input !py-2 !text-[12px] pl-9" />
              <p className="mt-2 text-[10px] text-fg/30">Por privacidad solo mostramos resultados de búsqueda exacta; no hay listado general de estudiantes.</p>
            </div>

            <div className="mt-3 space-y-1.5">
              {studentsQuery.isLoading && <Skeleton className="h-14 w-full" />}
              {studentsQuery.data?.user && (
                <div className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                  <Avatar name={studentsQuery.data.user.name} url={studentsQuery.data.user.avatarUrl} size={32} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/perfil/${studentsQuery.data.user.id}`} className="block truncate text-[12.5px] text-fg/80 hover:underline">{studentsQuery.data.user.name}</Link>
                    <p className="truncate text-[10px] text-fg/30">{[studentsQuery.data.user.university, studentsQuery.data.user.cycle].filter(Boolean).join(' · ') || 'Sin datos académicos'}</p>
                  </div>
                  {studentsQuery.data.user.relation === 'accepted' ? (
                    <button onClick={() => startChat(studentsQuery.data.user!.id)} className="btn btn-sm !px-2"><MessageSquare size={12} /></button>
                  ) : studentsQuery.data.user.relation === 'pending' ? (
                    <Badge>Pendiente</Badge>
                  ) : (
                    <button onClick={() => request.mutate(studentsQuery.data.user!.id)} className="btn btn-sm !px-2" title="Agregar amigo"><UserPlus size={13} /></button>
                  )}
                </div>
              )}
              {!studentsQuery.isLoading && search.trim().length >= 4 && !studentsQuery.data?.user && (
                <p className="py-6 text-center text-[11.5px] text-fg/30">No encontramos una cuenta con ese identificador exacto.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'groups' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setGroupModal(true)} className="btn btn-primary btn-sm"><Plus size={13} /> Crear grupo</button>
          </div>

          {groupsQuery.isLoading && <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>}

          {!groupsQuery.isLoading && (groupsQuery.data?.groups.length ?? 0) === 0 && (
            <EmptyState
              icon={<Users size={20} />}
              title="Todavía no hay grupos"
              description="Crea un grupo de estudio por materia, ciclo o tema y comparte apuntes con tus compañeros."
              action={<button onClick={() => setGroupModal(true)} className="btn btn-sm"><Plus size={13} /> Crear el primero</button>}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groupsQuery.data?.groups.map((g) => (
              <div key={g.id} className="card card-hover flex flex-col p-4">
                <div className="flex items-center gap-2">
                  <Badge tone={g.visibility === 'public' ? 'success' : 'neutral'}>{g.visibility === 'public' ? 'Público' : 'Privado'}</Badge>
                  {g.joined ? <Badge tone="gold">Miembro</Badge> : null}
                </div>
                <h3 className="mt-2 font-display text-[17px] text-fg/90">{g.name}</h3>
                {g.description && <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-fg/40">{g.description}</p>}
                <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-fg/30">
                  <span className="flex items-center gap-1"><Users size={11} /> {g.members} miembros</span>
                  <span>{g.owner_name}</span>
                </div>
                <button
                  onClick={async () => {
                    await api(`/community/groups/${g.id}/join`, { method: 'POST' });
                    queryClient.invalidateQueries({ queryKey: ['groups'] });
                  }}
                  className={cn('btn btn-sm mt-3', g.joined ? '' : 'btn-primary')}
                >
                  {g.joined ? 'Salir del grupo' : 'Unirme'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={groupModal} onClose={() => setGroupModal(false)} title="Nuevo grupo de estudio">
        <div className="space-y-3">
          <div>
            <label className="label">Nombre del grupo</label>
            <input value={groupForm.name} onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))} className="input" placeholder="Ej. Derecho Civil — Ciclo 6" maxLength={80} />
          </div>
          <div>
            <label className="label">Descripción</label>
            <textarea value={groupForm.description} onChange={(e) => setGroupForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="input resize-none" placeholder="Tema, objetivo o dinámica del grupo…" maxLength={500} />
          </div>
          <div>
            <label className="label">Visibilidad</label>
            <div className="grid grid-cols-2 gap-2">
              {(['private', 'public'] as const).map((v) => (
                <button key={v} onClick={() => setGroupForm((f) => ({ ...f, visibility: v }))} className={cn('rounded-xl border px-3 py-2 text-[12px]', groupForm.visibility === v ? 'border-fg/25 bg-fg/[.06] text-fg' : 'border-line text-fg/45')}>
                  {v === 'private' ? 'Privado' : 'Público'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => createGroup.mutate()} disabled={groupForm.name.trim().length < 3 || createGroup.isPending} className="btn btn-primary w-full">
            {createGroup.isPending ? 'Creando…' : 'Crear grupo'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
