import { db } from '../../db/index.js';
import { retrieveForChat, type RetrievedBlock } from './retrieval.js';

export type ToolRun = {
  name: string;
  detail: string;
  ok: boolean;
};

export type ToolOutcome = {
  library: RetrievedBlock[];
  blocks: RetrievedBlock[];
  runs: ToolRun[];
};

const LAW_RE = /\bley\s*(?:n[°º.]?\s*)?(\d{2,5})\b/gi;
const DEADLINE_RE = /(\d{1,3})\s*d[ií]as?\s*(h[aá]biles?)?\s*(?:desde|de|contados?\s+desde)\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i;

function normLookup(query: string): { blocks: RetrievedBlock[]; runs: ToolRun[] } {
  const numbers = [...new Set([...query.matchAll(LAW_RE)].map((m) => m[1]))].slice(0, 3);
  if (numbers.length === 0) return { blocks: [], runs: [] };

  const placeholders = numbers.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, slug, title, short_title, number, summary, status, verification, official_url, published_at
    FROM norms WHERE number IN (${placeholders}) LIMIT 6
  `).all(...numbers) as any[];

  const blocks = rows.map((r) => ({
    id: `tool_norm_${r.id}`,
    kind: 'tool' as const,
    label: `Herramienta · catálogo de normas: ${r.short_title ?? r.title}`,
    text: [r.summary, `Tipo de búsqueda: número de ley ${r.number}`, `Estado registrado: ${r.status}`].filter(Boolean).join('\n'),
    url: r.official_url ?? null,
    meta: `Consulta directa al catálogo ETON LEX · verificación: ${r.verification}${r.published_at ? ` · publicación: ${r.published_at}` : ''}`,
    score: 0.85,
    normId: r.id,
    slug: r.slug,
    publishedAt: r.published_at ?? null,
  }));

  return {
    blocks,
    runs: [{
      name: 'open_official_source',
      detail: numbers.length > 0
        ? `Se consultó el catálogo por número de ley: ${numbers.join(', ')}; ${rows.length} coincidencia(s).`
        : 'No se detectó un número de ley consultable.',
      ok: rows.length > 0,
    }],
  };
}

function addDays(year: number, month: number, day: number, days: number, onlyBusiness: boolean): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (!onlyBusiness || (weekday !== 0 && weekday !== 6)) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

function deadline(query: string): { blocks: RetrievedBlock[]; runs: ToolRun[] } {
  const m = query.match(DEADLINE_RE);
  if (!m) return { blocks: [], runs: [] };
  const days = Number(m[1]);
  const onlyBusiness = Boolean(m[2]);
  const day = Number(m[3]);
  const month = Number(m[4]);
  const rawYear = Number(m[5]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const result = addDays(year, month, day, days, onlyBusiness);
  if (!result) return { blocks: [], runs: [{ name: 'calculate_deadline', detail: 'La fecha proporcionada no es válida.', ok: false }] };

  const block: RetrievedBlock = {
    id: `tool_deadline_${result}_${days}`,
    kind: 'tool',
    label: `Herramienta · cómputo orientativo de plazo`,
    text: `${days} ${onlyBusiness ? 'días hábiles' : 'días'} contados desde ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} → ${result}. Cómputo calendario orientativo: no considera feriados, suspensiones ni reglas procesales especiales; debe verificarse en la norma aplicable.`,
    url: null,
    meta: 'Resultado de herramienta interna · orientativo, no fuente jurídica',
    score: 0.8,
  };
  return {
    blocks: [block],
    runs: [{
      name: 'calculate_deadline',
      detail: `Cómputo ${onlyBusiness ? 'de días hábiles (sin feriados)' : 'de días calendario'} desde ${day}/${month}/${year}: ${result}.`,
      ok: true,
    }],
  };
}

/**
 * Ejecuta herramientas reales del lado del servidor. `search_library` ya está
 * resuelto por el recuperador; aquí se añaden consultas al catálogo y cómputo
 * de plazos. Cada resultado entra al contexto como fuente citables [F#].
 */
export async function runLegalTools(
  query: string,
  userId: string | null,
  conversationId: string | null,
  limit: number,
): Promise<ToolOutcome> {
  const library = await retrieveForChat(query, userId, conversationId, limit);
  const law = normLookup(query);
  const dates = deadline(query);
  const blocks = [...law.blocks, ...dates.blocks];
  return {
    library,
    blocks,
    runs: [
      { name: 'search_library', detail: `${library.length} bloque(s) recuperados de la biblioteca y documentos de la conversación.`, ok: true },
      ...law.runs,
      ...dates.runs,
    ],
  };
}
