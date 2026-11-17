import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, ExternalLink, Globe2, MapPin, Newspaper, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { NewsItem } from '../lib/types';
import { Badge, EmptyState, Skeleton } from '../components/ui';
import { formatDate, timeAgo } from '../lib/utils';

type DetailResponse = { news: NewsItem };

export default function NewsDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['news-item', id],
    queryFn: () => api<DetailResponse>(`/news/${id}`),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<Newspaper size={20} />}
        title="Noticia no disponible"
        description="El enlace puede haber cambiado o la publicación ya no está en el índice."
        action={<Link to="/noticias" className="btn btn-sm"><ArrowLeft size={13} /> Volver a ETON NEWS</Link>}
      />
    );
  }

  const n = data.news;

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <Link to="/noticias" className="inline-flex items-center gap-1.5 text-[12px] text-fg/35 hover:text-fg/70">
        <ArrowLeft size={13} /> ETON NEWS
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={n.scope === 'internacional' ? 'info' : 'neutral'}>
            {n.scope === 'internacional' ? <Globe2 size={10} /> : <MapPin size={10} />} {n.scope}
          </Badge>
          {n.category && <Badge>{n.category}</Badge>}
          <Badge tone="success">Fuente: {n.source_name}</Badge>
        </div>

        <h1 className="mt-4 font-display text-[30px] leading-[1.15] text-fg/95 sm:text-[38px]">{n.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-fg/35">
          <span className="flex items-center gap-1.5"><CalendarClock size={12} /> Publicada: {n.published_at ? formatDate(n.published_at, { dateStyle: 'long', timeStyle: 'short' }) : 'fecha no informada por la fuente'}</span>
          {n.fetched_at && <span>Indexada: {formatDate(n.fetched_at, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          <span>{timeAgo(n.published_at ?? n.fetched_at)}</span>
        </div>
      </header>

      {n.image_url && (
        <figure className="overflow-hidden rounded-2xl border border-line">
          <img src={n.image_url} alt="" className="w-full object-cover" loading="lazy" />
          <figcaption className="bg-fg/[.02] px-4 py-2 text-[10px] text-fg/25">Imagen proporcionada por la fuente original ({n.source_name}).</figcaption>
        </figure>
      )}

      {n.summary && (
        <p className="border-l-2 border-fg/25 pl-4 text-[15px] leading-relaxed text-fg/65">{n.summary}</p>
      )}

      <div className="prose-eton max-w-none">
        {n.body ? (
          n.body.split(/\n{2,}/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)
        ) : (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-fg/35">
            La fuente solo publicó un resumen. Abre la publicación original para leer el texto completo.
          </p>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-4">
        <a href={n.source_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
          <ExternalLink size={13} /> Leer en la fuente original
        </a>
        <Link
          to={`/ai?q=${encodeURIComponent(`Explícame la relevancia jurídica de esta noticia: "${n.title}". Fuente: ${n.source_name}. No inventes datos que no consten en el texto.`)}`}
          className="btn btn-sm"
        >
          <Sparkles size={13} /> Analizar con ETON AI
        </Link>
      </div>

      <p className="text-[10.5px] leading-relaxed text-fg/25">
        ETON NEWS reproduce titulares y enlaces de fuentes externas. La fecha de publicación corresponde a la informada por la fuente; la fecha de indexación puede ser posterior. ETON LEX no altera el contenido original ni añade declaraciones que no consten en él.
      </p>
    </article>
  );
}
