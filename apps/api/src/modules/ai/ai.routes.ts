import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { db, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { fileBase64, safeUnlink, uploader, extractDocument, chunkDocument } from '../../lib/files.js';
import { ApiError, asyncHandler, badRequest, forbidden, notFound } from '../../lib/http.js';
import { buildContextBlock, buildSystemPrompt, MODE_LABEL, type AiMode } from './prompts.js';
import { providerInfo, type ChatMessage, type Part, type UsageInfo } from './providers.js';
import { citationFor, type RetrievedBlock } from './retrieval.js';
import { classifyIntent, expandFollowUp } from './intent.js';
import { researchWeb, type WebSource } from './web.js';
import { route, routerStatus, type ModelRole } from './router.js';
import { synthesize } from './synthesizer.js';
import { runLegalTools } from './tools.js';
import { verifyAnswer } from './verify.js';
import { generateDocument, safeFileName, type GeneratedKind } from './generate.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const MODES = Object.keys(MODE_LABEL) as AiMode[];

const ARTICLE_INTENT_RE = /\bart(?:[íi]culo|\.)\s*([0-9]+[a-z]?(?:\s*-\s*[a-z])?)/i;

/**
 * Normaliza para comparar sin depender de tildes ni mayúsculas: «Código
 * Civil» y «codigo civil» deben puntuar igual.
 */
function foldText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HINT_STOPWORDS = new Set(
  'de del la el los las un una unos unas y o que en al por para con sin sobre'.split(' '),
);

/**
 * Recupera el artículo exacto cuando la consulta dice «artículo 196 del
 * Código Civil». La búsqueda FTS por sí sola devuelve decenas de artículos
 * que comparten palabras, no el número pedido.
 */
function exactArticleBlocks(query: string): RetrievedBlock[] {
  const match = query.match(ARTICLE_INTENT_RE);
  if (!match) return [];
  const number = match[1].replace(/\s*-\s*/g, '-').toUpperCase();
  const hintTokens = foldText(query.replace(match[0], ' '))
    .split(' ')
    .filter((t) => t.length > 1 && !HINT_STOPWORDS.has(t));

  // Se buscan todos los artículos con ese número (suelen ser pocos) y se
  // puntúa la coincidencia con el nombre de la norma en JavaScript, porque
  // SQLite no pliega tildes de forma nativa.
  const candidates = db.prepare(`
    SELECT a.id, a.number, a.heading, a.text, n.id AS norm_id, n.slug, n.short_title, n.title,
           n.number AS norm_number, n.status, n.verification, n.official_url
    FROM articles a JOIN norms n ON n.id = a.norm_id
    WHERE a.number = ?
    ORDER BY n.title
    LIMIT 400
  `).all(number) as any[];

  const scored = candidates.map((r) => {
    // Se compara el nombre de la norma con las palabras de la consulta. Solo
    // cuentan las palabras que identifican la norma («codigo», «civil»,
    // «tributario»…), no las del resto de la pregunta («explícame», «límites»).
    const normName = foldText(r.short_title || r.title);
    const nameTokens = normName
      .split(' ')
      .filter((t) => t.length > 1 && !HINT_STOPWORDS.has(t) && !/^\d+$/.test(t));
    const hintSet = new Set(hintTokens);
    const matched = nameTokens.filter((t) => hintSet.has(t)).length;
    const coverage = nameTokens.length > 0 ? matched / nameTokens.length : 0;
    // Mención literal del nombre completo en la consulta: máxima prioridad.
    const explicit = normName.length > 4 && foldText(query).includes(normName) ? 1 : 0;
    return { row: r, coverage, matched, explicit, nameTokens: nameTokens.length };
  });

  const best = scored.reduce((max, s) => Math.max(max, s.coverage), 0);
  const explicitBest = scored.some((s) => s.explicit === 1);
  // Si la consulta nombra una norma, solo se devuelven artículos de esa norma.
  // Si no la nombra («artículo 920» a secas), se muestran las coincidencias.
  const rows = scored
    .filter((s) => {
      if (explicitBest) return s.explicit === 1;
      if (best === 0) return true;
      return s.matched > 0 && s.coverage >= Math.max(0.5, best - 0.15);
    })
    .sort((a, b) => b.explicit - a.explicit || b.coverage - a.coverage || a.row.title.localeCompare(b.row.title))
    .slice(0, 5)
    .map((s) => s.row);
  return rows.map((r) => ({
    id: `art_${r.id}`,
    kind: 'article' as const,
    label: `${r.short_title ?? r.title} · Artículo ${r.number}${r.heading ? ` — ${r.heading}` : ''}`,
    text: r.text,
    url: r.official_url,
    meta: `Norma: ${r.norm_number ?? r.title} · Estado: ${r.status}${r.verification === 'pending' ? ' · metadatos por verificar' : ''}`,
    score: 2,
    normId: r.norm_id,
    articleId: r.id,
    slug: r.slug,
    articleNumber: r.number,
  }));
}

/**
 * Convierte una fuente web en un bloque citables con el mismo formato que la
 * biblioteca, para que el modelo use [F#] y la interfaz muestre el origen.
 */
function webToBlock(src: WebSource, index: number): RetrievedBlock {
  const label = `Web ${src.official ? 'oficial' : 'externa'} · ${src.domain} — ${src.title}`;
  const summary = src.snippet && src.text && !src.text.includes(src.snippet) ? `Resumen del buscador: ${src.snippet}` : '';
  return {
    id: `web_${index + 1}`,
    kind: 'web',
    label,
    text: [src.text || src.snippet, summary].filter(Boolean).join('\n\n'),
    url: src.url,
    meta: `Dominio: ${src.domain}${src.official ? ' · fuente oficial' : ' · fuente no oficial'} · ${src.fetched ? 'página leída en esta consulta' : 'solo resultado de búsqueda'}`,
    score: src.official ? 0.9 : 0.7,
    official: src.official,
    publishedAt: src.publishedAt,
  };
}

/**
 * Respuesta determinista del «modo biblioteca»: no redacta Derecho ni simula
 * IA. Solo muestra el texto literal encontrado y su fuente.
 */
function buildLibraryAnswer(query: string, blocks: RetrievedBlock[], web: RetrievedBlock[] = []): string {
  const articles = blocks.filter((b) => b.kind === 'article').slice(0, 5);
  const norms = blocks.filter((b) => b.kind === 'norm').slice(0, 3);
  const out: string[] = [
    '**Modo biblioteca (sin IA conectada).** Esta respuesta no la generó un modelo de lenguaje: es una selección literal de la biblioteca de ETON LEX.',
    '',
    `Consulta: «${query.slice(0, 300)}»`,
    '',
  ];

  if (articles.length === 0) {
    out.push('No se encontraron artículos que coincidan con la búsqueda.');
    out.push('');
    out.push('Prueba con el número de artículo y la norma (por ejemplo, «artículo 196 del Código Civil») o usa el buscador de la biblioteca.');
  } else {
    out.push(`Se encontraron ${articles.length} artículo(s) en la biblioteca:`);
    articles.forEach((b, index) => {
      const excerpt = b.text.replace(/\s+/g, ' ').trim();
      out.push('');
      out.push(`**${index + 1}. ${b.label}**`);
      out.push('');
      out.push(`> ${excerpt.length > 1400 ? `${excerpt.slice(0, 1400)}…` : excerpt}`);
      out.push('');
      out.push(`Fuente: ${b.url ?? 'no registrada'} · ${b.meta}`);
    });
  }

  if (norms.length > 0) {
    out.push('');
    out.push('**Normas relacionadas en el catálogo**');
    for (const norm of norms) out.push(`- ${norm.label}${norm.url ? ` — ${norm.url}` : ''}`);
  }

  if (web.length > 0) {
    out.push('');
    out.push('**Fuentes externas encontradas (sin análisis de IA)**');
    for (const src of web.slice(0, 6)) out.push(`- ${src.label}${src.url ? ` — ${src.url}` : ''}`);
    out.push('');
    out.push('Estos enlaces no fueron redactados ni interpretados por un modelo: son resultados de la investigación web.');
  }

  out.push('');
  out.push('Para obtener una explicación redactada por un modelo, el administrador debe configurar `AI_PROVIDER`, `AI_MODEL` y, si corresponde, `AI_API_KEY` en el servidor. La plataforma no simula respuestas de IA.');
  return out.join('\n');
}

/** Registro de consumo real; nunca se estima un coste que no conocemos. */
function recordUsage(entry: {
  userId: string;
  conversationId: string;
  role: ModelRole | 'single' | 'biblioteca';
  provider: string;
  model: string;
  promptChars: number;
  completionChars: number;
  usage?: UsageInfo | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
}) {
  try {
    db.prepare(`
      INSERT INTO ai_usage (id, user_id, conversation_id, role, provider, model,
        prompt_chars, completion_chars, usage_json, latency_ms, ok, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), entry.userId, entry.conversationId, entry.role, entry.provider, entry.model,
      entry.promptChars, entry.completionChars, entry.usage ? JSON.stringify(entry.usage) : null,
      entry.latencyMs, entry.ok ? 1 : 0, entry.error ?? null,
    );
  } catch (err) {
    console.warn('[ai] no se pudo registrar ai_usage:', (err as Error).message);
  }
}

/** Números de ley citados que no aparecen en ninguna fuente del contexto. */
function unverifiedLawRefs(answer: string, blocks: RetrievedBlock[]): string[] {
  const corpus = blocks.map((b) => `${b.label} ${b.meta} ${b.text}`).join(' ');
  const known = new Set(
    [...corpus.matchAll(/\bley\s*(?:n[°º.]?\s*)?(\d{2,5})\b/gi)].map((m) => m[1]),
  );
  const cited = new Set(
    [...answer.matchAll(/\bley\s*(?:n[°º.]?\s*)?(\d{2,5})\b/gi)].map((m) => m[1]),
  );
  return [...cited].filter((n) => !known.has(n)).sort((a, b) => Number(a) - Number(b));
}

/** Figuras ajenas al ordenamiento peruano que el modelo suele inventar. */
function unverifiedForeignTerms(answer: string, blocks: RetrievedBlock[]): string[] {
  const corpus = foldText(blocks.map((b) => `${b.label} ${b.meta} ${b.text}`).join(' '));
  const terms = ['Corte Constitucional', 'acción de tutela', 'Ley 31307'];
  return terms.filter((t) => new RegExp(`\\b${t.replace(/ /g, '\\s+')}\\b`, 'i').test(answer)
    && !corpus.includes(foldText(t)));
}

/**
 * Una sección de fuentes sin marcadores [F#] en el cuerpo es una lista suelta
 * de enlaces: no permite saber qué afirmación respalda cada fuente. Se retira
 * y se sustituye por una advertencia explícita.
 */
function stripUnlinkedSources(answer: string): string {
  if (/\[F\d+\]/.test(answer)) return answer;
  const header = /(?:^|\n)[ \t]*(?:#{1,6}\s*)?\*{0,2}(?:Fuentes(?: consultadas| externas| consultadas externas)?|Bibliografía|Referencias)\*{0,2}\s*:?[ \t]*(?:\n|$)/i;
  if (!header.test(answer)) return answer;
  const note = '\n\n> ⚠️ **Fuentes no vinculadas:** se retiró la lista de fuentes porque el cuerpo de la respuesta no usa marcadores [F#]. Las fuentes se muestran en el panel de la conversación, pero no se ha podido asociar cada una con una afirmación concreta.';
  return `${answer.replace(header, '\n')}${note}`;
}

aiRouter.get('/status', asyncHandler(async (_req, res) => {
  res.json({
    ...providerInfo(),
    router: routerStatus(),
    tools: [
      { name: 'search_library', enabled: true, detail: 'Recuperación en biblioteca, noticias y documentos de la conversación.' },
      { name: 'open_official_source', enabled: true, detail: 'Consulta al catálogo de normas e investigación web oficial.' },
      { name: 'calculate_deadline', enabled: true, detail: 'Cómputo orientativo de plazos; no sustituye la norma procesal aplicable.' },
    ],
    modes: MODES.map((m) => ({ id: m, label: MODE_LABEL[m] })),
    exports: [
      { kind: 'docx', label: 'Word', enabled: true },
      { kind: 'pptx', label: 'PowerPoint', enabled: true },
      { kind: 'xlsx', label: 'Excel', enabled: true },
    ],
    voice: { input: 'Web Speech API (navegador)', output: 'Speech Synthesis (navegador)' },
    research: {
      web: config.webResearch.enabled,
      engine: 'duckduckgo',
      maxSources: config.webResearch.maxSources,
      timeoutMs: config.webResearch.timeoutMs,
    },
    limits: {
      maxUploadMb: config.maxUploadMb,
      maxTokens: config.ai.maxTokens,
      historyMessages: config.ai.historyMessages,
      contextChars: config.ai.contextChars,
      libraryBlocks: config.ai.libraryBlocks,
    },
  });
}));

aiRouter.get('/conversations', asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS messages,
      (SELECT content FROM ai_messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS preview
    FROM ai_conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 60
  `).all(req.user!.id);
  res.json({ conversations: rows });
}));

