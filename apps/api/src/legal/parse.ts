/**
 * Parser de textos legales extraídos de los PDF oficiales de
 * «Normas Legales Actualizadas» (Diario Oficial El Peruano).
 *
 * No inventa contenido: solo separa el texto que existe en el PDF y marca
 * los huecos detectados. Las notas de derogación se conservan como registro
 * del artículo derogado cuando la fuente oficial ya no reproduce su texto.
 */

export type ParsedArticle = {
  number: string;
  heading: string | null;
  text: string;
  orderIndex: number;
  book: string | null;
  section: string | null;
  title: string | null;
  chapter: string | null;
  status: 'vigente' | 'modificado' | 'derogado';
  /** Nota de procedencia cuando el texto se recuperó de otra fuente oficial. */
  provenance?: string | null;
};

export type ParseStats = {
  totalArticles: number;
  numberedArticles: number;
  missing: string[];
  derogated: number;
  modified: number;
  firstArticle: string | null;
  lastArticle: string | null;
  bodyStartLine: number;
  stoppedAtLine: number | null;
  supplemented: number;
  warnings: string[];
};

export type ParseResult = { articles: ParsedArticle[]; stats: ParseStats };

export type DerogatedRange = { from: number; to: number; note: string };

export type Supplement = {
  number: string;
  heading?: string | null;
  text: string;
  note: string;
  sourceUrl: string;
  status?: 'vigente' | 'modificado' | 'derogado';
};

export type ParseOptions = {
  lastArticle?: number;
  /** Línea a partir de la cual se corta el texto (reglamentos anexos). */
  stopAt?: RegExp;
  /** Rangos que la fuente oficial declara derogados sin reproducir el texto. */
  derogatedRanges?: DerogatedRange[];
  /** Artículos que faltan en la capa de texto y constan en otra fuente oficial. */
  supplements?: Supplement[];
  /** Encabezados de página repetidos que deben retirarse del texto (solo coincidencia de línea completa). */
  pageHeaders?: RegExp[];
};

// Algunos PDF oficiales numeran las notas al pie dentro del texto, de modo
// que el encabezado aparece como «(10) Artículo 11.-». El prefijo es una
// llamada de nota, no parte del número del artículo.
const FOOTNOTE_PREFIX = '^(?:\\(\\d{1,3}\\)\\s*)?';

const ARTICLE_RE = new RegExp(
  `${FOOTNOTE_PREFIX}["“”'‘’]{0,3}\\s*Art[íi]culo\\s+(\\d+[A-Za-z]?(?:\\s*-\\s*[A-Za-z])?|[IVXLC]+)\\s*[°º]?\\s*[\\.\\-–—]+\\s*(.*)$`,
);

const RANGE_RE =
  /^\(\*\)\s*Art[íi]culos?\s+(\d+)\s+al\s+(\d+)\s*[\.\-–—]\s*(.*)$/i;

// Listas explícitas de derogación: «Artículos 63, 64, 65, 66, 67, 68.-
// (*) Artículos derogados por...». Se exige coma o «y» para no confundirlas
// con los rangos «Artículos 70 al 75». La lista y su nota pueden ocupar
// varias líneas («Artículos 206, 207, 208, ... 216.-»), por eso se detectan
// sobre el bloque de líneas unido.
const GROUP_LIST_START_RE = new RegExp(
  `${FOOTNOTE_PREFIX}["“”'‘’]{0,3}Art[íi]culos\\s+\\d`,
  'i',
);

const GROUP_DEROGATION_JOINED_RE = new RegExp(
  `${FOOTNOTE_PREFIX}["“”'‘’]{0,3}Art[íi]culos\\s+` +
    '((?:\\d+[A-Za-z]?(?:\\s*-\\s*[A-Za-z])?\\s*(?:,\\s*|\\s+y\\s+))+)' +
    '(\\d+[A-Za-z]?(?:\\s*-\\s*[A-Za-z])?)\\s*[\\.\\-–—]*\\s*(.*)$',
  'i',
);

const SINGLE_DEROGATION_RE =
  /^\(\*\)\s*Art[íi]culo\s+(\d+[A-Za-z]?(?:\s*-\s*[A-Za-z])?)\s*[\.\-–—]\s*(Derogad[oa].*)$/i;

