import { Router } from 'express';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { providerInfo } from '../ai/providers.js';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch { dbOk = false; }
  res.json({
    ok: dbOk,
    service: 'eton-lex-api',
    version: '0.1.0',
    time: new Date().toISOString(),
    database: dbOk ? 'ok' : 'error',
  });
});

systemRouter.get('/capabilities', (_req, res) => {
  res.json({
    ai: { ...providerInfo(), note: providerInfo().configured ? null : 'Configura AI_PROVIDER / AI_API_KEY / AI_MODEL para activar ETON AI.' },
    news: {
      configured: config.news.feeds.length > 0 || Boolean(config.news.newsApiKey),
      feeds: config.news.feeds.length,
      newsApi: Boolean(config.news.newsApiKey),
    },
    email: { configured: config.smtp.configured, note: config.smtp.configured ? null : 'Sin SMTP: verificación de correo y recuperación de contraseña pendientes.' },
    webrtc: {
      stun: config.webrtc.stun,
      turn: Boolean(config.webrtc.turnUrl),
      note: config.webrtc.turnUrl ? null : 'Sin TURN: algunas llamadas pueden fallar detrás de NAT estricto.',
    },
    storage: { maxUploadMb: config.maxUploadMb },
    demoMode: config.demoMode,
  });
});

systemRouter.get('/areas', (_req, res) => {
  res.json({ areas: db.prepare('SELECT slug, name, description FROM legal_areas ORDER BY name').all() });
});

// Credenciales ICE para llamadas WebRTC reales. Solo usuarios autenticados.
systemRouter.get('/ice', requireAuth, (_req, res) => {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: config.webrtc.stun },
  ];
  if (config.webrtc.turnUrl) {
    iceServers.push({
      urls: config.webrtc.turnUrl,
      username: config.webrtc.turnUser || undefined,
      credential: config.webrtc.turnPass || undefined,
    });
  }
  res.json({ iceServers, turn: Boolean(config.webrtc.turnUrl) });
});