aiRouter.post('/conversations', asyncHandler(async (req, res) => {
  const { title, mode } = z.object({
    title: z.string().trim().max(120).optional(),
    mode: z.enum(MODES as [AiMode, ...AiMode[]]).optional(),
  }).parse(req.body ?? {});
  const id = uuid();
  db.prepare('INSERT INTO ai_conversations (id, user_id, title, mode) VALUES (?, ?, ?, ?)')
    .run(id, req.user!.id, title ?? 'Nueva consulta', mode ?? 'auto');
  res.status(201).json({ conversation: db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id) });
}));

aiRouter.get('/conversations/:id', asyncHandler(async (req, res) => {
  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
  if (!conv) throw notFound('Conversación no encontrada.');
  const messages = db.prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conv.id) as any[];
  res.json({
    conversation: conv,
    messages: messages.map((m) => ({
      id: m.id, role: m.role, content: m.content,
      citations: JSON.parse(m.citations ?? '[]'), sources: JSON.parse(m.sources ?? '[]'),
      model: m.model, latencyMs: m.latency_ms, createdAt: m.created_at,
    })),
  });
}));

aiRouter.patch('/conversations/:id', asyncHandler(async (req, res) => {
  const data = z.object({ title: z.string().trim().min(1).max(120).optional(), mode: z.enum(MODES as [AiMode, ...AiMode[]]).optional() }).parse(req.body);
  const conv = db.prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!conv) throw notFound('Conversación no encontrada.');
  if (data.title) db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(data.title, req.params.id);
  if (data.mode) db.prepare('UPDATE ai_conversations SET mode = ? WHERE id = ?').run(data.mode, req.params.id);
  res.json({ ok: true });
}));

