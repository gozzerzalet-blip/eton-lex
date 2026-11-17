/**
 * Ingesta manual de fuentes reales.
 *
 * Uso:
 *   npm run ingest            → noticias + actualizaciones legislativas
 *   npm run ingest -- news    → solo ETON NEWS
 *   npm run ingest -- updates → solo actualizaciones legislativas
 *
 * No genera contenido: si no hay fuentes configuradas, termina sin insertar nada.
 */
import { config } from '../config.js';
import { db } from '../db/index.js';
import { ingestNews } from '../modules/news/ingest.js';
import { ingestOfficialUpdates } from '../modules/updates/ingest.js';
async function main() {
    const target = (process.argv[2] ?? 'all').toLowerCase();
    const runNews = target === 'all' || target === 'news';
    const runUpdates = target === 'all' || target === 'updates';
    if (!runNews && !runUpdates) {
        console.error(`Destino desconocido: "${target}". Usa: all | news | updates.`);
        process.exitCode = 1;
        return;
    }
    console.log(`ETON LEX · ingesta (${target})`);
    console.log(`Base de datos: ${config.paths.db}`);
    if (runNews) {
        const feeds = config.news.feeds.length;
        console.log(`\n[news] fuentes RSS configuradas: ${feeds}${config.news.newsApiKey ? ' + NewsAPI' : ''}`);
        const result = await ingestNews();
        console.log(`[news] insertadas: ${result.inserted} · repetidas: ${result.skipped} · errores: ${result.errors.length}`);
        for (const error of result.errors)
            console.error(`  - ${error.feed}: ${error.error}`);
        if (!result.configured)
            console.log('  Sin fuentes configuradas: no se generó ninguna noticia.');
    }
    if (runUpdates) {
        const sources = db.prepare("SELECT COUNT(*) c FROM sources WHERE enabled = 1 AND kind IN ('rss','html')").get().c;
        console.log(`\n[updates] fuentes oficiales activas: ${sources}`);
        const result = await ingestOfficialUpdates();
        console.log(`[updates] propuestas pendientes creadas: ${result.inserted} · repetidas: ${result.skipped} · errores: ${result.errors.length}`);
        for (const error of result.errors)
            console.error(`  - ${error.source}: ${error.error}`);
        if (sources === 0)
            console.log('  Sin fuentes activas: configura una en /admin → Fuentes.');
    }
}
main().catch((error) => {
    console.error('La ingesta falló:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
//# sourceMappingURL=ingest.js.map