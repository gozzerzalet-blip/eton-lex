import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BookOpen, Bookmark, BookmarkCheck, ExternalLink, FileWarning, History,
  Info, Search, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import type { Article, LegislativeUpdate, Norm, TextStats } from '../lib/types';
import { Badge, EmptyState, Skeleton } from '../components/ui';
import { cn, formatDate, statusLabel, typeLabel, updateTypeLabel } from '../lib/utils';

type DetailResponse = {
  norm: Norm;
  articles: Article[];
  versions: Array<{ id: string; label: string; published_at?: string; source_url?: string; verification: string; notes?: string }>;
  updates: LegislativeUpdate[];
  followed: boolean;
  textAvailable: boolean;
  textStats?: TextStats;
};

const ARTICLE_STATUS_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  vigente: 'success',
  modificado: 'warn',
  derogado: 'danger',
};

const ARTICLE_STATUS_LABEL: Record<string, string> = {
  vigente: 'Vigente',
  modificado: 'Modificado',
  derogado: 'Derogado',
};

function structureKey(a: Article): string {
  return [a.book, a.section, a.title, a.chapter].filter(Boolean).join('|');
}

/** Los códigos grandes tienen más de 2 000 artículos: se pagina para no
 *  bloquear el navegador renderizando miles de tarjetas a la vez. */
const PAGE_SIZE = 50;