const STRUCTURE_RE =
  /^(LIBRO|SECCI[OÓ]N|T[IÍ]TULO|CAP[IÍ]TULO)\s+([IVXLC]+|\d+|[ÚU]NIC[OA]|PRELIMINAR|PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]|SEXT[OA]|S[EÉ]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[EÉ]CIM[OA])\b(.*)$/i;

const DISPOSITIONS_RE =
  /^(DISPOSICIONES|DISPOSICI[OÓ]N)\s+(COMPLEMENTARIAS?|TRANSITORIAS?|FINALES?|MODIFICATORIAS?|DEROGATORIAS?|ADICIONALES?)\b(.*)$/i;

const NOISE_RE = new RegExp(
  [
    '^\\d{0,3}\\s*NORMAS LEGALES(?: ACTUALIZADAS)?$',
    '^Editora Per[uú]$',
    '^ACTUALIZADA$',
    '^Inicio$',
    '^Tabla de Contenido$',
    '^\\d{1,3}$',
  ].join('|'),
  'i',
);

const DEROGATION_NOTE_RE = /derogad[oa]s?\b|dejado sin efecto/i;
const MODIFICATION_NOTE_RE = /modificad[oa]s?\b|incorporad[oa]s?\b|sustituid[oa]s?\b/i;

function normalize(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    // Algunos PDF oficiales separan la primera letra del encabezado
    // («A rtículo 151.-»). Se recompone para poder detectar el artículo; el
    // texto legal no cambia.
    .replace(/\bA\s+rt[íi]culo(s?)\b/g, (_match, plural: string) => `Artículo${plural}`)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());
}

function cleanStructureLine(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
}

function isNoise(line: string): boolean {
  return line === '' || NOISE_RE.test(line);
}

function normalizeArticleNumber(raw: string): string {
  return raw
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
    // La numeración con letra siempre usa guion en la práctica peruana
    // («3-A», «108-B»). Algunos PDF la escriben sin guion («3A»).
    .replace(/^(\d+)([A-Z])$/, '$1-$2');
}

