import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, BookOpen, CheckCircle2, FileText, GraduationCap,
  RotateCcw, ShieldCheck, Trophy, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import type { AiCitation } from '../lib/types';
import { Badge, EmptyState, SectionHeader, Skeleton, Spinner } from '../components/ui';
import { cn, formatDate } from '../lib/utils';
import { CitationList } from './AiChat';

type TutorCitation = AiCitation & {
  documentId?: string | null;
  page?: number | null;
  charOffset?: number | null;
  section?: string | null;
  chunkIndex?: number | null;
};

type Area = { slug: string; name: string; description?: string | null };
type Doc = { id: string; name: string; chars: number | null; created_at: string };

type Progress = {
  total: number;
  answered: number;
  correct: number;
  score: number;
  completed: boolean;
};

type PublicQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  sourceLabel: string;
  citations: TutorCitation[];
};

type SessionView = {
  session: {
    id: string;
    area: string | null;
    topic: string | null;
    documentId: string | null;
    questionCount: number;
    status: 'active' | 'completed';
    createdAt: string;
    completedAt: string | null;
  };
  progress: Progress;
  next: PublicQuestion | null;
};

type AnswerResponse = {
  correct: boolean;
  answerIndex: number;
  correctIndex: number;
  feedback: string;
  citations: TutorCitation[];
  progress: Progress;
  next: PublicQuestion | null;
};

type ResultQuestion = PublicQuestion & {
  correctIndex: number;
  explanation: string;
  sourceText: string;
  sourceUrl: string | null;
  answerIndex: number | null;
  wasCorrect: boolean | null;
  feedback: string | null;
};

type ResultView = SessionView & { questions: ResultQuestion[] };

type SessionSummary = {
  id: string;
  area: string | null;
  topic: string | null;
  status: 'active' | 'completed';
  createdAt: string;
  total: number;
  answered: number;
  correct: number;
  score: number;
};

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiClientError ? err.message : fallback;

