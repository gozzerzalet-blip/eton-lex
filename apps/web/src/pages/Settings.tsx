import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Bell, Check, Database, KeyRound, Laptop, LogOut, Mail, MessageCircle, Moon, Palette,
  ShieldCheck, Smartphone, Sparkles, Sun, Users, Video, Newspaper,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import type { User } from '../lib/types';
import { Badge, SectionHeader, Skeleton } from '../components/ui';
import { BubbleColorPicker } from '../components/BubbleColorPicker';
import { useBubbleColors } from '../lib/bubbleColors';
import { cn, formatDate } from '../lib/utils';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Area = { slug: string; name: string; description: string; norms: number };
type Session = { id: string; user_agent?: string | null; ip?: string | null; created_at: string; expires_at: string };
type Capabilities = {
  ai: { configured: boolean; provider: string; model?: string | null; embeddings: boolean; note?: string | null };
  news: { configured: boolean; feeds: number; newsApi: boolean };
  email: { configured: boolean; note?: string | null };
  webrtc: { stun: string[]; turn: boolean; note?: string | null };
  storage: { maxUploadMb: number };
  demoMode: boolean;
};

const PRIVACY_PROFILE = [
  { value: 'community', label: 'Comunidad', description: 'Cualquier estudiante autenticado puede ver tu perfil.' },
  { value: 'friends', label: 'Solo amigos', description: 'Solo tus amigos aceptados ven tu perfil.' },
  { value: 'private', label: 'Privado', description: 'Nadie más ve tu perfil.' },
] as const;

const PRIVACY_ACTIVITY = [
  { value: 'friends', label: 'Amigos', description: 'Tus amigos ven tus publicaciones.' },
  { value: 'private', label: 'Privado', description: 'Solo tú ves tu actividad.' },
] as const;

