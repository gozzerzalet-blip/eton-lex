import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, Bell, BookOpen, Clock3, FileText, MessageSquare, Newspaper,
  Scale, Send, Sparkles, Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/store';
import { Avatar, Badge, Skeleton } from '../components/ui';
import { formatDate, greeting, statusLabel, timeAgo, updateTypeLabel } from '../lib/utils';

type DashboardData = {
  user: { name: string; university?: string | null };
  stats: { aiConversations: number; savedNorms: number; friends: number; documents: number; unreadNotifications: number; unreadMessages: number };
  news: Array<{ id: string; title: string; summary?: string; source_name: string; scope: string; published_at?: string; fetched_at?: string; image_url?: string }>;
  updates: Array<{ id: string; type: string; title: string; summary?: string; published_at?: string; norm_title?: string; norm_slug?: string; article_number?: string }>;
  aiConversations: Array<{ id: string; title: string; mode: string; updated_at: string }>;
  conversations: Array<{ id: string; type: string; title?: string; other_name?: string; last_body?: string; last_message_at?: string }>;
  documents: Array<{ id: string; name: string; mime: string; size: number; created_at: string }>;
  activity: Array<{ id: string; title?: string; body?: string; kind: string; created_at: string; author_name: string; avatar_url?: string }>;
  alerts: Array<{ id: string; title: string; body?: string; link?: string; priority: string; created_at: string }>;
  followedNorms: Array<{ slug: string; title: string; number?: string; status: string }>;
  services: { ai: boolean; news: boolean };
};

