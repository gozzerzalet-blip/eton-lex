import { db } from '../../db/index.js';
import { embedTexts } from './providers.js';
const STOPWORDS = new Set('de la el los las un una unos unas y o u que en del al por para con sin sobre como cual cuales quien quienes cuanto cuanta es son fue ser esta este esto estas estos su sus mi mis tu tus se lo le les mas pero si no ni tambien cuando donde porque que qué cómo cuál diferencia diferencias explicame explica explicar explicación ejemplo ejemplos derecho peruano peruana perú significado significa concepto definición definicion cada entre hace tiene tiene puede pueden sirve aplica aplicación caso casos práctico practico'.split(/\s+/));
function tokensOf(input, max = 12) {
    const seen = new Set();
    const out = [];
    for (const t of input
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)) {
        if (t.length <= 2 || STOPWORDS.has(t) || seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
        if (out.length >= max)
            break;
    }
    return out;
}
function ftsQuery(input) {
    const tokens = tokensOf(input);
    if (tokens.length === 0)
        return '';
    return tokens.map((t) => `"${t}"`).join(' OR ');
}
const fold = (input) => input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/**
 * Cuenta cuántas palabras de la consulta aparecen realmente en el texto. Se
 * compara por prefijo de 5 letras para tolerar plurales y flexiones
 * («posesión» / «posesiones», «arrendar» / «arrendamiento»).
 */
