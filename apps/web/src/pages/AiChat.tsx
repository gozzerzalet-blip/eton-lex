import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp, BookOpen, Copy, FileSpreadsheet, FileText, Globe2, Mic, MicOff, Paperclip,
  Plus, Presentation, RefreshCw, Sparkles, Square, Trash2, Volume2, VolumeX, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError, streamAiMessage } from '../lib/api';
import type { AiCitation, AiMessage } from '../lib/types';
import { cn, formatBytes, timeAgo } from '../lib/utils';
import { Avatar, Badge, EmptyState, Spinner } from '../components/ui';

type Conversation = { id: string; title: string; mode: string; updated_at: string; messages?: number; preview?: string };
type GeneratedKind = 'docx' | 'pptx' | 'xlsx';
type AiStatus = {
  configured: boolean;
  provider: string;
  model: string | null;
  embeddings: boolean;
  fallback?: { provider: string; model: string | null; active: boolean } | null;
  modes: Array<{ id: string; label: string }>;
  exports?: Array<{ kind: GeneratedKind; label: string; enabled: boolean }>;
  limits: { maxUploadMb: number };
};

type Attachment = { id: string; name: string; size: number; mime: string; extracted: boolean; note?: string | null };
type GeneratedFile = { id: string; name: string; kind: GeneratedKind; mime: string; size: number; downloadUrl: string };

const STARTERS = [
  { title: 'Explicar un artículo', text: 'Explícame, como si recién empezara Derecho, el artículo 140 del Código Civil peruano.' },
  { title: 'Analizar un caso', text: 'Analiza este supuesto: una persona celebra un contrato verbal de compraventa de un inmueble y luego el vendedor se niega a transferirlo. ¿Qué acciones corresponden?' },
  { title: 'Prepararme para un examen', text: 'Prepárame para un examen de Derecho Constitucional sobre el control de constitucionalidad en el Perú.' },
  { title: 'Comparar normas', text: 'Compara el tratamiento de la detención preliminar en el Código Procesal Penal y en la Constitución.' },
  { title: 'Otra materia', text: 'Explícame de forma clara y verificable por qué el cielo es azul, con las fuentes científicas que lo respaldan.' },
];

