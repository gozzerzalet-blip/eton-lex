import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Bell, BookOpen, Check, CheckCircle2, Database, ExternalLink,
  FileText, History, Layers, Newspaper, Plus, RefreshCw, Rss, Search, Send, ShieldAlert,
  ShieldCheck, Users, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import type { LegislativeUpdate, Norm } from '../lib/types';
import { Avatar, Badge, EmptyState, Modal, SectionHeader, Skeleton, Tabs } from '../components/ui';
import { cn, formatDate, statusLabel, timeAgo, typeLabel, updateTypeLabel } from '../lib/utils';

type Tab = 'overview' | 'norms' | 'queue' | 'sources' | 'users' | 'reports' | 'audit' | 'broadcast';

type Overview = {
  stats: {
    users: number; norms: number; articles: number; verifiedNorms: number; pendingUpdates: number;
    confirmedUpdates: number; news: number; posts: number; messages: number; openReports: number;
  };
  recentRuns: Array<{ id: string; kind: string; source_key?: string | null; status: string; items: number; started_at: string; finished_at?: string | null; error?: string | null }>;
};

type QueueResponse = { queue: LegislativeUpdate[]; stats: Array<{ status: string; c: number }> };
type UsersResponse = { users: Array<{ id: string; name: string; email: string; university?: string | null; role: string; email_verified: number; created_at: string; last_seen_at?: string | null }> };
type SourcesResponse = { sources: Array<{ id: string; key: string; name: string; url: string; kind: string; enabled: number; notes?: string | null; last_checked_at?: string | null; last_error?: string | null }> };
type ReportsResponse = { reports: Array<{ id: string; target_type: string; target_id: string; reason: string; status: string; created_at: string; reporter_name: string }> };
type AuditResponse = { audit: Array<{ id: string; action: string; user_name?: string | null; ip?: string | null; created_at: string; meta?: string | null }> };
type NormsResponse = { norms: Norm[]; total: number; page: number; pages: number };

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Resumen' },
  { id: 'norms', label: 'Normas' },
  { id: 'queue', label: 'Cola de validación' },
  { id: 'sources', label: 'Fuentes' },
  { id: 'users', label: 'Usuarios' },
  { id: 'reports', label: 'Reportes' },
  { id: 'audit', label: 'Auditoría' },
  { id: 'broadcast', label: 'Difusión' },
];

const NORM_TYPES = ['constitucion', 'codigo', 'ley', 'decreto_legislativo', 'decreto_supremo', 'resolucion', 'reglamento', 'tratado'];
const NORM_STATUSES = ['vigente', 'modificado', 'parcialmente_derogado', 'derogado', 'por_verificar'];

const ROLE_LABEL: Record<string, string> = {
  student: 'Estudiante', moderator: 'Moderador', admin: 'Administrador',
};
const REPORT_STATUS_LABEL: Record<string, string> = {
  open: 'Abierto', reviewed: 'Revisado', actioned: 'Sancionado', dismissed: 'Descartado',
};
const REPORT_TARGET_LABEL: Record<string, string> = {
  norm: 'Norma', article: 'Artículo', post: 'Publicación', message: 'Mensaje', user: 'Usuario', news: 'Noticia',
};
const RUN_STATUS_LABEL: Record<string, string> = { ok: 'Correcto', error: 'Error', running: 'En curso' };
const RUN_KIND_LABEL: Record<string, string> = { news: 'Noticias', legislation: 'Legislación', legislative: 'Legislación' };
const QUEUE_STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmado', rejected: 'Rechazado' };
const AUDIT_ACTION_LABEL: Record<string, string> = {
  'admin.role': 'Rol actualizado',
  'admin.user_role': 'Rol actualizado',
  'admin.report_status': 'Estado de reporte actualizado',
  'admin.norm_verify': 'Norma verificada',
  'auth.change_password': 'Contraseña actualizada',
};
const SpanishLabel = (map: Record<string, string>, value: string) => map[value] ?? 'No especificado';

const emptyNormForm = {
  title: '', shortTitle: '', number: '', type: 'ley', area: '', entity: '',
  publishedAt: '', effectiveAt: '', status: 'por_verificar', officialUrl: '', summary: '',
};

function parseArticles(raw: string) {
  const blocks = raw.split(/^##\s+/m).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const header = lines.shift() ?? '';
    const [number, ...headingParts] = header.split('|');
    return {
      number: number.trim(),
      heading: headingParts.join('|').trim() || null,
      text: lines.join('\n').trim(),
    };
  }).filter((article) => article.number && article.text);
}