function toRoman(value: string): number | null {
  if (!/^[IVXLC]+$/.test(value)) return null;
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const cur = map[value[i]];
    const next = map[value[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

type DerogationList = { numbers: string[]; note: string; endLine: number };

/**
 * Detecta una lista de artículos derogados que puede ocupar varias líneas.
 * Solo se acepta si el propio bloque declara la derogación: así se evita
 * confundir una mención «Artículos 5, 6 y 7» con una lista derogatoria.
 */
function matchDerogationList(lines: string[], start: number): DerogationList | null {
  if (!GROUP_LIST_START_RE.test(lines[start])) return null;
  const parts: string[] = [];
  let endLine = start;
  for (let j = start; j < lines.length && j < start + 8; j++) {
    const line = lines[j];
    if (j > start && (line === '' || ARTICLE_RE.test(line) || STRUCTURE_RE.test(line) || DISPOSITIONS_RE.test(line))) {
      break;
    }
    if (j > start && GROUP_LIST_START_RE.test(line)) break;
    parts.push(line);
    endLine = j;
    if (DEROGATION_NOTE_RE.test(parts.join(' ')) && parts.length > 1) {
      // La nota puede continuar una o dos líneas más; se detiene ante el
      // siguiente artículo, estructura o línea en blanco.
      for (let k = j + 1; k < lines.length && k < j + 4; k++) {
        const next = lines[k];
        if (next === '' || ARTICLE_RE.test(next) || STRUCTURE_RE.test(next) || DISPOSITIONS_RE.test(next)) break;
        parts.push(next);
        endLine = k;
      }
      break;
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!DEROGATION_NOTE_RE.test(joined)) return null;
  const match = GROUP_DEROGATION_JOINED_RE.exec(joined);
  if (!match) return null;
  const numbers = `${match[1]} ${match[2]}`.match(/\d+[A-Za-z]?(?:\s*-\s*[A-Za-z])?/g) ?? [];
  if (numbers.length < 2) return null;
  const note = match[3].replace(/\s+/g, ' ').trim();
  return {
    numbers: numbers.map((n) => normalizeArticleNumber(n)),
    note: note || 'Artículos derogados según la fuente oficial.',
    endLine,
  };
}

function articleHeading(prevLine: string | undefined, structure: { title: string | null; chapter: string | null }): string | null {
  if (!prevLine) return null;
  const line = prevLine.trim();
  if (!line || line.length > 110) return null;
  if (/^(?:\(\d{1,3}\)\s*)?["“”'‘’]?Art[íi]culo\b/i.test(line)) return null;
  if (STRUCTURE_RE.test(line) || DISPOSITIONS_RE.test(line)) return null;
  if (isNoise(line)) return null;
  if (/^(?:[*()]|publicad|modificad|derogad|incorporad|sustituid)/i.test(line)) return null;
  if (!/^[A-ZÁÉÍÓÚÜÑ0-9¿¡«"“]/.test(line)) return null;
  if (/[,;]$/.test(line)) return null;
  if (line.length > 90 && /[.!?]$/.test(line)) return null;
  // Un párrafo completo suele terminar en punto y tener varias palabras.
  if (/[.!?]$/.test(line) && line.split(/\s+/).length > 12) return null;
  return line.replace(/\s*:\s*$/, '');
}

function cleanArticleText(lines: string[]): string {
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (isNoise(line)) continue;
    if (STRUCTURE_RE.test(line) || DISPOSITIONS_RE.test(line)) continue;
    if (/^\(\*\)\s*Art[íi]culos?\s+\d+\s+al\s+\d+/i.test(line)) continue;
    if (GROUP_LIST_START_RE.test(line) || RANGE_RE.test(line) || SINGLE_DEROGATION_RE.test(line)) continue;
    if (/^www\.|^https?:\/\//i.test(line)) continue;
    kept.push(line);
  }

  const paragraphs: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    buffer = [];
  };
  for (const line of kept) {
    if (line === '') {
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return paragraphs.join('\n\n').replace(/\s+([,;.])/g, '$1').trim();
}

function articleStatus(text: string): ParsedArticle['status'] {
  const head = text.slice(0, 700);
  if (DEROGATION_NOTE_RE.test(head) && /^(?:\(\*\)\s*)?(?:art[íi]culo|derogad)/i.test(head)) return 'derogado';
  if (/^\s*derogad[oa]\b/i.test(head)) return 'derogado';
  if (MODIFICATION_NOTE_RE.test(head)) return 'modificado';
  return 'vigente';
}

export function parseLegalText(raw: string, opts: ParseOptions = {}): ParseResult {
  let lines = normalize(raw);
  const warnings: string[] = [];

  // El PDF repite el título de la norma como encabezado de cada página. Esos
  // encabezados quedan incrustados en medio de los artículos, por eso se
  // retiran por coincidencia exacta de línea (nunca por palabras sueltas).
  if (opts.pageHeaders?.length) {
    const before = lines.length;
    lines = lines.filter((line) => !opts.pageHeaders!.some((re) => re.test(line)));
    const removed = before - lines.length;
    if (removed > 0) {
      warnings.push(`Se retiraron ${removed} encabezados de página repetidos del PDF.`);
    }
  }

  const articleLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      ARTICLE_RE.test(lines[i]) ||
      RANGE_RE.test(lines[i]) ||
      GROUP_LIST_START_RE.test(lines[i]) ||
      SINGLE_DEROGATION_RE.test(lines[i])
    ) {
      articleLines.push(i);
    }
  }

  const firstArticleLine = articleLines[0] ?? 0;
  let bodyStartLine = 0;
  let lastTocRange = -1;
  for (let i = 0; i < firstArticleLine; i++) {
    if (/^[º°]?art[ií]culos?\s+\d+\s+al\s+\d+/i.test(lines[i])) lastTocRange = i;
  }
  if (lastTocRange >= 0) bodyStartLine = lastTocRange + 1;

  // Muchas ediciones oficiales incluyen, después de la norma, su reglamento
  // o normas conexas. `stopAt` corta el texto en el encabezado del anexo antes
  // de detectar el Título Preliminar: si se aplicara después, un reglamento
  // anexo con su propio «Título Preliminar» podría desplazar el inicio del
  // cuerpo y mezclar dos normas.
  let stoppedAtLine: number | null = null;
  if (opts.stopAt) {
    for (let i = bodyStartLine; i < lines.length; i++) {
      if (opts.stopAt.test(lines[i])) {
        stoppedAtLine = i;
        lines = lines.slice(0, i);
        break;
      }
    }
    if (stoppedAtLine === null) {
      warnings.push('No se encontró el corte configurado para el anexo; se revisó el texto completo.');
    }
  }

  // Los códigos traen, antes del articulado, el decreto de promulgación y
  // documentos anexos con sus propios «Artículo 1» y «Artículo 2». El cuerpo
  // real empieza en el Título Preliminar cuyas líneas siguientes ya son
  // artículos del código.
  for (let i = bodyStartLine; i < Math.min(lines.length, bodyStartLine + 600); i++) {
    if (!/^T[IÍ]TULO PRELIMINAR\b/i.test(lines[i])) continue;
    const window = lines.slice(i + 1, i + 6);
    if (window.some((l) => ARTICLE_RE.test(l))) {
      bodyStartLine = i;
      break;
    }
  }

  // Fallback para códigos cuyo Título Preliminar usa numeración romana.
  const firstRoman = lines.findIndex(
    (l, idx) => idx >= bodyStartLine && /^["“”'‘’]{0,3}\s*Art[íi]culo\s+[IVXLC]+\s*[°º]?\s*[\.\-–—]+/.test(l),
  );
  if (firstRoman > bodyStartLine) {
    for (let i = firstRoman; i >= bodyStartLine; i--) {
      if (/^T[IÍ]TULO PRELIMINAR\b/i.test(lines[i])) {
        bodyStartLine = i;
        break;
      }
    }
  }

  const articles: ParsedArticle[] = [];
  const seen = new Set<string>();
  const structure = {
    book: null as string | null,
    section: null as string | null,
    title: null as string | null,
    chapter: null as string | null,
  };
  let order = 0;

  const add = (article: Omit<ParsedArticle, 'orderIndex' | 'book' | 'section' | 'title' | 'chapter'>) => {
    const normalized = normalizeArticleNumber(article.number);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    order += 1;
    articles.push({
      ...article,
      number: normalized,
      orderIndex: order,
      book: structure.book,
      section: structure.section,
      title: structure.title,
      chapter: structure.chapter,
      provenance: article.provenance ?? null,
    });
  };

  const addDerogationRange = (from: number, to: number, note: string) => {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200) return;
    for (let n = from; n <= to; n++) {
      add({
        number: String(n),
        heading: structure.title ?? structure.chapter ?? 'Disposición derogatoria',
        text: `Artículo ${n} derogado. ${note}`.trim(),
        status: 'derogado',
      });
    }
  };

  for (let i = bodyStartLine; i < lines.length; i++) {
    const line = lines[i];

    const range = RANGE_RE.exec(line);
    if (range) {
      const noteLines: string[] = [range[3]];
      let j = i + 1;
      while (j < lines.length && j < i + 10) {
        const next = lines[j];
        if (
          next === '' ||
          ARTICLE_RE.test(next) ||
          RANGE_RE.test(next) ||
          GROUP_LIST_START_RE.test(next) ||
          STRUCTURE_RE.test(next) ||
          DISPOSITIONS_RE.test(next)
        ) {
          break;
        }
        noteLines.push(next);
        j++;
      }
      addDerogationRange(Number(range[1]), Number(range[2]), noteLines.join(' ').replace(/\s+/g, ' ').trim());
      i = j - 1;
      continue;
    }

    const group = matchDerogationList(lines, i);
    if (group) {
      for (const number of group.numbers) {
        if (!/^\d/.test(number)) continue;
        const numeric = Number(number);
        if (Number.isFinite(numeric) && opts.lastArticle && numeric > opts.lastArticle) continue;
        add({
          number,
          heading: structure.title ?? structure.chapter ?? 'Disposición derogatoria',
          text: `Artículo ${number} derogado. ${group.note}`.trim(),
          status: 'derogado',
        });
      }
      i = group.endLine;
      continue;
    }

    const single = SINGLE_DEROGATION_RE.exec(line);
    if (single) {
      add({
        number: normalizeArticleNumber(single[1]),
        heading: structure.title ?? structure.chapter ?? 'Disposición derogatoria',
        text: `Artículo derogado. ${single[2]}`.trim(),
        status: 'derogado',
      });
      continue;
    }

    const structureMatch = STRUCTURE_RE.exec(line);
    if (structureMatch) {
      const label = structureMatch[1].toUpperCase();
      let value = cleanStructureLine(line);
      // «Título I» suele ir seguido del nombre en la línea siguiente. No se
      // combina en «Título Preliminar», porque la línea siguiente ya es el
      // título temático del primer artículo.
      const following = lines[i + 1];
      const alreadyNamed = value.includes(':') || /PRELIMINAR/i.test(value);
      if (
        !alreadyNamed &&
        following &&
        !ARTICLE_RE.test(following) &&
        !RANGE_RE.test(following) &&
        !STRUCTURE_RE.test(following) &&
        !DISPOSITIONS_RE.test(following) &&
        !isNoise(following) &&
        following.length <= 90 &&
        /^[A-ZÁÉÍÓÚÜÑ]/.test(following)
      ) {
        value = `${value} — ${following.trim()}`;
        i += 1;
      }
      if (label.startsWith('LIBRO')) {
        structure.book = value;
        structure.section = null;
        structure.title = null;
        structure.chapter = null;
      } else if (label.startsWith('SECCI')) {
        structure.section = value;
        structure.title = null;
        structure.chapter = null;
      } else if (label.startsWith('TÍTULO') || label.startsWith('TITULO')) {
        structure.title = value;
        structure.chapter = null;
      } else if (label.startsWith('CAP')) {
        structure.chapter = value;
      }
      continue;
    }

    const dispositions = DISPOSITIONS_RE.exec(line);
    if (dispositions) {
      structure.section = cleanStructureLine(line);
      structure.title = null;
      structure.chapter = null;
      continue;
    }

    const match = ARTICLE_RE.exec(line);
    if (!match) continue;

    const number = normalizeArticleNumber(match[1]);
    const numericNumber = Number(number);
    // Una norma no puede tener artículos por encima de su último artículo:
    // esos encabezados suelen ser citas de otros códigos dentro de las
    // disposiciones finales (por ejemplo, el artículo 272 del Código Penal
    // citado en el Código Tributario).
    if (opts.lastArticle && Number.isFinite(numericNumber) && numericNumber > opts.lastArticle) {
      i = i + 1;
      continue;
    }
    const rest = match[2] ?? '';
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (
        ARTICLE_RE.test(lines[j]) ||
        RANGE_RE.test(lines[j]) ||
        GROUP_LIST_START_RE.test(lines[j]) ||
        SINGLE_DEROGATION_RE.test(lines[j]) ||
        STRUCTURE_RE.test(lines[j]) ||
        DISPOSITIONS_RE.test(lines[j])
      ) {
        end = j;
        break;
      }
    }

    const block = [rest, ...lines.slice(i + 1, end)];
    const text = cleanArticleText(block);
    if (!text) {
      warnings.push(`Artículo ${number}: sin texto extraíble.`);
      i = end - 1;
      continue;
    }

    // Encabezado: última línea no vacía antes del artículo, si parece título.
    let prev = i - 1;
    while (prev >= bodyStartLine && lines[prev] === '') prev--;
    let headingLine = lines[prev];
    // Títulos partidos por el salto de página: «Protección del menor y de sus
    // bienes en el» + «juicio». Solo se unen fragmentos cortos en minúscula
    // que no cierran una oración.
    if (
      headingLine &&
      prev - 1 >= bodyStartLine &&
      /^[a-záéíóúüñ]/.test(headingLine) &&
      headingLine.length <= 25
    ) {
      let prev2 = prev - 1;
      while (prev2 >= bodyStartLine && lines[prev2] === '') prev2--;
      const candidate = lines[prev2];
      if (candidate && !/[.!?;:]$/.test(candidate) && candidate.length <= 90) {
        headingLine = `${candidate} ${headingLine}`;
      }
    }
    const heading = articleHeading(headingLine, structure);

    add({ number, heading, text, status: articleStatus(text) });
    i = end - 1;
  }

  // Rangos que la fuente oficial declara derogados sin reproducir el texto
  // (por ejemplo, capítulos completos derogados por una ley posterior). Se
  // insertan en su posición numérica, nunca se inventa su contenido.
  for (const range of opts.derogatedRanges ?? []) {
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < range.from) continue;
    const additions: ParsedArticle[] = [];
    for (let n = range.from; n <= range.to; n++) {
      const number = String(n);
      if (seen.has(number)) continue;
      seen.add(number);
      additions.push({
        number,
        heading: 'Disposición derogatoria',
        text: `Artículo ${number} derogado. ${range.note}`.trim(),
        orderIndex: 0,
        book: null,
        section: null,
        title: null,
        chapter: null,
        status: 'derogado',
      });
    }
    if (!additions.length) continue;
    const insertAt = articles.findIndex((a) => {
      const num = Number(a.number);
      return Number.isFinite(num) && num > range.to;
    });
    articles.splice(insertAt >= 0 ? insertAt : articles.length, 0, ...additions);
  }
  articles.forEach((article, index) => {
    article.orderIndex = index + 1;
  });

  // Artículos que la capa de texto del PDF omite pero que constan en otra
  // publicación oficial. Se insertan en su posición numérica y conservan la
  // nota de procedencia; el texto no se completa por inferencia.
  const supplemented: string[] = [];
  for (const supplement of opts.supplements ?? []) {
    const number = normalizeArticleNumber(supplement.number);
    if (seen.has(number)) {
      warnings.push(`El suplemento del artículo ${number} ya existe en la fuente; se conserva el texto del PDF.`);
      continue;
    }
    const numericNumber = Number(number);
    const insertAt = articles.findIndex((a) => {
      const num = Number(a.number);
      return Number.isFinite(num) && Number.isFinite(numericNumber) && num > numericNumber;
    });
    const position = insertAt >= 0 ? insertAt : articles.length;
    const previous = articles[position - 1];
    seen.add(number);
    articles.splice(position, 0, {
      number,
      heading: supplement.heading ?? null,
      text: supplement.text,
      orderIndex: 0,
      book: previous?.book ?? null,
      section: previous?.section ?? null,
      title: previous?.title ?? null,
      chapter: previous?.chapter ?? null,
      status: supplement.status ?? 'vigente',
      provenance: `${supplement.note} Fuente: ${supplement.sourceUrl}`.trim(),
    });
    supplemented.push(number);
  }
  articles.forEach((article, index) => {
    article.orderIndex = index + 1;
  });

  // El título temático del artículo siguiente suele quedar al final del bloque
  // anterior. Se retira para no contaminar el texto legal. Se revisan hasta
  // tres artículos siguientes porque los suplementos y los rangos derogados
  // insertados pueden desplazar el encabezado que originalmente seguía.
  for (let i = 0; i < articles.length; i++) {
    const current = articles[i];
    let stripped = true;
    while (stripped) {
      stripped = false;
      for (let k = i + 1; k <= i + 3 && k < articles.length; k++) {
        const heading = articles[k]?.heading;
        if (heading && current.text.endsWith(heading)) {
          current.text = current.text.slice(0, -heading.length).trim();
          stripped = true;
        }
      }
    }
  }

  // Huecos en la numeración arábiga esperada.
  const missing: string[] = [];
  const numeric = new Set(
    articles
      .map((a) => Number(a.number))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  const last = opts.lastArticle ?? Math.max(0, ...numeric);
  for (let n = 1; n <= last; n++) if (!numeric.has(n)) missing.push(String(n));
  const roman = articles.filter((a) => toRoman(a.number) !== null).length;
  if (roman === 0 && /T[IÍ]TULO PRELIMINAR/i.test(raw)) {
    warnings.push('No se detectaron artículos del Título Preliminar en numeración romana.');
  }
  if (missing.length > 0) {
    warnings.push(`Huecos de numeración detectados: ${missing.slice(0, 30).join(', ')}${missing.length > 30 ? '…' : ''}`);
  }

  const first = articles[0]?.number ?? null;
  const lastArticle = articles.at(-1)?.number ?? null;

  return {
    articles,
    stats: {
      totalArticles: articles.length,
      numberedArticles: numeric.size,
      missing,
      derogated: articles.filter((a) => a.status === 'derogado').length,
      modified: articles.filter((a) => a.status === 'modificado').length,
      firstArticle: first,
      lastArticle,
      bodyStartLine,
      stoppedAtLine,
      supplemented: supplemented.length,
      warnings,
    },
  };
}
