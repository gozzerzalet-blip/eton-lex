/**
 * Tutor jurídico y evaluación (Fase 5).
 *
 * Las preguntas no son inventadas ni generadas por un modelo: se construyen a
 * partir de texto real de la biblioteca o de documentos del propio usuario. La
 * respuesta correcta es una palabra literal del texto y la explicación cita ese
 * mismo fragmento. Si no hay suficiente texto verificable, se informa y no se
 * fabrica una pregunta.
 */
import { db } from '../../db/index.js';
import { citationFor, retrieveForChat, type RetrievedBlock } from './retrieval.js';

export type TutorCitation = ReturnType<typeof citationFor>;

export type TutorQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  citations: TutorCitation[];
  sourceLabel: string;
  sourceText: string;
  sourceUrl: string | null;
};

type TutorSource = {
  block: RetrievedBlock;
  citation: TutorCitation;
};

type PoolTerm = { key: string; literal: string };

const STOPWORDS = new Set(
  'de la el los las un una unos unas y o u que en del al por para con sin sobre como cual cuales quien quienes cuando donde porque esta este esto estas estos su sus mi mis tu tus se lo le les mas pero si no ni tambien ser son fue era han ha haber tener tiene tienen hace puede pueden debe deben tampoco asi mismo otro otros otra otras todo todos toda todas nada algo'.split(/\s+/),
);

const LEGAL_FILLER = new Set(
  'articulo articulos capitulo titulo seccion libro ley codigo norma decreto constitucion politica estados unidos peruano peruana peru peruanos peruanas numero numeral inciso literal parrafo siguiente anterior respecto conforme acuerdo'.split(/\s+/),
);

const fold = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 45 && s.length <= 260);
}

