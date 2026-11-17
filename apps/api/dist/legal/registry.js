/**
 * Registro de fuentes legales oficiales para la ingesta.
 *
 * Cada entrada debe apuntar a una fuente realmente comprobada. Si no hay
 * fuente oficial confirmada, la norma queda fuera de la ingesta y la UI la
 * muestra como «pendiente de integración»: nunca se inventa el texto.
 *
 * `stopAt` corta la edición oficial cuando después de la norma se publica su
 * reglamento u otra norma conexa. `derogatedRanges` registra los artículos que
 * la fuente declara derogados sin reproducir su texto.
 */
const EL_PERUANO = (id) => `https://diariooficial.elperuano.pe/Normas/obtenerDocumento?idNorma=${id}`;
export const officialPdfUrl = (id) => EL_PERUANO(id);
export const LEGAL_SOURCES = [
    {
        slug: 'constitucion-politica',
        expected: /constituci[oó]n pol[ií]tica del per[uú]/i,
        idNorma: 1,
        status: 'vigente',
        minArticles: 190,
        lastArticle: 206,
        notes: 'Texto constitucional con reformas incorporadas en la edición oficial actualizada.',
    },
    {
        slug: 'codigo-civil',
        expected: /c[oó]digo civil/i,
        idNorma: 60,
        status: 'vigente',
        minArticles: 2080,
        lastArticle: 2122,
        notes: 'Los artículos derogados se conservan como registro con la nota oficial de derogación. El artículo 557 no aparece en la capa de texto del PDF oficial y se recupera de la publicación oficial del SPIJ.',
        supplements: [
            {
                number: '557',
                heading: 'Remoción del tutor a pedido del pupilo',
                text: 'El menor que ha cumplido la edad de catorce años puede pedir al juez la remoción de su tutor.',
                status: 'vigente',
                sourceUrl: 'https://spijlibre.minjus.gob.pe/content/publicaciones_oficiales/img/Codigo-Civil.pdf',
                note: 'La capa de texto del PDF de El Peruano omite el cuerpo de este artículo (solo conserva su título). El texto se recuperó de la publicación oficial del Código Civil difundida por el Sistema Peruano de Información Jurídica (SPIJ) y se contrastó con la nota oficial de la Segunda Disposición Final del Decreto Ley N.º 26102, publicada el 29 de diciembre de 1992, que dispone su modificación sin proponer texto modificatorio; por ello se mantiene el texto original.',
            },
        ],
    },
    {
        slug: 'codigo-penal',
        expected: /c[oó]digo penal/i,
        idNorma: 2,
        status: 'vigente',
        minArticles: 440,
        lastArticle: 452,
        derogatedRanges: [
            {
                from: 262,
                to: 269,
                note: 'Capítulo I «Contrabando» del Título XI derogado por la tercera disposición final de la Ley Nº 26461, publicada el 8 de junio de 1995. La edición oficial no reproduce su texto.',
            },
        ],
        notes: 'Incluye artículos con numeración alfabética (por ejemplo, 108-B).',
    },
    {
        slug: 'codigo-procesal-civil',
        expected: /c[oó]digo procesal civil/i,
        idNorma: 120007,
        status: 'vigente',
        minArticles: 800,
        lastArticle: 847,
        stopAt: /^DISPOSICIONES COMPLEMENTARIAS$/,
        derogatedRanges: [
            {
                from: 469,
                to: 472,
                note: 'Artículos derogados por la única disposición derogatoria del Decreto Legislativo N° 1069, publicado el 28 de junio de 2008. La edición oficial no reproduce su texto.',
            },
            {
                from: 540,
                to: 545,
                note: 'Artículos derogados por la Primera Disposición Derogatoria de la Ley N° 27584, publicada el 7 de diciembre de 2001. La edición oficial no reproduce su texto.',
            },
            {
                from: 697,
                to: 703,
                note: 'Artículos derogados por la única disposición complementaria derogatoria del Decreto Legislativo N° 1069, publicado el 28 de junio de 2008. La edición oficial no reproduce su texto.',
            },
        ],
        notes: 'Texto único ordenado aprobado por Resolución Ministerial 010-93-JUS, en la edición oficial actualizada al 7 de junio de 2025. La edición termina en el artículo 847; el índice impreso conserva la referencia antigua al 840.',
    },
    {
        slug: 'codigo-procesal-constitucional',
        expected: /c[oó]digo procesal constitucional/i,
        idNorma: 7,
        status: 'vigente',
        minArticles: 100,
        lastArticle: 122,
        notes: 'Nuevo Código Procesal Constitucional, Ley 31307.',
    },
    {
        slug: 'codigo-ninos-adolescentes',
        expected: /c[oó]digo de los ni[nñ]os y adolescentes/i,
        idNorma: 8,
        status: 'vigente',
        minArticles: 200,
        lastArticle: 252,
        derogatedRanges: [
            {
                from: 183,
                to: 241,
                note: 'Artículos derogados por la única disposición complementaria derogatoria del Decreto Legislativo N° 1348, publicado el 7 de enero de 2017.',
            },
            {
                from: 243,
                to: 244,
                note: 'Artículos derogados por la primera disposición complementaria derogatoria del Decreto Legislativo N° 1297, publicado el 30 de diciembre de 2016.',
            },
        ],
    },
    {
        slug: 'lpaq',
        expected: /procedimiento administrativo general/i,
        idNorma: 12,
        status: 'vigente',
        minArticles: 235,
        lastArticle: 244,
        notes: 'Texto único ordenado de la Ley 27444, aprobado por Decreto Supremo 006-2026-JUS.',
    },
    {
        slug: 'ley-conciliacion',
        expected: /conciliaci[oó]n/i,
        idNorma: 13,
        status: 'vigente',
        minArticles: 28,
        lastArticle: 30,
        stopAt: /^TEXTO [ÚU]NICO ORDENADO DEL$/i,
        notes: 'La edición incluye el TUO del Reglamento; se corta antes del anexo.',
    },
    {
        slug: 'ley-general-sociedades',
        expected: /ley general de sociedades/i,
        idNorma: 15,
        status: 'vigente',
        minArticles: 400,
        lastArticle: 448,
    },
    {
        slug: 'codigo-consumidor',
        expected: /protecci[oó]n y defensa del consumidor/i,
        idNorma: 17,
        status: 'vigente',
        minArticles: 150,
        lastArticle: 160,
    },
    {
        slug: 'ley-procedimiento-ejecucion-coactiva',
        expected: /ejecuci[oó]n coactiva/i,
        idNorma: 19,
        status: 'vigente',
        minArticles: 35,
        lastArticle: 40,
        stopAt: /^REGLAMENTO DE LA LEY DE$/,
        notes: 'La edición incluye el reglamento; se corta antes del anexo.',
    },
    {
        slug: 'ley-transparencia',
        expected: /transparencia y acceso a la informaci[oó]n p[uú]blica/i,
        idNorma: 20,
        status: 'vigente',
        minArticles: 20,
        lastArticle: 22,
        stopAt: /^REGLAMENTO DE LA LEY DE TRANSPARENCIA Y$/,
        notes: 'La edición incluye el reglamento; se corta antes del anexo.',
    },
    {
        slug: 'ley-contrataciones',
        expected: /contrataciones/i,
        idNorma: 25,
        status: 'vigente',
        minArticles: 95,
        lastArticle: 100,
        stopAt: /^Reglamento de la Ley General de Contrataciones Públicas$/,
        notes: 'Ley 32069. La edición incluye el reglamento; se corta antes del anexo.',
    },
    {
        slug: 'ley-productividad-laboral',
        expected: /productividad y competitividad laboral/i,
        idNorma: 35,
        status: 'vigente',
        minArticles: 105,
        lastArticle: 112,
        stopAt: /^Texto Único Ordenado de la Ley de Formación y Promoción Laboral$/,
        derogatedRanges: [
            {
                from: 97,
                to: 106,
                note: 'Título V «De las Empresas Especiales» derogado por la quinta disposición transitoria, complementaria y final de la Ley Nº 27626, publicada el 9 de enero de 2002. La edición oficial no reproduce su texto.',
            },
        ],
        notes: 'TUO del Decreto Legislativo 728. Se corta antes de la Ley de Formación y Promoción Laboral y su reglamento.',
    },
    {
        slug: 'ley-universitaria',
        expected: /ley universitaria/i,
        idNorma: 50,
        status: 'vigente',
        minArticles: 130,
        lastArticle: 133,
    },
    {
        slug: 'ley-titulos-valores',
        expected: /t[ií]tulos valores/i,
        idNorma: 63,
        status: 'vigente',
        minArticles: 270,
        lastArticle: 279,
    },
    {
        slug: 'lopj',
        expected: /ley org[aá]nica del poder judicial/i,
        idNorma: 71,
        status: 'vigente',
        minArticles: 250,
        lastArticle: 304,
        notes: 'Texto único ordenado aprobado por Decreto Supremo 017-93-JUS. Los artículos derogados se registran con la nota oficial agrupada.',
    },
    {
        slug: 'lomp',
        expected: /ley\s+org[aá]nica\s+del\s+ministerio\s+p[uú]blico/i,
        idNorma: 72,
        status: 'vigente',
        minArticles: 100,
        lastArticle: 107,
    },
    {
        slug: 'codigo-tributario',
        expected: /c[oó]digo tributario/i,
        idNorma: 90009,
        status: 'vigente',
        minArticles: 185,
        lastArticle: 194,
        notes: 'Texto único ordenado aprobado por Decreto Supremo 133-2013-EF.',
    },
    {
        slug: 'ley-arbitraje',
        expected: /arbitraje/i,
        idNorma: 40001,
        status: 'vigente',
        minArticles: 75,
        lastArticle: 78,
        notes: 'Decreto Legislativo 1071, que deroga la Ley 26572. Consta de 78 artículos.',
    },
    {
        slug: 'codigo-procesal-penal',
        expected: /c[oó]digo procesal penal/i,
        idNorma: 70003,
        status: 'vigente',
        minArticles: 550,
        lastArticle: 566,
    },
    {
        slug: 'codigo-ejecucion-penal',
        expected: /c[oó]digo de ejecuci[oó]n penal/i,
        idNorma: 70006,
        status: 'vigente',
        minArticles: 140,
        lastArticle: 148,
        stopAt: /^REGLAMENTO DEL C[OÓ]DIGO DE EJECUCI[OÓ]N PENAL$/,
        notes: 'La edición incluye el reglamento; se corta antes del anexo.',
    },
];
/**
 * Encabezados de página que «Normas Legales Actualizadas» repite en cada
 * página. Se retiran por coincidencia exacta de línea; nunca se tocan
 * referencias dentro de un párrafo.
 */