aiRouter.delete('/conversations/:id', asyncHandler(async (req, res) => {
  db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
}));

// ── Chat con streaming (SSE) ────────────────────────────────────
aiRouter.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const data = z.object({
    content: z.string().trim().max(12_000).optional(),
    mode: z.enum(MODES as [AiMode, ...AiMode[]]).optional(),
    attachmentIds: z.array(z.string().uuid()).max(4).optional(),
  }).parse(req.body);

  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
  if (!conv) throw notFound('Conversación no encontrada.');

  const docs = data.attachmentIds?.length
    ? db.prepare(`SELECT * FROM ai_documents WHERE user_id = ? AND id IN (${data.attachmentIds.map(() => '?').join(',')})`)
        .all(req.user!.id, ...data.attachmentIds) as any[]
    : [];

  // Un archivo recién subido no tiene conversación todavía. Al adjuntarlo se
  // asocia a esta conversación: así el seguimiento lo recupera sin volver a
  // cargarlo, pero nunca aparece en otras conversaciones del usuario.
  const unbound = docs.filter((d) => !d.conversation_id).map((d) => d.id);
  if (unbound.length) {
    const mark = db.prepare('UPDATE ai_documents SET conversation_id = ? WHERE id = ? AND user_id = ? AND conversation_id IS NULL');
    for (const id of unbound) mark.run(conv.id, id, req.user!.id);
  }

  const textParts: string[] = [];
  const imageParts: Part[] = [];
  for (const doc of docs) {
    if (doc.mime.startsWith('image/') && fs.existsSync(doc.path)) {
      imageParts.push({ type: 'image', mime: doc.mime, dataBase64: fileBase64(doc.path) });
    } else if (doc.extracted) {
      textParts.push(`Documento adjunto "${doc.name}":\n${doc.extracted.slice(0, 20_000)}`);
    }
  }

  const userContent = [data.content ?? '', ...textParts].filter(Boolean).join('\n\n').trim();
  if (!userContent && imageParts.length === 0) throw badRequest('Escribe una consulta o adjunta un documento.');

  const mode: AiMode = data.mode ?? (conv.mode as AiMode) ?? 'auto';

  const history = db.prepare(`
    SELECT role, content FROM ai_messages WHERE conversation_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(conv.id, config.ai.historyMessages) as Array<{ role: string; content: string }>;
  history.reverse();

  const query = userContent || 'documento adjunto';
  const plan = classifyIntent(query, history);
  const retrievalQuery = plan.kind === 'seguimiento' ? expandFollowUp(query, history) : query;
  const toolsOutcome = await runLegalTools(retrievalQuery, req.user!.id, conv.id, Math.max(8, config.ai.libraryBlocks));
  const retrieved = toolsOutcome.library;

  // El artículo exacto («artículo 920 del Código Civil») debe ir primero; la
  // búsqueda FTS sola devuelve artículos que comparten palabras, no el pedido.
  // En un seguimiento («¿y si…?») se arrastra el artículo del turno anterior:
  // el usuario no tiene que repetir el número.
  const carried = plan.kind === 'seguimiento'
    ? history
        .filter((m) => m.role === 'user')
        .slice(-3)
        .flatMap((m) => exactArticleBlocks(m.content))
    : [];
  const exactSeen = new Set<string>();
  const exact = [...(userContent ? exactArticleBlocks(userContent) : []), ...carried]
    .filter((b) => (exactSeen.has(b.id) ? false : (exactSeen.add(b.id), true)))
    .slice(0, 3);
  const exactNormIds = new Set(exact.map((b) => b.normId).filter(Boolean));
  const rest = exact.length > 0
    ? retrieved.filter((b) => b.kind !== 'article' && b.normId && exactNormIds.has(b.normId))
    : retrieved;
  const seenLibrary = new Set<string>();
  const libraryBlocks = [...exact, ...rest, ...toolsOutcome.blocks]
    .filter((b) => (seenLibrary.has(b.id) ? false : (seenLibrary.add(b.id), true)))
    .slice(0, config.ai.libraryBlocks + toolsOutcome.blocks.length);

  const webEnabled = config.webResearch.enabled && plan.useWeb && Boolean(userContent.trim());

  const userMessageId = uuid();
  db.prepare('INSERT INTO ai_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)')
    .run(userMessageId, conv.id, 'user', userContent || `[imagen adjunta: ${docs.map((d) => d.name).join(', ')}]`);

  if (conv.title === 'Nueva consulta' && userContent) {
    db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?')
      .run(userContent.slice(0, 70), conv.id);
  }
  db.prepare("UPDATE ai_conversations SET updated_at = datetime('now'), mode = ? WHERE id = ?").run(mode, conv.id);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const send = (event: string, payload: unknown) => {
    if (controller.signal.aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  // Los modelos locales en CPU pueden tardar más de un minuto en empezar a
  // responder. Un comentario SSE cada 15 s evita que el túnel público corte la
  // conexión por inactividad; el cliente ignora las líneas de comentario.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n');
  }, 15_000);
  res.on('close', () => clearInterval(heartbeat));

  const planPayload = {
    kind: plan.kind,
    label: plan.label,
    reason: plan.reason,
    usesLibrary: libraryBlocks.length > 0,
    usesWeb: webEnabled,
  };

  // Primero se muestra lo que ya está en la biblioteca; así la persona ve
  // actividad mientras se consultan fuentes externas.
  send('meta', {
    userMessageId,
    mode,
    libraryMode: !providerInfo().configured,
    plan: planPayload,
    tools: toolsOutcome.runs,
    web: { status: webEnabled ? 'searching' : 'off', enabled: config.webResearch.enabled, engine: 'duckduckgo' },
    citations: libraryBlocks.map(citationFor),
    retrieval: libraryBlocks.map((b) => ({ kind: b.kind, label: b.label })),
  });

  const started = Date.now();
  let web: Awaited<ReturnType<typeof researchWeb>> | null = null;
  let webBlocks: RetrievedBlock[] = [];

  if (webEnabled) {
    send('status', { stage: 'web', message: 'Investigando en fuentes oficiales y jurisprudencia…' });
    web = await researchWeb(plan.webQuery, {
      officialDomains: plan.officialDomains,
      maxSources: config.webResearch.maxSources,
      timeoutMs: config.webResearch.timeoutMs,
      maxChars: config.webResearch.maxPageChars,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    webBlocks = web.sources.map((src, index) => webToBlock(src, index));
  }

  const allBlocks = [...libraryBlocks, ...webBlocks];
  const citations = allBlocks.map(citationFor);

  // Sin proveedor de IA, el chat no se bloquea: responde en «modo biblioteca»
  // con el texto literal de los artículos encontrados, sin inventar nada.
  if (!providerInfo().configured) {
    const answer = buildLibraryAnswer(userContent || 'documento adjunto', libraryBlocks, webBlocks);
    send('meta', {
      userMessageId,
      mode: 'biblioteca',
      libraryMode: true,
      plan: planPayload,
      tools: toolsOutcome.runs,
      web: web ? { status: web.sources.length > 0 ? 'done' : 'empty', results: web.sources.length, errors: web.errors, tookMs: web.tookMs } : { status: 'off' },
      citations,
      retrieval: allBlocks.map((b) => ({ kind: b.kind, label: b.label })),
    });
    for (let i = 0; i < answer.length; i += 600) {
      send('delta', { text: answer.slice(i, i + 600) });
    }
    const assistantId = uuid();
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, citations, sources, model, latency_ms)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
    `).run(
      assistantId,
      conv.id,
      answer,
      JSON.stringify(citations),
      JSON.stringify(allBlocks.map((b) => ({ label: b.label, url: b.url, kind: b.kind }))),
      'biblioteca',
      Date.now() - started,
    );
    db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    recordUsage({
      userId: req.user!.id,
      conversationId: conv.id,
      role: 'biblioteca',
      provider: 'none',
      model: 'biblioteca',
      promptChars: query.length,
      completionChars: answer.length,
      latencyMs: Date.now() - started,
      ok: true,
    });
    send('done', {
      id: assistantId,
      content: answer,
      citations,
      latencyMs: Date.now() - started,
      libraryMode: true,
    });
    res.end();
    return;
  }

  const context = buildContextBlock(allBlocks, { maxTotalChars: config.ai.contextChars });
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(mode, {
        hasLibrary: libraryBlocks.length > 0,
        hasWeb: webBlocks.length > 0,
        webErrors: web?.errors,
        plan: { kind: plan.kind, label: plan.label, reason: plan.reason },
      }) + context,
    },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.slice(0, 1500),
    })),
    {
      role: 'user',
      content: imageParts.length
        ? [{ type: 'text', text: userContent || 'Analiza la imagen adjunta.' } as Part, ...imageParts]
        : userContent,
    },
  ];

  let full = '';
  try {
    send('meta', {
      userMessageId,
      mode,
      plan: planPayload,
      tools: toolsOutcome.runs,
      web: web
        ? {
            status: web.sources.length > 0 ? 'done' : 'empty',
            results: web.sources.length,
            errors: web.errors,
            tookMs: web.tookMs,
          }
        : { status: config.webResearch.enabled ? 'off' : 'disabled' },
      citations,
      retrieval: allBlocks.map((b) => ({ kind: b.kind, label: b.label })),
    });

    // El sintetizador usa modelos distintos solo si el router los tiene
    // configurados. Cada etapa se anuncia por SSE con el modelo realmente usado.
    const synthesis = await synthesize({
      messages,
      signal: controller.signal,
      onStage: (stage, message) => {
        const choice = route(stage === 'reasoning' ? 'reasoning' : 'clarity');
        send('status', { stage, message, model: choice.label });
      },
      emitDelta: (delta) => {
        full += delta;
        send('delta', { text: delta });
      },
    });

    // Control de veracidad: se evalúa únicamente el texto generado por el
    // modelo, antes de añadir advertencias, para que un aviso no dispare otro.
    const modelAnswer = full;
    const verification = verifyAnswer(full, allBlocks);
    full = verification.text;
    for (const note of verification.warnings) {
      full += note;
      send('delta', { text: note });
    }

    const promptChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : m.content.reduce((s, p) => s + (p.type === 'text' ? p.text.length : p.dataBase64.length), 0)),
      0,
    );
    if (synthesis.usage.length === 0) {
      const choice = route('clarity');
      recordUsage({
        userId: req.user!.id,
        conversationId: conv.id,
        role: 'single',
        provider: choice.target.provider,
        model: choice.target.model,
        promptChars,
        completionChars: synthesis.text.length,
        latencyMs: Date.now() - started,
        ok: true,
      });
    } else {
      for (const entry of synthesis.usage) {
        const choice = route(entry.role);
        recordUsage({
          userId: req.user!.id,
          conversationId: conv.id,
          role: entry.role,
          provider: choice.target.provider,
          model: choice.target.model,
          promptChars,
          completionChars: synthesis.text.length,
          usage: entry.info,
          latencyMs: Date.now() - started,
          ok: true,
        });
      }
    }

    const inventedLaws = unverifiedLawRefs(modelAnswer, allBlocks);
    if (inventedLaws.length > 0) {
      const note = `\n\n> ⚠️ **Norma no verificada:** se menciona(n) la(s) Ley ${inventedLaws.join(', Ley ')} sin que aparezca(n) en las fuentes consultadas. No des por verificada esa referencia.`;
      full += note;
      send('delta', { text: note });
    }

    const foreignTerms = unverifiedForeignTerms(modelAnswer, allBlocks);
    if (foreignTerms.length > 0) {
      const note = `\n\n> ⚠️ **Figura ajena al contexto:** ${foreignTerms.join(', ')} no consta en las fuentes peruanas recuperadas. En Perú corresponde verificar el Tribunal Constitucional y las normas peruanas vigentes.`;
      full += note;
      send('delta', { text: note });
    }

    // Si el modelo listó fuentes sin marcar ninguna afirmación con [F#], se
    // retira esa lista del texto final y se explica por qué en la respuesta.
    const corrected = stripUnlinkedSources(full);
    if (corrected !== full) {
      full = corrected;
      send('delta', { text: '\n\n> ⚠️ Se retiró la sección de fuentes porque el cuerpo no vinculó ninguna afirmación con marcadores [F#].' });
    }

    const assistantId = uuid();
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, citations, sources, model, latency_ms)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
    `).run(
      assistantId, conv.id, full,
      JSON.stringify(citations),
      JSON.stringify(allBlocks.map((b) => ({ label: b.label, url: b.url, kind: b.kind }))),
      synthesis.roles.map((r) => route(r).label).join(' → '), Date.now() - started,
    );
    db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    send('done', {
      id: assistantId,
      content: full,
      citations,
      latencyMs: Date.now() - started,
      roles: synthesis.roles,
      verification: verification.checks,
    });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : (err as Error).message;
    const choice = route('clarity');
    recordUsage({
      userId: req.user!.id,
      conversationId: conv.id,
      role: 'single',
      provider: choice.target.provider,
      model: choice.target.model,
      promptChars: query.length,
      completionChars: full.length,
      latencyMs: Date.now() - started,
      ok: false,
      error: message.slice(0, 400),
    });
    send('error', { message: controller.signal.aborted ? 'Respuesta interrumpida.' : message });
  } finally {
    res.end();
  }
}));

// ── Documentos para ETON AI ────────────────────────────────────
aiRouter.post('/documents', uploader('ai').array('files', 5), asyncHandler(async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) throw badRequest('No se recibió ningún archivo.');
  const conversationId = typeof req.body.conversationId === 'string' ? req.body.conversationId : null;

  const out = [];
  for (const file of files) {
    const document = await extractDocument(file.path, file.mimetype);
    const extracted = document?.text ?? null;
    const id = uuid();
    const name = file.originalname.slice(0, 200);
    db.prepare(`
      INSERT INTO ai_documents (id, user_id, conversation_id, name, mime, size, path, extracted, pages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user!.id, conversationId, name, file.mimetype, file.size, file.path, extracted, document?.pages ?? null);

    // Los fragmentos se calculan una sola vez, al subir el archivo. Cada uno
    // conserva página, desplazamiento y sección para poder citarse con precisión.
    const chunks = document ? chunkDocument(document) : [];
    if (chunks.length > 0) {
      const insert = db.prepare(`
        INSERT INTO document_chunks (id, document_id, user_id, conversation_id, chunk_index,
          page, char_offset, section, label, text, chars)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        insert.run(
          uuid(), id, req.user!.id, conversationId, chunk.index,
          chunk.page, chunk.charOffset, chunk.section,
          name, chunk.text, chunk.text.length,
        );
      }
    }

    out.push({
      id,
      name: file.originalname,
      mime: file.mimetype,
      size: file.size,
      extracted: Boolean(extracted),
      pages: document?.pages ?? null,
      chunks: chunks.length,
      note: extracted
        ? chunks.length > 0
          ? `${chunks.length} fragmento(s) indexado(s) para citas por página/sección.`
          : 'Texto extraído; el documento es suficientemente corto y se usa completo.'
        : file.mimetype.startsWith('image/')
          ? 'Se enviará al modelo como imagen; no hay OCR configurado que invente texto.'
          : 'No se pudo extraer texto de este archivo.',
    });
  }
  res.status(201).json({ documents: out });
}));

aiRouter.get('/documents', asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, mime, size, pages, created_at, LENGTH(COALESCE(extracted,'')) AS chars
    FROM ai_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.user!.id);
  res.json({ documents: rows });
}));

aiRouter.get('/documents/:id/chunks', asyncHandler(async (req, res) => {
  const doc = db.prepare('SELECT id, name, pages FROM ai_documents WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as any;
  if (!doc) throw notFound('Documento no encontrado.');
  const chunks = db.prepare(`
    SELECT id, chunk_index AS chunkIndex, page, char_offset AS charOffset, section, text, chars
    FROM document_chunks WHERE document_id = ? AND user_id = ? ORDER BY chunk_index
  `).all(doc.id, req.user!.id);
  res.json({ document: { id: doc.id, name: doc.name, pages: doc.pages }, chunks });
}));

aiRouter.delete('/documents/:id', asyncHandler(async (req, res) => {
  const doc = db.prepare('SELECT * FROM ai_documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
  if (!doc) throw notFound('Documento no encontrado.');
  safeUnlink(doc.path);
  db.prepare('DELETE FROM ai_documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
}));

// ── Exportación real (Fase 3): Word, PowerPoint y Excel ────────
const generatedSchema = z.object({
  kind: z.enum(['docx', 'pptx', 'xlsx']),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().max(50_000).optional(),
  sections: z.array(z.object({
    heading: z.string().trim().max(160).optional(),
    body: z.string().trim().max(20_000),
  })).max(60).optional(),
  conversationId: z.string().uuid().optional(),
  columns: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  rows: z.array(z.union([
    z.array(z.union([z.string(), z.number()])).max(30),
    z.record(z.union([z.string(), z.number()])),
  ])).max(2000).optional(),
});

aiRouter.post('/generated', asyncHandler(async (req, res) => {
  const data = generatedSchema.parse(req.body);
  const sections = data.sections ?? [];
  let content = data.content?.trim() ?? '';
  let sourceLabel: string | undefined;

  if (data.conversationId) {
    const owned = db.prepare('SELECT id, title FROM ai_conversations WHERE id = ? AND user_id = ?')
      .get(data.conversationId, req.user!.id) as { id: string; title: string } | undefined;
    if (!owned) throw notFound('Conversación no encontrada.');
    if (!content) {
      const last = db.prepare(`
        SELECT content FROM ai_messages
        WHERE conversation_id = ? AND role = 'assistant' AND content <> ''
        ORDER BY created_at DESC LIMIT 1
      `).get(owned.id) as { content: string } | undefined;
      content = last?.content?.trim() ?? '';
      sourceLabel = `Última respuesta de ETON AI · ${owned.title}`;
    }
  }

  if (!content && sections.length === 0 && !data.rows?.length) {
    throw badRequest('Escribe un contenido, añade secciones o elige una conversación con respuesta.');
  }
  if (content && sections.length === 0) sections.push({ body: content });
  else if (content && sections.length > 0 && !sections.some((s) => s.body === content)) {
    sections.unshift({ body: content });
  }

  const generated = await generateDocument(data.kind as GeneratedKind, {
    title: data.title,
    sections,
    columns: data.columns,
    rows: data.rows,
    sourceLabel,
  });

  const id = uuid();
  const storedName = `${id}-${safeFileName(data.title, generated.ext)}`;
  const fullPath = path.join(config.paths.generated, storedName);
  await fs.promises.writeFile(fullPath, generated.buffer);

  db.prepare(`
    INSERT INTO generated_files (id, user_id, conversation_id, kind, name, mime, path, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user!.id, data.conversationId ?? null, generated.ext,
    safeFileName(data.title, generated.ext), generated.mime, fullPath, generated.buffer.length,
  );

  res.status(201).json({
    file: {
      id,
      name: safeFileName(data.title, generated.ext),
      kind: generated.ext,
      mime: generated.mime,
      size: generated.buffer.length,
      downloadUrl: `/api/ai/generated/${id}/download`,
    },
  });
}));

aiRouter.get('/generated', asyncHandler(async (req, res) => {
  const files = db.prepare(`
    SELECT id, kind, name, mime, size, conversation_id AS conversationId, created_at AS createdAt
    FROM generated_files WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.user!.id);
  res.json({ files });
}));

aiRouter.get('/generated/:id/download', asyncHandler(async (req, res) => {
  const file = db.prepare('SELECT * FROM generated_files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as any;
  if (!file) throw notFound('Archivo generado no encontrado.');
  if (!fs.existsSync(file.path)) throw notFound('El archivo ya no está disponible en el servidor.');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.send(fs.readFileSync(file.path));
}));

aiRouter.delete('/generated/:id', asyncHandler(async (req, res) => {
  const file = db.prepare('SELECT * FROM generated_files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as any;
  if (!file) throw notFound('Archivo generado no encontrado.');
  safeUnlink(file.path);
  db.prepare('DELETE FROM generated_files WHERE id = ?').run(file.id);
  res.json({ ok: true });
}));

aiRouter.get('/history', asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, c.title
    FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.role = 'user'
    ORDER BY m.created_at DESC LIMIT 50
  `).all(req.user!.id);
  res.json({ history: rows });
}));
