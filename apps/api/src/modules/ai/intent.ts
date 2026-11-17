/**
 * Clasificador de consultas de ETON AI.
 *
 * No pretende «entender» por sí solo: prepara el plan de investigación que
 * usará el modelo de lenguaje (biblioteca + web) y detecta seguimientos para
 * que la recuperación no pierda el contexto de la conversación.
 */

export type IntentKind =
  | 'conceptual'
  | 'legislativa'
  | 'jurisprudencial'
  | 'caso'
  | 'actualidad'
  | 'seguimiento'
  | 'general';

export type IntentPlan = {
  kind: IntentKind;
  label: string;
  /** La consulta se apoya en la biblioteca de ETON LEX. */
  useLibrary: boolean;
  /** Conviene contrastar con fuentes externas. */
  useWeb: boolean;
  /** Consulta enviada al buscador web (ya normalizada). */
  webQuery: string;
  /** Dominios que se priorizan al ordenar los resultados. */
  officialDomains: string[];
  /** Explicación breve del plan, visible en la interfaz. */
  reason: string;
};

export const INTENT_LABEL: Record<IntentKind, string> = {
  conceptual: 'Explicación conceptual',
  legislativa: 'Consulta normativa',
  jurisprudencial: 'Investigación jurisprudencial',
  caso: 'Caso práctico',
  actualidad: 'Actualidad y vigencia',
  seguimiento: 'Seguimiento de la conversación',
  general: 'Consulta general',
};

/** Dominios oficiales o institucionales que se ordenan primero. */
const OFFICIAL_DOMAINS = [
  'elperuano.pe',
  'diariooficial.elperuano.pe',
  'spij.minjus.gob.pe',
  'spij.gob.pe',
  'minjus.gob.pe',
  'tc.gob.pe',
  'pj.gob.pe',
  'mpfn.gob.pe',
  'congreso.gob.pe',
  'gob.pe',
  'sunat.gob.pe',
  'sunarp.gob.pe',
  'indecopi.gob.pe',
  'oece.gob.pe',
  'osce.gob.pe',
  'mintra.gob.pe',
  'minsa.gob.pe',
  'minedu.gob.pe',
  'onpe.gob.pe',
  'jne.gob.pe',
  'defensoria.gob.pe',
  'corteidh.or.cr',
  'oas.org',
  'un.org',
  'worldbank.org',
  'oecd.org',
];

/** Fuentes oficiales de otros países cuando la consulta es de derecho comparado. */
const FOREIGN_SOURCES: Array<{ name: string; re: RegExp; domains: string[] }> = [
  { name: 'Chile', re: /\b(chile|chileno|chilena)\b/i, domains: ['bcn.cl', 'diariooficial.interior.gob.cl', 'pjud.cl', 'tc.cl', 'gob.cl'] },
  { name: 'Argentina', re: /\b(argentina|argentino|argentina)\b/i, domains: ['infoleg.gob.ar', 'argentina.gob.ar', 'csjn.gov.ar'] },
  { name: 'Colombia', re: /\b(colombia|colombiano|colombiana)\b/i, domains: ['funcionpublica.gov.co', 'ramajudicial.gov.co', 'corteconstitucional.gov.co'] },
  { name: 'Ecuador', re: /\b(ecuador|ecuatoriano|ecuatoriana)\b/i, domains: ['asambleanacional.gob.ec', 'funcionjudicial.gob.ec'] },
  { name: 'Bolivia', re: /\b(bolivia|boliviano|boliviana)\b/i, domains: ['gacetaoficialdebolivia.gob.bo', 'oja.gob.bo'] },
  { name: 'México', re: /\b(m[eé]xico|mexicano|mexicana)\b/i, domains: ['gob.mx', 'scjn.gob.mx', 'diputados.gob.mx'] },
  { name: 'España', re: /\b(espa[ñn]a|espa[ñn]ol|espa[ñn]ola)\b/i, domains: ['boe.es', 'poderjudicial.es'] },
];

const JURIS_RE =
  /\b(jurisprudencia|sentencia|casaci[oó]n|expediente|precedente|fallo|resoluci[oó]n judicial|tribunal constitucional|sala suprema|sala penal|sala civil|stc|apelaci[oó]n|amparo|habeas corpus)\b/i;

const ACTUALITY_RE =
  /\b(actualidad|actual(?:es)?|reciente(?:s)?|[uú]ltim[oa]s?|hoy|ayer|noticias?|nueva ley|nuevo c[oó]digo|ha cambiado|han cambiado|cambi[oó]|modificaci[oó]n|modificad[oa]|derogad[oa]|derogaci[oó]n|entr[oó] en vigencia|est[aá] vigente|sigue vigente|2024|2025|2026)\b/i;

