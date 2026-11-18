import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { optionalAuth } from './lib/auth.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { libraryRouter } from './modules/library/library.routes.js';
import { newsRouter } from './modules/news/news.routes.js';
import { updatesRouter } from './modules/updates/updates.routes.js';
import { communityRouter } from './modules/community/community.routes.js';
import { messagingRouter } from './modules/messaging/messaging.routes.js';
import { stickersRouter } from './modules/messaging/stickers.routes.js';
import { roomsRouter } from './modules/rooms/rooms.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { tutorRouter } from './modules/ai/tutor.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { systemRouter } from './modules/system/system.routes.js';
import { academicRouter } from './modules/system/academic.routes.js';
export function createApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(helmet({
        contentSecurityPolicy: config.isProd ? {
            directives: {
                defaultSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
                mediaSrc: ["'self'", 'blob:', 'https:'],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
                connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
                frameAncestors: ["'none'"],
            },
        } : false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
    app.use(cors({ origin: config.webOrigin, credentials: true }));
    app.use(compression());
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));
    app.use(cookieParser());
    app.use(optionalAuth);
    app.use('/api', rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 1200,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Espera unos minutos.' } },
    }));
    app.use('/api/auth/login', rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos de acceso. Espera 15 minutos.' } },
    }));
    app.use('/api/auth/register', rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiados registros desde esta red. Intenta más tarde.' } },
    }));
    app.use('/api/auth/forgot-password', rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes de recuperación. Espera una hora.' } },
    }));
    app.use('/api/auth/reset-password', rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos con el código. Espera 15 minutos.' } },
    }));
    app.use('/api/auth/verify-email', rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos con el código. Espera 15 minutos.' } },
    }));
    app.use('/api/auth/resend-verification', rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes de verificación. Espera una hora.' } },
    }));
    app.use('/api/auth/request-login-code', rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiados códigos de ingreso. Espera una hora.' } },
    }));
    app.use('/api/auth/login-with-code', rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos con el código. Espera 15 minutos.' } },
    }));
    app.use('/api/ai', rateLimit({
        windowMs: 60 * 1000,
        limit: 40,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Límite de consultas a ETON AI. Espera un momento.' } },
    }));
    app.use('/api/tutor', rateLimit({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMIT', message: 'Límite de consultas al tutor. Espera un momento.' } },
    }));
    app.use('/api/academic', academicRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/users', usersRouter);
    app.use('/api/library', libraryRouter);
    app.use('/api/news', newsRouter);
    app.use('/api/updates', updatesRouter);
    app.use('/api/community', communityRouter);
    app.use('/api/messaging', messagingRouter);
    app.use('/api/stickers', stickersRouter);
    app.use('/api/rooms', roomsRouter);
    app.use('/api/notifications', notificationsRouter);
    app.use('/api/ai', aiRouter);
    app.use('/api/tutor', tutorRouter);
    app.use('/api/dashboard', dashboardRouter);
    app.use('/api/admin', adminRouter);
    app.use('/api/system', systemRouter);
    app.use('/api', documentsRouter);
    // Frontend compilado (producción)
    const webDist = path.join(config.paths.repoRoot, 'apps', 'web', 'dist');
    if (fs.existsSync(webDist)) {
        const indexPath = path.join(webDist, 'index.html');
        // Rutas públicas indexables. El resto de la app requiere sesión y se
        // excluye explícitamente de los buscadores.
        const publicPaths = ['/login', '/registro', '/acerca', '/privacidad', '/terminos'];
        const renderIndex = (req, res) => {
            res.setHeader('Cache-Control', 'no-cache');
            try {
                // Canonical y og:url correctos ya en el HTML servido (sin depender de
                // JavaScript). Las rutas privadas apuntan a /login porque no se indexan.
                const canonicalPath = publicPaths.includes(req.path) ? req.path : '/login';
                const html = fs
                    .readFileSync(indexPath, 'utf8')
                    .replaceAll('__PUBLIC_URL__', config.publicWebUrl)
                    .replaceAll(`<link rel="canonical" href="${config.publicWebUrl}/login" />`, `<link rel="canonical" href="${config.publicWebUrl}${canonicalPath}" />`)
                    .replaceAll(`<meta property="og:url" content="${config.publicWebUrl}/login" />`, `<meta property="og:url" content="${config.publicWebUrl}${canonicalPath}" />`);
                res.type('html').send(html);
            }
            catch {
                res.sendFile(indexPath);
            }
        };
        app.get('/robots.txt', (_req, res) => {
            const body = [
                'User-agent: *',
                'Allow: /login',
                'Allow: /registro',
                'Allow: /acerca',
                'Allow: /privacidad',
                'Allow: /terminos',
                'Disallow: /',
                'Disallow: /api/',
                'Disallow: /socket.io/',
                'Disallow: /*?',
                '',
                `Sitemap: ${config.publicWebUrl}/sitemap.xml`,
                '',
            ].join('\n');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.type('text/plain').send(body);
        });
        app.get('/sitemap.xml', (_req, res) => {
            const lastmod = new Date().toISOString().slice(0, 10);
            const urls = publicPaths
                .map((p) => `  <url>\n    <loc>${config.publicWebUrl}${p}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${p === '/login' ? '1.0' : '0.6'}</priority>\n  </url>`)
                .join('\n');
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.type('application/xml').send(xml);
        });
        app.use(express.static(webDist, {
            index: false,
            maxAge: '1h',
            setHeaders: (res, filePath) => {
                // El service worker y el manifest deben revalidarse siempre:
                // un sw.js cacheado impide recibir actualizaciones.
                if (/[\\/](sw\.js|manifest\.webmanifest)$/.test(filePath)) {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            },
        }));
        app.get(/^(?!\/api).*/, renderIndex);
    }
    app.use('/api', notFoundHandler);
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map