const PAGE_HEADERS = {
    'constitucion-politica': [/^Constitución Política del Perú$/i],
    'codigo-civil': [/^Código Civil$/i],
    'codigo-penal': [/^Código Penal$/i, /^Código PenalCódigo Penal$/i],
    'codigo-procesal-civil': [/^TUO del Código Procesal Civil$/i],
    'codigo-procesal-constitucional': [/^Código Procesal Constitucional$/i],
    'codigo-ninos-adolescentes': [/^Código de los Niños y Adolescentes$/i],
    lpaq: [/^TUO de la Ley del Procedimiento Administrativo General$/i],
    'ley-conciliacion': [/^Ley de Conciliación$/i],
    'ley-general-sociedades': [/^Ley General de Sociedades$/i],
    'codigo-consumidor': [/^Código de Protección y Defensa del Consumidor$/i],
    'ley-procedimiento-ejecucion-coactiva': [
        /^TUO de la Ley de Procedimiento de Ejecución Coactiva$/i,
    ],
    'ley-transparencia': [
        /^TUO de la Ley de Transparencia y Acceso a la Información Pública$/i,
    ],
    'ley-contrataciones': [/^Ley General de Contrataciones Públicas$/i],
    'ley-productividad-laboral': [
        /^Ley de Productividad y Competitividad Laboral$/i,
    ],
    'ley-universitaria': [/^Ley Universitaria$/i],
    lopj: [/^Texto Único Ordenado de la Ley Orgánica del Poder Judicial$/i],
    lomp: [/^LEY ORGÁNICA DEL$/i, /^MINISTERIO PÚBLICO$/i],
    'codigo-tributario': [
        /^Texto Único Ordenado del Código Tributario$/i,
        /^Código Tributario$/i,
    ],
    'ley-arbitraje': [/^Decreto Legislativo que norma el Arbitraje$/i],
    'codigo-procesal-penal': [
        /^Código Procesal Penal$/i,
        /^Código Procesal PenalCódigo Procesal Penal$/i,
    ],
    'codigo-ejecucion-penal': [/^Código de Ejecución Penal$/i],
};
for (const source of LEGAL_SOURCES) {
    const headers = PAGE_HEADERS[source.slug];
    if (headers)
        source.pageHeaders = headers;
}
/** Normas del catálogo que todavía no tienen fuente oficial confirmada. */
export const PENDING_SLUGS = [
    'codigo-comercio',
    'codigo-procedimientos-penales',
    'ley-delitos-aduaneros',
    'ley-seguridad-salud-trabajo',
    'nueva-ley-procesal-trabajo',
];
export function sourceFor(slug) {
    return LEGAL_SOURCES.find((s) => s.slug === slug);
}
//# sourceMappingURL=registry.js.map