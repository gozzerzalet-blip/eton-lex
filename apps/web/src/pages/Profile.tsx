import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, CalendarDays, Camera, Check, ExternalLink, FileText, GraduationCap, MapPin, MessageSquare,
  Pencil, Plus, ShieldAlert, ShieldCheck, Sparkles, Trash2, UserMinus, UserPlus, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import type { Norm, User } from '../lib/types';
import { Avatar, Badge, EmptyState, SectionHeader, Skeleton } from '../components/ui';
import UniversityPicker, { type AcademicSelection } from '../components/UniversityPicker';
import { cn, formatBytes, formatDate, statusLabel, timeAgo } from '../lib/utils';

type Relation = { id: string; status: 'pending' | 'accepted' | 'blocked'; direction: 'incoming' | 'outgoing' } | null;

type ProfileResponse = {
  user: User;
  relation: Relation;
  groups: Array<{ id: string; name: string; description?: string | null; visibility: string }>;
  documents: Array<{ id: string; name: string; mime: string; size: number; created_at: string }>;
};

type DocumentItem = {
  id: string;
  name: string;
  mime: string;
  size: number;
  access?: string;
  ownerName?: string | null;
  visibility?: string;
  createdAt?: string;
  created_at?: string;
  hasText?: boolean;
};

type Stats = { aiConversations: number; savedNorms: number; friends: number; documents: number };

type PrivacyLevel = 'everyone' | 'friends' | 'private';
type LinkItem = { label: string; url: string };

type ProfileForm = {
  name: string;
  username: string;
  university: string;
  universityId: string;
  campusId: string;
  universityType: 'publica' | 'privada' | '';
  faculty: string;
  career: string;
  cycle: string;
  country: string;
  city: string;
  bio: string;
  coverUrl: string;
  links: LinkItem[];
  privacyFields: Record<string, PrivacyLevel>;
  missingUniversity: string;
};

const PRIVACY_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'university', label: 'Universidad' },
  { key: 'faculty', label: 'Facultad' },
  { key: 'career', label: 'Carrera' },
  { key: 'cycle', label: 'Ciclo' },
  { key: 'city', label: 'Ciudad' },
  { key: 'bio', label: 'Sobre mí' },
  { key: 'links', label: 'Enlaces' },
  { key: 'interests', label: 'Intereses' },
];

const PRIVACY_LEVELS: Array<{ value: PrivacyLevel; label: string }> = [
  { value: 'everyone', label: 'Todos' },
  { value: 'friends', label: 'Amigos' },
  { value: 'private', label: 'Solo yo' },
];

const DEFAULT_PRIVACY_FIELDS: Record<string, PrivacyLevel> = {
  university: 'everyone', faculty: 'everyone', career: 'everyone', cycle: 'everyone',
  city: 'everyone', bio: 'everyone', links: 'everyone', interests: 'everyone',
};

function makeForm(user?: User | null): ProfileForm {
  return {
    name: user?.name ?? '',
    username: user?.username ?? '',
    university: user?.university ?? '',
    universityId: user?.universityId ?? '',
    campusId: user?.campusId ?? '',
    universityType: user?.universityType ?? '',
    faculty: user?.faculty ?? '',
    career: user?.career ?? '',
    cycle: user?.cycle ?? '',
    country: user?.country ?? 'Perú',
    city: user?.city ?? '',
    bio: user?.bio ?? '',
    coverUrl: user?.coverUrl ?? '',
    links: (user?.links ?? []).map((link) => ({ label: link.label ?? '', url: link.url ?? '' })),
    privacyFields: { ...DEFAULT_PRIVACY_FIELDS, ...(user?.privacyFields ?? {}) },
    missingUniversity: '',
  };
}

