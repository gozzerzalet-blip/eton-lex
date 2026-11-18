import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Server } from 'socket.io';
import cron from 'node-cron';
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { initRealtime } from './realtime.js';
import { ingestNews } from './modules/news/ingest.js';
import { ingestOfficialUpdates } from './modules/updates/ingest.js';

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.webOrigin, credentials: true },
  maxHttpBufferSize: 1e6,
});

initRealtime(io);

// ── Procesos automáticos (reales, solo si hay fuentes configuradas) ──
if (config.news.feeds.length > 0 || config.news.newsApiKey) {
  cron.schedule('*/2 * * * *', async () => {
    try {
      const r = await ingestNews();
      console.log(`[news] ${r.inserted} nuevas, ${r.skipped} repetidas, ${r.errors.length} errores`);
    } catch (err) {
      console.error('[news] error', (err as Error).message);
    }
  });
  console.log('· ETON NEWS: comprobación automática cada 2 minutos; noticias nuevas en tiempo real.');
} else {
  console.log('· ETON NEWS: sin fuentes configuradas (NEWS_FEEDS). No se generan noticias.');
}

const officialSources = db.prepare("SELECT COUNT(*) c FROM sources WHERE enabled = 1 AND kind IN ('rss','html')").get() as { c: number };
if (officialSources.c > 0) {
  cron.schedule('*/30 * * * *', async () => {
    try {
      const r = await ingestOfficialUpdates();
      console.log(`[updates] ${r.inserted} publicaciones detectadas, ${r.skipped} repetidas`);
    } catch (err) {
      console.error('[updates] error', (err as Error).message);
    }
  });
  console.log(`· Actualizaciones legislativas: ${officialSources.c} fuente(s) oficial(es) activas, revisión cada 30 minutos.`);
} else {
  console.log('· Actualizaciones legislativas: sin fuentes activas. Configúralas en /admin.');
}

if (config.isProd) {
  const backupScript = path.join(config.paths.apiRoot, 'dist', 'scripts', 'backup.js');
  cron.schedule('0 3 * * *', () => {
    const child = spawn(process.execPath, [backupScript], { stdio: 'inherit' });
    child.on('error', (err) => console.error('[backup] error', err.message));
  });
  console.log('· Respaldos automáticos: diarios a las 03:00 en el volumen persistente.');
}

server.listen(config.port, () => {
  console.log(`\n  ETON LEX API  ·  http://localhost:${config.port}`);
  console.log(`  Entorno: ${config.env}`);
  console.log(`  Base de datos: ${config.paths.db}`);
  console.log(`  ETON AI: ${config.ai.configured ? `${config.ai.provider} / ${config.ai.model}` : 'NO CONFIGURADA'}`);
  console.log(`  Web permitida: ${config.webOrigin.join(', ')}\n`);
});

const shutdown = () => {
  console.log('\nCerrando ETON LEX…');
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