export default function Admin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('overview');

  const [normModal, setNormModal] = useState(false);
  const [normForm, setNormForm] = useState(emptyNormForm);
  const [verifyNorm, setVerifyNorm] = useState<Norm | null>(null);
  const [verifyForm, setVerifyForm] = useState({ officialUrl: '', status: 'vigente' });
  const [articlesNorm, setArticlesNorm] = useState<Norm | null>(null);
  const [articlesForm, setArticlesForm] = useState({ versionLabel: 'Texto vigente', sourceUrl: '', replace: true, raw: '' });
  const [sourceModal, setSourceModal] = useState(false);
  const [sourceForm, setSourceForm] = useState({ key: '', name: '', url: '', kind: 'rss' });
  const [confirmUpdate, setConfirmUpdate] = useState<LegislativeUpdate | null>(null);
  const [confirmForm, setConfirmForm] = useState({ title: '', summary: '', articleNumber: '', previousText: '', currentText: '', normId: '' });
  const [userSearch, setUserSearch] = useState('');
  const [broadcast, setBroadcast] = useState({ title: '', body: '', link: '', area: '' });

  const overviewQuery = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: isStaff });
  const normsQuery = useQuery({ queryKey: ['admin-norms'], queryFn: () => api<NormsResponse>('/library?pageSize=60'), enabled: isStaff && tab === 'norms' });
  const queueQuery = useQuery({ queryKey: ['admin-queue'], queryFn: () => api<QueueResponse>('/updates/queue'), enabled: isStaff && tab === 'queue' });
  const sourcesQuery = useQuery({ queryKey: ['admin-sources'], queryFn: () => api<SourcesResponse>('/admin/sources'), enabled: isStaff && tab === 'sources' });
  const usersQuery = useQuery({
    queryKey: ['admin-users', userSearch],
    queryFn: () => api<UsersResponse>(`/admin/users?q=${encodeURIComponent(userSearch)}`),
    enabled: isStaff && tab === 'users',
  });
  const reportsQuery = useQuery({ queryKey: ['admin-reports'], queryFn: () => api<ReportsResponse>('/admin/reports'), enabled: isStaff && tab === 'reports' });
  const auditQuery = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<AuditResponse>('/admin/audit'), enabled: isStaff && tab === 'audit' });
  const areasQuery = useQuery({ queryKey: ['areas'], queryFn: () => api<{ areas: Array<{ slug: string; name: string }> }>('/library/areas'), enabled: isStaff });

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });

  const run = async (action: () => Promise<unknown>, success: string, keys: string[] = []) => {
    try {
      await action();
      toast.success(success);
      keys.forEach(invalidate);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'La operación no se pudo completar.');
    }
  };

  const createNorm = async () => run(async () => {
    await api('/admin/norms', {
      method: 'POST',
      body: JSON.stringify({
        title: normForm.title.trim(),
        shortTitle: normForm.shortTitle.trim() || null,
        number: normForm.number.trim() || null,
        type: normForm.type,
        area: normForm.area || null,
        entity: normForm.entity.trim() || null,
        publishedAt: normForm.publishedAt || null,
        effectiveAt: normForm.effectiveAt || null,
        status: normForm.status,
        officialUrl: normForm.officialUrl.trim() || null,
        summary: normForm.summary.trim() || null,
      }),
    });
    setNormModal(false);
    setNormForm(emptyNormForm);
  }, 'Norma registrada. Si indicaste una URL oficial, quedó marcada como verificada.', ['admin-norms', 'admin-overview']);

  const submitVerify = async () => run(async () => {
    if (!verifyNorm) return;
    await api(`/admin/norms/${verifyNorm.id}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ officialUrl: verifyForm.officialUrl.trim(), status: verifyForm.status }),
    });
    setVerifyNorm(null);
    setVerifyForm({ officialUrl: '', status: 'vigente' });
  }, 'Norma verificada contra la fuente oficial.', ['admin-norms', 'admin-overview']);

  const submitArticles = async () => run(async () => {
    if (!articlesNorm) return;
    const articles = parseArticles(articlesForm.raw);
    if (articles.length === 0) throw new ApiClientError(400, 'FORMAT', 'Usa el formato «## 1 | Título» seguido del texto del artículo.');
    await api(`/admin/norms/${articlesNorm.id}/articles`, {
      method: 'POST',
      body: JSON.stringify({
        versionLabel: articlesForm.versionLabel.trim() || 'Texto vigente',
        sourceUrl: articlesForm.sourceUrl.trim() || null,
        replace: articlesForm.replace,
        articles,
      }),
    });
    setArticlesNorm(null);
    setArticlesForm({ versionLabel: 'Texto vigente', sourceUrl: '', replace: true, raw: '' });
  }, 'Articulado cargado y disponible en la biblioteca.', ['admin-norms', 'admin-overview']);

  const addSource = async () => run(async () => {
    await api('/admin/sources', {
      method: 'POST',
      body: JSON.stringify({
        key: sourceForm.key.trim().toLowerCase(),
        name: sourceForm.name.trim(),
        url: sourceForm.url.trim(),
        kind: sourceForm.kind,
        enabled: true,
      }),
    });
    setSourceModal(false);
    setSourceForm({ key: '', name: '', url: '', kind: 'rss' });
  }, 'Fuente agregada. Se usará en la próxima ingesta.', ['admin-sources']);

  const toggleSource = async (id: string, enabled: boolean) => run(async () => {
    await api(`/admin/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
  }, enabled ? 'Fuente activada.' : 'Fuente desactivada.', ['admin-sources']);

  const changeRole = async (id: string, role: string) => run(async () => {
    await api(`/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
  }, 'Rol actualizado.', ['admin-users']);

  const setReportStatus = async (id: string, status: string) => run(async () => {
    await api(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }, 'Reporte actualizado.', ['admin-reports', 'admin-overview']);

  const openConfirm = (update: LegislativeUpdate) => {
    setConfirmUpdate(update);
    setConfirmForm({
      title: update.title,
      summary: update.summary ?? '',
      articleNumber: update.article_number ?? '',
      previousText: update.previous_text ?? '',
      currentText: update.current_text ?? '',
      normId: '',
    });
  };

  const submitConfirm = async () => run(async () => {
    if (!confirmUpdate) return;
    await api(`/updates/${confirmUpdate.id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        normId: confirmForm.normId || null,
        articleNumber: confirmForm.articleNumber.trim() || null,
        previousText: confirmForm.previousText.trim() || null,
        currentText: confirmForm.currentText.trim() || null,
        title: confirmForm.title.trim() || null,
        summary: confirmForm.summary.trim() || null,
      }),
    });
    setConfirmUpdate(null);
  }, 'Actualización confirmada y publicada.', ['admin-queue', 'admin-overview']);

  const rejectUpdate = async (update: LegislativeUpdate) => {
    const reason = window.prompt('Motivo del rechazo (opcional):') ?? '';
    await run(async () => {
      await api(`/updates/${update.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
    }, 'Propuesta rechazada.', ['admin-queue', 'admin-overview']);
  };

  const sendBroadcast = async () => run(async () => {
    await api('/admin/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        title: broadcast.title.trim(),
        body: broadcast.body.trim() || null,
        link: broadcast.link.trim() || null,
        area: broadcast.area || null,
      }),
    });
    setBroadcast({ title: '', body: '', link: '', area: '' });
  }, 'Notificación enviada a los usuarios.', ['admin-overview']);

  const refreshNews = async () => run(async () => {
    const result = await api<{ result: { inserted?: number; skipped?: boolean; reason?: string } }>('/news/refresh', { method: 'POST' });
    toast.info(result.result?.skipped ? result.result.reason ?? 'Ingesta omitida.' : `Ingesta completada: ${result.result?.inserted ?? 0} noticias nuevas.`);
  }, 'Ingesta de noticias ejecutada.', ['admin-overview']);

  const refreshUpdates = async () => run(async () => {
    const result = await api<{ result: { inserted?: number; skipped?: boolean; reason?: string } }>('/updates/refresh', { method: 'POST' });
    toast.info(result.result?.skipped ? result.result.reason ?? 'Ingesta omitida.' : `Ingesta completada: ${result.result?.inserted ?? 0} propuestas.`);
  }, 'Ingesta legislativa ejecutada.', ['admin-overview', 'admin-queue']);

  const stats = overviewQuery.data?.stats;

  const statCards = useMemo(() => [
    { label: 'Usuarios', value: stats?.users ?? 0, icon: Users, tone: 'neutral' },
    { label: 'Normas', value: stats?.norms ?? 0, icon: BookOpen, tone: 'neutral' },
    { label: 'Verificadas', value: stats?.verifiedNorms ?? 0, icon: ShieldCheck, tone: 'success' },
    { label: 'Artículos', value: stats?.articles ?? 0, icon: FileText, tone: 'neutral' },
    { label: 'Cola pendiente', value: stats?.pendingUpdates ?? 0, icon: AlertTriangle, tone: 'warn' },
    { label: 'Confirmadas', value: stats?.confirmedUpdates ?? 0, icon: CheckCircle2, tone: 'success' },
    { label: 'Noticias', value: stats?.news ?? 0, icon: Newspaper, tone: 'neutral' },
    { label: 'Reportes abiertos', value: stats?.openReports ?? 0, icon: ShieldAlert, tone: stats?.openReports ? 'danger' : 'neutral' },
  ] as const, [stats]);

  if (!isStaff) {
    return (
      <EmptyState
        icon={<ShieldCheck size={20} />}
        title="Acceso restringido"
        description="Esta sección requiere rol de moderador o administrador. Si necesitas validar normas o fuentes, solicita acceso al equipo de ETON LEX."
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Administración"
        title="Validación, fuentes y control editorial"
        description="Ninguna norma, actualización o noticia se publica como verificada sin una fuente oficial. Desde aquí se carga el articulado y se confirma la cola de cambios detectados."
        action={<Badge tone="gold"><ShieldCheck size={10} /> {isAdmin ? 'Administrador' : 'Moderador'}</Badge>}
      />

      <Tabs value={tab} onChange={setTab} items={TABS} />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statCards.map((card) => (
              <div key={card.label} className="card p-4">
                <div className="flex items-start justify-between">
                  <card.icon size={16} className="text-fg/30" />
                  <Badge tone={card.tone}>{card.label}</Badge>
                </div>
                <p className="mt-4 font-display text-[26px] text-fg/90">{overviewQuery.isLoading ? <Skeleton className="h-7 w-10" /> : card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
            <section className="card p-5">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Activity size={16} className="text-fg/40" /> Últimas ingestas</h2>
                <div className="flex gap-2">
                  <button onClick={refreshNews} className="btn btn-sm"><RefreshCw size={12} /> Noticias</button>
                  <button onClick={refreshUpdates} className="btn btn-sm"><RefreshCw size={12} /> Legislación</button>
                </div>
              </header>
              {overviewQuery.isLoading && <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
              {(overviewQuery.data?.recentRuns.length ?? 0) === 0 && <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-fg/30">No hay ejecuciones registradas. Configura fuentes reales para activar la ingesta.</p>}
              <div className="mt-3 space-y-2">
                {overviewQuery.data?.recentRuns.map((runItem) => (
                  <div key={runItem.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
                    <Badge tone={runItem.status === 'ok' ? 'success' : runItem.status === 'error' ? 'danger' : 'warn'}>{SpanishLabel(RUN_STATUS_LABEL, runItem.status)}</Badge>
                    <span className="text-[11.5px] text-fg/70">{SpanishLabel(RUN_KIND_LABEL, runItem.kind)}</span>
                    {runItem.source_key && <span className="text-[10px] text-fg/30">{runItem.source_key}</span>}
                    <span className="ml-auto text-[10px] text-fg/25">{formatDate(runItem.started_at, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    {runItem.error && <p className="w-full text-[10.5px] text-bad/70">{runItem.error}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="card p-5">
              <h2 className="font-display text-lg text-fg/90">Principios editoriales</h2>
              <ul className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-fg/45">
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok/70" /> El catálogo puede mostrar metadatos, pero el texto articulado solo se publica desde una fuente oficial.</li>
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok/70" /> Las propuestas de actualización permanecen en cola hasta que una persona las confirma.</li>
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok/70" /> Las noticias se indexan con su fuente, fecha y enlace originales; no se reescriben como contenido propio.</li>
                <li className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn/70" /> Sin fuentes configuradas, los módulos muestran un aviso honesto en lugar de datos simulados.</li>
              </ul>
            </section>
          </div>
        </div>
      )}

      {tab === 'norms' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setNormModal(true)} className="btn btn-primary btn-sm"><Plus size={13} /> Registrar norma</button>
          </div>

          {normsQuery.isLoading && <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full" />)}</div>}

          <div className="grid gap-3 sm:grid-cols-2">
            {normsQuery.data?.norms.map((norm) => (
              <article key={norm.id} className="card flex flex-col p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={norm.status === 'vigente' ? 'success' : norm.status === 'derogado' || norm.status === 'parcialmente_derogado' ? 'danger' : 'warn'}>{statusLabel[norm.status] ?? 'No especificado'}</Badge>
                  <Badge>{typeLabel[norm.type] ?? 'No especificado'}</Badge>
                  <Badge tone={norm.verification === 'verified' ? 'success' : 'warn'}>{norm.verification === 'verified' ? 'Verificada' : 'Pendiente'}</Badge>
                </div>
                <h3 className="mt-2 font-display text-[16px] leading-snug text-fg/90">{norm.title}</h3>
                <p className="mt-1 text-[10.5px] text-fg/30">{norm.number ?? 'Sin número'} · {norm.articleCount ?? 0} artículos</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <button
                    onClick={() => { setVerifyNorm(norm); setVerifyForm({ officialUrl: norm.officialUrl ?? '', status: norm.status === 'por_verificar' ? 'vigente' : norm.status }); }}
                    className="btn btn-sm"
                  >
                    <ShieldCheck size={12} /> Verificar
                  </button>
                  <button
                    onClick={() => { setArticlesNorm(norm); setArticlesForm({ versionLabel: 'Texto vigente', sourceUrl: norm.officialUrl ?? '', replace: true, raw: '' }); }}
                    className="btn btn-sm"
                  >
                    <Layers size={12} /> Cargar articulado
                  </button>
                  {norm.officialUrl && <a href={norm.officialUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm !px-2"><ExternalLink size={12} /></a>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {queueQuery.data?.stats.map((stat) => (
              <Badge key={stat.status} tone={stat.status === 'pending' ? 'warn' : stat.status === 'confirmed' ? 'success' : 'neutral'}>
                {SpanishLabel(QUEUE_STATUS_LABEL, stat.status)}: {stat.c}
              </Badge>
            ))}
            <button onClick={refreshUpdates} className="btn btn-sm ml-auto"><RefreshCw size={12} /> Buscar cambios</button>
          </div>

          {queueQuery.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>}

          {(queueQuery.data?.queue.length ?? 0) === 0 && !queueQuery.isLoading && (
            <EmptyState
              icon={<History size={20} />}
              title="Cola vacía"
              description="No hay propuestas de actualización pendientes. La ingesta solo crea propuestas cuando encuentra cambios reales en fuentes oficiales configuradas."
            />
          )}

          <div className="space-y-3">
            {queueQuery.data?.queue.map((update) => (
              <article key={update.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warn">{updateTypeLabel[update.type] ?? 'No especificado'}</Badge>
                  {update.article_number && <Badge tone="gold">Art. {update.article_number}</Badge>}
                  {update.source_name && <Badge>{update.source_name}</Badge>}
                  <span className="ml-auto text-[10px] text-fg/25">{timeAgo(update.detected_at)}</span>
                </div>
                <h3 className="mt-2 font-display text-[17px] text-fg/90">{update.title}</h3>
                {update.summary && <p className="mt-1 text-[12px] leading-relaxed text-fg/45">{update.summary}</p>}
                <p className="mt-2 text-[11px] text-fg/35">Norma: {update.norm_title ?? 'sin vincular'} {update.norm_number ? `· ${update.norm_number}` : ''}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => openConfirm(update)} className="btn btn-primary btn-sm"><Check size={12} /> Revisar y confirmar</button>
                  <button onClick={() => rejectUpdate(update)} className="btn btn-sm"><XCircle size={12} /> Rechazar</button>
                  {update.source_url && <a href={update.source_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm"><ExternalLink size={12} /> Fuente</a>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'sources' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-fg/35">Fuentes RSS/API usadas por ETON NEWS y la detección de cambios. Una fuente desactivada no se consulta.</p>
            <button onClick={() => setSourceModal(true)} className="btn btn-primary btn-sm"><Plus size={13} /> Agregar fuente</button>
          </div>

          {sourcesQuery.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}

          {(sourcesQuery.data?.sources.length ?? 0) === 0 && !sourcesQuery.isLoading && (
            <EmptyState icon={<Rss size={20} />} title="Sin fuentes registradas" description="Agrega un RSS oficial o de un medio jurídico confiable. También puedes configurar NEWS_FEEDS en el servidor." />
          )}

          <div className="space-y-2">
            {sourcesQuery.data?.sources.map((source) => (
              <div key={source.id} className="card flex flex-wrap items-center gap-3 p-4">
                <span className={cn('h-2 w-2 rounded-full', source.enabled ? 'bg-ok' : 'bg-fg/20')} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-fg/85">{source.name} <span className="text-[10px] text-fg/30">({source.key})</span></p>
                  <a href={source.url} target="_blank" rel="noreferrer" className="block truncate text-[10.5px] text-fg/50 underline decoration-fg/15 underline-offset-2 hover:text-fg">{source.url}</a>
                  {source.last_error && <p className="mt-0.5 text-[10px] text-bad/70">Último error: {source.last_error}</p>}
                </div>
                <Badge>{source.kind}</Badge>
                {source.last_checked_at && <span className="text-[9.5px] text-fg/25">{timeAgo(source.last_checked_at)}</span>}
                <button onClick={() => toggleSource(source.id, !source.enabled)} className={cn('btn btn-sm', source.enabled ? '' : 'btn-primary')}>
                  {source.enabled ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
            <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Buscar por nombre o correo…" className="input !py-2 !text-[12px] pl-9" />
          </div>

          {usersQuery.isLoading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}

          <div className="space-y-1.5">
            {usersQuery.data?.users.map((student) => (
              <div key={student.id} className="card flex flex-wrap items-center gap-3 p-3">
                <Avatar name={student.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-fg/85">{student.name}</p>
                  <p className="truncate text-[10px] text-fg/30">{student.email} · {student.university ?? 'Sin universidad'}</p>
                </div>
                <Badge tone={student.role === 'admin' ? 'gold' : student.role === 'moderator' ? 'info' : 'neutral'}>{SpanishLabel(ROLE_LABEL, student.role)}</Badge>
                {student.email_verified ? <Badge tone="success">Correo verificado</Badge> : <Badge tone="warn">Correo sin verificar</Badge>}
                {isAdmin && student.id !== user?.id && (
                  <select
                    value={student.role}
                    onChange={(event) => changeRole(student.id, event.target.value)}
                    className="input !w-auto !py-1 !text-[11px]"
                  >
                    <option value="student">Estudiante</option>
                    <option value="moderator">Moderador</option>
                    <option value="admin">Administrador</option>
                  </select>
                )}
              </div>
            ))}
            {!usersQuery.isLoading && (usersQuery.data?.users.length ?? 0) === 0 && <p className="py-8 text-center text-[12px] text-fg/30">Sin resultados.</p>}
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-3">
          {reportsQuery.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          {(reportsQuery.data?.reports.length ?? 0) === 0 && !reportsQuery.isLoading && (
            <EmptyState icon={<ShieldAlert size={20} />} title="Sin reportes" description="Los reportes de la comunidad aparecerán aquí para revisión." />
          )}
          {reportsQuery.data?.reports.map((report) => (
            <div key={report.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={report.status === 'open' ? 'danger' : 'neutral'}>{SpanishLabel(REPORT_STATUS_LABEL, report.status)}</Badge>
                <Badge>{SpanishLabel(REPORT_TARGET_LABEL, report.target_type)}</Badge>
                <span className="ml-auto text-[10px] text-fg/25">{formatDate(report.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
              <p className="mt-2 text-[12.5px] text-fg/75">{report.reason}</p>
              <p className="mt-1 text-[10.5px] text-fg/30">Reportado por {report.reporter_name} · objetivo {report.target_id}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['reviewed', 'actioned', 'dismissed'].map((status) => (
                  <button key={status} onClick={() => setReportStatus(report.id, status)} className="btn btn-sm">{SpanishLabel(REPORT_STATUS_LABEL, status)}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11.5px]">
              <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-fg/30">
                <tr>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fg/[.04]">
                {auditQuery.data?.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 text-fg/70">{SpanishLabel(AUDIT_ACTION_LABEL, entry.action)}</td>
                    <td className="px-4 py-2.5 text-fg/45">{entry.user_name ?? 'Sistema'}</td>
                    <td className="px-4 py-2.5 text-fg/30">{entry.ip ?? '—'}</td>
                    <td className="px-4 py-2.5 text-fg/30">{formatDate(entry.created_at, { dateStyle: 'short', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {auditQuery.isLoading && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
          {(auditQuery.data?.audit.length ?? 0) === 0 && !auditQuery.isLoading && <p className="py-8 text-center text-[12px] text-fg/30">Sin registros de auditoría.</p>}
        </div>
      )}

      {tab === 'broadcast' && (
        <section className="card max-w-2xl p-5">
          <h2 className="flex items-center gap-2 font-display text-lg text-fg/90"><Bell size={16} className="text-fg/40" /> Notificación a la comunidad</h2>
          <p className="mt-1 text-[11.5px] text-fg/35">Se envía una notificación real dentro de la app. Si eliges una materia, solo llega a quienes la siguen o la tienen como interés.</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="label">Título</label>
              <input value={broadcast.title} onChange={(event) => setBroadcast((value) => ({ ...value, title: event.target.value }))} className="input" maxLength={160} placeholder="Ej. Nueva actualización del Código Civil" />
            </div>
            <div>
              <label className="label">Mensaje</label>
              <textarea value={broadcast.body} onChange={(event) => setBroadcast((value) => ({ ...value, body: event.target.value }))} rows={3} className="input resize-none" maxLength={1000} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Enlace interno</label>
                <input value={broadcast.link} onChange={(event) => setBroadcast((value) => ({ ...value, link: event.target.value }))} className="input" placeholder="/actualizaciones" maxLength={300} />
              </div>
              <div>
                <label className="label">Materia (opcional)</label>
                <select value={broadcast.area} onChange={(event) => setBroadcast((value) => ({ ...value, area: event.target.value }))} className="input">
                  <option value="">Todos los usuarios</option>
                  {areasQuery.data?.areas.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}
                </select>
              </div>
            </div>
            <button onClick={sendBroadcast} disabled={broadcast.title.trim().length < 3} className="btn btn-primary btn-sm"><Send size={13} /> Enviar notificación</button>
          </div>
        </section>
      )}

      {/* ── Modales ── */}
      <Modal open={normModal} onClose={() => setNormModal(false)} title="Registrar norma" width="max-w-2xl">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Título oficial</label>
            <input value={normForm.title} onChange={(event) => setNormForm((value) => ({ ...value, title: event.target.value }))} className="input" maxLength={240} />
          </div>
          <div>
            <label className="label">Título corto</label>
            <input value={normForm.shortTitle} onChange={(event) => setNormForm((value) => ({ ...value, shortTitle: event.target.value }))} className="input" maxLength={120} />
          </div>
          <div>
            <label className="label">Número</label>
            <input value={normForm.number} onChange={(event) => setNormForm((value) => ({ ...value, number: event.target.value }))} className="input" maxLength={80} />
          </div>
          <div>
            <label className="label">Tipo</label>
            <select value={normForm.type} onChange={(event) => setNormForm((value) => ({ ...value, type: event.target.value }))} className="input">
              {NORM_TYPES.map((type) => <option key={type} value={type}>{typeLabel[type] ?? 'No especificado'}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Materia</label>
            <select value={normForm.area} onChange={(event) => setNormForm((value) => ({ ...value, area: event.target.value }))} className="input">
              <option value="">Sin asignar</option>
              {areasQuery.data?.areas.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Entidad emisora</label>
            <input value={normForm.entity} onChange={(event) => setNormForm((value) => ({ ...value, entity: event.target.value }))} className="input" maxLength={160} />
          </div>
          <div>
            <label className="label">Estado</label>
            <select value={normForm.status} onChange={(event) => setNormForm((value) => ({ ...value, status: event.target.value }))} className="input">
              {NORM_STATUSES.map((status) => <option key={status} value={status}>{statusLabel[status] ?? 'No especificado'}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Publicación</label>
            <input type="date" value={normForm.publishedAt} onChange={(event) => setNormForm((value) => ({ ...value, publishedAt: event.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Entrada en vigor</label>
            <input type="date" value={normForm.effectiveAt} onChange={(event) => setNormForm((value) => ({ ...value, effectiveAt: event.target.value }))} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">URL de la fuente oficial</label>
            <input value={normForm.officialUrl} onChange={(event) => setNormForm((value) => ({ ...value, officialUrl: event.target.value }))} className="input" placeholder="https://spij.minjus.gob.pe/… o https://elperuano.pe/…" />
            <p className="mt-1 text-[10px] text-fg/25">Si indicas una URL oficial, la norma se marca como verificada. El articulado se carga por separado.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Resumen</label>
            <textarea value={normForm.summary} onChange={(event) => setNormForm((value) => ({ ...value, summary: event.target.value }))} rows={3} className="input resize-none" maxLength={2000} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setNormModal(false)} className="btn btn-sm">Cancelar</button>
          <button onClick={createNorm} disabled={normForm.title.trim().length < 4} className="btn btn-primary btn-sm">Registrar</button>
        </div>
      </Modal>

      <Modal open={Boolean(verifyNorm)} onClose={() => setVerifyNorm(null)} title="Verificar norma">
        {verifyNorm && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-fg/70">{verifyNorm.title}</p>
            <div>
              <label className="label">URL oficial que confirma el texto</label>
              <input value={verifyForm.officialUrl} onChange={(event) => setVerifyForm((value) => ({ ...value, officialUrl: event.target.value }))} className="input" placeholder="https://…" />
            </div>
            <div>
              <label className="label">Estado confirmado</label>
              <select value={verifyForm.status} onChange={(event) => setVerifyForm((value) => ({ ...value, status: event.target.value }))} className="input">
                {['vigente', 'modificado', 'parcialmente_derogado', 'derogado'].map((status) => <option key={status} value={status}>{statusLabel[status] ?? 'No especificado'}</option>)}
              </select>
            </div>
            <p className="rounded-xl border border-warn/15 bg-warn/[.05] px-3 py-2 text-[10.5px] leading-relaxed text-warn/60">
              Verifica el texto en la fuente antes de confirmar. Este sello aparece en la biblioteca y en las respuestas de ETON AI.
            </p>
            <button onClick={submitVerify} disabled={!verifyForm.officialUrl.trim()} className="btn btn-primary w-full">Marcar como verificada</button>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(articlesNorm)} onClose={() => setArticlesNorm(null)} title="Cargar articulado" width="max-w-3xl">
        {articlesNorm && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-fg/70">{articlesNorm.title}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Etiqueta de versión</label>
                <input value={articlesForm.versionLabel} onChange={(event) => setArticlesForm((value) => ({ ...value, versionLabel: event.target.value }))} className="input" maxLength={60} />
              </div>
              <div>
                <label className="label">URL de la fuente</label>
                <input value={articlesForm.sourceUrl} onChange={(event) => setArticlesForm((value) => ({ ...value, sourceUrl: event.target.value }))} className="input" placeholder="https://…" />
              </div>
            </div>
            <div>
              <label className="label">Articulado</label>
              <textarea
                value={articlesForm.raw}
                onChange={(event) => setArticlesForm((value) => ({ ...value, raw: event.target.value }))}
                rows={12}
                className="input resize-y font-mono !text-[11.5px]"
                placeholder={'## 1 | Título del artículo\nTexto literal del artículo, tal como aparece en la fuente oficial.\n\n## 2 | Siguiente artículo\nTexto…'}
              />
              <p className="mt-1 text-[10px] leading-relaxed text-fg/25">
                Formato: cada artículo empieza con <code className="rounded bg-fg/[.06] px-1">## número | título opcional</code>. El texto debe transcribirse literalmente desde la fuente oficial.
              </p>
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-fg/55">
              <input type="checkbox" checked={articlesForm.replace} onChange={(event) => setArticlesForm((value) => ({ ...value, replace: event.target.checked }))} className="h-3.5 w-3.5 accent-black dark:accent-white" />
              Reemplazar el articulado anterior de esta norma
            </label>
            <button onClick={submitArticles} className="btn btn-primary w-full">Publicar articulado</button>
          </div>
        )}
      </Modal>

      <Modal open={sourceModal} onClose={() => setSourceModal(false)} title="Agregar fuente">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Clave</label>
              <input value={sourceForm.key} onChange={(event) => setSourceForm((value) => ({ ...value, key: event.target.value }))} className="input" placeholder="elperuano" maxLength={40} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select value={sourceForm.kind} onChange={(event) => setSourceForm((value) => ({ ...value, kind: event.target.value }))} className="input">
                <option value="rss">RSS</option>
                <option value="api">API</option>
                <option value="html">HTML</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Nombre</label>
            <input value={sourceForm.name} onChange={(event) => setSourceForm((value) => ({ ...value, name: event.target.value }))} className="input" placeholder="El Peruano — Normas legales" maxLength={120} />
          </div>
          <div>
            <label className="label">URL</label>
            <input value={sourceForm.url} onChange={(event) => setSourceForm((value) => ({ ...value, url: event.target.value }))} className="input" placeholder="https://…" />
          </div>
          <button onClick={addSource} disabled={sourceForm.name.trim().length < 3 || !sourceForm.url.trim() || !sourceForm.key.trim()} className="btn btn-primary w-full">Agregar fuente</button>
        </div>
      </Modal>

      <Modal open={Boolean(confirmUpdate)} onClose={() => setConfirmUpdate(null)} title="Confirmar actualización" width="max-w-2xl">
        {confirmUpdate && (
          <div className="space-y-3">
            <div>
              <label className="label">Título publicado</label>
              <input value={confirmForm.title} onChange={(event) => setConfirmForm((value) => ({ ...value, title: event.target.value }))} className="input" maxLength={300} />
            </div>
            <div>
              <label className="label">Resumen</label>
              <textarea value={confirmForm.summary} onChange={(event) => setConfirmForm((value) => ({ ...value, summary: event.target.value }))} rows={2} className="input resize-none" maxLength={2000} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Vincular a norma</label>
                <select value={confirmForm.normId} onChange={(event) => setConfirmForm((value) => ({ ...value, normId: event.target.value }))} className="input">
                  <option value="">Mantener vínculo actual</option>
                  {normsQuery.data?.norms.map((norm) => <option key={norm.id} value={norm.id}>{norm.title}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Artículo</label>
                <input value={confirmForm.articleNumber} onChange={(event) => setConfirmForm((value) => ({ ...value, articleNumber: event.target.value }))} className="input" maxLength={30} />
              </div>
            </div>
            <div>
              <label className="label">Texto anterior</label>
              <textarea value={confirmForm.previousText} onChange={(event) => setConfirmForm((value) => ({ ...value, previousText: event.target.value }))} rows={3} className="input resize-none font-mono !text-[11px]" />
            </div>
            <div>
              <label className="label">Texto vigente</label>
              <textarea value={confirmForm.currentText} onChange={(event) => setConfirmForm((value) => ({ ...value, currentText: event.target.value }))} rows={3} className="input resize-none font-mono !text-[11px]" />
            </div>
            {confirmUpdate.source_url && <a href={confirmUpdate.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-fg/55 underline decoration-fg/20 underline-offset-2 hover:text-fg"><ExternalLink size={11} /> Abrir fuente oficial</a>}
            <button onClick={submitConfirm} className="btn btn-primary w-full"><CheckCircle2 size={14} /> Confirmar y publicar</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