export default function NormDetail() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'articulos' | 'historial' | 'ficha'>('articulos');

  const { data, isLoading, error } = useQuery({
    queryKey: ['norm', slug],
    queryFn: () => api<DetailResponse>(`/library/norms/${slug}`),
  });

  const follow = useMutation({
    mutationFn: () => api<{ followed: boolean }>(`/library/norms/${slug}/follow`, { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(res.followed ? 'Norma guardada. Recibirás alertas de cambios.' : 'Dejaste de seguir esta norma.');
      queryClient.invalidateQueries({ queryKey: ['norm', slug] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'No se pudo actualizar.'),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.articles;
    return data.articles.filter((a) =>
      a.number.toLowerCase().includes(q) ||
      (a.heading ?? '').toLowerCase().includes(q) ||
      a.text.toLowerCase().includes(q),
    );
  }, [data, query]);

  const focusedArticle = params.get('articulo');
  const focusedIndex = useMemo(
    () => (focusedArticle ? filtered.findIndex((a) => a.number === focusedArticle) : -1),
    [filtered, focusedArticle],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Al entrar con ?articulo=N, abrir directamente la página que lo contiene.
  useEffect(() => {
    if (focusedIndex >= 0) setPage(Math.floor(focusedIndex / PAGE_SIZE));
  }, [focusedIndex]);

  useEffect(() => {
    if (!focusedArticle) return;
    const el = document.getElementById(`art-${focusedArticle}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-1', 'ring-brand/40');
      const t = setTimeout(() => el.classList.remove('ring-1', 'ring-brand/40'), 2600);
      return () => clearTimeout(t);
    }
  }, [focusedArticle, data, currentPage]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<FileWarning size={20} />}
        title="No encontramos esta norma"
        description="Puede que el enlace sea incorrecto o que la norma aún no esté cargada en la biblioteca."
        action={<Link to="/biblioteca" className="btn btn-sm"><ArrowLeft size={13} /> Volver a la biblioteca</Link>}
      />
    );
  }

  const { norm } = data;
  const tone = norm.status === 'vigente' ? 'success' : norm.status === 'modificado' ? 'warn' : norm.status === 'derogado' || norm.status === 'parcialmente_derogado' ? 'danger' : 'neutral';

  return (
    <div className="space-y-5">
      <Link to="/biblioteca" className="inline-flex items-center gap-1.5 text-[12px] text-fg/35 hover:text-fg/70">
        <ArrowLeft size={13} /> Biblioteca jurídica
      </Link>

      <header className="card overflow-hidden">
        <div className="border-b border-line bg-fg/[.025] px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={tone}>{statusLabel[norm.status] ?? norm.status}</Badge>
            <Badge>{typeLabel[norm.type] ?? norm.type}</Badge>
            {norm.verification === 'verified' ? (
              <Badge tone="success">Verificada</Badge>
            ) : (
              <Badge tone="warn">Metadatos por verificar</Badge>
            )}
          </div>
          <h1 className="mt-3 font-display text-[26px] leading-tight text-fg/95 sm:text-[32px]">{norm.title}</h1>
          <p className="mt-1.5 text-[12.5px] text-fg/40">
            {[norm.number, norm.entity, norm.publishedAt ? `Publicada: ${formatDate(norm.publishedAt)}` : null].filter(Boolean).join(' · ') || 'Datos de publicación no registrados'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => follow.mutate()} disabled={follow.isPending} className={cn('btn btn-sm', data.followed && '!border-fg/30 !bg-fg/[.06] !text-fg')}>
              {data.followed ? <><BookmarkCheck size={13} /> Siguiendo</> : <><Bookmark size={13} /> Seguir norma</>}
            </button>
            <Link to={`/ai?q=${encodeURIComponent(`Explícame ${norm.title}${norm.number ? ` (${norm.number})` : ''} de forma clara, indicando si está vigente y citando la fuente oficial.`)}`} className="btn btn-sm">
              <Sparkles size={13} /> Consultar con ETON AI
            </Link>
            {norm.officialUrl && (
              <a href={norm.officialUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
                <ExternalLink size={13} /> Fuente oficial
              </a>
            )}
          </div>
        </div>

        <div className="grid gap-px bg-fg/[.06] sm:grid-cols-4">
          {[
            ['Entidad', norm.entity ?? 'No registrada'],
            ['Publicación', formatDate(norm.publishedAt)],
            ['Vigencia', norm.effectiveAt ? formatDate(norm.effectiveAt) : 'No registrada'],
            ['Artículos', String(data.textStats?.articleCount ?? data.articles.length)],
          ].map(([label, value]) => (
            <div key={label} className="bg-[var(--panel-solid)] px-5 py-3">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-fg/25">{label}</p>
              <p className="mt-1 text-[12.5px] text-fg/75">{value}</p>
            </div>
          ))}
        </div>
      </header>

      {!data.textAvailable && (
        <div className="flex gap-3 rounded-2xl border border-warn/20 bg-warn/[.06] px-4 py-3.5">
          <FileWarning size={17} className="mt-0.5 shrink-0 text-warn/80" />
          <div>
            <p className="text-[12.5px] font-medium text-warn/90">Texto articulado pendiente de sincronización</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-warn/55">
              ETON LEX no muestra textos inventados. Un administrador debe cargar el texto desde la fuente oficial (SPIJ o El Peruano) para habilitar la consulta por artículo. Mientras tanto, puedes usar el enlace a la fuente oficial.
            </p>
          </div>
        </div>
      )}

      {data.textStats && (data.textStats.gaps.length > 0 || data.textStats.supplemented.length > 0) && (
        <div className="space-y-2.5">
          {data.textStats.gaps.length > 0 && (
            <div className="flex gap-3 rounded-2xl border border-warn/20 bg-warn/[.06] px-4 py-3.5">
              <FileWarning size={17} className="mt-0.5 shrink-0 text-warn/80" />
              <div>
                <p className="text-[12.5px] font-medium text-warn/90">
                  Faltan {data.textStats.gaps.length} artículo(s) en la capa de texto del PDF oficial
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-warn/55">
                  No se completan por inferencia: la plataforma no inventa texto legal. Números ausentes:{' '}
                  <span className="text-warn/80">{data.textStats.gaps.slice(0, 60).join(', ')}{data.textStats.gaps.length > 60 ? '…' : ''}</span>.
                  Consúltalos en la fuente oficial enlazada arriba.
                </p>
              </div>
            </div>
          )}
          {data.textStats.supplemented.length > 0 && (
            <div className="flex gap-3 rounded-2xl border border-info/20 bg-info/[.05] px-4 py-3.5">
              <Info size={17} className="mt-0.5 shrink-0 text-info/80" />
              <div>
                <p className="text-[12.5px] font-medium text-info/90">
                  {data.textStats.supplemented.length} artículo(s) recuperado(s) de otra publicación oficial
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-info/60">
                  El texto faltaba en la edición de El Peruano y se recuperó de una fuente oficial alternativa
                  (por ejemplo, SPIJ). Cada artículo muestra su nota de procedencia.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex gap-1 rounded-xl border border-line bg-fg/[.02] p-1">
          {([
            ['articulos', 'Artículos', data.articles.length],
            ['historial', 'Historial', data.updates.length],
            ['ficha', 'Ficha', null],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn('rounded-lg px-3.5 py-1.5 text-[11.5px] font-medium transition-colors', tab === id ? 'bg-fg/95 text-paper' : 'text-fg/45 hover:text-fg/80')}
            >
              {label}{count !== null && count > 0 ? <span className="ml-1.5 opacity-50">{count}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'articulos' && data.articles.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
                if (params.has('articulo')) {
                  params.delete('articulo');
                  setParams(params, { replace: true });
                }
              }}
              placeholder="Buscar artículo o palabra…"
              className="input !py-1.5 !text-[12px] pl-9"
            />
          </div>
        )}
      </div>

      {tab === 'articulos' && (
        <section className="space-y-2.5">
          {filtered.length === 0 && (
            <EmptyState
              icon={<BookOpen size={20} />}
              title={data.articles.length === 0 ? 'Sin articulado cargado' : 'Ningún artículo coincide'}
              description={data.articles.length === 0 ? 'El texto de esta norma se incorporará cuando se valide en una fuente oficial.' : 'Prueba con el número de artículo o una palabra clave distinta.'}
            />
          )}
          {filtered.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-fg/[.02] px-3 py-2">
              <p className="text-[11px] text-fg/40">
                Mostrando {visible.length} de {filtered.length} artículos
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className="btn btn-sm disabled:opacity-35">
                  Anterior
                </button>
                <span className="px-1 text-[11px] text-fg/45">Página {currentPage + 1} de {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage >= totalPages - 1} className="btn btn-sm disabled:opacity-35">
                  Siguiente
                </button>
              </div>
            </div>
          )}
          {visible.map((a, index) => {
            const prev = filtered[pageStart + index - 1];
            const showStructure = !prev || structureKey(prev) !== structureKey(a);
            const structure = [a.book, a.section, a.title, a.chapter].filter(Boolean) as string[];
            const status = a.status ?? 'vigente';
            const isDerogated = status === 'derogado';
            return (
              <Fragment key={a.id}>
                {showStructure && structure.length > 0 && (
                  <div className="scroll-mt-24 pt-3 first:pt-0">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-fg/25">Ubicación en la norma</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-fg/55">{structure.join(' · ')}</p>
                  </div>
                )}
                <article
                  id={`art-${a.number}`}
                  className={cn('card scroll-mt-24 p-4 transition-all sm:p-5', isDerogated && 'border-bad/20 bg-bad/[.02]')}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className={cn('font-display text-[16px]', isDerogated ? 'text-fg/55' : 'text-fg/90')}>Artículo {a.number}</h3>
                    {a.heading && <span className="text-[12px] text-fg/40">{a.heading}</span>}
                    {status !== 'vigente' && (
                      <Badge tone={ARTICLE_STATUS_TONE[status] ?? 'neutral'}>
                        {ARTICLE_STATUS_LABEL[status] ?? status}
                      </Badge>
                    )}
                    {a.source_url && (
                      <a href={a.source_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[10px] text-fg/30 hover:text-fg/60">
                        <ExternalLink size={10} /> Fuente
                      </a>
                    )}
                  </div>
                  <p className={cn('mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed', isDerogated ? 'text-fg/50' : 'text-fg/70')}>{a.text}</p>
                  {a.provenance && (
                    <div className="mt-3 flex gap-2 rounded-lg border border-info/15 bg-info/[.04] px-3 py-2">
                      <Info size={13} className="mt-0.5 shrink-0 text-info/70" />
                      <p className="text-[11px] leading-relaxed text-info/70">{a.provenance}</p>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      to={`/ai?q=${encodeURIComponent(`Explícame el artículo ${a.number} de ${norm.title}: "${a.text.slice(0, 400)}"`)}`}
                      className="chip !text-[10.5px]"
                    >
                      <Sparkles size={11} /> Explicar con ETON AI
                    </Link>
                    {a.updated_at && <span className="text-[10px] text-fg/20">Actualizado: {formatDate(a.updated_at)}</span>}
                  </div>
                </article>
              </Fragment>
            );
          })}
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className="btn btn-sm disabled:opacity-35">
                Anterior
              </button>
              <span className="px-1 text-[11px] text-fg/45">Página {currentPage + 1} de {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage >= totalPages - 1} className="btn btn-sm disabled:opacity-35">
                Siguiente
              </button>
            </div>
          )}
        </section>
      )}

      {tab === 'historial' && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><History size={16} className="text-fg/40" /> Cambios confirmados</h2>
          {data.updates.length === 0 && (
            <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-fg/35">
              No hay modificaciones confirmadas registradas para esta norma. Las propuestas de fuentes oficiales pasan por validación antes de publicarse aquí.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {data.updates.map((u) => (
              <div key={u.id} className="rounded-xl border border-line bg-fg/[.02] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{updateTypeLabel[u.type] ?? u.type}</Badge>
                  {u.article_number && <Badge tone="gold">Art. {u.article_number}</Badge>}
                  <span className="ml-auto text-[10px] text-fg/25">{formatDate(u.published_at ?? u.detected_at)}</span>
                </div>
                <p className="mt-2 text-[13px] text-fg/80">{u.title}</p>
                {u.summary && <p className="mt-1 text-[12px] leading-relaxed text-fg/45">{u.summary}</p>}
                {u.modifying_norm && <p className="mt-2 text-[11px] text-fg/35">Norma modificatoria: {u.modifying_norm}</p>}
                {u.previous_text && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-bad/15 bg-bad/[.04] p-2.5">
                      <p className="mb-1 text-[9.5px] uppercase tracking-[0.14em] text-bad/70">Texto anterior</p>
                      <p className="text-[11.5px] leading-relaxed text-fg/50">{u.previous_text}</p>
                    </div>
                    <div className="rounded-lg border border-ok/15 bg-ok/[.04] p-2.5">
                      <p className="mb-1 text-[9.5px] uppercase tracking-[0.14em] text-ok/70">Texto actual</p>
                      <p className="text-[11.5px] leading-relaxed text-fg/70">{u.current_text}</p>
                    </div>
                  </div>
                )}
                {u.source_url && <a href={u.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-fg/55 underline decoration-fg/20 underline-offset-2 hover:text-fg"><ExternalLink size={11} /> Ver publicación oficial</a>}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'ficha' && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="font-display text-lg text-fg/90">Ficha normativa</h2>
            <dl className="mt-4 space-y-3 text-[12.5px]">
              {[
                ['Título', norm.title],
                ['Número', norm.number ?? 'No registrado'],
                ['Tipo', typeLabel[norm.type] ?? norm.type],
                ['Materia', norm.areaName ?? 'No asignada'],
                ['Entidad emisora', norm.entity ?? 'No registrada'],
                ['Fecha de publicación', formatDate(norm.publishedAt)],
                ['Entrada en vigor', norm.effectiveAt ? formatDate(norm.effectiveAt) : 'No registrada'],
                ['Estado', statusLabel[norm.status] ?? norm.status],
                ['Verificación', norm.verification === 'verified' ? 'Verificada contra fuente oficial' : 'Pendiente de verificación'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-line pb-2.5 last:border-0">
                  <dt className="shrink-0 text-fg/35">{k}</dt>
                  <dd className="text-right text-fg/75">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="font-display text-lg text-fg/90">Versiones del texto</h2>
              {data.versions.length === 0 && <p className="mt-3 text-[12px] text-fg/35">Sin versiones cargadas todavía.</p>}
              <div className="mt-3 space-y-2">
                {data.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                    <div>
                      <p className="text-[12px] text-fg/75">{v.label}</p>
                      <p className="text-[10px] text-fg/30">{formatDate(v.published_at)}</p>
                    </div>
                    <Badge tone={v.verification === 'verified' ? 'success' : 'warn'}>{v.verification === 'verified' ? 'Verificada' : 'Pendiente'}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="font-display text-lg text-fg/90">Cómo citar</h2>
              <p className="mt-2 rounded-lg border border-line bg-fg/[.03] p-3 font-mono text-[11px] leading-relaxed text-fg/55">
                {norm.title}{norm.number ? `, ${norm.number}` : ''}{norm.publishedAt ? ` (${formatDate(norm.publishedAt)})` : ''}. Perú. {norm.officialUrl ? `Disponible en: ${norm.officialUrl}` : 'Fuente oficial pendiente de registro.'}
              </p>
              <p className="mt-2 text-[10.5px] leading-relaxed text-fg/30">
                Verifica siempre el texto vigente en la fuente oficial antes de citarlo en un trabajo académico o escrito judicial.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
