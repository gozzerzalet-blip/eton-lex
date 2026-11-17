/**
 * Investigación web de ETON AI sin API key.
 *
 * Estrategia: buscar en DuckDuckGo (HTML), ordenar los resultados para que los
 * dominios oficiales vayan primero y leer un número acotado de páginas con
 * protección contra SSRF, timeouts y límite de bytes. El texto extraído se
 * entrega al modelo como fuente externa citables; si algo falla, se informa y
 * la respuesta continúa con la biblioteca.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ETON-LEX/1.0 (+asistente juridico)';
const MAX_HTML_BYTES = 2_500_000;
const MAX_PDF_BYTES = 12_000_000;
const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata.google.internal',
    'instance-data',
    '169.254.169.254',
]);
const NON_SOURCE_DOMAINS = [
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'pinterest.com',
    'x.com',
    'twitter.com',
    'youtube.com',
    'duckduckgo.com',
    'google.com',
];
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MONTHS = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', setiembre: '09', septiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
};
function decodeEntities(input) {
    const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
        mdash: '—', hellip: '…', laquo: '«', raquo: '»', aacute: 'á', eacute: 'é',
        iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É',
        Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uml: '¨', deg: '°',
        ordm: 'º', ordf: 'ª', sect: '§', middot: '·', times: '×', divide: '÷',
    };
    return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code) => {
        if (code.startsWith('#x') || code.startsWith('#X')) {
            const n = parseInt(code.slice(2), 16);
            return Number.isFinite(n) ? String.fromCodePoint(n) : all;
        }
        if (code.startsWith('#')) {
            const n = parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : all;
        }
        return named[code] ?? named[code.toLowerCase()] ?? all;
    });
}
function stripTags(html) {
    return decodeEntities(html
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|header|footer|table)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function pageTitle(html) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? stripTags(m[1]).slice(0, 200) : '';
}
function htmlToText(html) {
    const cleaned = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|nav|footer|form|iframe|aside)\b[\s\S]*?<\/\1>/gi, ' ');
    return stripTags(cleaned);
}
function findDate(text) {
    const iso = text.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/);
    if (iso)
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const long = text.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/i);
    if (long) {
        const month = MONTHS[long[2].toLowerCase()] ?? '01';
        return `${long[3]}-${month}-${long[1].padStart(2, '0')}`;
    }
    return null;
}
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127)
            return true;
        if (p[0] === 169 && p[1] === 254)
            return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
            return true;
        if (p[0] === 192 && p[1] === 168)
            return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
            return true;
        if (p[0] === 192 && p[1] === 0 && p[2] === 0)
            return true;
        if (p[0] === 198 && (p[1] === 18 || p[1] === 19))
            return true;
        if (p[0] >= 224)
            return true;
        return false;
    }
    if (net.isIPv6(ip)) {
        const low = ip.toLowerCase();
        if (low === '::1' || low === '::')
            return true;
        if (low.startsWith('fc') || low.startsWith('fd'))
            return true;
        if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb'))
            return true;
        const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped)
            return isPrivateIp(mapped[1]);
        return false;
    }
    return true;
}
async function assertSafeUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error('URL inválida.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new Error('Solo se permite HTTP/HTTPS.');
    if (url.username || url.password)
        throw new Error('URL con credenciales no permitida.');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (port !== '80' && port !== '443')
        throw new Error('Puerto no permitido.');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
        throw new Error('Destino interno bloqueado.');
    }
    if (net.isIP(host)) {
        if (isPrivateIp(host))
            throw new Error('Dirección IP privada bloqueada.');
        return url;
    }
    const resolved = await dns.lookup(host, { all: true, verbatim: true });
    if (resolved.length === 0)
        throw new Error('No se pudo resolver el dominio.');
    if (resolved.some((r) => isPrivateIp(r.address)))
        throw new Error('El dominio resuelve a una red privada.');
    return url;
}
async function fetchLimited(rawUrl, signal, maxBytes, redirects = 0) {
    const url = await assertSafeUrl(rawUrl);
    const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
            'accept-language': 'es-PE,es;q=0.9,en;q=0.6',
        },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (redirects >= 3)
            throw new Error('Demasiadas redirecciones.');
        const next = new URL(res.headers.get('location'), url).toString();
        return fetchLimited(next, signal, maxBytes, redirects + 1);
    }
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length && length > maxBytes)
        throw new Error('Página demasiado grande.');
    const reader = res.body?.getReader();
    if (!reader)
        throw new Error('Respuesta sin cuerpo.');
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => { });
            throw new Error('Página demasiado grande.');
        }
        chunks.push(value);
    }
    return { res, buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), url };
}
function unwrapDuckUrl(href) {
    let raw = href.trim();
    if (raw.startsWith('//'))
        raw = `https:${raw}`;
    try {
        const u = new URL(raw);
        if (u.hostname.endsWith('duckduckgo.com')) {
            const target = u.searchParams.get('uddg');
            if (target)
                return decodeURIComponent(target);
        }
        return raw;
    }
    catch {
        return raw;
    }
}
function parseDuckHtml(html) {
    const hits = [];
    const snippets = [];
    const snippetRe = /<(?:a|td)\b[^>]*class=["'][^"']*result(?:__snippet|-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
    for (const m of html.matchAll(snippetRe))
        snippets.push(stripTags(m[1]).slice(0, 500));
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(anchorRe)) {
        const attrs = m[1];
        if (!/class=["'][^"']*(result__a|result-link)/i.test(attrs))
            continue;
        const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
        if (!href)
            continue;
        const url = unwrapDuckUrl(href);
        const title = stripTags(m[2]).slice(0, 220);
        if (!url || !title)
            continue;
        if (hits.some((h) => h.url === url))
            continue;
        hits.push({ title, url, snippet: snippets[hits.length] ?? '' });
    }
    return hits;
}
async function searchDuckDuckGo(query, signal) {
    const endpoints = [
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=pe-es`,
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=pe-es`,
    ];
    const errors = [];
    for (const endpoint of endpoints) {
        try {
            const { res, buffer } = await fetchLimited(endpoint, signal, MAX_HTML_BYTES);
            const html = buffer.toString('utf8');
            if (/anomaly|challenge|captcha/i.test(html.slice(0, 4000)) && !/result__a|result-link/i.test(html)) {
                errors.push('DuckDuckGo pidió verificación.');
                continue;
            }
            const hits = parseDuckHtml(html);
            if (hits.length > 0)
                return hits;
            const ct = res.headers.get('content-type') ?? '';
            errors.push(`Sin resultados (${ct || 'sin tipo'}).`);
        }
        catch (err) {
            if (signal.aborted)
                throw err;
            errors.push(err.message);
        }
    }
    if (errors.length > 0)
        throw new Error(errors[errors.length - 1]);
    return [];
}
function sourceDomain(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    }
    catch {
        return '';
    }
}
function isOfficialDomain(host, officialDomains) {
    return officialDomains.some((d) => host === d || host.endsWith(`.${d}`));
}
function rankHits(hits, officialDomains) {
    return [...hits]
        .map((hit, index) => {
        const host = sourceDomain(hit.url);
        const official = isOfficialDomain(host, officialDomains);
        const blocked = NON_SOURCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
        const score = (official ? 100 : 0) - (blocked ? 80 : 0) - index;
        return { hit, score };
    })
        .filter((x) => x.score > -50)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.hit);
}
async function readPage(hit, signal, maxChars) {
    const maybePdf = /\.pdf($|\?)/i.test(hit.url);
    const { res, buffer, url } = await fetchLimited(hit.url, signal, maybePdf ? MAX_PDF_BYTES : MAX_HTML_BYTES);
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null;
    let text = '';
    let title = hit.title;
    if (contentType === 'application/pdf' || /\.pdf($|\?)/i.test(url.pathname)) {
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const parsed = await pdfParse(buffer, { max: 25 });
        text = parsed.text?.replace(/\s+/g, ' ').trim() ?? '';
        if (parsed.info?.Title)
            title = String(parsed.info.Title).slice(0, 220);
    }
    else if (contentType === 'text/plain') {
        text = buffer.toString('utf8');
    }
    else if (!contentType || contentType.includes('html') || contentType.includes('xml')) {
        const html = buffer.toString('utf8');
        text = htmlToText(html);
        title = pageTitle(html) || hit.title;
        if (text.length < 300) {
            // Algunas páginas cargan el contenido con JavaScript: al menos se
            // conserva el resumen del buscador, nunca se inventa texto.
            text = `${hit.snippet}\n${text}`.trim();
        }
    }
    else {
        throw new Error(`Tipo de contenido no legible (${contentType}).`);
    }
    const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return {
        text: clean.slice(0, Math.max(500, maxChars)),
        contentType,
        title: title.slice(0, 220),
        finalUrl: url.toString(),
        publishedAt: findDate(clean.slice(0, 1500)),
    };
}
/**
 * Busca y lee fuentes externas. Nunca lanza por fallos de red: devuelve los
 * errores para que la respuesta pueda explicar qué no se pudo verificar.
 */
