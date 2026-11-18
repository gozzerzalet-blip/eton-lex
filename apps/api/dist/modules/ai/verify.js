/** Normaliza para comparar sin depender de tildes ni mayúsculas. */
function foldText(input) {
    return input
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeForMatch(input) {
    return input
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
export function unverifiedArticleRefs(answer, blocks) {
    const known = new Set();
    for (const b of blocks) {
        if (b.articleNumber)
            known.add(String(b.articleNumber).toUpperCase());
        const source = foldText(`${b.label} ${b.meta} ${b.text}`);
        for (const m of source.matchAll(/art(?:iculo|s?\.?)\s*(\d{1,4})/g))
            known.add(m[1]);
    }
    const cited = new Set();
    for (const m of answer.matchAll(/\bart(?:[ií]culo|s?\.?)\s*(\d{1,4})/gi))
        cited.add(m[1]);
    return [...cited].filter((n) => !known.has(n) && !known.has(`${n}A`)).sort((a, b) => Number(a) - Number(b));
}
export function unverifiedQuotes(answer, blocks) {
    const corpus = normalizeForMatch(blocks.map((b) => `${b.text} ${b.meta}`).join(' '));
    if (!corpus)
        return [];
    const quotes = new Set();
    for (const m of answer.matchAll(/[“"«]([^”"»]{25,400})[”"»]/g))
        quotes.add(m[1].trim());
    const bad = [];
    for (const q of quotes) {
        const norm = normalizeForMatch(q);
        if (norm.length < 20)
            continue;
        if (!corpus.includes(norm.slice(0, 60)))
            bad.push(q.length > 90 ? `${q.slice(0, 90)}…` : q);
    }
    return bad;
}
export function unverifiedLawRefs(answer, blocks) {
    const corpus = blocks.map((b) => `${b.label} ${b.meta} ${b.text}`).join(' ');
    const known = new Set([...corpus.matchAll(/\bley\s*(?:n[°º.]?\s*)?(\d{2,5})\b/gi)].map((m) => m[1]));
    const cited = new Set([...answer.matchAll(/\bley\s*(?:n[°º.]?\s*)?(\d{2,5})\b/gi)].map((m) => m[1]));
    return [...cited].filter((n) => !known.has(n)).sort((a, b) => Number(a) - Number(b));
}
export function unverifiedForeignTerms(answer, blocks) {
    const corpus = foldText(blocks.map((b) => `${b.label} ${b.meta} ${b.text}`).join(' '));
    const terms = ['Corte Constitucional', 'acción de tutela', 'Ley 31307'];
    return terms.filter((t) => new RegExp(`\\b${t.replace(/ /g, '\\s+')}\\b`, 'i').test(answer)
        && !corpus.includes(foldText(t)));
}
/** Marcadores [F#] que no corresponden a ninguna fuente entregada. */
export function invalidCitationRefs(answer, blockCount) {
    const refs = [...answer.matchAll(/\[F(\d+)\]/g)].map((m) => Number(m[1]));
    return [...new Set(refs.filter((n) => n < 1 || n > blockCount))].sort((a, b) => a - b);
}
function stripUnlinkedSources(answer) {
    if (/\[F\d+\]/.test(answer))
        return answer;
    const header = /(?:^|\n)[ \t]*(?:#{1,6}\s*)?\*{0,2}(?:Fuentes(?: consultadas| externas| consultadas externas)?|Bibliografía|Referencias)\*{0,2}\s*:?[ \t]*(?:\n|$)/i;
    if (!header.test(answer))
        return answer;
    return answer.replace(header, '\n');
}
/**
 * Verificación posterior al modelo. No reescribe el razonamiento: añade
 * advertencias visibles cuando una afirmación no tiene respaldo en el contexto.
 */
export function verifyAnswer(answer, blocks) {
    const warnings = [];
    const checks = [];
    const modelAnswer = answer;
    const unsupported = unverifiedArticleRefs(modelAnswer, blocks);
    if (unsupported.length > 0) {
        warnings.push(`\n\n---\n\n> ⚠️ **Verificación automática:** esta respuesta menciona el artículo ${unsupported.join(', artículo ')} sin que ese texto conste en las fuentes consultadas. Confírmalo en el diario oficial o en el SPIJ antes de usarlo.`);
        checks.push('articulos_no_verificados');
    }
    const fakeQuotes = unverifiedQuotes(modelAnswer, blocks);
    if (fakeQuotes.length > 0) {
        const list = fakeQuotes.map((q) => `«${q}»`).join('; ');
        warnings.push(`\n\n> ⚠️ **Cita textual no verificada:** ${list} no aparece literalmente en las fuentes consultadas. Puede ser una paráfrasis del modelo: no la uses como texto legal.`);
        checks.push('citas_no_verificadas');
    }
    const inventedLaws = unverifiedLawRefs(modelAnswer, blocks);
    if (inventedLaws.length > 0) {
        warnings.push(`\n\n> ⚠️ **Norma no verificada:** se menciona(n) la(s) Ley ${inventedLaws.join(', Ley ')} sin que aparezca(n) en las fuentes consultadas. No des por verificada esa referencia.`);
        checks.push('leyes_no_verificadas');
    }
    const foreignTerms = unverifiedForeignTerms(modelAnswer, blocks);
    if (foreignTerms.length > 0) {
        warnings.push(`\n\n> ⚠️ **Figura ajena al contexto:** ${foreignTerms.join(', ')} no consta en las fuentes peruanas recuperadas. En Perú corresponde verificar el Tribunal Constitucional y las normas peruanas vigentes.`);
        checks.push('figuras_ajenas');
    }
    const badRefs = invalidCitationRefs(modelAnswer, blocks.length);
    if (badRefs.length > 0) {
        warnings.push(`\n\n> ⚠️ **Referencia inválida:** el texto usa ${badRefs.map((n) => `[F${n}]`).join(', ')} pero ${blocks.length === 0 ? 'no hay fuentes' : `solo existen ${blocks.length} fuentes`} en esta consulta. Esa cita no puede verificarse.`);
        checks.push('referencias_invalidas');
    }
    if (/\bverificado\b/i.test(modelAnswer) && !/\[F\d+\]/.test(modelAnswer)) {
        warnings.push('\n\n> ⚠️ **Verificación sin fuente:** la respuesta usa la palabra «verificado» sin vincular ninguna afirmación con un marcador [F#]. No la presentes como información confirmada.');
        checks.push('verificacion_sin_fuente');
    }
    if (/\bvigent[ea]s?\b/i.test(modelAnswer) && !blocks.some((b) => /vigente/i.test(`${b.meta} ${b.text}`))) {
        warnings.push('\n\n> ⚠️ **Vigencia no confirmada:** la respuesta afirma vigencia, pero ninguna fuente consultada registra ese estado. Confírmalo en El Peruano o el SPIJ.');
        checks.push('vigencia_no_confirmada');
    }
    const stripped = stripUnlinkedSources(modelAnswer);
    if (stripped !== modelAnswer) {
        warnings.push('\n\n> ⚠️ Se retiró la sección de fuentes porque el cuerpo no vinculó ninguna afirmación con marcadores [F#].');
        checks.push('fuentes_no_vinculadas');
    }
    return { text: stripped, warnings, checks };
}
//# sourceMappingURL=verify.js.map