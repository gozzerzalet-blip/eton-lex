import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, ChevronLeft, ChevronRight, Filter, Library as LibraryIcon, Search, ShieldAlert,
  ShieldCheck, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Norm } from '../lib/types';
import { Badge, EmptyState, SectionHeader, Skeleton } from '../components/ui';
import { cn, statusLabel, typeLabel } from '../lib/utils';

type AreasResponse = { areas: Array<{ slug: string; name: string; description: string; norms: number }> };
type NormsResponse = { norms: Norm[]; total: number; page: number; pages: number; pageSize: number };
type ArticleHit = {
  id: string;
  number: string;
  heading?: string | null;
  slug: string;
  short_title?: string | null;
  norm_title?: string | null;
  status?: string | null;
  snippet?: string | null;
};
type SearchResponse = { articles: ArticleHit[] };

const STATUSES = ['', 'vigente', 'modificado', 'parcialmente_derogado', 'derogado', 'por_verificar'];
const TYPES = ['', 'constitucion', 'codigo', 'ley', 'decreto_legislativo', 'decreto_supremo', 'reglamento', 'resolucion', 'tratado'];

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'vigente') return 'success';
  if (status === 'modificado') return 'warn';
  if (status === 'derogado' || status === 'parcialmente_derogado') return 'danger';
  return 'neutral';
}