const QUICK_ACTIONS = [
  'Explicar un artículo',
  'Analizar un caso',
  'Prepararme para un examen',
  'Resumen jurídico',
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard') });

  const goAsk = (text: string) => {
    if (!text.trim()) return;
    navigate(`/ai?q=${encodeURIComponent(text.trim())}`);
  };

  const modules = [
    { to: '/biblioteca', label: 'Biblioteca jurídica', hint: `${data?.stats.savedNorms ?? 0} normas guardadas`, icon: BookOpen },
    { to: '/noticias', label: 'Noticias', hint: `${data?.news.length ?? 0} titulares hoy`, icon: Newspaper },
    { to: '/actualizaciones', label: 'Actualizaciones', hint: `${data?.updates.length ?? 0} cambios verificados`, icon: Scale },
    { to: '/comunidad', label: 'Comunidad', hint: `${data?.stats.friends ?? 0} contactos`, icon: Users },
  ];

  return (
    <div className="space-y-7">
      {/* Bienvenida */}
      <header className="pt-1">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.26em] text-fg/35">
          {formatDate(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="mt-3 font-display text-[34px] leading-[1.04] tracking-[-0.02em] text-fg sm:text-[46px]">
          {greeting()}, {user?.name?.split(' ')[0] ?? 'estudiante'}
        </h1>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-fg/50">
          Tu plataforma jurídica inteligente. Todo el Derecho peruano, en un solo lugar.
        </p>
        <p className="mt-1.5 font-display text-[13.5px] italic text-fg/35">«El Derecho, siempre a tu alcance.»</p>
      </header>

      {/* Asistente */}
      <motion.section
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="card relative overflow-hidden p-5 sm:p-7"
      >
        <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,.95),transparent_65%)] dark:bg-[radial-gradient(circle,rgba(255,255,255,.06),transparent_65%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-fg text-paper shadow-[0_12px_26px_-18px_rgba(0,0,0,.8)]">
              <Sparkles size={17} />
            </span>
            <div>
              <p className="font-display text-[19px] leading-none text-fg">ETON AI</p>
              <p className="mt-1.5 text-[11.5px] text-fg/45">Asistente jurídico · Derecho peruano y consultas generales</p>
            </div>
          </div>
          <Badge tone={data?.services.ai ? 'success' : 'warn'}>{data?.services.ai ? 'Conectado' : 'Sin configurar'}</Badge>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); goAsk(prompt); }}
          className="glass-pill relative mt-6 flex items-center gap-2 p-1.5 pl-5 transition-colors focus-within:bg-white/95 dark:focus-within:bg-white/[.08]"
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Pregúntale a ETON AI sobre Derecho, leyes o cualquier tema…"
            className="min-w-0 flex-1 bg-transparent py-2 text-[14px] text-fg outline-none placeholder:text-fg/35"
          />
          <button type="submit" className="btn btn-primary !h-9 !w-9 !rounded-full !p-0" aria-label="Preguntar">
            <Send size={15} />
          </button>
        </form>

        <div className="relative mt-4 flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((s) => (
            <button key={s} onClick={() => goAsk(s)} className="chip !text-[11.5px]">
              {s}
            </button>
          ))}
        </div>

        {!data?.services.ai && (
          <p className="relative mt-4 rounded-xl border border-dashed border-fg/25 bg-white/40 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-fg/60 dark:bg-white/[.04]">
            ETON AI todavía no está conectada. Un administrador debe configurar el proveedor de IA en el servidor; la plataforma no genera respuestas simuladas.
          </p>
        )}
      </motion.section>

      {/* Módulos */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {modules.map((m) => (
          <Link key={m.to} to={m.to} className="card card-hover group flex flex-col gap-3.5 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line/80 bg-white/50 text-fg/60 transition-colors group-hover:text-fg dark:bg-white/[.05]">
              <m.icon size={16} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-[12.5px] font-medium text-fg">{m.label}</span>
              <span className="mt-1 block text-[10.5px] text-fg/40">{m.hint}</span>
            </span>
            <span className="mt-auto flex items-center gap-1 text-[10.5px] text-fg/35 transition-colors group-hover:text-fg/70">
              Ver todas <ArrowRight size={11} />
            </span>
          </Link>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          {/* Noticias */}
          <section className="card p-5 sm:p-6">
            <header className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-display text-[21px] leading-none text-fg">Últimas noticias</h2>
              <Link to="/noticias" className="inline-flex items-center gap-1 pb-0.5 text-[11px] text-fg/40 transition-colors hover:text-fg">
                Ver todas <ArrowRight size={11} />
              </Link>
            </header>
            {isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
            {!isLoading && (data?.news.length ?? 0) === 0 && (
              <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[12px] text-fg/40">
                Sin noticias todavía. Configura fuentes reales en <span className="font-medium text-fg/70">NEWS_FEEDS</span> o desde administración.
              </p>
            )}
            <div className="divide-y divide-line/70">
              {data?.news.slice(0, 4).map((n) => (
                <Link key={n.id} to={`/noticias/${n.id}`} className="group flex gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.16em] text-fg/35">
                      <span>{n.scope}</span><span className="h-0.5 w-0.5 rounded-full bg-fg/25" /><span>{n.source_name}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-fg/85 transition-colors group-hover:text-fg">{n.title}</p>
                    <p className="mt-1 text-[10px] text-fg/30">{timeAgo(n.published_at ?? n.fetched_at)}</p>
                  </div>
                  {n.image_url && <img src={n.image_url} alt="" className="h-14 w-20 shrink-0 rounded-lg border border-line/60 object-cover" loading="lazy" />}
                </Link>
              ))}
            </div>
          </section>

          {/* Actualizaciones */}
          <section className="card p-5 sm:p-6">
            <header className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-display text-[21px] leading-none text-fg">Actualizaciones legislativas</h2>
              <Link to="/actualizaciones" className="inline-flex items-center gap-1 pb-0.5 text-[11px] text-fg/40 transition-colors hover:text-fg">
                Ver todas <ArrowRight size={11} />
              </Link>
            </header>
            {(data?.updates.length ?? 0) === 0 && (
              <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[12px] text-fg/40">
                No hay modificaciones confirmadas. Las actualizaciones se publican solo tras verificarse en una fuente oficial.
              </p>
            )}
            <div className="space-y-2.5">
              {data?.updates.map((u) => (
                <div key={u.id} className="rounded-xl border border-line/80 bg-white/35 p-3.5 dark:bg-white/[.03]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">{updateTypeLabel[u.type] ?? u.type}</Badge>
                    {u.article_number && <Badge tone="neutral">Art. {u.article_number}</Badge>}
                    <span className="ml-auto text-[10px] text-fg/30">{formatDate(u.published_at)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[12.5px] text-fg/80">{u.title}</p>
                  {u.norm_slug && <Link to={`/biblioteca/${u.norm_slug}`} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-fg/55 underline decoration-fg/20 underline-offset-2 transition-colors hover:text-fg">{u.norm_title} <ArrowUpRight size={11} /></Link>}
                </div>
              ))}
            </div>
          </section>

          {/* Conversaciones */}
          <section className="card p-5 sm:p-6">
            <header className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-display text-[21px] leading-none text-fg">Conversaciones</h2>
              <Link to="/mensajes" className="inline-flex items-center gap-1 pb-0.5 text-[11px] text-fg/40 transition-colors hover:text-fg">Abrir <ArrowRight size={11} /></Link>
            </header>
            {(data?.conversations.length ?? 0) === 0 && <p className="py-4 text-center text-[11.5px] text-fg/35">Sin conversaciones aún.</p>}
            <div className="space-y-0.5">
              {data?.conversations.map((c) => (
                <Link key={c.id} to={`/mensajes/${c.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-fg/[.035]">
                  <Avatar name={c.other_name ?? c.title} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg/85">{c.other_name ?? c.title ?? 'Conversación'}</span>
                    <span className="block truncate text-[11px] text-fg/40">{c.last_body ?? 'Sin mensajes'}</span>
                  </span>
                  <span className="text-[9.5px] text-fg/30">{timeAgo(c.last_message_at)}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          {/* Actividad */}
          <section className="card p-5">
            <header className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-display text-[18px] leading-none text-fg">Actividades recientes</h2>
              <Link to="/comunidad" className="pb-0.5 text-[11px] text-fg/40 transition-colors hover:text-fg">Comunidad</Link>
            </header>
            {(data?.activity.length ?? 0) === 0 && (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[11.5px] text-fg/40">
                Aún no hay actividad. Agrega amigos para ver sus apuntes.
              </p>
            )}
            <div className="space-y-3.5">
              {data?.activity.slice(0, 4).map((a) => (
                <div key={a.id} className="flex gap-3">
                  <Avatar name={a.author_name} url={a.avatar_url} size={30} />
                  <div className="min-w-0">
                    <p className="text-[11.5px] leading-relaxed text-fg/65"><span className="font-medium text-fg">{a.author_name}</span> compartió {a.kind === 'question' ? 'una pregunta' : a.kind === 'document' ? 'un documento' : 'una nota'}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-fg/45">{a.title ?? a.body}</p>
                    <p className="mt-1 text-[9.5px] text-fg/30">{timeAgo(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Documentos */}
          <section className="card p-5">
            <header className="mb-3 flex items-end justify-between gap-3">
              <h2 className="font-display text-[18px] leading-none text-fg">Documentos guardados</h2>
              <Link to="/perfil" className="pb-0.5 text-[11px] text-fg/40 transition-colors hover:text-fg">Ver</Link>
            </header>
            {(data?.documents.length ?? 0) === 0 && <p className="py-4 text-center text-[11.5px] text-fg/35">Aún no has subido documentos.</p>}
            <div className="space-y-1">
              {data?.documents.slice(0, 4).map((d) => (
                <a key={d.id} href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-fg/[.035]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line/80 bg-white/45 text-fg/45 dark:bg-white/[.04]"><FileText size={13} /></span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg/75">{d.name}</span>
                  <span className="text-[9.5px] text-fg/30">{timeAgo(d.created_at)}</span>
                </a>
              ))}
            </div>
          </section>

          {/* Alertas */}
          <section className="card p-5">
            <header className="mb-3 flex items-center gap-2">
              <Bell size={13.5} className="text-fg/45" />
              <h2 className="font-display text-[18px] leading-none text-fg">Alertas importantes</h2>
            </header>
            {(data?.alerts.length ?? 0) === 0 && <p className="py-3 text-center text-[11.5px] text-fg/35">Sin alertas pendientes.</p>}
            <div className="space-y-2">
              {data?.alerts.map((a) => (
                <Link key={a.id} to={a.link ?? '/actualizaciones'} className="block rounded-xl border border-line/80 bg-white/35 px-3 py-2.5 transition-colors hover:bg-white/70 dark:bg-white/[.03] dark:hover:bg-white/[.06]">
                  <p className="text-[11.5px] font-medium text-fg/85">{a.title}</p>
                  {a.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-fg/40">{a.body}</p>}
                </Link>
              ))}
            </div>
          </section>

          {/* Normas seguidas */}
          <section className="card p-5">
            <header className="mb-3 flex items-center gap-2">
              <BookOpen size={13.5} className="text-fg/45" />
              <h2 className="font-display text-[18px] leading-none text-fg">Normas que sigues</h2>
            </header>
            {(data?.followedNorms.length ?? 0) === 0 && <p className="py-3 text-center text-[11.5px] text-fg/35">Sigue normas para recibir alertas.</p>}
            <div className="space-y-0.5">
              {data?.followedNorms.map((n) => (
                <Link key={n.slug} to={`/biblioteca/${n.slug}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-fg/[.035]">
                  <span className="h-1.5 w-1.5 rounded-full bg-fg/40" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg/75">{n.title}</span>
                  <span className="text-[9.5px] text-fg/35">{statusLabel[n.status] ?? n.status}</span>
                </Link>
              ))}
            </div>
          </section>

          <div className="flex items-center gap-2 px-1 text-[9.5px] text-fg/25">
            <Clock3 size={11} /> Resumen actualizado en tiempo real
          </div>
        </div>
      </div>
    </div>
  );
}