export default function Tutor() {
  const queryClient = useQueryClient();
  const [area, setArea] = useState('');
  const [topic, setTopic] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [session, setSession] = useState<SessionView | null>(null);
  const [current, setCurrent] = useState<PublicQuestion | null>(null);
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [starting, setStarting] = useState(false);

  const areasQuery = useQuery({
    queryKey: ['tutor-areas'],
    queryFn: () => api<{ areas: Area[] }>('/tutor/areas'),
  });
  const docsQuery = useQuery({
    queryKey: ['ai-documents'],
    queryFn: () => api<{ documents: Doc[] }>('/ai/documents'),
  });
  const sessionsQuery = useQuery({
    queryKey: ['tutor-sessions'],
    queryFn: () => api<{ sessions: SessionSummary[] }>('/tutor/sessions'),
  });

  const resultQuery = useQuery({
    queryKey: ['tutor-result', session?.session.id],
    queryFn: () => api<ResultView>(`/tutor/sessions/${session!.session.id}/result`),
    enabled: !!session?.progress.completed,
  });

  const answerMutation = useMutation({
    mutationFn: (answerIndex: number) =>
      api<AnswerResponse>(`/tutor/sessions/${session!.session.id}/answers`, {
        method: 'POST',
        body: JSON.stringify({ questionId: current!.id, answerIndex }),
      }),
    onSuccess: (data) => {
      setAnswer(data);
      // La pregunta visible no cambia hasta que el estudiante pulsa "Siguiente":
      // así la explicación siempre corresponde a la opción que acaba de elegir.
      setSession((prev) => prev ? {
        ...prev,
        progress: data.progress,
        session: {
          ...prev.session,
          status: data.progress.completed ? 'completed' : prev.session.status,
          completedAt: data.progress.completed ? new Date().toISOString() : prev.session.completedAt,
        },
      } : prev);
      queryClient.invalidateQueries({ queryKey: ['tutor-sessions'] });
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo registrar tu respuesta.')),
  });

  const startSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setAnswer(null);
    try {
      const view = await api<SessionView>('/tutor/sessions', {
        method: 'POST',
        body: JSON.stringify({
          area,
          topic,
          documentId: documentId || null,
          questionCount,
        }),
      });
      setSession(view);
      setCurrent(view.next);
      queryClient.invalidateQueries({ queryKey: ['tutor-sessions'] });
      toast.success(`Se prepararon ${view.progress.total} preguntas con texto verificable.`);
    } catch (err) {
      toast.error(errorMessage(err, 'No se pudo preparar la sesión.'));
    } finally {
      setStarting(false);
    }
  };

  const openSession = async (id: string) => {
    try {
      const view = await api<SessionView>(`/tutor/sessions/${id}`);
      setAnswer(null);
      setSession(view);
      setCurrent(view.next);
    } catch (err) {
      toast.error(errorMessage(err, 'No se pudo abrir la sesión.'));
    }
  };

  const reset = () => {
    setSession(null);
    setCurrent(null);
    setAnswer(null);
    queryClient.invalidateQueries({ queryKey: ['tutor-sessions'] });
  };

  const progress = session?.progress;
  const question = current;
  const docs = docsQuery.data?.documents ?? [];
  const areas = areasQuery.data?.areas ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Tutor jurídico"
        title="Practica con fragmentos reales de la biblioteca"
        description="Cada pregunta se arma con una frase literal de una norma vigente o de un documento que tú subiste. La respuesta correcta se revela solo después de responder; si no hay texto suficiente, el tutor lo dice en lugar de inventar una pregunta."
        action={<Badge tone="gold"><ShieldCheck size={10} /> Sin respuestas inventadas</Badge>}
      />

      {session ? (
        <div className="space-y-5">
          <div className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">
                {session.session.area
                  ? areas.find((a) => a.slug === session.session.area)?.name ?? session.session.area
                  : 'Todas las áreas'}
              </Badge>
              {session.session.topic && <Badge tone="neutral">Tema: {session.session.topic}</Badge>}
              {session.session.documentId && <Badge tone="gold"><FileText size={10} /> Documento propio</Badge>}
              <button onClick={reset} className="btn btn-sm ml-auto !px-2" title="Salir de la sesión">
                <ArrowLeft size={14} /> Salir
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-fg/45">
                <span>
                  Pregunta {question?.position ?? progress?.total ?? 0} de {progress?.total}
                </span>
                <span>{progress?.correct ?? 0} correctas · {progress?.score ?? 0}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-fg/[.07]">
                <div
                  className="h-full rounded-full bg-fg/70 transition-all"
                  style={{ width: `${progress?.total ? (progress.answered / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>

          {progress?.completed ? (
            <div className="space-y-4">
              <div className="card flex flex-wrap items-center gap-4 p-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-fg/[.05] text-fg">
                  <Trophy size={22} />
                </span>
                <div>
                  <h2 className="font-display text-2xl text-fg/90">Resultado: {progress.score}%</h2>
                  <p className="text-sm text-fg/45">
                    {progress.correct} de {progress.total} respuestas correctas. Cada explicación muestra el fragmento exacto de la fuente.
                  </p>
                </div>
                <button onClick={reset} className="btn btn-sm ml-auto">
                  <RotateCcw size={13} /> Nueva sesión
                </button>
              </div>

              {resultQuery.isLoading && <Skeleton className="h-48 w-full" />}
              {resultQuery.data?.questions.map((q) => (
                <article key={q.id} className="card space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      q.wasCorrect ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-fg/[.07] text-fg/50',
                    )}>
                      {q.wasCorrect ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">Pregunta {q.position}</p>
                      <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-fg/85">{q.prompt}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-line/70 bg-white/40 p-3 text-[12px] leading-relaxed text-fg/70 dark:bg-white/[.03]">
                    {q.feedback}
                  </div>
                  <p className="text-[11px] text-fg/40">
                    Texto de origen: <span className="italic text-fg/60">«{q.sourceText}»</span>
                  </p>
                  <CitationList citations={q.citations} />
                </article>
              ))}
            </div>
          ) : question ? (
            <div className="card space-y-5 p-5 sm:p-6">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">
                  <GraduationCap size={12} /> Pregunta {question.position}
                </p>
                <p className="mt-2 whitespace-pre-line font-display text-lg leading-relaxed text-fg/90 sm:text-xl">
                  {question.prompt}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {question.options.map((option, index) => {
                  const revealed = answer !== null;
                  const isRight = revealed && index === answer.correctIndex;
                  const isMine = revealed && !answer.correct && index === answer.answerIndex;
                  return (
                    <button
                      key={index}
                      disabled={revealed || answerMutation.isPending}
                      onClick={() => answerMutation.mutate(index)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-[13px] transition-colors',
                        !revealed && 'border-line bg-white/50 hover:border-fg/30 hover:bg-fg/[.04] dark:bg-white/[.03]',
                        isRight && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                        isMine && 'border-fg/25 bg-fg/[.07] text-fg/80 line-through',
                        revealed && !isRight && !isMine && 'border-line/60 bg-fg/[.02] text-fg/40',
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-line/70 font-mono text-[10px]">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="min-w-0 flex-1">{option}</span>
                      {isRight && <CheckCircle2 size={15} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {answerMutation.isPending && <Spinner size={16} />}

              {answer && (
                <div className="space-y-3">
                  <div className={cn(
                    'rounded-xl border p-3.5 text-[12.5px] leading-relaxed',
                    answer.correct
                      ? 'border-emerald-500/30 bg-emerald-500/[.07] text-fg/80'
                      : 'border-line bg-fg/[.03] text-fg/70',
                  )}>
                    {answer.feedback}
                  </div>
                  <CitationList citations={answer.citations} />
                  <div className="flex justify-end">
                    <button
                      onClick={() => { setCurrent(answer.next); setAnswer(null); }}
                      className="btn btn-sm"
                    >
                      {answer.next ? 'Siguiente pregunta' : 'Ver resultado'}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<Trophy size={20} />}
              title="No quedan preguntas por responder"
              description="Abre el resultado para revisar cada respuesta con su fuente."
              action={<button onClick={() => queryClient.invalidateQueries({ queryKey: ['tutor-result', session.session.id] })} className="btn btn-sm">Actualizar resultado</button>}
            />
          )}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <form onSubmit={startSession} className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-display text-xl text-fg/90">Preparar una práctica</h2>
              <p className="mt-1 text-[12.5px] text-fg/45">
                Elige un área, escribe un tema opcional y usa un documento propio si quieres practicar sobre tus apuntes.
              </p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/40">Área del Derecho</span>
              <select value={area} onChange={(e) => setArea(e.target.value)} className="input">
                <option value="">Todas las áreas de la biblioteca</option>
                {areas.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/40">Tema (opcional)</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={160}
                placeholder="Ej.: restitución de la posesión"
                className="input"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/40">Documento propio (opcional)</span>
              <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="input">
                <option value="">Usar solo la biblioteca ETON LEX</option>
                {docs.filter((d) => (d.chars ?? 0) > 0).map((d) => (
                  <option key={d.id} value={d.id}>{d.name} · {d.chars} caracteres extraídos</option>
                ))}
              </select>
              {docs.length === 0 && (
                <span className="mt-1.5 block text-[11px] text-fg/35">
                  Aún no subiste documentos a ETON AI. Puedes hacerlo desde la conversación de IA.
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/40">Número de preguntas</span>
              <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} className="input">
                {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} preguntas</option>)}
              </select>
            </label>

            <button type="submit" disabled={starting} className="btn w-full">
              {starting ? <Spinner size={15} /> : <BookOpen size={15} />}
              {starting ? 'Preparando preguntas…' : 'Empezar práctica'}
            </button>
          </form>

          <div className="space-y-4">
            <div className="card p-4 text-[12px] leading-relaxed text-fg/55">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/40">
                <ShieldCheck size={12} /> Cómo funciona
              </p>
              <p>
                El tutor toma frases completas de artículos vigentes o de los fragmentos de tus documentos.
                Oculta una palabra literal y te pide completarla. Las opciones incorrectas son palabras reales
                de otras fuentes de la misma sesión, nunca texto inventado.
              </p>
            </div>

            <div className="card p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/40">Prácticas anteriores</p>
              {sessionsQuery.isLoading && <Skeleton className="h-20 w-full" />}
              {!sessionsQuery.isLoading && (sessionsQuery.data?.sessions.length ?? 0) === 0 && (
                <p className="text-[12px] text-fg/40">Todavía no tienes sesiones. La primera aparecerá aquí.</p>
              )}
              <div className="space-y-2">
                {sessionsQuery.data?.sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openSession(s.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line/70 bg-white/40 px-3 py-2.5 text-left hover:border-fg/25 dark:bg-white/[.03]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-fg/75">
                        {s.topic || s.area || 'Práctica general'}
                      </span>
                      <span className="block text-[10.5px] text-fg/35">{formatDate(s.createdAt)}</span>
                    </span>
                    <Badge tone={s.status === 'completed' ? 'success' : 'warn'}>
                      {s.answered}/{s.total} · {s.score}%
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