export async function researchWeb(query, opts) {
    const started = Date.now();
    const q = query.replace(/\s+/g, ' ').trim();
    const empty = { query: q, sources: [], errors: [], tookMs: 0, engine: 'duckduckgo' };
    if (!q)
        return empty;
    const cached = cache.get(q.toLowerCase());
    if (cached && Date.now() - cached.at < CACHE_TTL_MS)
        return { ...cached.value, tookMs: Date.now() - started };
    const maxSources = Math.max(1, Math.min(opts.maxSources ?? 4, 6));
    const timeoutMs = Math.max(3000, Math.min(opts.timeoutMs ?? 15_000, 30_000));
    const maxChars = Math.max(1200, Math.min(opts.maxChars ?? 6000, 12_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (opts.signal) {
        if (opts.signal.aborted)
            controller.abort();
        else
            opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    const errors = [];
    const sources = [];
    try {
        let hits = [];
        try {
            hits = await searchDuckDuckGo(q, controller.signal);
        }
        catch (err) {
            errors.push(`Búsqueda web no disponible: ${err.message}`);
        }
        const ranked = rankHits(hits, opts.officialDomains).slice(0, maxSources + 3);
        const tasks = ranked.slice(0, maxSources + 1).map(async (hit) => {
            const host = sourceDomain(hit.url);
            const official = isOfficialDomain(host, opts.officialDomains);
            try {
                const page = await readPage(hit, controller.signal, maxChars);
                return {
                    id: '',
                    title: page.title || hit.title,
                    url: page.finalUrl,
                    domain: sourceDomain(page.finalUrl) || host,
                    snippet: hit.snippet,
                    text: page.text,
                    official,
                    fetched: true,
                    contentType: page.contentType,
                    publishedAt: page.publishedAt,
                };
            }
            catch (err) {
                if (controller.signal.aborted)
                    throw err;
                return {
                    id: '',
                    title: hit.title,
                    url: hit.url,
                    domain: host,
                    snippet: hit.snippet,
                    text: hit.snippet,
                    official,
                    fetched: false,
                    contentType: null,
                    publishedAt: findDate(hit.snippet),
                };
            }
        });
        const settled = await Promise.allSettled(tasks);
        for (const result of settled) {
            if (result.status === 'fulfilled') {
                const src = result.value;
                if (src.text.trim().length > 40 && !sources.some((s) => s.url === src.url))
                    sources.push(src);
            }
            else if (!controller.signal.aborted) {
                errors.push(result.reason.message);
            }
        }
        // Las fuentes oficiales primero, luego las que sí se pudieron leer.
        sources.sort((a, b) => Number(b.official) - Number(a.official) || Number(b.fetched) - Number(a.fetched));
        const selected = sources.slice(0, maxSources).map((s, i) => ({ ...s, id: `web_${i + 1}` }));
        const value = {
            query: q,
            sources: selected,
            errors: [...new Set(errors)].slice(0, 4),
            tookMs: Date.now() - started,
            engine: 'duckduckgo',
        };
        cache.set(q.toLowerCase(), { at: Date.now(), value });
        return value;
    }
    catch (err) {
        return {
            query: q,
            sources,
            errors: [...new Set([...errors, err.message])].slice(0, 4),
            tookMs: Date.now() - started,
            engine: 'duckduckgo',
        };
    }
    finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
    }
}
//# sourceMappingURL=web.js.map