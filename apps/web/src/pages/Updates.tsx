import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bell, CheckCircle2, Clock3, ExternalLink, Scale, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import type { LegislativeUpdate } from '../lib/types';
import { Badge, EmptyState, SectionHeader, Skeleton } from '../components/ui';
import { cn, formatDate, updateTypeLabel } from '../lib/utils';

type UpdatesResponse = { updates: LegislativeUpdate[]; total: number; page: number; pages: number };

const TYPE_TONE: Record<string, 'info' | 'warn' | 'danger' | 'success' | 'gold' | 'neutral'> = {
  modificacion: 'warn',
  incorporacion: 'success',
  derogacion: 'danger',
  nueva_norma: 'info',
  jurisprudencia: 'gold',
  precedente: 'gold',
};

export default function UpdatesPage() {
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [page, setPage] = useState(1);

  const allQuery = useQuery({
    queryKey: ['updates', page],
    queryFn: () => api<UpdatesResponse>(`/updates?page=${page}`),
    enabled: tab === 'all',
  });

  const mineQuery = useQuery({
    queryKey: ['updates-mine'],
    queryFn: () => api<{ updates: LegislativeUpdate[] }>('/updates/for-me'),
    enabled: tab === 'mine',
  });

  const updates = tab === 'all' ? allQuery.data?.updates ?? [] : mineQuery.data?.updates ?? [];
  const isLoading = tab === 'all' ? allQuery.isLoading : mineQuery.isLoading;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Actualizaciones legislativas"
        title="Solo cambios comprobados en fuentes oficiales"
        description="Cada propuesta detectada por los procesos automáticos pasa por validación humana antes de publicarse como actualización confirmada. No afirmamos que una norma cambió hasta verificarlo."
        action={<Badge tone="gold"><ShieldAlert size={10} /> Validación previa</Badge>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-xl border border-line bg-fg/[.02] p-1">
          {([
            ['all', 'Todas las confirmadas'],
            ['mine', 'Según mis intereses'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setPage(1); }}
              className={cn('rounded-lg px-3.5 py-1.5 text-[11.5px] font-medium transition-colors', tab === id ? 'bg-fg/95 text-paper' : 'text-fg/45 hover:text-fg/80')}
            >
              {label}
            </button>
          ))}
        </div>
        <Link to="/configuracion" className="chip ml-auto !text-[11px]"><Bell size={12} /> Personalizar alertas</Link>
      </div>

      {isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>}

      {!isLoading && updates.length === 0 && (
        <EmptyState
          icon={<Scale size={20} />}
          title={tab === 'all' ? 'Sin actualizaciones confirmadas' : 'No hay novedades en tus materias'}
          description={
            tab === 'all'
              ? 'Cuando el equipo valide una modificación, derogación o nueva norma frente a El Peruano o SPIJ, aparecerá aquí con el texto anterior y el vigente.'
              : 'Sigue normas o materias en tu perfil y configuración para recibir aquí solo lo que te interesa.'
          }
          action={tab === 'mine' ? <Link to="/biblioteca" className="btn btn-sm">Explorar la biblioteca</Link> : undefined}
        />
      )}

      <div className="space-y-3">
        {updates.map((u) => (
          <article key={u.id} className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TYPE_TONE[u.type] ?? 'neutral'}>{updateTypeLabel[u.type] ?? u.type}</Badge>
              {u.article_number && <Badge tone="gold">Artículo {u.article_number}</Badge>}
              {u.status === 'confirmed' && <Badge tone="success"><CheckCircle2 size={10} /> Confirmada</Badge>}
              <span className="ml-auto flex items-center gap-1 text-[10px] text-fg/25">
                <Clock3 size={10} /> {formatDate(u.published_at ?? u.detected_at)}
              </span>
            </div>

            <h3 className="mt-2.5 font-display text-[17px] leading-snug text-fg/90">{u.title}</h3>
            {u.summary && <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg/45">{u.summary}</p>}

            {u.modifying_norm && (
              <p className="mt-2 text-[11.5px] text-fg/40">
                <span className="text-fg/25">Norma modificatoria:</span> {u.modifying_norm}
              </p>
            )}

            {(u.previous_text || u.current_text) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {u.previous_text && (
                  <div className="rounded-lg border border-bad/15 bg-bad/[.04] p-3">
                    <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-bad/70">Texto anterior</p>
                    <p className="text-[11.5px] leading-relaxed text-fg/50">{u.previous_text}</p>
                  </div>
                )}
                {u.current_text && (
                  <div className="rounded-lg border border-ok/15 bg-ok/[.04] p-3">
                    <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ok/70">Texto vigente</p>
                    <p className="text-[11.5px] leading-relaxed text-fg/70">{u.current_text}</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
              {u.norm_slug && (
                <Link to={`/biblioteca/${u.norm_slug}${u.article_number ? `?articulo=${u.article_number}` : ''}`} className="inline-flex items-center gap-1 text-fg/60 underline decoration-fg/20 underline-offset-2 hover:text-fg">
                  Abrir {u.norm_title ?? 'la norma'} <ArrowUpRight size={11} />
                </Link>
              )}
              {u.source_url && (
                <a href={u.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg/35 hover:text-fg/70">
                  <ExternalLink size={11} /> Fuente oficial
                </a>
              )}
              {u.source_name && <span className="text-fg/20">Detectada en {u.source_name}</span>}
            </div>
          </article>
        ))}
      </div>

      {tab === 'all' && (allQuery.data?.pages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn btn-sm">Anterior</button>
          <span className="text-[12px] text-fg/40">Página {allQuery.data?.page} de {allQuery.data?.pages}</span>
          <button disabled={page >= (allQuery.data?.pages ?? 1)} onClick={() => setPage((p) => p + 1)} className="btn btn-sm">Siguiente</button>
        </div>
      )}
    </div>
  );
}