const LEGIS_RE =
  /\b(ley|decreto|c[oó]digo|art[ií]culo|art\.|norma|reglamento|constituci[oó]n|texto [uú]nico|tuo|vigencia|derogad[oa]|publicad[oa]|promulgad[oa])\b/i;

const CASE_RE =
  /\b(caso|supuesto|situaci[oó]n|cliente|demanda|denuncia|contrato|si una persona|si mi|mi (?:caso|vecino|vecina|terreno|casa|inmueble|predio|local|propiedad|arrendador|arrendatario|empleador|trabajador|hermano|padre|madre|esposa|esposo)|puedo|podr[ií]a|podemos|puede el estado|el estado (?:recupera|recuperar|ocupa|desaloja)|conviene|qu[eé] (?:acci[oó]n|hago|recurso|demanda|sucede|pasa|ocurre)|c[oó]mo (?:defiendo|reclamo|demando|procedo)|me (?:niegan|deben|desalojan|ocupan|quitan)|reclamo|indemnizaci[oó]n|desalojo|prescripci[oó]n adquisitiva|usurpaci[oó]n)\b/i;

const CONCEPT_RE =
  /\b(qu[eé] es|qu[eé] significa|significado|diferencia|diferencias|expl[ií]came|explica|concepto|definici[oó]n|definir|principio|teor[ií]a|naturaleza jur[ií]dica|c[oó]mo funciona|por qu[eé]|comparaci[oó]n|compara|versus|vs\.?)\b/i;

/** Comparaciones con ordenamientos distintos al peruano: conviene contrastar. */
const FOREIGN_RE =
  /\b(chile|argentina|colombia|ecuador|bolivia|brasil|m[eé]xico|espa[ñn]a|uruguay|paraguay|venezuela|estados unidos|uni[oó]n europea|derecho comparado|comparaci[oó]n|compara)\b/i;

const FOLLOWUP_START_RE =
  /^(y |pero |entonces|adem[aá]s|tambi[eé]n|ahora|en ese caso|en ese supuesto|sobre eso|respecto a eso|y si|y cuando|y c[oó]mo|y qui[eé]n|y d[oó]nde|y cu[aá]ndo|por qu[eé]|porque|c[oó]mo ser[ií]a|qu[eé] pasa|qu[eé] m[aá]s|cu[aá]l ser[ií]a|expl[ií]came m[aá]s|ampl[ií]a|contin[uú]a|sigue)\b/i;

const FOLLOWUP_RE =
  /\b(eso|esto|aquello|lo mismo|el mismo|la misma|ah[ií]|anterior|antes dijiste|mencionaste|dijiste|ese art[ií]culo|esa norma|esa ley|esa sentencia|en el ejemplo|del ejemplo)\b/i;

const ARTICLE_RE = /\bart(?:[ií]culo|\.)\s*[0-9]+/i;

export function foldText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El mensaje solo tiene sentido si se lee junto con lo anterior. */
export function isFollowUp(text: string): boolean {
  // En español la pregunta empieza con signo de apertura: «¿Y si…?» debe
  // reconocerse como seguimiento igual que «y si…».
  const clean = text.replace(/^[¿?¡!\s]+/, '').trim();
  if (!clean) return false;
  if (ARTICLE_RE.test(clean) || JURIS_RE.test(clean)) return false;
  if (clean.length < 90 && FOLLOWUP_START_RE.test(clean)) return true;
  if (clean.length < 60 && FOLLOWUP_RE.test(clean)) return true;
  return false;
}

/**
 * Construye la consulta de recuperación para un seguimiento: conserva el tema
 * del mensaje anterior y le añade la pregunta nueva.
 */
export function expandFollowUp(text: string, history: Array<{ role: string; content: string }>): string {
  const previous = [...history].reverse().find((m) => m.role === 'user' && m.content.trim());
  if (!previous) return text;
  const base = previous.content.replace(/\s+/g, ' ').trim();
  const current = text.replace(/\s+/g, ' ').trim();
  return `${base.slice(0, 500)} — ${current}`.trim();
}

function hasAny(re: RegExp, text: string): boolean {
  return re.test(text);
}