function coverage(tokens, text) {
    const hay = fold(text);
    let hits = 0;
    for (const t of tokens) {
        const stem = t.slice(0, Math.min(5, t.length));
        if (hay.includes(stem))
            hits++;
    }
    return hits;
}
function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
function semanticSearch(queryVector, userId, conversationId, limit) {
    // Los documentos del usuario solo pueden filtrarse en la conversación a la
    // que pertenecen. Sin este filtro, una pregunta en un chat aparejaba
    // documentos privados de otras conversaciones del mismo usuario.
    const rows = db.prepare(`
    SELECT id, ref_type, ref_id, label, text, embedding, dim FROM chunks
    WHERE embedding IS NOT NULL AND (ref_type != 'userdoc' OR ref_id IN (
      SELECT id FROM ai_documents WHERE user_id = ? AND conversation_id = ?
    ))
    LIMIT 8000
  `).all(userId ?? '', conversationId ?? '');
    return rows
        .map((r) => {
        const vec = Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4));
        return { row: r, score: cosine(vec, queryVector) };
    })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ row, score }) => ({
        id: row.id,
        kind: row.ref_type,
        label: row.label,
        text: row.text,
        url: null,
        meta: `Similitud semántica ${(score * 100).toFixed(0)}%`,
        score,
    }));
}
export async function retrieveForChat(query, userId, conversationId = null, limit = 8) {
    const blocks = [];
    const q = ftsQuery(query);
    const tokens = tokensOf(query);
    if (q) {
        const articleRows = db.prepare(`
      SELECT a.id, a.number, a.heading, a.text, n.id AS norm_id, n.slug, n.short_title, n.title,
             n.number AS norm_number, n.status, n.verification, n.official_url,
             bm25(articles_fts) AS rank
      FROM articles_fts
      JOIN articles a ON a.rowid = articles_fts.rowid
      JOIN norms n ON n.id = a.norm_id
      WHERE articles_fts MATCH ?
      ORDER BY rank
      LIMIT 16
    `).all(q);
        // Solo se envían al modelo artículos que comparten al menos dos palabras
        // con la consulta (o una, si la consulta tiene una sola). Sin este filtro,
        // FTS devuelve coincidencias por una palabra suelta y el modelo termina
        // citando artículos que no tienen relación con la pregunta.
        const needed = Math.min(2, tokens.length);
        const relevant = articleRows
            .map((r) => ({ r, cov: coverage(tokens, `${r.heading ?? ''} ${r.text}`) }))
            .filter((x) => x.cov >= needed)
            .slice(0, 6);
        relevant.forEach(({ r }, index) => {
            blocks.push({
                id: `art_${r.id}`,
                kind: 'article',
                label: `${r.short_title ?? r.title} · Artículo ${r.number}${r.heading ? ` — ${r.heading}` : ''}`,
                text: r.text,
                url: r.official_url,
                meta: `Norma: ${r.norm_number ?? r.title} · Estado: ${r.status}${r.verification === 'pending' ? ' · metadatos por verificar' : ''}`,
                // El orden de bm25 ya es el de relevancia: decrece suavemente desde 1.
                score: 1 - index * 0.03,
                normId: r.norm_id,
                articleId: r.id,
                slug: r.slug,
                articleNumber: r.number,
            });
        });
        const normRows = db.prepare(`
      SELECT n.*, bm25(norms_fts) AS rank
      FROM norms_fts JOIN norms n ON n.rowid = norms_fts.rowid
      WHERE norms_fts MATCH ?
      ORDER BY rank LIMIT 8
    `).all(q);
        const normsRelevant = normRows
            .filter((r) => coverage(tokens, `${r.title} ${r.short_title ?? ''} ${r.summary ?? ''}`) >= 1)
            .slice(0, 3);
        for (const r of normsRelevant) {
            blocks.push({
                id: `norm_${r.id}`,
                kind: 'norm',
                label: `${r.title}${r.number ? ` (${r.number})` : ''}`,
                text: [r.summary, `Tipo: ${r.type}`, `Entidad: ${r.entity ?? 'no registrada'}`, `Publicación: ${r.published_at ?? 'no registrada'}`, `Estado: ${r.status}`].filter(Boolean).join('\n'),
                url: r.official_url,
                meta: `Catálogo ETON LEX · verificación: ${r.verification}`,
                score: 0.5,
                normId: r.id,
                slug: r.slug,
            });
        }
        const newsRows = db.prepare(`
      SELECT ne.*, snippet(news_fts, 2, '«', '»', '…', 24) AS snip, bm25(news_fts) AS rank
      FROM news_fts JOIN news ne ON ne.rowid = news_fts.rowid
      WHERE news_fts MATCH ?
      ORDER BY rank LIMIT 4
    `).all(q);
        for (const r of newsRows) {
            blocks.push({
                id: `news_${r.id}`,
                kind: 'news',
                label: `ETON NEWS · ${r.title}`,
                text: r.summary || r.snip || '',
                url: r.source_url,
                meta: `${r.source_name} · ${r.published_at ?? r.fetched_at} · ${r.scope}`,
                score: 0.4,
                newsId: r.id,
            });
        }
    }
    // Búsqueda semántica opcional (solo si hay embeddings configurados).
    if (process.env.EMBEDDING_MODEL) {
        try {
            const vecs = await embedTexts([query]);
            if (vecs?.[0]) {
                // El vector se pasa por parámetro: usarlo en un global mezclaba
                // consultas cuando dos usuarios preguntaban al mismo tiempo.
                blocks.push(...semanticSearch(vecs[0], userId, conversationId, 5));
            }
        }
        catch (err) {
            console.warn('[rag] embeddings no disponibles:', err.message);
        }
    }
    // Documentos del usuario vinculados a ESTA conversación. Los fragmentos con
    // página/sección se buscan por texto y se entregan como fuentes citables; los
    // documentos sin fragmentos (pequeños o sin texto extraíble) se entregan
    // completos como antes, para no romper el seguimiento.
    if (userId && conversationId) {
        if (q) {
            const chunkRows = db.prepare(`
        SELECT c.*, bm25(document_chunks_fts) AS rank
        FROM document_chunks_fts
        JOIN document_chunks c ON c.rowid = document_chunks_fts.rowid
        WHERE document_chunks_fts MATCH ? AND c.user_id = ? AND c.conversation_id = ?
        ORDER BY rank LIMIT 8
      `).all(q, userId, conversationId);
            const needed = Math.min(2, tokens.length);
            for (const r of chunkRows) {
                if (coverage(tokens, r.text) < needed)
                    continue;
                const location = [
                    r.page ? `pág. ${r.page}` : null,
                    r.section ? `sección ${r.section}` : null,
                    `carácter ${r.char_offset}`,
                ].filter(Boolean).join(' · ');
                blocks.push({
                    id: `chunk_${r.id}`,
                    kind: 'userdoc',
                    label: `Documento del usuario · ${r.label} — ${location}`,
                    text: r.text,
                    url: null,
                    meta: `Fragmento ${r.chunk_index + 1} de documento privado · ${location}`,
                    score: 0.55,
                    documentId: r.document_id,
                    page: r.page ?? null,
                    charOffset: r.char_offset,
                    section: r.section ?? null,
                    documentName: r.label,
                    chunkIndex: r.chunk_index,
                });
            }
        }
        const withChunks = new Set(db.prepare('SELECT DISTINCT document_id FROM document_chunks WHERE user_id = ? AND conversation_id = ?')
            .all(userId, conversationId).map((r) => r.document_id));
        const docs = db.prepare(`
      SELECT id, name, extracted FROM ai_documents
      WHERE user_id = ? AND conversation_id = ? AND extracted IS NOT NULL
      ORDER BY created_at DESC LIMIT 3
    `).all(userId, conversationId);
        for (const d of docs) {
            if (withChunks.has(d.id))
                continue;
            blocks.push({
                id: `doc_${d.id}`,
                kind: 'userdoc',
                label: `Documento del usuario · ${d.name}`,
                text: d.extracted,
                url: null,
                meta: 'Documento privado aportado por el usuario',
                score: 0.4,
                documentId: d.id,
                documentName: d.name,
            });
        }
    }
    // Deduplicar por id y ordenar por score.
    const seen = new Set();
    return blocks
        .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
export function citationFor(block, index) {
    return {
        ref: `F${index + 1}`,
        label: block.label,
        kind: block.kind,
        url: block.url,
        normId: block.normId ?? null,
        articleId: block.articleId ?? null,
        newsId: block.newsId ?? null,
        slug: block.slug ?? null,
        articleNumber: block.articleNumber ?? null,
        official: block.official ?? null,
        publishedAt: block.publishedAt ?? null,
        documentId: block.documentId ?? null,
        documentName: block.documentName ?? null,
        page: block.page ?? null,
        charOffset: block.charOffset ?? null,
        section: block.section ?? null,
        chunkIndex: block.chunkIndex ?? null,
    };
}
//# sourceMappingURL=retrieval.js.map