export default function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bubbleColors = useBubbleColors();

  const [theme, setTheme] = useState<'dark' | 'light'>((user?.theme as 'dark' | 'light') ?? 'dark');
  const [selectedAreas, setSelectedAreas] = useState<string[]>(user?.interests ?? []);
  const [privacy, setPrivacy] = useState({
    profile: user?.privacy?.profile ?? 'community',
    activity: user?.privacy?.activity ?? 'friends',
  });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [savingAreas, setSavingAreas] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallPrompt(null);
  };

  const areasQuery = useQuery({ queryKey: ['areas'], queryFn: () => api<{ areas: Area[] }>('/library/areas') });
  const sessionsQuery = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ sessions: Session[] }>('/auth/sessions') });
  const capabilitiesQuery = useQuery({ queryKey: ['capabilities'], queryFn: () => api<Capabilities>('/system/capabilities') });

  useEffect(() => {
    if (user?.theme) setTheme(user.theme);
    if (user?.interests) setSelectedAreas(user.interests);
    if (user?.privacy) {
      setPrivacy({
        profile: user.privacy.profile ?? 'community',
        activity: user.privacy.activity ?? 'friends',
      });
    }
  }, [user]);

  const capabilities = capabilitiesQuery.data;

  const applyTheme = async (next: 'dark' | 'light') => {
    setTheme(next);
    localStorage.setItem('eton-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      const response = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify({ theme: next }) });
      setUser(response.user);
    } catch {
      toast.error('El tema se aplicó en este dispositivo, pero no se pudo guardar en tu cuenta.');
    }
  };

  const saveAreas = async () => {
    setSavingAreas(true);
    try {
      const response = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify({ interests: selectedAreas }) });
      setUser(response.user);
      toast.success('Materias de interés actualizadas. Tu feed de actualizaciones cambiará.');
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['updates-mine'] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudieron guardar tus intereses.');
    } finally {
      setSavingAreas(false);
    }
  };

  const savePrivacy = async () => {
    setSavingPrivacy(true);
    try {
      const response = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify({ privacy }) });
      setUser(response.user);
      toast.success('Preferencias de privacidad guardadas.');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo guardar la privacidad.');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const changePassword = async () => {
    if (passwords.next.length < 8) { toast.error('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
    if (passwords.next !== passwords.confirm) { toast.error('Las contraseñas nuevas no coinciden.'); return; }
    setChangingPassword(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current: passwords.current, next: passwords.next }),
      });
      setPasswords({ current: '', next: '', confirm: '' });
      toast.success('Contraseña actualizada. Inicia sesión nuevamente.');
      logout();
      navigate('/login');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setChangingPassword(false);
    }
  };

  const closeAllSessions = async () => {
    if (!window.confirm('Se cerrarán todas tus sesiones, incluida esta. ¿Continuar?')) return;
    try {
      await api('/auth/logout-all', { method: 'POST' });
      toast.success('Todas las sesiones fueron cerradas.');
      logout();
      navigate('/login');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudieron cerrar las sesiones.');
    }
  };

  const toggleArea = (slug: string) => {
    setSelectedAreas((current) => current.includes(slug) ? current.filter((area) => area !== slug) : [...current, slug]);
  };

  const services = useMemo(() => capabilities ? [
    {
      label: 'ETON AI',
      icon: Sparkles,
      ok: capabilities.ai.configured,
      detail: capabilities.ai.configured
        ? `Proveedor ${capabilities.ai.provider}${capabilities.ai.model ? ` · ${capabilities.ai.model}` : ''}${capabilities.ai.embeddings ? ' · embeddings activos' : ' · búsqueda léxica FTS5'}`
        : 'Sin proveedor configurado. ETON AI responde 503 y no genera contenido simulado.',
    },
    {
      label: 'ETON NEWS',
      icon: Newspaper,
      ok: capabilities.news.configured,
      detail: capabilities.news.configured
        ? `${capabilities.news.feeds} fuente(s) RSS${capabilities.news.newsApi ? ' + NewsAPI' : ''} configuradas.`
        : 'Sin fuentes configuradas. No se inventan noticias.',
    },
    {
      label: 'Correo transaccional',
      icon: Mail,
      ok: capabilities.email.configured,
      detail: capabilities.email.configured
        ? 'SMTP configurado para verificación y recuperación.'
        : 'Sin SMTP. La verificación de correo y la recuperación de contraseña aún no están activas.',
    },
    {
      label: 'Llamadas WebRTC',
      icon: Video,
      ok: capabilities.webrtc.turn,
      detail: capabilities.webrtc.turn
        ? 'STUN + TURN configurados para redes restrictivas.'
        : 'STUN configurado, sin TURN. Algunas redes NAT estrictas pueden impedir la llamada.',
    },
    {
      label: 'Almacenamiento',
      icon: Database,
      ok: true,
      detail: `Archivos privados en disco, servidos con control de acceso. Límite: ${capabilities.storage.maxUploadMb} MB por archivo.`,
    },
  ] : [], [capabilities]);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Configuración"
        title="Tu cuenta, tus reglas"
        description="Preferencias de apariencia, materias, privacidad y seguridad. Los estados de servicio reflejan la configuración real del servidor, sin simulaciones."
        action={<Badge tone="gold"><ShieldCheck size={10} /> Privacidad por diseño</Badge>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.35fr]">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Palette size={16} className="text-fg/40" /> Apariencia</h2>
            <p className="mt-1 text-[11.5px] text-fg/35">El tema se guarda en tu cuenta y se aplica al iniciar sesión en cualquier dispositivo.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                ['light', 'Claro', Sun],
                ['dark', 'Oscuro', Moon],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  onClick={() => void applyTheme(value)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-3 text-[12px] transition-colors',
                    theme === value ? 'border-fg/25 bg-fg/[.06] font-medium text-fg' : 'border-line text-fg/50 hover:bg-fg/[.03]',
                  )}
                >
                  <Icon size={15} /> {label}
                  {theme === value && <Check size={13} className="ml-auto text-ok" />}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-fg/30">
              El tema se aplica de inmediato y se guarda en tu cuenta. Ambos modos comparten la misma paleta de marca.
            </p>
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Smartphone size={16} className="text-fg/40" /> Instalar en tu celular</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fg/35">
              Gratis y sin Play Store ni App Store: ETON LEX funciona como aplicación instalable desde el navegador en Android, iPhone y computadoras.
            </p>
            {installed ? (
              <p className="mt-3 text-[11.5px] font-medium text-ok">Listo: ETON LEX ya está en tu pantalla de inicio.</p>
            ) : isIos ? (
              <p className="mt-3 text-[11.5px] text-fg/60">En Safari, toca <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.</p>
            ) : installPrompt ? (
              <button onClick={() => void installApp()} className="btn btn-sm mt-3"><Smartphone size={13} /> Instalar ETON LEX</button>
            ) : (
              <p className="mt-3 text-[11.5px] text-fg/60">En Chrome, abre el menú <strong>⋮</strong> y elige <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla de inicio</strong>.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><MessageCircle size={16} className="text-fg/40" /> Colores de mensajería</h2>
            <p className="mt-1 text-[11.5px] text-fg/35">Personaliza tus burbujas y las de tus contactos con una vista previa antes de aplicarlas.</p>
            <div className="mt-3">
              <BubbleColorPicker
                value={bubbleColors.colors}
                onChange={(next) => void bubbleColors.update(next)}
                onReset={() => void bubbleColors.reset()}
                saving={bubbleColors.saving}
              />
            </div>
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Users size={16} className="text-fg/40" /> Privacidad</h2>
            <p className="mt-1 text-[11.5px] text-fg/35">Define quién puede ver tu perfil y tu actividad en la comunidad.</p>

            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/30">Perfil</p>
            <div className="mt-1.5 space-y-1.5">
              {PRIVACY_PROFILE.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setPrivacy((current) => ({ ...current, profile: option.value }))}
                  className={cn('w-full rounded-xl border px-3 py-2 text-left transition-colors', privacy.profile === option.value ? 'border-fg/20 bg-fg/[.05]' : 'border-line hover:bg-fg/[.03]')}
                >
                  <span className="flex items-center gap-2 text-[12px] text-fg/80">
                    <span className={cn('h-1.5 w-1.5 rounded-full', privacy.profile === option.value ? 'bg-danger' : 'bg-fg/20')} />
                    {option.label}
                  </span>
                  <span className="mt-0.5 block pl-3.5 text-[10.5px] text-fg/30">{option.description}</span>
                </button>
              ))}
            </div>

            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/30">Actividad</p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {PRIVACY_ACTIVITY.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setPrivacy((current) => ({ ...current, activity: option.value }))}
                  className={cn('rounded-xl border px-3 py-2 text-left transition-colors', privacy.activity === option.value ? 'border-fg/20 bg-fg/[.05]' : 'border-line hover:bg-fg/[.03]')}
                >
                  <span className="text-[12px] text-fg/80">{option.label}</span>
                  <span className="mt-0.5 block text-[10.5px] text-fg/30">{option.description}</span>
                </button>
              ))}
            </div>

            <button onClick={savePrivacy} disabled={savingPrivacy} className="btn btn-primary btn-sm mt-4 w-full">
              {savingPrivacy ? 'Guardando…' : 'Guardar privacidad'}
            </button>
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Bell size={16} className="text-fg/40" /> Notificaciones</h2>
            <div className="mt-3 space-y-2 text-[11.5px] text-fg/45">
              <p className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok/70" /> Notificaciones dentro de la app: activas y en tiempo real mediante Socket.IO.</p>
              <p className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn/70" /> Notificaciones por correo: dependen de SMTP. {capabilities?.email.configured ? 'Configurado en este servidor.' : 'No configurado todavía.'}</p>
              <p className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn/70" /> Notificaciones push móviles: requieren la app nativa y credenciales de plataforma. Aún no habilitadas.</p>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Sparkles size={16} className="text-fg/40" /> Materias de interés</h2>
            <p className="mt-1 text-[11.5px] text-fg/35">Personaliza ETON NEWS, las actualizaciones legislativas y las sugerencias de ETON AI.</p>
            {areasQuery.isLoading && <div className="mt-4 grid gap-2 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {areasQuery.data?.areas.map((area) => {
                const active = selectedAreas.includes(area.slug);
                return (
                  <button
                    key={area.slug}
                    onClick={() => toggleArea(area.slug)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[11.5px] transition-colors',
                      active ? 'border-fg/25 bg-fg/[.06] text-fg' : 'border-line text-fg/45 hover:border-fg/20 hover:text-fg/70',
                    )}
                  >
                    {active && <Check size={11} className="mr-1 inline" />}
                    {area.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[10px] text-fg/25">{selectedAreas.length} materia(s) seleccionada(s)</p>
              <button onClick={saveAreas} disabled={savingAreas} className="btn btn-primary btn-sm">
                {savingAreas ? 'Guardando…' : 'Guardar intereses'}
              </button>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><KeyRound size={16} className="text-fg/40" /> Seguridad</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Contraseña actual</label>
                <input type="password" value={passwords.current} onChange={(event) => setPasswords((value) => ({ ...value, current: event.target.value }))} className="input" autoComplete="current-password" />
              </div>
              <div>
                <label className="label">Nueva contraseña</label>
                <input type="password" value={passwords.next} onChange={(event) => setPasswords((value) => ({ ...value, next: event.target.value }))} className="input" autoComplete="new-password" />
              </div>
              <div>
                <label className="label">Confirmar contraseña</label>
                <input type="password" value={passwords.confirm} onChange={(event) => setPasswords((value) => ({ ...value, confirm: event.target.value }))} className="input" autoComplete="new-password" />
              </div>
            </div>
            <button onClick={changePassword} disabled={changingPassword || !passwords.current || !passwords.next} className="btn btn-primary btn-sm mt-3">
              {changingPassword ? 'Actualizando…' : 'Cambiar contraseña'}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-fg/25">Al cambiar la contraseña se revocan todas las sesiones activas. Deberás iniciar sesión de nuevo.</p>

            <div className="my-4 divider" />

            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-[12.5px] text-fg/80"><Laptop size={14} className="text-fg/35" /> Sesiones activas</p>
                <p className="mt-0.5 text-[10.5px] text-fg/30">Dispositivos con acceso a tu cuenta.</p>
              </div>
              <button onClick={closeAllSessions} className="btn btn-sm">Cerrar todas</button>
            </div>
            {sessionsQuery.isLoading && <Skeleton className="mt-3 h-16 w-full" />}
            <div className="mt-2 space-y-1.5">
              {sessionsQuery.data?.sessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-line px-3 py-2">
                  <p className="truncate text-[11px] text-fg/65">{session.user_agent || 'Dispositivo no identificado'}</p>
                  <p className="text-[10px] text-fg/25">{session.ip ?? 'IP no registrada'} · desde {formatDate(session.created_at)}</p>
                </div>
              ))}
              {(sessionsQuery.data?.sessions.length ?? 0) === 0 && !sessionsQuery.isLoading && <p className="text-[11px] text-fg/30">No hay otras sesiones activas.</p>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-lg text-fg/90">Estado real de los servicios</h2>
            <p className="mt-1 text-[11.5px] text-fg/35">Esta información viene de <code className="rounded bg-fg/[.05] px-1 py-0.5 text-[10px]">/api/system/capabilities</code>. No se simula ninguna conexión.</p>
            {capabilitiesQuery.isLoading && <div className="mt-3 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
            <div className="mt-3 space-y-2">
              {services.map((service) => (
                <div key={service.label} className="rounded-xl border border-line px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <service.icon size={14} className="text-fg/35" />
                    <span className="text-[12px] font-medium text-fg/80">{service.label}</span>
                    <Badge tone={service.ok ? 'success' : 'warn'} className="ml-auto">{service.ok ? 'Activo' : 'Pendiente'}</Badge>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-fg/35">{service.detail}</p>
                </div>
              ))}
            </div>
            {capabilities?.demoMode && (
              <p className="mt-3 rounded-xl border border-warn/20 bg-warn/[.06] px-3 py-2 text-[10.5px] text-warn/70">
                DEMO_MODE está activo en el servidor. Revisa qué datos son de demostración antes de usar la plataforma en producción.
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-display text-lg text-fg/90">Cuenta</h2>
            <p className="mt-1 text-[11.5px] text-fg/35">{user?.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => { logout(); navigate('/login'); }} className="btn btn-sm"><LogOut size={13} /> Cerrar sesión</button>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-fg/25">
              La eliminación definitiva de la cuenta y la exportación de datos aún no están implementadas. Para solicitudes de privacidad, contacta al administrador de la plataforma.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