export function classifyIntent(text: string, history: Array<{ role: string; content: string }> = []): IntentPlan {
  const clean = text.replace(/\s+/g, ' ').trim();
  const folded = foldText(clean);
  const followUp = history.length > 0 && isFollowUp(clean);

  let kind: IntentKind;
  if (followUp) kind = 'seguimiento';
  else if (hasAny(JURIS_RE, folded)) kind = 'jurisprudencial';
  else if (hasAny(ACTUALITY_RE, folded)) kind = 'actualidad';
  else if (ARTICLE_RE.test(clean)) kind = 'legislativa';
  else if (hasAny(CASE_RE, folded) && !hasAny(CONCEPT_RE, folded)) kind = 'caso';
  else if (hasAny(LEGIS_RE, folded)) kind = 'legislativa';
  else if (hasAny(CONCEPT_RE, folded)) kind = 'conceptual';
  else if (hasAny(CASE_RE, folded)) kind = 'caso';
  else kind = 'general';

  // La biblioteca cubre Derecho peruano; para temas ajenos solo sirve como
  // apoyo y la web pasa a ser la fuente principal.
  const legalDomain = hasAny(LEGIS_RE, folded) || hasAny(JURIS_RE, folded) || hasAny(CASE_RE, folded);
  const useLibrary = legalDomain || kind !== 'general';
  const useWeb =
    kind === 'actualidad' ||
    kind === 'jurisprudencial' ||
    (kind === 'legislativa' && hasAny(/vigencia|derogad|publicad|modificad|reciente|actual/i, folded)) ||
    kind === 'general' ||
    hasAny(FOREIGN_RE, folded) ||
    (kind === 'caso' && hasAny(/actual|hoy|reciente|2025|2026|nuevo/i, folded));

  // En derecho comparado la biblioteca cubre el Perú; la web debe buscar la
  // normativa del otro país en sus fuentes oficiales, no artículos peruanos.
  const foreign = FOREIGN_SOURCES.find((f) => f.re.test(clean));
  const comparing = Boolean(foreign && /\b(compara|comparar|comparaci[oó]n|diferencias|semejanzas|versus|vs\.?)\b/i.test(folded));
  const officialDomains = comparing && foreign ? [...OFFICIAL_DOMAINS, ...foreign.domains] : OFFICIAL_DOMAINS;
  const webQuery = buildWebQuery(clean, kind, folded, comparing ? foreign : undefined);

  const reasons: Record<IntentKind, string> = {
    conceptual: 'Explicación con apoyo de la biblioteca y, si aporta, una fuente externa.',
    legislativa: 'Se busca el texto y los metadatos de la norma en la biblioteca y en fuentes oficiales.',
    jurisprudencial: 'Se contrastan sentencias y criterios en el Tribunal Constitucional y el Poder Judicial.',
    caso: 'Se resuelve el supuesto con la norma aplicable y se advierten riesgos procesales.',
    actualidad: 'Se verifica la vigencia y los cambios recientes en fuentes oficiales antes de responder.',
    seguimiento: 'Se conserva el tema de los mensajes anteriores y se profundiza en la nueva pregunta.',
    general: 'Se responde con conocimiento general y se buscan fuentes verificables cuando sea posible.',
  };

  return {
    kind,
    label: INTENT_LABEL[kind],
    useLibrary,
    useWeb,
    webQuery,
    officialDomains,
    reason: comparing && foreign
      ? `Se contrasta con el derecho de ${foreign.name}: se buscan sus fuentes oficiales y se usa la biblioteca para el Perú.`
      : reasons[kind],
  };
}

function buildWebQuery(
  clean: string,
  kind: IntentKind,
  folded: string,
  foreign?: { name: string; domains: string[] },
): string {
  let query = clean
    .replace(/[«»"“”]/g, ' ')
    .replace(/^(?:compara|comparar|comp[aá]rame|expl[ií]came|explica|dime|cu[eé]ntame|analiza|resuelve)\s+/i, '')
    .replace(/[.?!]\s.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Los artículos y las leyes se buscan mejor con el nombre completo.
  if (kind === 'legislativa' && !/per[uú]/i.test(query)) query += ' Perú';
  if (kind === 'jurisprudencial' && !/per[uú]/i.test(query)) query += ' Perú';
  if (kind === 'actualidad') {
    const year = new Date().getFullYear();
    if (!/\b20\d\d\b/.test(folded)) query += ` ${year}`;
    if (!/per[uú]|el peruano|spij/i.test(query)) query += ' Perú';
  }
  if (foreign) {
    // Los comparadores genéricos devuelven mayormente páginas peruanas; se
    // pide expresamente el dominio oficial del otro ordenamiento.
    query = `site:${foreign.domains[0]} ${clean}`.slice(0, 300);
  }
  // DuckDuckGo limita el largo útil de la consulta.
  return query.slice(0, 300);
}

export function isOfficialUrl(url: string, officialDomains: string[] = OFFICIAL_DOMAINS): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return officialDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