export default function LibraryPage() {
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (area) p.set('area', area);
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    p.set('page', String(page));
    return p.toString();
  }, [q, area, type, status, page]);

  const { data: areasData } = useQuery({ queryKey: ['areas'], queryFn: () => api<AreasResponse>('/library/areas') });
  const { data, isLoading } = useQuery({
    queryKey: ['library', params],
    queryFn: () => api<NormsResponse>(`/library?${params}`),
  });
  const trimmedQuery = q.trim();
  const { data: searchData, isFetching: searchingArticles } = useQuery({
    queryKey: ['library-search', trimmedQuery],
    queryFn: () => api<SearchResponse>(`/library/search?q=${encodeURIComponent(trimmedQuery)}`),
    enabled: trimmedQuery.length >= 2,
  });
  const articleHits = searchData?.articles ?? [];

  const reset = () => { setQ(''); setArea(''); setType(''); setStatus(''); setPage(1); };
  const change = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Biblioteca jurídica"
        title="Legislación peruana, artículo por artículo"
        description="Catálogo normativo con estado de vigencia, historial de modificaciones y enlaces a fuentes oficiales. Las normas sin texto sincronizado se marcan como pendientes de verificación."
        action={<Badge tone="gold"><ShieldCheck size={10} /> Veracidad primero</Badge>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <div className="card p-4">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/25" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Norma, número o palabra clave…"
                className="input pl-10"
              />
            </div>
            <button onClick={() => setShowFilters((v) => !v)} className="btn btn-ghost btn-sm mt-2 w-full justify-between lg:hidden">
              <span className="flex items-center gap-1.5"><Filter size={13} /> Filtros</span>
              <span className="text-fg/30">{area || type || status ? 'activos' : ''}</span>
            </button>
          </div>

          <div className={cn('card p-4', !showFilters && 'hidden lg:block')}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Materia</p>
            <div className="space-y-0.5">
              <button
                onClick={() => change(setArea)('')}
                className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px]', !area ? 'bg-fg/[.06] text-fg/90' : 'text-fg/50 hover:bg-fg/[.03] hover:text-fg/80')}
              >
                Todas las materias
              </button>
              {areasData?.areas.map((a) => (
                <button
                  key={a.slug}
                  onClick={() => change(setArea)(a.slug)}
                  className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px]', area === a.slug ? 'bg-fg/[.06] text-fg/90' : 'text-fg/50 hover:bg-fg/[.03] hover:text-fg/80')}
                >
                  <span className="truncate">{a.name}</span>
                  <span className="ml-2 text-[10px] text-fg/25">{a.norms}</span>
                </button>
              ))}
            </div>

            <div className="my-3 divider" />

            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Tipo de norma</p>
            <select value={type} onChange={(e) => change(setType)(e.target.value)} className="input !py-2 !text-[12px]">
              <option value="">Todos los tipos</option>
              {TYPES.filter(Boolean).map((t) => <option key={t} value={t}>{typeLabel[t] ?? t}</option>)}
            </select>

            <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Estado</p>
            <select value={status} onChange={(e) => change(setStatus)(e.target.value)} className="input !py-2 !text-[12px]">
              {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s ? statusLabel[s] : 'Todos los estados'}</option>)}
            </select>

            <button onClick={reset} className="btn btn-ghost btn-sm mt-3 w-full">Limpiar filtros</button>
          </div>

          <div className="card p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-fg/60"><ShieldAlert size={13} className="text-warn/70" /> Sobre la verificación</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg/35">
              El catálogo incluye metadatos de normas reales. Cuando el texto articulado no se ha cargado desde una fuente oficial, se muestra el aviso «texto pendiente» en lugar de contenido inventado.
            </p>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-fg/35">
              {isLoading
                ? 'Buscando…'
                : `${data?.total ?? 0} norma${(data?.total ?? 0) === 1 ? '' : 's'} encontrada${(data?.total ?? 0) === 1 ? '' : 's'}${articleHits.length > 0 ? ` · ${articleHits.length} artículo${articleHits.length === 1 ? '' : 's'}` : ''}`}
            </p>
            <Link to="/ai" className="chip !text-[11px]"><Sparkles size={12} /> Preguntar a ETON AI</Link>
          </div>

          {isLoading && (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
            </div>
          )}

          {!isLoading && (data?.norms.length ?? 0) === 0 && articleHits.length > 0 && (
            <div className="card mb-3 p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">
                <BookOpen size={12} /> Artículos que coinciden
              </p>
              <div className="mt-3 space-y-1.5">
                {articleHits.map((a) => (
                  <Link
                    key={a.id}
                    to={`/biblioteca/${a.slug}?articulo=${encodeURIComponent(a.number)}`}
                    className="block rounded-xl border border-line px-3 py-2.5 transition-colors hover:bg-fg/[.03]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-medium text-fg/85">
                        {a.short_title ?? a.norm_title ?? a.slug} · Artículo {a.number}
                      </span>
                      {a.status && <Badge tone={statusTone(a.status)}>{statusLabel[a.status] ?? a.status}</Badge>}
                    </div>
                    {a.heading && <p className="mt-0.5 text-[11.5px] text-fg/45">{a.heading}</p>}
                    {a.snippet && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg/35">{a.snippet}</p>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {!isLoading && (data?.norms.length ?? 0) === 0 && articleHits.length === 0 && !searchingArticles && (
            <EmptyState
              icon={<LibraryIcon size={20} />}
              title="No encontramos normas ni artículos con esos filtros"
              description="Prueba con otro término, materia o estado. También puedes preguntarle directamente a ETON AI."
              action={<button onClick={reset} className="btn btn-sm">Limpiar filtros</button>}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {data?.norms.map((n) => (
              <Link key={n.id} to={`/biblioteca/${n.slug}`} className="card card-hover group flex flex-col p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={statusTone(n.status)}>{statusLabel[n.status] ?? n.status}</Badge>
                  <Badge>{typeLabel[n.type] ?? n.type}</Badge>
                  {n.verification !== 'verified' && <Badge tone="warn">Por verificar</Badge>}
                </div>
                <h3 className="mt-2.5 line-clamp-2 font-display text-[16px] leading-snug text-fg/90 group-hover:text-fg">{n.title}</h3>
                <p className="mt-1 text-[11px] text-fg/35">{n.number ?? 'Sin número registrado'}</p>
                {n.summary && <p className="mt-2 line-clamp-2 text-[11.5px] leading-relaxed text-fg/40">{n.summary}</p>}
                <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-fg/25">
                  <span className="flex items-center gap-1"><BookOpen size={11} /> {n.articleCount ?? 0} artículos</span>
                  <span>{n.areaName ?? '—'}</span>
                </div>
              </Link>
            ))}
          </div>

          {(data?.pages ?? 1) > 1 && (
            <div className="mt-5 flex items-center justify-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn btn-sm !px-2"><ChevronLeft size={14} /></button>
              <span className="text-[12px] text-fg/40">Página {data?.page} de {data?.pages}</span>
              <button disabled={page >= (data?.pages ?? 1)} onClick={() => setPage((p) => p + 1)} className="btn btn-sm !px-2"><ChevronRight size={14} /></button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
