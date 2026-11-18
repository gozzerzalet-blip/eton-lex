import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
// Carga .env del monorepo y, si existe, el local de la API.
for (const file of [path.join(repoRoot, '.env'), path.join(apiRoot, '.env')]) {
    if (fs.existsSync(file))
        dotenv.config({ path: file, override: false });
}
const bool = (v, fallback = false) => v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
const int = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
// Proveedores que funcionan sin clave de API: un servidor local (Ollama) o un
// punto de acceso comunitario sin registro (Pollinations).
const NO_KEY_PROVIDERS = new Set(['ollama', 'pollinations']);
/**
 * Fuentes públicas predeterminadas de ETON NEWS. No requieren clave ni pago y
 * cubren cambios legales, derechos humanos, criminalidad, cultura y actualidad
 * mundial. `NEWS_FEEDS` las reemplaza por completo cuando se define.
 */
const DEFAULT_NEWS_FEEDS = [
    'https://iuslatin.pe/feed/|nacional|Actualidad jurídica|IUSLatin.pe',
    'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=165|internacional|Nuevas leyes y derogaciones|EUR-Lex DO L',
    'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=162|internacional|Legislación UE|EUR-Lex Legislación',
    'https://ec.europa.eu/commission/presscorner/api/rss?language=en&latestnews|internacional|Políticas y justicia UE|Comisión Europea',
    'https://news.un.org/feed/subscribe/en/news/all/rss.xml|internacional|Derecho internacional|UN News',
    'https://www.ohchr.org/en/rss.xml|internacional|Derechos humanos|OHCHR',
    'https://www.icc-cpi.int/rss/news/all|internacional|Crímenes internacionales|Corte Penal Internacional',
    'https://www.europol.europa.eu/rss.xml|internacional|Criminalidad|Europol',
    'https://whc.unesco.org/en/news/rss/|internacional|Cultura y patrimonio|UNESCO Patrimonio Mundial',
    'https://ich.unesco.org/cron_rss.php?flux-rss=news&lang=en|internacional|Cultura viva|UNESCO Patrimonio Inmaterial',
    'https://hudoc.echr.coe.int/app/transform/rss?library=echrengpress&query=contentsitename%3AECHR%20AND%20doctype%3DPR&sort=kpdate%20Descending&start=0&length=20&rankingModelId=11111111-0000-0000-0000-000000000000|internacional|Jurisprudencia|TEDH',
    'https://feeds.bbci.co.uk/news/world/rss.xml|internacional|Actualidad mundial|BBC World',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml|internacional|Actualidad mundial|The New York Times',
];
const dataDir = process.env.DATA_DIR ?? path.join(apiRoot, 'data');
export const config = {
    env: process.env.NODE_ENV ?? 'development',
    isProd: process.env.NODE_ENV === 'production',
    port: int(process.env.PORT, 4000),
    // URL pública oficial: se usa en canonical, Open Graph, robots.txt y sitemap.xml.
    // En producción debe ser el dominio con HTTPS (p. ej. https://etonlex.pe).
    publicWebUrl: (process.env.PUBLIC_WEB_URL ?? `http://localhost:${int(process.env.PORT, 4000)}`).replace(/\/+$/, ''),
    webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
    paths: {
        apiRoot,
        repoRoot,
        data: dataDir,
        uploads: path.join(dataDir, 'uploads'),
        aiUploads: path.join(dataDir, 'uploads', 'ai'),
        db: process.env.DATABASE_PATH ?? path.join(dataDir, 'eton-lex.db'),
    },
    // Respaldos locales dentro del volumen persistente. En VPS se puede montar
    // otro volumen en BACKUP_DIR para copiar fuera del contenedor de la API.
    backup: {
        dir: process.env.BACKUP_DIR ?? path.join(dataDir, 'backups'),
        retentionDays: int(process.env.BACKUP_RETENTION_DAYS, 14),
    },
    ai: {
        provider: (process.env.AI_PROVIDER ?? 'none').toLowerCase(),
        apiKey: process.env.AI_API_KEY ?? '',
        model: process.env.AI_MODEL ?? '',
        baseUrl: process.env.AI_BASE_URL ?? '',
        embeddingModel: process.env.EMBEDDING_MODEL ?? '',
        // Proveedor de respaldo: si el principal falla antes de emitir texto
        // (límite de uso, caída o timeout), la respuesta continúa con este otro
        // modelo en lugar de mostrar un error al usuario.
        fallback: {
            provider: (process.env.AI_FALLBACK_PROVIDER ?? '').toLowerCase(),
            model: process.env.AI_FALLBACK_MODEL ?? '',
            baseUrl: process.env.AI_FALLBACK_BASE_URL ?? '',
            apiKey: process.env.AI_FALLBACK_API_KEY ?? process.env.AI_API_KEY ?? '',
            get configured() {
                return this.provider !== '' && this.provider !== 'none' && Boolean(this.model) && (NO_KEY_PROVIDERS.has(this.provider) || Boolean(this.apiKey));
            },
        },
        // Temperatura baja: el asistente jurídico debe ser estable y no inventar.
        temperature: (() => {
            const n = Number(process.env.AI_TEMPERATURE ?? 0.2);
            return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.2;
        })(),
        maxTokens: int(process.env.AI_MAX_TOKENS, 900),
        historyMessages: int(process.env.AI_HISTORY, 12),
        // Un modelo local en CPU necesita contexto corto; uno en la nube puede
        // recibir más fuentes sin penalizar la velocidad.
        contextChars: int(process.env.AI_CONTEXT_CHARS, (process.env.AI_PROVIDER ?? '').toLowerCase() === 'ollama' ? 12_000 : 20_000),
        libraryBlocks: int(process.env.AI_LIBRARY_BLOCKS, 8),
        get configured() {
            return this.provider !== 'none' && (NO_KEY_PROVIDERS.has(this.provider) || Boolean(this.apiKey));
        },
    },
    // Investigación web sin API key: búsqueda en DuckDuckGo y lectura de la
    // página, con prioridad para dominios oficiales del Estado peruano.
    webResearch: {
        enabled: bool(process.env.AI_WEB_RESEARCH, true),
        maxSources: int(process.env.AI_WEB_SOURCES, 3),
        timeoutMs: int(process.env.AI_WEB_TIMEOUT_MS, 15_000),
        maxPageChars: int(process.env.AI_WEB_PAGE_CHARS, 2500),
    },
    news: {
        feeds: (() => {
            const raw = process.env.NEWS_FEEDS;
            if (raw === undefined || raw.trim() === '')
                return DEFAULT_NEWS_FEEDS;
            return raw.split(',').map((s) => s.trim()).filter(Boolean);
        })(),
        newsApiKey: process.env.NEWSAPI_KEY ?? '',
    },
    webrtc: {
        stun: (process.env.WEBRTC_STUN ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
        turnUrl: process.env.WEBRTC_TURN_URL ?? '',
        turnUser: process.env.WEBRTC_TURN_USER ?? '',
        turnPass: process.env.WEBRTC_TURN_PASS ?? '',
    },
    smtp: {
        host: process.env.SMTP_HOST ?? '',
        port: int(process.env.SMTP_PORT, 465),
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
        // Gmail rechaza remitentes que no sean la cuenta autenticada. Si no se
        // define SMTP_FROM, se usa el propio SMTP_USER como remitente visible.
        get from() {
            return process.env.SMTP_FROM ?? (process.env.SMTP_USER ? `ETON LEX <${process.env.SMTP_USER}>` : 'ETON LEX <no-reply@etonlex.pe>');
        },
        get secure() {
            return this.port === 465;
        },
        get configured() {
            return Boolean(this.host && this.user && this.pass);
        },
    },
    maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25),
    seedAdmin: {
        email: process.env.SEED_ADMIN_EMAIL ?? '',
        password: process.env.SEED_ADMIN_PASSWORD ?? '',
        name: process.env.SEED_ADMIN_NAME ?? 'Administrador ETON LEX',
    },
    demoMode: bool(process.env.DEMO_MODE, false),
};
for (const dir of [config.paths.data, config.paths.uploads, config.paths.aiUploads, config.backup.dir]) {
    fs.mkdirSync(dir, { recursive: true });
}
if (config.isProd && config.jwtSecret.startsWith('dev-only')) {
    throw new Error('JWT_SECRET debe configurarse en producción.');
}
//# sourceMappingURL=config.js.map