export default function AiChat() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState('auto');
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [listening, setListening] = useState(false);
  const [citations, setCitations] = useState<AiCitation[]>([]);
  const [plan, setPlan] = useState<{ kind: string; label: string; usesWeb: boolean } | null>(null);
  const [research, setResearch] = useState<string | null>(null);
  const [exporting, setExporting] = useState<GeneratedKind | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: () => api<AiStatus>('/ai/status') });
  const { data: convData } = useQuery({ queryKey: ['ai-conversations'], queryFn: () => api<{ conversations: Conversation[] }>('/ai/conversations') });

  const activeConversation = useMemo(
    () => convData?.conversations.find((c) => c.id === activeId) ?? null,
    [convData, activeId],
  );

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim()) ?? null,
    [messages],
  );

  const loadConversation = async (id: string) => {
    setActiveId(id);
    setStreaming('');
    setCitations([]);
    setPlan(null);
    setResearch(null);
    try {
      const data = await api<{ conversation: Conversation; messages: AiMessage[] }>(`/ai/conversations/${id}`);
      setMessages(data.messages);
      setMode(data.conversation.mode ?? 'auto');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo abrir la conversación.');
    }
  };

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setStreaming('');
    setCitations([]);
    setPlan(null);
    setResearch(null);
    setAttachments([]);
    setInput('');
    setParams({}, { replace: true });
  };

  useEffect(() => {
    const q = params.get('q');
    if (q) {
      setInput(q);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const speak = (text: string) => {
    if (!voiceOutput || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/[#*_`>\[\]]/g, '').replace(/\n{2,}/g, '. ').slice(0, 4000);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'es-PE';
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  };

  const send = async (textOverride?: string) => {
    const content = (textOverride ?? input).trim();
    if ((!content && attachments.length === 0) || pending) return;

    let conversationId = activeId;
    setPending(true);
    setStreaming('');
    setCitations([]);
    setPlan(null);
    setResearch(null);
    setInput('');
    setParams({}, { replace: true });

    const localUser: AiMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: content || `[documento adjunto: ${attachments.map((a) => a.name).join(', ')}]`,
      citations: [],
    };
    setMessages((prev) => [...prev, localUser]);

    try {
      if (!conversationId) {
        const created = await api<{ conversation: Conversation }>('/ai/conversations', { method: 'POST', body: JSON.stringify({ mode }) });
        conversationId = created.conversation.id;
        setActiveId(conversationId);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let full = '';
      let metaCitations: AiCitation[] = [];

      await streamAiMessage(
        conversationId,
        { content: content || undefined, mode, attachmentIds: attachments.map((a) => a.id) },
        {
          onMeta: (meta) => {
            metaCitations = meta.citations as AiCitation[];
            setCitations(metaCitations);
            if (meta.plan) setPlan(meta.plan);
            if (meta.web?.status === 'searching') setResearch('Investigando en fuentes oficiales…');
            else if (meta.web && meta.web.status !== 'searching') setResearch(null);
          },
          onStatus: (status) => setResearch(status.message),
          onDelta: (delta) => { full += delta; setStreaming(full); },
          onDone: (done) => {
            setMessages((prev) => [
              ...prev.map((m) => (m.id.startsWith('local-') ? { ...m, id: done.id + '-user' } : m)),
              { id: done.id, role: 'assistant', content: done.content, citations: (done.citations as AiCitation[]) ?? metaCitations, latencyMs: done.latencyMs },
            ]);
            setStreaming('');
            setPlan(null);
            setResearch(null);
            setAttachments([]);
            speak(done.content);
            queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
          },
          onError: (message) => {
            toast.error(message);
            setStreaming('');
            setPlan(null);
            setResearch(null);
            setMessages((prev) => prev.filter((m) => !m.id.startsWith('local-')));
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error(err instanceof ApiClientError ? err.message : 'Error al consultar ETON AI.');
        setMessages((prev) => prev.filter((m) => !m.id.startsWith('local-')));
      }
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setPending(false);
    setStreaming('');
  };

  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) send(lastUser.content);
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    try {
      const data = await api<{ documents: Attachment[] }>('/ai/documents', { method: 'POST', body: form });
      setAttachments((prev) => [...prev, ...data.documents]);
      for (const d of data.documents) if (d.note) toast.info(`${d.name}: ${d.note}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleVoiceInput = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error('Tu navegador no soporta reconocimiento de voz. Prueba con Chrome o Edge.'); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }

    const recognition = new SR();
    recognition.lang = 'es-PE';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join(' ');
      setInput(transcript);
    };
    recognition.onerror = () => { setListening(false); toast.error('No se pudo captar el audio.'); };
    recognition.onend = () => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api(`/ai/conversations/${id}`, { method: 'DELETE' });
    if (id === activeId) newConversation();
    queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
  };

  const exportAnswer = async (kind: GeneratedKind) => {
    if (!lastAssistant || exporting) return;
    const title = activeConversation?.title
      ?? messages.find((m) => m.role === 'user')?.content.slice(0, 70)
      ?? 'Consulta ETON AI';
    setExporting(kind);
    try {
      const { file } = await api<{ file: GeneratedFile }>('/ai/generated', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          title: title.trim() || 'Consulta ETON AI',
          conversationId: activeId ?? undefined,
          content: activeId ? undefined : lastAssistant.content,
        }),
      });
      const response = await api<Response>(file.downloadUrl, {}, { raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${kind.toUpperCase()} generado y descargado.`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'No se pudo generar el archivo.');
    } finally {
      setExporting(null);
    }
  };

  const exportOptions: Array<{ kind: GeneratedKind; label: string; icon: typeof FileText }> = [
    { kind: 'docx', label: 'Word', icon: FileText },
    { kind: 'pptx', label: 'PowerPoint', icon: Presentation },
    { kind: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  ];

  return (
    <div className="grid h-[calc(100vh-9.5rem)] min-h-[540px] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      {/* Historial */}
      <aside className="card hidden flex-col overflow-hidden lg:flex">
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fg/35">Consultas</span>
          <button onClick={newConversation} className="btn btn-ghost btn-sm !px-2" aria-label="Nueva consulta"><Plus size={15} /></button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {(convData?.conversations.length ?? 0) === 0 && <p className="px-3 py-6 text-center text-[11.5px] text-fg/30">Tus consultas aparecerán aquí.</p>}
          {convData?.conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={cn(
                'group flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors',
                activeId === c.id ? 'bg-fg/[.06] text-fg shadow-[inset_0_0_0_1px_rgba(10,10,10,.04)] dark:bg-white/[.08]' : 'hover:bg-fg/[.035]',
              )}
            >
              <Sparkles size={13} className="mt-0.5 shrink-0 text-fg/30" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-fg/75">{c.title}</span>
                <span className="mt-0.5 block text-[10px] text-fg/25">{timeAgo(c.updated_at)}</span>
              </span>
              <span onClick={(e) => deleteConversation(c.id, e)} className="rounded p-1 text-fg/0 hover:bg-fg/10 hover:text-fg/60 group-hover:text-fg/25"><Trash2 size={12} /></span>
            </button>
          ))}
        </div>
        <div className="border-t border-line/70 px-4 py-3">
          <p className="text-[10px] leading-relaxed text-fg/25">
            ETON AI prioriza el Derecho peruano y cita fuentes verificables. También responde consultas generales; si no puede confirmar un dato, lo dice.
          </p>
        </div>
      </aside>

      {/* Chat */}
      <section className="card flex min-h-0 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-fg text-paper shadow-[0_10px_22px_-16px_rgba(0,0,0,.8)]"><Sparkles size={15} /></span>
            <div>
              <h1 className="font-display text-[16px] leading-none text-fg">ETON AI</h1>
              <p className="mt-1 text-[10px] text-fg/35">
                {status?.configured
                  ? `${status.provider}${status.model ? ` · ${status.model}` : ''}${status.fallback?.active ? ' · respaldo local' : ''}`
                  : 'Modo guiado · sin proveedor de IA'}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="input !w-auto !py-1.5 !text-[11.5px]">
              {(status?.modes ?? [{ id: 'auto', label: 'Adaptativo' }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {(status?.exports ?? [
              { kind: 'docx', label: 'Word', enabled: true },
              { kind: 'pptx', label: 'PowerPoint', enabled: true },
              { kind: 'xlsx', label: 'Excel', enabled: true },
            ]).filter((e) => e.enabled).map((e) => {
              const option = exportOptions.find((o) => o.kind === e.kind);
              if (!option) return null;
              const Icon = option.icon;
              return (
                <button
                  key={e.kind}
                  onClick={() => exportAnswer(e.kind)}
                  disabled={!lastAssistant || exporting !== null}
                  className="btn btn-sm !px-2"
                  title={lastAssistant ? `Exportar respuesta a ${option.label}` : 'Espera a que ETON AI responda para exportar'}
                >
                  {exporting === e.kind ? <Spinner size={14} /> : <Icon size={14} />}
                </button>
              );
            })}
            <button
              onClick={() => { setVoiceOutput((v) => !v); if (voiceOutput) window.speechSynthesis.cancel(); }}
              className={cn('btn btn-sm !px-2', voiceOutput && '!border-fg/30 !bg-fg/[.06] !text-fg')}
              title={voiceOutput ? 'Desactivar lectura en voz alta' : 'Leer respuestas en voz alta'}
            >
              {voiceOutput ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <button onClick={newConversation} className="btn btn-sm !px-2 lg:hidden" aria-label="Nueva consulta"><Plus size={14} /></button>
          </div>
        </header>

        {!status?.configured && (
          <div className="border-b border-line/70 bg-fg/[.03] px-4 py-2.5 text-[11.5px] text-fg/60">
            <strong className="text-fg/80">Modo guiado.</strong> No hay IA conectada: las explicaciones se ordenan con la fuente disponible, sin transcribir el artículo completo; las consultas literales siguen mostrando el texto exacto. Para activar respuestas redactadas por un modelo, configura <code className="text-fg">AI_PROVIDER</code> y <code className="text-fg">AI_MODEL</code> (o un respaldo gratuito) en el servidor.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.length === 0 && !streaming && (
            <div className="mx-auto max-w-2xl py-6">
              <div className="text-center">
                <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-fg text-paper shadow-[0_16px_32px_-22px_rgba(0,0,0,.9)]">
                  <Sparkles size={20} />
                </span>
                <h2 className="font-display text-[28px] leading-tight text-fg/95">¿En qué puedo ayudarte hoy?</h2>
                <p className="mx-auto mt-2.5 max-w-md text-[12.5px] leading-relaxed text-fg/40">
                  {status?.configured
                    ? 'Consulta legislación peruana, analiza casos, prepara exámenes o pregunta sobre cualquier materia. ETON AI prioriza el Derecho y responde con información verificable; si no puede confirmar un dato, lo dice.'
                    : 'No hay IA conectada: estás en modo biblioteca. Escribe el número de artículo y la norma (por ejemplo, «artículo 196 del Código Civil») y verás el texto literal con su fuente oficial.'}
                </p>
              </div>
              <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button key={s.title} onClick={() => send(s.text)} className="card card-hover p-3.5 text-left">
                    <p className="text-[12px] font-medium text-fg/80">{s.title}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg/35">{s.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onCopy={() => { navigator.clipboard.writeText(m.content); toast.success('Copiado'); }} />
            ))}

            {streaming && (
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-fg text-paper"><Sparkles size={13} /></span>
                <div className="min-w-0 flex-1">
                  <div className="prose-eton"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown></div>
                  <span className="mt-1 inline-block h-4 w-1.5 animate-pulseSoft rounded-sm bg-fg/60 align-middle" />
                  {citations.length > 0 && <CitationList citations={citations} />}
                </div>
              </div>
            )}

            {pending && !streaming && (
              <div className="flex items-center gap-3 text-[12px] text-fg/35">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fg text-paper"><Sparkles size={13} /></span>
                <Spinner size={13} />
                {research ?? (plan ? `${plan.label} · buscando en la biblioteca…` : 'Buscando en fuentes jurídicas…')}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-line/70 p-3 sm:p-4">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-2 rounded-lg border border-line/80 bg-white/50 px-2.5 py-1.5 text-[11px] text-fg/60 dark:bg-white/[.05]">
                  <FileText size={12} /> {a.name} <span className="text-fg/25">{formatBytes(a.size)}</span>
                  <button onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="text-fg/30 hover:text-fg"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}

          <div className="glass flex items-end gap-1.5 rounded-[20px] p-2 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,.95),0_0_0_1px_rgba(10,10,10,.12),0_24px_48px_-36px_rgba(10,10,10,.32)]">
            <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.doc,.txt,.md,image/*" onChange={(e) => upload(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading || !status?.configured} className="btn btn-ghost btn-sm !px-2" title="Adjuntar PDF, Word o imagen">
              {uploading ? <Spinner size={14} /> : <Paperclip size={16} />}
            </button>
            <button onClick={toggleVoiceInput} className={cn('btn btn-ghost btn-sm !px-2', listening && '!bg-fg/[.08] !text-fg')} title="Dictar por voz">
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder={status?.configured ? 'Escribe tu consulta jurídica o de otra materia…' : 'Pregunta o busca un artículo (modo guiado sin IA)…'}
              className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-1 py-2 text-[13.5px] text-fg/90 outline-none placeholder:text-fg/25 disabled:opacity-50"
            />
            {pending ? (
              <button onClick={stop} className="btn btn-sm !rounded-xl !px-2.5" title="Detener"><Square size={14} /></button>
            ) : (
              <button onClick={() => send()} disabled={(!input.trim() && attachments.length === 0)} className="btn btn-primary !rounded-xl !px-3 !py-2" title="Enviar">
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-fg/20">
            <span>ETON AI puede equivocarse. Verifica siempre en la fuente oficial.</span>
            <div className="flex items-center gap-2">
              {messages.some((m) => m.role === 'assistant') && (
                <button onClick={regenerate} className="inline-flex items-center gap-1 hover:text-fg/50"><RefreshCw size={10} /> Regenerar</button>
              )}
              <span>Enter envía · Shift+Enter nueva línea</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MessageBubble({ message, onCopy }: { message: AiMessage; onCopy: () => void }) {
  const isUser = message.role === 'user';
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {isUser ? (
        <Avatar name="Tú" size={28} />
      ) : (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-fg text-paper"><Sparkles size={13} /></span>
      )}
      <div className={cn('min-w-0 max-w-[85%]', isUser && 'text-right')}>
        {isUser ? (
          <div className="bubble-me inline-block px-4 py-2.5 text-left text-[13.5px] leading-relaxed">
            {message.content}
          </div>
        ) : (
          <>
            <div className="prose-eton text-left"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
            <CitationList citations={message.citations} />
            <div className="mt-2 flex items-center gap-3 text-[10px] text-fg/20">
              {message.latencyMs && <span>{(message.latencyMs / 1000).toFixed(1)} s</span>}
              <button onClick={onCopy} className="inline-flex items-center gap-1 hover:text-fg/50"><Copy size={10} /> Copiar</button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

export function CitationList({ citations }: { citations: AiCitation[] }) {
  if (!citations || citations.length === 0) return null;
  const library = citations.filter((c) => c.kind !== 'web');
  const web = citations.filter((c) => c.kind === 'web');

  const chip = (c: AiCitation) => {
    const content = (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line/80 bg-white/60 px-2 py-1 text-[10.5px] text-fg/55 dark:bg-white/[.05]">
        <span className="font-mono text-[9px] text-fg">{c.ref}</span>
        {c.kind === 'web' && (
          <span className={cn(
            'rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide',
            c.official ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-fg/[.06] text-fg/45',
          )}>
            {c.official ? 'Web oficial' : 'Web'}
          </span>
        )}
        <span className="truncate">{c.label.length > 80 ? `${c.label.slice(0, 80)}…` : c.label}</span>
      </span>
    );
    if (c.slug) {
      const to = c.articleNumber
        ? `/biblioteca/${c.slug}?articulo=${encodeURIComponent(c.articleNumber)}`
        : `/biblioteca/${c.slug}`;
      return (
        <Link key={c.ref} to={to} title="Abrir en la biblioteca" className="max-w-full hover:opacity-80">
          {content}
        </Link>
      );
    }
    return c.url
      ? <a key={c.ref} href={c.url} target="_blank" rel="noreferrer" title={c.url} className="max-w-full hover:opacity-80">{content}</a>
      : <span key={c.ref} className="max-w-full">{content}</span>;
  };

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-line/80 bg-white/40 p-3 dark:bg-white/[.03]">
      {library.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-fg/30"><BookOpen size={11} /> Biblioteca ETON LEX</p>
          <div className="flex flex-wrap gap-1.5">{library.map(chip)}</div>
        </div>
      )}
      {web.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-fg/30"><Globe2 size={11} /> Fuentes externas consultadas</p>
          <div className="flex flex-wrap gap-1.5">{web.map(chip)}</div>
        </div>
      )}
    </div>
  );
}