const normalizeUsername = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function Profile() {
  const { id } = useParams();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profileId = id ?? user?.id;
  const isOwn = !id || id === user?.id;

  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [form, setForm] = useState<ProfileForm>(() => makeForm(user));

  const profileQuery = useQuery({
    queryKey: ['profile', profileId],
    queryFn: () => api<ProfileResponse>(`/users/${profileId}`),
    enabled: Boolean(profileId),
  });

  const statsQuery = useQuery({
    queryKey: ['profile-stats'],
    queryFn: () => api<{ stats: Stats }>('/users/me/stats'),
    enabled: isOwn,
  });

  const documentsQuery = useQuery({
    queryKey: ['documents'],
    queryFn: () => api<{ documents: DocumentItem[] }>('/documents'),
    enabled: isOwn,
  });

  const followsQuery = useQuery({
    queryKey: ['follows'],
    queryFn: () => api<{ norms: Norm[]; areas: string[] }>('/library/follows'),
    enabled: isOwn,
  });

  useEffect(() => {
    if (!user) return;
    setForm(makeForm(user));
  }, [user]);

  const profile = profileQuery.data?.user;
  const displayed = isOwn ? user ?? profile : profile;

  const save = useMutation({
    mutationFn: (payload: { username: string; links: LinkItem[] }) => api<{ user: User }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name: form.name.trim(),
        username: payload.username || undefined,
        university: form.university.trim() || null,
        universityId: form.universityId || null,
        campusId: form.campusId || null,
        universityType: form.universityType || null,
        faculty: form.faculty.trim() || null,
        career: form.career.trim() || null,
        coverUrl: normalizeUrl(form.coverUrl) || null,
        links: payload.links,
        country: form.country.trim() || 'Perú',
        city: form.city.trim() || null,
        cycle: form.cycle.trim() || null,
        bio: form.bio.trim() || null,
        privacyFields: form.privacyFields,
      }),
    }),
    onSuccess: (response) => {
      setUser(response.user);
      setEditing(false);
      toast.success('Perfil actualizado.');
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : 'No se pudo guardar el perfil.'),
  });

  const academic: AcademicSelection = {
    university: form.university,
    universityId: form.universityId,
    campusId: form.campusId,
    universityType: form.universityType,
    faculty: form.faculty,
    career: form.career,
    cycle: form.cycle,
    missingUniversity: form.missingUniversity,
  };

  const updateAcademic = (selection: AcademicSelection) => setForm((value) => ({ ...value, ...selection }));

  const updateLink = (index: number, key: keyof LinkItem, value: string) => {
    setForm((current) => ({
      ...current,
      links: current.links.map((link, linkIndex) => (linkIndex === index ? { ...link, [key]: value } : link)),
    }));
  };

  const updatePrivacy = (key: string, value: PrivacyLevel) => {
    setForm((current) => ({ ...current, privacyFields: { ...current.privacyFields, [key]: value } }));
  };

  const handleSave = () => {
    const username = normalizeUsername(form.username);
    if (username && username.length < 3) {
      toast.error('El nombre de usuario debe tener al menos 3 caracteres.');
      return;
    }
    const links = form.links
      .map((link) => ({
        label: (link.label.trim() || link.url.trim()).slice(0, 60),
        url: normalizeUrl(link.url).slice(0, 300),
      }))
      .filter((link) => link.url.length > 0);
    if (links.some((link) => !isValidHttpUrl(link.url))) {
      toast.error('Revisa los enlaces: cada URL debe ser válida, por ejemplo https://ejemplo.com.');
      return;
    }
    save.mutate({ username, links });
  };

  const requestFriend = useMutation({
    mutationFn: () => api('/community/friends/request', { method: 'POST', body: JSON.stringify({ userId: profileId }) }),
    onSuccess: () => {
      toast.success('Solicitud enviada.');
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : 'No se pudo enviar la solicitud.'),
  });

  const respondFriend = useMutation({
    mutationFn: (action: 'accept' | 'reject') => api(`/community/friends/${profileQuery.data?.relation?.id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
    onSuccess: () => {
      toast.success('Solicitud actualizada.');
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : 'No se pudo responder.'),
  });

  const removeFriend = useMutation({
    mutationFn: () => api(`/community/friends/${profileId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Amistad eliminada.');
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : 'No se pudo eliminar.'),
  });

  const startChat = async () => {
    try {
      const response = await api<{ conversation: { id: string } }>('/messaging/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [profileId] }),
      });
      navigate(`/mensajes/${response.conversation.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo abrir la conversación.');
    }
  };

  const uploadAvatar = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const body = new FormData();
      body.append('avatar', file);
      const response = await api<{ avatarUrl: string }>('/users/me/avatar', { method: 'POST', body });
      if (user) setUser({ ...user, avatarUrl: response.avatarUrl });
      toast.success('Foto de perfil actualizada.');
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo subir la imagen.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const uploadCover = async (file: File) => {
    setUploadingCover(true);
    try {
      const body = new FormData();
      body.append('cover', file);
      const response = await api<{ coverUrl: string }>('/users/me/cover', { method: 'POST', body });
      if (user) setUser({ ...user, coverUrl: response.coverUrl });
      setForm((value) => ({ ...value, coverUrl: response.coverUrl }));
      toast.success('Portada actualizada.');
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo subir la portada.');
    } finally {
      setUploadingCover(false);
    }
  };

  const uploadDocuments = async (files: FileList) => {
    setUploadingDocs(true);
    try {
      const body = new FormData();
      Array.from(files).forEach((file) => body.append('files', file));
      await api('/documents', { method: 'POST', body });
      toast.success('Documento subido. Ya puedes consultarlo con ETON AI.');
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo subir el documento.');
    } finally {
      setUploadingDocs(false);
    }
  };

  const deleteDocument = async (documentId: string) => {
    if (!window.confirm('¿Eliminar este documento del servidor?')) return;
    try {
      await api(`/documents/${documentId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] });
      toast.success('Documento eliminado.');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo eliminar.');
    }
  };

  const documents = useMemo<DocumentItem[]>(() => {
    if (isOwn) return documentsQuery.data?.documents ?? [];
    return (profileQuery.data?.documents ?? []).map((document) => ({ ...document, createdAt: document.created_at }));
  }, [documentsQuery.data, isOwn, profileQuery.data]);

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-full" />)}</div>
      </div>
    );
  }

  if (profileQuery.error || !displayed) {
    return (
      <EmptyState
        icon={<Users size={20} />}
        title="Perfil no disponible"
        description="El estudiante no existe o su perfil no es visible con la configuración de privacidad actual."
        action={<Link to="/comunidad" className="btn btn-sm">Volver a la comunidad</Link>}
      />
    );
  }

  const stats = statsQuery.data?.stats;
  const relation = profileQuery.data?.relation ?? null;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={isOwn ? 'Mi perfil' : 'Perfil de estudiante'}
        title={isOwn ? 'Tu identidad académica' : displayed.name}
        description={isOwn ? 'Tus datos académicos, documentos y normas seguidas. Puedes controlar qué comparte la comunidad desde Configuración.' : undefined}
        action={isOwn ? <Badge tone="gold"><ShieldCheck size={10} /> Cuenta verificada por correo pendiente</Badge> : undefined}
      />

      <header className="card relative overflow-hidden">
        <div className="relative h-28 overflow-hidden bg-[linear-gradient(118deg,#fafafa_0%,#ececef_46%,#f6f6f8_100%)] sm:h-32 dark:bg-[linear-gradient(118deg,rgba(255,255,255,.09),rgba(255,255,255,.03)_46%,rgba(255,255,255,.06))]">
          {displayed.coverUrl && (
            <img
              src={displayed.coverUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={(event) => { event.currentTarget.style.display = 'none'; }}
            />
          )}
          {isOwn && (
            <button
              type="button"
              onClick={() => coverRef.current?.click()}
              disabled={uploadingCover}
              className="absolute bottom-2 right-2 flex h-8 items-center gap-1.5 rounded-full bg-fg/85 px-2.5 text-[11px] font-medium text-paper shadow-lg backdrop-blur transition-opacity hover:opacity-85"
              aria-label="Cambiar portada"
            >
              <Camera size={14} className={uploadingCover ? 'animate-pulse' : ''} /> Portada
            </button>
          )}
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void uploadCover(file);
            }}
          />
        </div>
        <div className="relative px-5 pb-5 sm:px-7">
          <div className="-mt-12 flex flex-wrap items-end gap-4">
            <div className="relative">
              <Avatar name={displayed.name} url={displayed.avatarUrl} size={92} className="border-4 border-[var(--panel-solid)] shadow-lift" />
              {isOwn && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-fg text-paper shadow-lg transition-opacity hover:opacity-85"
                  aria-label="Cambiar foto"
                >
                  <Camera size={14} className={uploadingAvatar ? 'animate-pulse' : ''} />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadAvatar(file);
                }}
              />
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[26px] leading-tight text-fg/95">{displayed.name}</h1>
                <Badge tone={displayed.role === 'admin' ? 'gold' : displayed.role === 'moderator' ? 'info' : 'neutral'}>
                  {displayed.role === 'admin' ? 'Administrador' : displayed.role === 'moderator' ? 'Moderador' : 'Estudiante'}
                </Badge>
              </div>
              {(displayed.username || displayed.publicId) && (
                <p className="mt-1 text-[11px] text-fg/35">
                  {displayed.username && <span>@{displayed.username}</span>}
                  {displayed.username && displayed.publicId && <span className="mx-1.5 text-fg/15">·</span>}
                  {displayed.publicId && <span>ID {displayed.publicId}</span>}
                </p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg/40">
                {displayed.university && <span className="flex items-center gap-1"><GraduationCap size={12} /> {displayed.university}{displayed.universityType ? ` · ${displayed.universityType === 'publica' ? 'Pública' : 'Privada'}` : ''}</span>}
                {displayed.faculty && <span className="flex items-center gap-1"><BookOpen size={12} /> {displayed.faculty}</span>}
                {displayed.career && <span className="flex items-center gap-1"><GraduationCap size={12} /> {displayed.career}</span>}
                {displayed.cycle && <span>{displayed.cycle}</span>}
                {(displayed.city || displayed.country) && <span className="flex items-center gap-1"><MapPin size={12} /> {[displayed.city, displayed.country].filter(Boolean).join(', ')}</span>}
                {displayed.createdAt && <span className="flex items-center gap-1"><CalendarDays size={12} /> Desde {formatDate(displayed.createdAt)}</span>}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pb-1">
              {isOwn ? (
                <>
                  <button onClick={() => setEditing((value) => !value)} className="btn btn-sm"><Pencil size={13} /> {editing ? 'Cerrar edición' : 'Editar perfil'}</button>
                  <Link to="/configuracion" className="btn btn-sm">Configuración</Link>
                </>
              ) : (
                <>
                  {!relation && <button onClick={() => requestFriend.mutate()} disabled={requestFriend.isPending} className="btn btn-primary btn-sm"><UserPlus size={13} /> Agregar amigo</button>}
                  {relation?.status === 'pending' && relation.direction === 'outgoing' && <Badge>Solicitud enviada</Badge>}
                  {relation?.status === 'pending' && relation.direction === 'incoming' && (
                    <>
                      <button onClick={() => respondFriend.mutate('accept')} className="btn btn-primary btn-sm"><Check size={13} /> Aceptar</button>
                      <button onClick={() => respondFriend.mutate('reject')} className="btn btn-sm"><X size={13} /> Rechazar</button>
                    </>
                  )}
                  {relation?.status === 'accepted' && (
                    <>
                      <button onClick={startChat} className="btn btn-primary btn-sm"><MessageSquare size={13} /> Mensaje</button>
                      <button onClick={() => removeFriend.mutate()} className="btn btn-sm"><UserMinus size={13} /> Eliminar amistad</button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {displayed.bio && <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-fg/55">{displayed.bio}</p>}

          {displayed.links && displayed.links.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {displayed.links.map((link, index) => (
                <a
                  key={`${link.url}-${index}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-white/40 px-2.5 py-1 text-[11px] text-fg/60 transition-colors hover:text-fg dark:bg-white/[.04]"
                >
                  <ExternalLink size={11} /> {link.label || link.url}
                </a>
              ))}
            </div>
          )}

          {displayed.interests && displayed.interests.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {displayed.interests.map((interest) => <Badge key={interest} tone="info">{interest}</Badge>)}
            </div>
          )}
        </div>
      </header>

      {isOwn && editing && (
        <section className="card p-5">
          <h2 className="font-display text-lg text-fg/90">Editar perfil</h2>
          <p className="mt-1 text-[11px] text-fg/35">Identidad académica, enlaces y visibilidad de cada campo.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Nombre completo</label>
              <input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} className="input" maxLength={80} />
            </div>
            <div>
              <label className="label">Nombre de usuario</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-fg/30">@</span>
                <input
                  value={form.username}
                  onChange={(event) => setForm((value) => ({ ...value, username: normalizeUsername(event.target.value) }))}
                  className="input pl-9"
                  placeholder="tu.usuario"
                  maxLength={30}
                />
              </div>
              <p className="mt-1 text-[10px] text-fg/25">Mínimo 3 caracteres. Solo letras, números, punto, guion y guion bajo.</p>
            </div>
            <div className="sm:col-span-2">
              <UniversityPicker value={academic} onChange={updateAcademic} compact />
              {form.missingUniversity.trim() && (
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-dashed border-fg/25 bg-white/40 px-3 py-2 text-[11px] leading-relaxed text-fg/55 dark:bg-white/[.04]">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  Reportaste «{form.missingUniversity.trim()}». Tu universidad será revisada con fuente oficial; este reporte no se guarda en el perfil. Para mostrarla mientras tanto, escríbela en el buscador del catálogo.
                </p>
              )}
            </div>
            <div>
              <label className="label">Ciclo</label>
              <input value={form.cycle} onChange={(event) => setForm((value) => ({ ...value, cycle: event.target.value }))} className="input" placeholder="Ej. 6.º ciclo" maxLength={40} />
            </div>
            <div>
              <label className="label">Ciudad</label>
              <input value={form.city} onChange={(event) => setForm((value) => ({ ...value, city: event.target.value }))} className="input" placeholder="Ej. Lima" maxLength={80} />
            </div>
            <div>
              <label className="label">País</label>
              <input value={form.country} onChange={(event) => setForm((value) => ({ ...value, country: event.target.value }))} className="input" placeholder="Perú" maxLength={80} />
            </div>
            <div>
              <label className="label">Imagen de portada (URL)</label>
              <input value={form.coverUrl} onChange={(event) => setForm((value) => ({ ...value, coverUrl: event.target.value }))} className="input" placeholder="https://ejemplo.com/portada.jpg" maxLength={300} />
              <p className="mt-1 text-[10px] text-fg/25">También puedes subirla con el botón «Portada» en la parte superior de tu perfil.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Sobre mí</label>
              <textarea value={form.bio} onChange={(event) => setForm((value) => ({ ...value, bio: event.target.value }))} rows={3} className="input resize-none" maxLength={500} placeholder="Áreas de interés, logros académicos o lo que quieras compartir…" />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="label">Enlaces <span className="text-fg/25">(máximo 8)</span></label>
                <button
                  type="button"
                  onClick={() => setForm((value) => ({ ...value, links: [...value.links, { label: '', url: '' }] }))}
                  disabled={form.links.length >= 8}
                  className="btn btn-ghost btn-sm"
                >
                  <Plus size={13} /> Agregar enlace
                </button>
              </div>
              {form.links.length === 0 && <p className="text-[11px] text-fg/30">Aún no agregas enlaces. Puedes compartir tu LinkedIn, GitHub o portafolio.</p>}
              <div className="mt-2 space-y-2">
                {form.links.map((link, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1.6fr_auto]">
                    <input
                      value={link.label}
                      onChange={(event) => updateLink(index, 'label', event.target.value)}
                      className="input"
                      placeholder="Etiqueta (ej. LinkedIn)"
                      maxLength={60}
                    />
                    <input
                      value={link.url}
                      onChange={(event) => updateLink(index, 'url', event.target.value)}
                      className="input"
                      placeholder="https://ejemplo.com"
                      maxLength={300}
                    />
                    <button
                      type="button"
                      onClick={() => setForm((value) => ({ ...value, links: value.links.filter((_, linkIndex) => linkIndex !== index) }))}
                      className="btn btn-ghost btn-sm"
                      aria-label="Quitar enlace"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Privacidad por campo</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PRIVACY_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                    <span className="text-[12px] text-fg/60">{field.label}</span>
                    <select
                      value={form.privacyFields[field.key] ?? 'everyone'}
                      onChange={(event) => updatePrivacy(field.key, event.target.value as PrivacyLevel)}
                      className="input w-32 !py-1.5 !text-[11px]"
                    >
                      {PRIVACY_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Correo electrónico</label>
              <input value={displayed.email ?? ''} readOnly className="input opacity-50" />
              <p className="mt-1 text-[10px] text-fg/25">El correo identifica tu cuenta y no se puede cambiar desde aquí.</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn btn-sm">Cancelar</button>
            <button onClick={handleSave} disabled={save.isPending || form.name.trim().length < 2} className="btn btn-primary btn-sm">
              {save.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </section>
      )}

      {isOwn && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Consultas a ETON AI', value: stats?.aiConversations ?? 0, icon: Sparkles, to: '/ai' },
            { label: 'Normas guardadas', value: stats?.savedNorms ?? 0, icon: BookOpen, to: '/biblioteca' },
            { label: 'Amigos', value: stats?.friends ?? 0, icon: Users, to: '/comunidad' },
            { label: 'Documentos', value: stats?.documents ?? 0, icon: FileText, to: '/perfil' },
          ].map((item) => (
            <Link key={item.label} to={item.to} className="card card-hover p-4">
              <item.icon size={16} className="text-fg/30" />
              <p className="mt-3 font-display text-[24px] text-fg/90">{statsQuery.isLoading ? <Skeleton className="h-6 w-8" /> : item.value}</p>
              <p className="mt-0.5 text-[10.5px] text-fg/35">{item.label}</p>
            </Link>
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><FileText size={16} className="text-fg/40" /> Documentos</h2>
              <p className="mt-0.5 text-[11px] text-fg/30">{isOwn ? 'Tus archivos se guardan con acceso controlado en el servidor.' : 'Documentos que este estudiante decidió compartir.'}</p>
            </div>
            {isOwn && (
              <>
                <button onClick={() => docRef.current?.click()} disabled={uploadingDocs} className="btn btn-sm"><Plus size={13} /> Subir</button>
                <input
                  ref={docRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files;
                    event.target.value = '';
                    if (files && files.length) void uploadDocuments(files);
                  }}
                />
              </>
            )}
          </header>

          {isOwn && documentsQuery.isLoading && <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}

          {!isOwn && documents.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-fg/30">Este estudiante no ha compartido documentos.</p>}

          {documents.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {documents.map((document) => (
                <div key={document.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                  <FileText size={15} className="shrink-0 text-fg/25" />
                  <div className="min-w-0 flex-1">
                    <a href={`/api/files/${document.id}`} target="_blank" rel="noreferrer" className="block truncate text-[12.5px] text-fg/80 hover:underline">{document.name}</a>
                    <p className="text-[10px] text-fg/30">
                      {formatBytes(document.size)}
                      {document.createdAt || document.created_at ? ` · ${timeAgo(document.createdAt ?? document.created_at)}` : ''}
                      {document.hasText ? ' · texto extraído' : ''}
                    </p>
                  </div>
                  {document.access === 'shared' && <Badge>Compartido</Badge>}
                  {isOwn && document.access !== 'shared' && (
                    <button onClick={() => deleteDocument(document.id)} className="p-1.5 text-fg/20 hover:text-bad" aria-label="Eliminar documento"><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwn && !documentsQuery.isLoading && documents.length === 0 && (
            <div className="mt-4">
              <EmptyState icon={<FileText size={18} />} title="Sin documentos" description="Sube apuntes, demandas o resoluciones en PDF, Word o imagen para analizarlos con ETON AI." action={<button onClick={() => docRef.current?.click()} className="btn btn-sm"><Plus size={13} /> Subir el primero</button>} />
            </div>
          )}
        </section>

        <div className="space-y-5">
          {isOwn && (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><BookOpen size={16} className="text-fg/40" /> Normas que sigues</h2>
              {followsQuery.isLoading && <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
              {(followsQuery.data?.norms.length ?? 0) === 0 && !followsQuery.isLoading && (
                <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[11.5px] text-fg/30">
                  Aún no sigues ninguna norma. Síguelas desde la biblioteca para recibir alertas de cambios.
                </p>
              )}
              <div className="mt-3 space-y-1">
                {followsQuery.data?.norms.map((norm) => (
                  <Link key={norm.id} to={`/biblioteca/${norm.slug}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-fg/[.03]">
                    <span className={cn('h-1.5 w-1.5 rounded-full', norm.status === 'vigente' ? 'bg-fg/70' : 'bg-fg/25')} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg/70">{norm.title}</span>
                    <span className="text-[9.5px] text-fg/25">{statusLabel[norm.status] ?? norm.status}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Users size={16} className="text-fg/40" /> Grupos de estudio</h2>
            {(profileQuery.data?.groups.length ?? 0) === 0 && <p className="mt-3 text-[11.5px] text-fg/30">{isOwn ? 'No perteneces a ningún grupo todavía.' : 'No comparte grupos públicos.'}</p>}
            <div className="mt-3 space-y-1.5">
              {profileQuery.data?.groups.map((group) => (
                <Link key={group.id} to="/comunidad" className="block rounded-xl border border-line px-3 py-2 hover:bg-fg/[.03]">
                  <p className="text-[12px] text-fg/80">{group.name}</p>
                  {group.description && <p className="mt-0.5 line-clamp-1 text-[10.5px] text-fg/30">{group.description}</p>}
                </Link>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-lg text-fg/90">Privacidad</h2>
            <p className="mt-2 text-[11.5px] leading-relaxed text-fg/35">
              {isOwn
                ? 'Controla quién puede ver tu perfil y tu actividad desde Configuración → Privacidad.'
                : 'La visibilidad de este perfil depende de los ajustes de privacidad del estudiante.'}
            </p>
            {isOwn && <Link to="/configuracion" className="btn btn-sm mt-3">Abrir configuración</Link>}
          </section>
        </div>
      </div>
    </div>
  );
}
