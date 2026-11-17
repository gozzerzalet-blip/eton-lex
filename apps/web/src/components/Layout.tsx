import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell, BookMarked, ChevronRight, Command, Home, Library, LogOut, Menu, MessageSquare,
  Newspaper, Scale, Search, Settings, ShieldCheck, Sparkles, User, Users, Video, X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../lib/store';
import type { Notification } from '../lib/types';
import { cn, timeAgo } from '../lib/utils';
import { Logo } from './Logo';
import { Avatar, Badge, Modal, Spinner } from './ui';
import { toast } from 'sonner';

const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/ai', label: 'ETON AI', icon: Sparkles, accent: true },
  { to: '/biblioteca', label: 'Biblioteca jurídica', icon: Library },
  { to: '/noticias', label: 'Noticias', icon: Newspaper },
  { to: '/actualizaciones', label: 'Actualizaciones', icon: Scale },
];

const SOCIAL = [
  { to: '/comunidad', label: 'Comunidad', icon: Users },
  { to: '/mensajes', label: 'Mensajes', icon: MessageSquare },
  { to: '/salas', label: 'Salas', icon: Video },
];

const ACCOUNT = [
  { to: '/perfil', label: 'Mi perfil', icon: User },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

const MOBILE_NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/ai', label: 'ETON AI', icon: Sparkles },
  { to: '/biblioteca', label: 'Biblioteca', icon: Library },
  { to: '/mensajes', label: 'Mensajes', icon: MessageSquare },
  { to: '/salas', label: 'Salas', icon: Video },
];