function wordsOf(text: string): string[] {
  return fold(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function rawWordsOf(sentence: string): string[] {
  return sentence
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function candidateTerms(sentence: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const literal of rawWordsOf(sentence)) {
    const word = fold(literal);
    if (word.length < 5 || word.length > 16 || /^\d+$/.test(word)) continue;
    if (STOPWORDS.has(word) || LEGAL_FILLER.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(literal);
  }
  return out.sort((a, b) => b.length - a.length);
}

function literalPattern(literal: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(literal)}(?![\\p{L}\\p{N}])`, 'u');
}

function keyTermsFromSource(source: TutorSource): PoolTerm[] {
  const found = new Map<string, PoolTerm>();
  for (const sentence of splitSentences(source.block.text)) {
    for (const literal of candidateTerms(sentence)) {
      const key = fold(literal);
      if (!found.has(key)) found.set(key, { key, literal });
    }
    if (found.size >= 30) break;
  }
  return [...found.values()];
}

function matchCase(term: string, correct: string): string {
  if (/^[A-ZÁÉÍÓÚÑ]/.test(correct)) return term.charAt(0).toUpperCase() + term.slice(1);
  return term.toLowerCase();
}

function makeDistractors(correct: string, sentence: string, pool: PoolTerm[]): string[] {
  const correctKey = fold(correct);
  const foldedSentence = fold(sentence);
  const candidates = pool
    .filter((term) => term.key !== correctKey)
    .filter((term) => term.key.length >= Math.max(5, correctKey.length - 4))
    .filter((term) => term.key.length <= correctKey.length + 5)
    .filter((term) => !foldedSentence.includes(term.key))
    .sort((a, b) => Math.abs(a.key.length - correctKey.length) - Math.abs(b.key.length - correctKey.length));

  const picked: string[] = [];
  for (const term of candidates) {
    const literal = matchCase(term.literal, correct);
    if (picked.some((p) => fold(p) === fold(literal))) continue;
    picked.push(literal);
    if (picked.length === 3) break;
  }
  return picked;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildQuestion(source: TutorSource, pool: PoolTerm[]): TutorQuestion | null {
  for (const sentence of shuffle(splitSentences(source.block.text))) {
    const words = wordsOf(sentence);
    if (words.length < 10 || words.length > 42) continue;
    for (const literal of candidateTerms(sentence)) {
      const distractors = makeDistractors(literal, sentence, pool);
      if (distractors.length < 3) continue;

      const options = shuffle([literal, ...distractors]);
      const correctIndex = options.indexOf(literal);
      const masked = sentence.replace(literalPattern(literal), '________');
      if (masked === sentence) continue;

      const quoteWords = sentence.split(/\s+/);
      const quote = quoteWords.length > 25 ? `${quoteWords.slice(0, 25).join(' ')}…` : sentence;

      return {
        id: '',
        position: 0,
        prompt: `Según ${source.citation.label}, ¿qué palabra completa exactamente este fragmento?\n\n${masked}\n\n(El fragmento reproduce la fuente con un espacio en blanco.)`,
        options,
        correctIndex,
        explanation: `La palabra que falta es «${literal}». El texto de la fuente dice: «${quote}».`,
        citations: [source.citation],
        sourceLabel: source.citation.label,
        sourceText: sentence,
        sourceUrl: source.citation.url,
      };
    }
  }
  return null;
}

async function librarySources(area: string, topic: string, limit: number): Promise<TutorSource[]> {
  let blocks: RetrievedBlock[] = [];
  if (topic) {
    const found = await retrieveForChat(topic, null, null, 16);
    blocks = found.filter((b) => b.kind === 'article').filter((b) => {
      if (!b.normId || !area) return true;
      const row = db.prepare('SELECT 1 FROM norms WHERE id = ? AND area = ?').get(b.normId, area);
      return !!row;
    });
  }

  if (blocks.length < limit) {
    const rows = db.prepare(`
      SELECT a.id, a.number, a.heading, a.text, n.id AS norm_id, n.slug,
             COALESCE(n.short_title, n.title) AS short_title, n.title,
             n.number AS norm_number, n.status, n.official_url, n.area
      FROM articles a
      JOIN norms n ON n.id = a.norm_id
      WHERE (? = '' OR n.area = ?)
        AND LENGTH(a.text) BETWEEN 160 AND 2200
        AND a.status = 'vigente'
      ORDER BY RANDOM() LIMIT 120
    `).all(area, area) as any[];

    for (const r of rows) {
      blocks.push({
        id: `art_${r.id}`,
        kind: 'article',
        label: `${r.short_title ?? r.title} · Artículo ${r.number}${r.heading ? ` — ${r.heading}` : ''}`,
        text: r.text,
        url: r.official_url,
        meta: `Norma: ${r.norm_number ?? r.title} · Estado: ${r.status}`,
        score: 0.4,
        normId: r.norm_id,
        articleId: r.id,
        slug: r.slug,
        articleNumber: r.number,
      });
    }
  }

  const seen = new Set<string>();
  return blocks
    .filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    })
    .slice(0, Math.max(limit * 3, 24))
    .map((block) => ({ block, citation: citationFor(block, 0) }));
}

function documentSources(documentId: string, userId: string): TutorSource[] {
  const chunks = db.prepare(`
    SELECT id, chunk_index AS chunkIndex, page, char_offset AS charOffset, section, text, label
    FROM document_chunks WHERE document_id = ? AND user_id = ? ORDER BY chunk_index
  `).all(documentId, userId) as any[];

  const blocks: RetrievedBlock[] = chunks.map((r) => {
    const location = [
      r.page ? `pág. ${r.page}` : null,
      r.section ? `sección ${r.section}` : null,
      `carácter ${r.charOffset}`,
    ].filter(Boolean).join(' · ');
    return {
      id: `chunk_${r.id}`,
      kind: 'userdoc',
      label: `Documento del usuario · ${r.label} — ${location}`,
      text: r.text,
      url: null,
      meta: `Fragmento ${r.chunkIndex + 1} de documento privado · ${location}`,
      score: 0.5,
      documentId,
      documentName: r.label,
      page: r.page ?? null,
      charOffset: r.charOffset,
      section: r.section ?? null,
      chunkIndex: r.chunkIndex,
    };
  });

  if (blocks.length === 0) {
    const doc = db.prepare('SELECT id, name, extracted FROM ai_documents WHERE id = ? AND user_id = ?')
      .get(documentId, userId) as { id: string; name: string; extracted: string | null } | undefined;
    if (doc?.extracted) {
      blocks.push({
        id: `doc_${doc.id}`,
        kind: 'userdoc',
        label: `Documento del usuario · ${doc.name}`,
        text: doc.extracted,
        url: null,
        meta: 'Documento privado aportado por el usuario',
        score: 0.5,
        documentId,
        documentName: doc.name,
      });
    }
  }

  return blocks.map((block) => ({ block, citation: citationFor(block, 0) }));
}

/**
 * Devuelve preguntas reales. Nunca rellena con preguntas genéricas si faltan
 * fuentes: el llamador debe informar al usuario que no hay texto suficiente.
 */
export async function buildTutorQuestions(input: {
  userId: string;
  area: string;
  topic: string;
  documentId: string | null;
  count: number;
}): Promise<TutorQuestion[]> {
  const sources = input.documentId
    ? documentSources(input.documentId, input.userId)
    : await librarySources(input.area, input.topic, input.count);
  if (sources.length === 0) return [];

  const pool = [...new Map<string, PoolTerm>(
    sources.flatMap((s) => keyTermsFromSource(s)).map((t) => [t.key, t] as const),
  ).values()];
  if (pool.length < 4) return [];

  const questions: TutorQuestion[] = [];
  const usedSentences = new Set<string>();
  for (const source of shuffle(sources)) {
    const question = buildQuestion(source, pool);
    if (!question) continue;
    const key = fold(question.sourceText);
    if (usedSentences.has(key)) continue;
    usedSentences.add(key);
    questions.push(question);
    if (questions.length >= input.count) break;
  }
  return questions;
}

export function publicQuestion(question: TutorQuestion) {
  return {
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    options: question.options,
    sourceLabel: question.sourceLabel,
    citations: question.citations,
  };
}

export function revealQuestion(question: TutorQuestion) {
  return {
    ...publicQuestion(question),
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    sourceText: question.sourceText,
    sourceUrl: question.sourceUrl,
  };
}

export function isCorrect(question: TutorQuestion, answerIndex: number): boolean {
  return answerIndex === question.correctIndex;
}
