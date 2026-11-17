import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Globe2, MapPin, Newspaper, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { NewsItem } from '../lib/types';
import { Badge, EmptyState, SectionHeader, Skeleton } from '../components/ui';
import { cn, timeAgo } from '../lib/utils';

type NewsResponse = {
  news: NewsItem[];
  total: number;
  page: number;
  pages: number;
  sources: { configured: boolean; feeds: Array<{ url: string; scope: string; category: string; name: string | null }>; newsApi: boolean };
};

export default function NewsPage() {
  const [scope, setScope] = useState<'all' | 'nacional' | 'internacional'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (scope !== 'all') params.set('scope', scope);
  if (q.trim()) params.set('q', q.trim());
  params.set('page', String(page));

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['news', scope, q, page],
    queryFn: () => api<NewsResponse>(`/news?${params.toString()}`),
  });

  const featured = data?.news[0];
  const rest = data?.news.slice(1) ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="ETON NEWS"
        title="Actualidad jurídica nacional e internacional"
        description="Titulares con fecha real de publicación y enlace a la fuente original. Sin fuentes configuradas, ETON NEWS lo indica en lugar de inventar noticias."
        action={
          <button onClick={() => refetch()} className="btn btn-sm" disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Actualizar
          </button>
        }
      />

      {!isLoading && data && !data.sources.configured && (
        <div className="rounded-2xl border border-warn/20 bg-warn/[.06] px-4 py-3.5">
          <p className="text-[12.5px] font-medium text-warn/90">Sin fuentes de noticias configuradas</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-warn/55">
            Configura <code>NEWS_FEEDS</code> (RSS de medios jurídicos) o <code>NEWSAPI_KEY</code> en el servidor. El módulo no genera contenido editorial propio ni noticias simuladas.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-xl border border-line bg-fg/[.02] p-1">
          {([
            ['all', 'Todo'],
            ['nacional', 'Nacional'],
            ['internacional', 'Internacional'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setScope(id); setPage(1); }}
              className={cn('rounded-lg px-3.5 py-1.5 text-[11.5px] font-medium transition-colors', scope === id ? 'bg-fg/95 text-paper' : 'text-fg/45 hover:text-fg/80')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Buscar en ETON NEWS…" className="input !py-2 !text-[12px] pl-9" />
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 w-full lg:col-span-2" />
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        </div>
      )}

      {!isLoading && (data?.news.length ?? 0) === 0 && (
        <EmptyState
          icon={<Newspaper size={20} />}
          title="Aún no hay noticias disponibles"
          description="Cuando se configuren fuentes reales, las publicaciones aparecerán aquí con su fecha original y enlace de origen."
        />
      )}

      {featured && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
          <Link to={`/noticias/${featured.id}`} className="card card-hover group overflow-hidden">
            {featured.image_url ? (
              <div className="relative h-56 overflow-hidden sm:h-72">
                <img src={featured.image_url} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-white/65">
                    <span className="flex items-center gap-1">{featured.scope === 'internacional' ? <Globe2 size={10} /> : <MapPin size={10} />} {featured.scope}</span>
                    <span className="h-0.5 w-0.5 rounded-full bg-white/50" />
                    <span>{featured.source_name}</span>
                  </div>
                  <h2 className="mt-2 font-display text-2xl leading-snug text-white sm:text-[28px]">{featured.title}</h2>
                </div>
              </div>
            ) : (
              <div className="border-b border-line bg-fg/[.025] p-6">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-fg/45">
                  <span>{featured.scope}</span><span>·</span><span>{featured.source_name}</span>
                </div>
                <h2 className="mt-2 font-display text-2xl leading-snug text-fg">{featured.title}</h2>
              </div>
            )}
            <div className="p-5">
              {featured.summary && <p className="line-clamp-3 text-[13px] leading-relaxed text-fg/50">{featured.summary}</p>}
              <div className="mt-3 flex items-center justify-between text-[10.5px] text-fg/30">
                <span>{timeAgo(featured.published_at ?? featured.fetched_at)}</span>
                <span className="text-fg/70 underline decoration-fg/20 underline-offset-2 transition-colors group-hover:text-fg group-hover:decoration-fg/50">Leer noticia →</span>
              </div>
            </div>
          </Link>

          <div className="space-y-3">
            {rest.slice(0, 3).map((n) => (
              <Link key={n.id} to={`/noticias/${n.id}`} className="card card-hover flex gap-3 p-3.5">
                {n.image_url && <img src={n.image_url} alt="" className="h-16 w-20 shrink-0 rounded-lg object-cover opacity-85" loading="lazy" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.1em] text-fg/30">
                    <span>{n.scope}</span><span>·</span><span className="truncate">{n.source_name}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-fg/80">{n.title}</p>
                  <p className="mt-1 text-[10px] text-fg/25">{timeAgo(n.published_at ?? n.fetched_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {rest.length > 3 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.slice(3).map((n) => (
            <Link key={n.id} to={`/noticias/${n.id}`} className="card card-hover flex flex-col overflow-hidden">
              {n.image_url && <img src={n.image_url} alt="" className="h-40 w-full object-cover opacity-90" loading="lazy" />}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={n.scope === 'internacional' ? 'info' : 'neutral'}>{n.scope}</Badge>
                  {n.category && <Badge>{n.category}</Badge>}
                </div>
                <h3 className="mt-2 line-clamp-2 font-display text-[16px] leading-snug text-fg/90">{n.title}</h3>
                {n.summary && <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-fg/40">{n.summary}</p>}
                <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-fg/25">
                  <span>{n.source_name}</span>
                  <span>{timeAgo(n.published_at ?? n.fetched_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {(data?.pages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn btn-sm">Anterior</button>
          <span className="text-[12px] text-fg/40">Página {data?.page} de {data?.pages}</span>
          <button disabled={page >= (data?.pages ?? 1)} onClick={() => setPage((p) => p + 1)} className="btn btn-sm">Siguiente</button>
        </div>
      )}
    </div>
  );
}