type SearchResults = {
  norms: Array<{ slug: string; title: string; number?: string }>;
  articles: Array<{ id: string; number: string; heading?: string; slug: string; short_title?: string; snippet?: string }>;
  news: Array<{ id: string; title: string; source_name: string }>;
  users: Array<{ id: string; name: string; university?: string }>;
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Notification[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNotification = (n: Notification) => {
      toast(n.title, { description: n.body ?? undefined });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    const onMessage = () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    socket.on('notification:new', onNotification);
    socket.on('conversation:activity', onMessage);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('conversation:activity', onMessage);
    };
  }, [queryClient]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  const unread = notifData?.unread ?? 0;

  const links = useMemo(() => ({ NAV, SOCIAL, ACCOUNT }), []);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <Logo />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 no-scrollbar">
        <NavGroup items={links.NAV} />
        <div className="divider mx-3 my-2" />
        <NavGroup items={links.SOCIAL} />
        <NavGroup items={links.ACCOUNT} />
        {user?.role !== 'student' && (
          <>
            <div className="divider mx-3 my-2" />
            <NavGroup title="Administración" items={[{ to: '/admin', label: 'Validación y fuentes', icon: ShieldCheck }]} />
          </>
        )}
      </nav>

      <div className="border-t border-line/70 p-3">
        <button
          onClick={() => navigate('/perfil')}
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-fg/[.04]"
        >
          <Avatar name={user?.name} url={user?.avatarUrl} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg/90">{user?.name}</span>
            <span className="block truncate text-[11px] text-fg/35">{user?.university ?? 'Estudiante de Derecho'}</span>
          </span>
          <ChevronRight size={14} className="text-fg/25" />
        </button>
        <button onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-fg/35 hover:text-fg/70">
          <LogOut size={13} /> Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="sidebar-glass sticky top-0 hidden h-screen w-[264px] shrink-0 lg:block">
        {sidebar}
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              className="sidebar-glass fixed inset-y-0 left-0 z-50 w-[280px] shadow-lift lg:hidden"
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <button className="absolute right-3 top-5 rounded-lg p-2 text-fg/50" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={18} /></button>
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-bar sticky top-0 z-30 flex h-16 items-center gap-2 px-4 sm:px-6 lg:px-8">
          <button className="btn btn-ghost btn-sm -ml-1 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
            <Menu size={18} />
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="glass-pill group flex h-10 flex-1 items-center gap-2.5 px-4 text-left text-[13px] text-fg/45 transition-colors hover:text-fg/70 sm:max-w-md"
          >
            <Search size={15} className="text-fg/55 transition-colors group-hover:text-fg" />
            <span className="flex-1 truncate">Buscar en ETON LEX…</span>
            <span className="hidden items-center gap-0.5 rounded-md border border-line/80 bg-white/50 px-1.5 py-0.5 text-[10px] text-fg/40 sm:flex dark:bg-white/[.06]">
              <Command size={10} />K
            </span>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative flex h-9 w-9 items-center justify-center rounded-xl text-fg/55 transition-colors hover:bg-fg/[.05] hover:text-fg"
                aria-label="Notificaciones"
              >
                <Bell size={17} />
                {unread > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-fg ring-2 ring-paper" />}
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}
                    className="glass absolute right-0 top-11 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <span className="text-[13px] font-medium text-fg/85">Notificaciones</span>
                      {unread > 0 && (
                        <button
                          className="text-[11px] text-fg/40 hover:text-fg/80"
                          onClick={async () => {
                            await api('/notifications/read-all', { method: 'POST' });
                            queryClient.invalidateQueries({ queryKey: ['notifications'] });
                          }}
                        >
                          Marcar leídas
                        </button>
                      )}
                    </div>
                    <div className="max-h-[380px] overflow-y-auto">
                      {(notifData?.notifications ?? []).length === 0 && (
                        <p className="px-4 py-8 text-center text-xs text-fg/35">Sin notificaciones por ahora.</p>
                      )}
                      {(notifData?.notifications ?? []).slice(0, 12).map((n) => (
                        <button
                          key={n.id}
                          onClick={async () => {
                            await api(`/notifications/${n.id}/read`, { method: 'POST' });
                            queryClient.invalidateQueries({ queryKey: ['notifications'] });
                            setNotifOpen(false);
                            if (n.link) navigate(n.link);
                          }}
                          className={cn('flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-fg/[.03]', !n.read_at && 'bg-fg/[.02]')}
                        >
                          <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', n.read_at ? 'bg-fg/15' : 'bg-fg')} />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-fg/85">{n.title}</span>
                            {n.body && <span className="mt-0.5 block truncate text-[11px] text-fg/40">{n.body}</span>}
                            <span className="mt-1 block text-[10px] text-fg/25">{timeAgo(n.created_at)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={() => navigate('/perfil')} aria-label="Perfil">
              <Avatar name={user?.name} url={user?.avatarUrl} size={32} />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-6">
          <Outlet />
        </main>

        <footer className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 pb-24 text-[10px] text-fg/25 sm:px-6 lg:px-8 lg:pb-6">
          <span>ETON LEX · El Derecho, siempre a tu alcance</span>
          <span>Creado por Zalet Gozzer · Lima, Perú</span>
        </footer>

        {/* Navegación inferior (móvil) */}
        <nav className="glass-bar fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[9.5px] transition-colors', isActive ? 'text-fg' : 'text-fg/40')}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-7 w-9 items-center justify-center rounded-lg transition-colors', isActive && 'bg-fg/[.07]')}>
                    <item.icon size={18} strokeWidth={isActive ? 2.1 : 1.7} />
                  </span>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function NavGroup({ title, items }: { title?: string; items: Array<{ to: string; label: string; icon: any; end?: boolean; accent?: boolean }> }) {
  return (
    <div>
      {title && <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/25">{title}</p>}
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-all',
                isActive
                  ? 'bg-fg/[.06] font-medium text-fg shadow-[inset_0_0_0_1px_rgba(10,10,10,.045)] dark:bg-white/[.08] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]'
                  : 'text-fg/55 hover:bg-fg/[.035] hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={16} strokeWidth={isActive ? 2 : 1.7} className={cn('transition-colors', isActive ? 'text-fg' : 'text-fg/40 group-hover:text-fg/70')} />
                <span className="flex-1">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setResults(null);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api<SearchResults>(`/library/search?q=${encodeURIComponent(q)}`);
        setResults(data);
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  const go = (path: string) => { onClose(); navigate(path); };

  const total = results ? results.norms.length + results.articles.length + results.news.length + results.users.length : 0;

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl">
      <div className="-mt-2">
        <div className="flex items-center gap-3 border-b border-line pb-3">
          <Search size={18} className="text-fg/35" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca una norma, un artículo o una pregunta…"
            className="flex-1 bg-transparent text-[15px] text-fg/90 outline-none placeholder:text-fg/25"
          />
          {loading && <Spinner size={14} />}
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-fg/30">ESC</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto pt-3">
          {!q && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {[
                ['Preguntar a ETON AI', '/ai'],
                ['Explorar la biblioteca', '/biblioteca'],
                ['Últimas noticias jurídicas', '/noticias'],
                ['Actualizaciones legislativas', '/actualizaciones'],
                ['Salas de videoconferencia', '/salas'],
              ].map(([label, path]) => (
                <button key={path} onClick={() => go(path)} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left text-[12.5px] text-fg/60 hover:bg-fg/[.04] hover:text-fg">
                  {path === '/salas' ? <Video size={14} className="text-fg/30" /> : <Sparkles size={14} className="text-fg/30" />} {label}
                </button>
              ))}
            </div>
          )}

          {q && total === 0 && !loading && <p className="py-10 text-center text-sm text-fg/35">Sin resultados para «{q}».</p>}

          {results && total > 0 && (
            <div className="space-y-4 pb-2">
              {results.norms.length > 0 && (
                <ResultGroup title="Normas">
                  {results.norms.map((n) => (
                    <button key={n.slug} onClick={() => go(`/biblioteca/${n.slug}`)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fg/[.04]">
                      <Library size={14} className="text-fg/30" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg/80">{n.title}</span>
                      <span className="text-[10px] text-fg/25">{n.number}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}
              {results.articles.length > 0 && (
                <ResultGroup title="Artículos">
                  {results.articles.map((a) => (
                    <button key={a.id} onClick={() => go(`/biblioteca/${a.slug}?articulo=${a.number}`)} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fg/[.04]">
                      <BookMarked size={14} className="mt-0.5 text-fg/30" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-fg/80">{a.short_title} · Art. {a.number}</span>
                        {a.snippet && <span className="mt-0.5 block truncate text-[11px] text-fg/35" dangerouslySetInnerHTML={{ __html: a.snippet }} />}
                      </span>
                    </button>
                  ))}
                </ResultGroup>
              )}
              {results.news.length > 0 && (
                <ResultGroup title="Noticias">
                  {results.news.map((n) => (
                    <button key={n.id} onClick={() => go(`/noticias/${n.id}`)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fg/[.04]">
                      <Newspaper size={14} className="text-fg/30" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg/80">{n.title}</span>
                      <span className="text-[10px] text-fg/25">{n.source_name}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}
              {results.users.length > 0 && (
                <ResultGroup title="Estudiantes">
                  {results.users.map((u) => (
                    <button key={u.id} onClick={() => go(`/perfil/${u.id}`)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fg/[.04]">
                      <Avatar name={u.name} size={22} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg/80">{u.name}</span>
                      <span className="truncate text-[10px] text-fg/25">{u.university}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/25">{title}</p>
      {children}
    </div>
  );
}
