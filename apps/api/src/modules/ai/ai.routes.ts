import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { db, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { fileBase64, safeUnlink, uploader, extractText } from '../../lib/files.js';
import { ApiError, asyncHandler, badRequest, forbidden, notFound } from '../../lib/http.js';
import { buildContextBlock, buildSystemPrompt, MODE_LABEL, type AiMode } from './prompts.js';
import { providerInfo, streamChat, type ChatMessage, type Part } from './providers.js';
import { citationFor, retrieveForChat, type RetrievedBlock } from './retrieval.js';
import { classifyIntent, expandFollowUp } from './intent.js';
import { researchWeb, type WebSource } from './web.js';

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

/**
 * El modelo puede mencionar artículos que no están en las fuentes entregadas.
 * No se reescribe su texto: se detecta y se avisa de forma visible para que
 * ninguna cita quede presentada como verificada sin serlo.
 */
function unverifiedArticleRefs(answer: string, blocks: RetrievedBlock[]): string[] {
  const known = new Set<string>();
  for (const b of blocks) {
    if (b.articleNumber) known.add(String(b.articleNumber).toUpperCase());
    const source = foldText(`${b.label} ${b.meta} ${b.text}`);
    for (const m of source.matchAll(/art(?:iculo|s?\.?)\s*(\d{1,4})/g)) known.add(m[1]);
  }
  const cited = new Set<string>();
  for (const m of answer.matchAll(/\bart(?:[ií]culo|s?\.?)\s*(\d{1,4})/gi)) cited.add(m[1]);
  return [...cited].filter((n) => !known.has(n) && !known.has(`${n}A`)).sort((a, b) => Number(a) - Number(b));
}

/** Normaliza para comparar texto legal: sin tildes, signos ni espacios de más. */
function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Detecta frases entrecomilladas que no aparecen en las fuentes. Un modelo
 * puede inventar una cita textual aunque no invente el número de artículo; se
 * compara el arranque de la cita con el texto disponible y, si no coincide, se
 * advierte en la respuesta en lugar de dejar pasar una cita falsa.
 */
function unverifiedQuotes(answer: string, blocks: RetrievedBlock[]): string[] {
  const corpus = normalizeForMatch(blocks.map((b) => `${b.text} ${b.meta}`).join(' '));
  if (!corpus) return [];
  const quotes = new Set<string>();
  for (const m of answer.matchAll(/[“"«]([^”"»]{25,400})[”"»]/g)) quotes.add(m[1].trim());
  const bad: string[] = [];
  for (const q of quotes) {
    const norm = normalizeForMatch(q);
    if (norm.length < 20) continue;
    // Se compara el comienzo: tolera cortes, puntos suspensivos o el final
    // reformulado, pero no una frase que no existe en la fuente.
    if (!corpus.includes(norm.slice(0, 60))) {
      bad.push(q.length > 90 ? `${q.slice(0, 90)}…` : q);
    }
  }
  return bad;
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
    modes: MODES.map((m) => ({ id: m, label: MODE_LABEL[m] })),
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
  const retrieved = await retrieveForChat(retrievalQuery, req.user!.id, Math.max(8, config.ai.libraryBlocks));

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
  const libraryBlocks = [...exact, ...rest]
    .filter((b) => (seenLibrary.has(b.id) ? false : (seenLibrary.add(b.id), true)))
    .slice(0, config.ai.libraryBlocks);

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

    for await (const delta of streamChat(messages, controller.signal)) {
      full += delta;
      send('delta', { text: delta });
    }

    // Control de veracidad: se evalúa únicamente el texto generado por el
    // modelo, antes de añadir advertencias, para que un aviso no dispare otro.
    const modelAnswer = full;
    const unsupported = unverifiedArticleRefs(modelAnswer, allBlocks);
    if (unsupported.length > 0) {
      const note = `\n\n---\n\n> ⚠️ **Verificación automática:** esta respuesta menciona el artículo ${unsupported.join(', artículo ')} sin que ese texto conste en las fuentes consultadas. Confírmalo en el diario oficial o en el SPIJ antes de usarlo.`;
      full += note;
      send('delta', { text: note });
    }

    const fakeQuotes = unverifiedQuotes(modelAnswer, allBlocks);
    if (fakeQuotes.length > 0) {
      const list = fakeQuotes.map((q) => `«${q}»`).join('; ');
      const note = `\n\n> ⚠️ **Cita textual no verificada:** ${list} no aparece literalmente en las fuentes consultadas. Puede ser una paráfrasis del modelo: no la uses como texto legal.`;
      full += note;
      send('delta', { text: note });
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
      config.ai.model, Date.now() - started,
    );
    db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    send('done', { id: assistantId, content: full, citations, latencyMs: Date.now() - started });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : (err as Error).message;
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
    const extracted = await extractText(file.path, file.mimetype);
    const id = uuid();
    db.prepare(`
      INSERT INTO ai_documents (id, user_id, conversation_id, name, mime, size, path, extracted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user!.id, conversationId, file.originalname.slice(0, 200), file.mimetype, file.size, file.path, extracted);
    out.push({
      id,
      name: file.originalname,
      mime: file.mimetype,
      size: file.size,
      extracted: Boolean(extracted),
      note: extracted ? null : file.mimetype.startsWith('image/') ? 'Se enviará al modelo como imagen.' : 'No se pudo extraer texto de este archivo.',
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

aiRouter.delete('/documents/:id', asyncHandler(async (req, res) => {
  const doc = db.prepare('SELECT * FROM ai_documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
  if (!doc) throw notFound('Documento no encontrado.');
  safeUnlink(doc.path);
  db.prepare('DELETE FROM ai_documents WHERE id = ?').run(doc.id);
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
