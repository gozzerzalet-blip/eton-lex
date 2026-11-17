# ETON LEX

**El Derecho, siempre a tu alcance.**

Ecosistema jurídico inteligente para estudiantes de Derecho del Perú. No es un mockup: el
registro, la autenticación, la base de datos, la mensajería en tiempo real, las llamadas
WebRTC y el almacenamiento de archivos funcionan de verdad. Lo que no está configurado
—proveedor de IA, fuentes de noticias, SMTP, TURN— **se muestra como no configurado y no se
simula**.

Creado por **Zalet Gozzer**.

> Despliegue permanente: la infraestructura (Docker + Caddy + volumen persistente + backups +
> `deploy:check`) está implementada en [`docs/PRODUCTION-LAUNCH.md`](docs/PRODUCTION-LAUNCH.md).
> El dominio y el hosting requieren cuentas de la creadora; no se simula su contratación.

---

## Estado real del producto

Esta tabla es deliberadamente honesta. «Listo» significa implementado y verificado con
pruebas; «requiere configuración» significa que el código existe pero depende de
credenciales o servicios externos; «pendiente» significa que aún no está construido.

| Área | Estado | Detalle |
|---|---|---|
| Registro, login, JWT + refresh, sesiones | ✅ Listo | bcrypt, rotación de refresh token, revocación por sesión |
| Perfil, ajustes, privacidad, tema | ✅ Listo | Preferencias persistidas por usuario |
| Dashboard | ✅ Listo | Datos reales del usuario y del catálogo |
| Biblioteca jurídica | ✅ Listo (22 de 27 normas) | 7 433 artículos de fuentes oficiales de El Peruano, con estado, procedencia y 0 huecos numéricos; 5 normas pendientes de fuente oficial. Ver [`docs/LEGAL-AUDIT.md`](docs/LEGAL-AUDIT.md) |
| Búsqueda FTS5 | ✅ Listo | Búsqueda léxica real sobre normas y artículos cargados, incluidos artículos exactos |
| ETON AI (chat, streaming, adjuntos, voz) | ✅ Listo | RAG sobre la biblioteca + investigación web (El Peruano, SPIJ, TC, PJ) + modelo real con respaldo local; sin proveedor responde en «modo biblioteca»: extractos literales con fuente oficial, nunca simula una respuesta generada |
| RAG sobre corpus jurídico | ✅ Listo (léxico) | Recuperación FTS5 real; embeddings opcionales con `EMBEDDING_MODEL` |
| ETON NEWS | 🟡 Requiere fuentes | Ingesta RSS/NewsAPI real; sin fuentes informa que no hay ninguna |
| Actualizaciones legislativas | 🟡 Requiere fuentes RSS | Ingesta + cola de validación humana antes de publicar |
| Notificaciones | ✅ Listo | Persistidas + push por Socket.IO |
| Comunidad (amigos, feed, grupos, reportes) | ✅ Listo | Datos reales en SQLite |
| Mensajería estilo iMessage | ✅ Listo | Adjuntos, notas de voz, reacciones, respuestas, edición, borrado, leídos, typing, presencia |
| Llamadas de voz/video | ✅ Listo (P2P) | WebRTC real con señalización Socket.IO; TURN opcional para NAT estricto |
| Archivos y avatares | ✅ Listo | Control de acceso privado/compartido, límite de tamaño |
| Panel de administración | ✅ Listo | Validación de normas, cola legislativa, fuentes, usuarios, reportes, auditoría, broadcast |
| Correo transaccional (verificación/recuperación) | 🟡 Requiere SMTP | Sin SMTP el estado queda marcado como pendiente |
| PWA e instalación web | ✅ Listo | Manifest, iconos, service worker y shell offline; instalable desde el navegador. Push pendiente |
| SEO y presencia pública | 🟡 Preparado | Metadatos, JSON-LD, `robots.txt` y `sitemap.xml` dinámicos, `/acerca` `/privacidad` `/terminos`, `noindex` en rutas privadas. Falta dominio + Search Console |
| App móvil nativa y tiendas | ⛔ No iniciado | Requiere cuentas, firma y (en iOS) macOS. Ver [`docs/STORES.md`](docs/STORES.md) y [`docs/PUBLISHING.md`](docs/PUBLISHING.md) |

Pruebas automatizadas: `npm test` (smoke) y `npm run e2e` (integración real contra el
servidor, incluida mensajería y señalización WebRTC).

---

## Stack

- **Monorepo** con npm workspaces: `apps/api` + `apps/web`.
- **Backend:** Node.js 22.5+ (probado en 26.13.1), Express 4, TypeScript estricto,
  `node:sqlite` (`DatabaseSync`), Socket.IO 4, Zod, Helmet, rate limiting.
- **Base de datos:** SQLite con FTS5, migraciones idempotentes y triggers de índice.
- **Frontend:** React 18, Vite 6, TypeScript, Tailwind CSS, React Router 6,
  TanStack Query 5, Zustand 5, Framer Motion, Sonner.
- **Tiempo real:** Socket.IO (mensajería, presencia, typing, notificaciones, señalización
  WebRTC).
- **IA:** adaptadores OpenAI-compatible, Anthropic, Google y Ollama.

---

## Requisitos

- Node.js **22.5 o superior** (por `node:sqlite`). Recomendado: Node 24/26.
- npm 10+.
- No requiere compilador nativo: `node:sqlite` viene incluido en Node.

> En este equipo el Node portátil está en
> `C:\Users\Zalet\AppData\Local\eton-node\node-v26.13.1-win-x64`. En PowerShell hay que
> invocar `npm.cmd`, no `npm.ps1`.

---

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Configuración
cp .env.example .env      # en Windows: Copy-Item .env.example .env

# 3. Base de datos
npm run db:migrate
npm run db:seed           # catálogo de normas
npm run db:seed -- --demo # además crea 3 usuarios de demostración
npm --workspace apps/api run ingest:legal   # textos desde El Peruano

# 4. Desarrollo (API :4000 + web :5173 con proxy)
npm run dev
```

Abre `http://localhost:5173`.

### Producción local

```bash
npm run build   # compila web y API; la API sirve el SPA si existe apps/web/dist
npm start       # http://localhost:4000
```

`NODE_ENV=production` exige un `JWT_SECRET` real; el servidor se niega a arrancar con el
secreto de desarrollo.

### Instalar como app (PWA)

El frontend compilado incluye `manifest.webmanifest`, iconos y un service worker con soporte
offline:

1. Abre `http://localhost:4000` en Chrome o Edge.
2. Usa el icono de instalar de la barra de direcciones («Instalar ETON LEX»).
3. En Android/iOS el service worker exige HTTPS (o `localhost`); para probar desde el móvil
   en red local publica el sitio con HTTPS (ver [`docs/PUBLISHING.md`](docs/PUBLISHING.md)).

El service worker nunca cachea `/api` ni `/socket.io`: los datos privados siempre viajan por
red. Sin conexión se abre el shell y la última pantalla de acceso cacheada.

### Cuentas demo

Solo existen si ejecutaste `db:seed -- --demo`:

| Correo | Contraseña |
|---|---|
| `demo.andrea@etonlex.pe` | `Demo1234!` |
| `demo.rafael@etonlex.pe` | `Demo1234!` |
| `demo.lucia@etonlex.pe` | `Demo1234!` |

Para un administrador real, define `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` y
`SEED_ADMIN_NAME` antes de ejecutar `npm run db:seed`.

---

## Configuración

Todo vive en `.env` (ver `.env.example`). Lo importante:

| Variable | Efecto si falta |
|---|---|
| `JWT_SECRET` | Usa un secreto de desarrollo; en producción aborta |
| `AI_PROVIDER`, `AI_MODEL` | ETON AI responde en «modo biblioteca» (extractos literales, sin simular IA) |
| `AI_API_KEY` | Obligatoria solo en proveedores comerciales (OpenAI, Anthropic, Google, OpenRouter) |
| `AI_BASE_URL` | Necesario para OpenRouter, Groq, Pollinations, Ollama y otros compatibles OpenAI |
| `AI_FALLBACK_PROVIDER`, `AI_FALLBACK_MODEL` | Sin respaldo: si el proveedor principal falla, se muestra el error |
| `EMBEDDING_MODEL` | RAG usa solo FTS5 léxico (también real) |
| `NEWS_FEEDS`, `NEWSAPI_KEY` | ETON NEWS informa «sin fuentes configuradas» |
| `WEBRTC_TURN_*` | Llamadas P2P funcionan en redes domésticas; NAT estricto puede fallar |
| `SMTP_*` | Verificación de correo queda pendiente en el perfil |
| `MAX_UPLOAD_MB` | 25 MB por archivo |
| `DATABASE_PATH`, `DATA_DIR` | `apps/api/data` |

### Conectar ETON AI

Ejemplo con un proveedor comercial compatible con OpenAI (máxima calidad):

```env
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

Modo gratuito sin clave ni registro (el que usa este equipo): se apoya en el punto
de acceso comunitario Pollinations (GPT-OSS 20B) y, si falla o alcanza su límite
(una respuesta cada 45 s por IP), responde el modelo local de Ollama:

```env
AI_PROVIDER=pollinations
AI_MODEL=openai-fast
AI_BASE_URL=https://text.pollinations.ai
AI_FALLBACK_PROVIDER=ollama
AI_FALLBACK_MODEL=qwen2.5:3b-instruct
AI_FALLBACK_BASE_URL=http://127.0.0.1:11434/v1
```

Ollama local como proveedor principal:

```env
AI_PROVIDER=ollama
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.1
```

Advertencia de hardware: en un equipo sin GPU (CPU de 2 núcleos), un modelo de 7B
genera a ~1,3 tokens/s y tarda más de un minuto en leer el contexto, por lo que se
usa el 3B como respaldo y se recorta el contexto (`AI_CONTEXT_CHARS`). Para uso
intensivo conviene una clave de API o una GPU.

El prompt del sistema obliga a citar solo lo verificable, distinguir texto legal de
interpretación y admitir «no consta» cuando no hay evidencia. ETON AI prioriza el Derecho
peruano, pero también responde consultas generales con el mismo estándar de veracidad.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | API + web en modo desarrollo |
| `npm run build` | Build de producción de web y API |
| `npm start` | Sirve API y SPA compilado |
| `npm run db:migrate` | Aplica `schema.sql` (idempotente) |
| `npm run db:seed` | Catálogo base; `-- --demo` añade usuarios demo |
| `npm run ingest -- news\|updates\|all` | Ingesta manual de fuentes reales |
| `npm --workspace apps/api run ingest:legal` | Carga el corpus legal desde las fuentes oficiales de El Peruano |
| `npm test` | Pruebas smoke (sin red) |
| `npm run e2e` | Integración real contra una API en ejecución |
| `npm run typecheck` | TypeScript del frontend |

La ingesta automática corre en el servidor: noticias cada 20 min si hay feeds, y
actualizaciones legislativas cada 30 min si hay fuentes RSS activas en la base de datos.
Nada se genera si no hay fuentes.

---

## Estructura

```
eton-lex/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ db/            schema.sql, migraciones, seed
│  │  │  ├─ lib/           auth, http, archivos, notificaciones
│  │  │  ├─ modules/       auth, users, library, ai, news, updates,
│  │  │  │                 community, messaging, documents, admin,
│  │  │  │                 dashboard, notifications, system
│  │  │  ├─ tests/         smoke + e2e
│  │  │  ├─ app.ts         rutas, seguridad, SPA
│  │  │  ├─ realtime.ts    Socket.IO
│  │  │  └─ server.ts      arranque + cron
│  │  └─ data/             SQLite y uploads (ignorado por git)
│  └─ web/
│     └─ src/
│        ├─ components/    Layout, UI kit, Logo
│        ├─ lib/           api, socket, store, tipos, utilidades
│        └─ pages/         Inicio, ETON AI, Biblioteca, NEWS, etc.
├─ docs/                   arquitectura, fases, publicación
├─ .env.example
└─ package.json
```

---

## Principios del producto

1. **Veracidad antes que fluidez.** Si un dato no está en el corpus ni es verificable, se
   dice. No se inventan artículos, sentencias, fechas ni autores.
2. **Nada simulado.** Una función sin credenciales se muestra como no disponible.
3. **Trazabilidad.** Cada norma tiene estado de verificación; cada actualización legislativa
   pasa por una cola de validación humana antes de publicarse.
4. **Privacidad por defecto.** Archivos privados, control de acceso por propietario o
   destinatario, sesiones revocables y auditoría administrativa.
5. **Accesibilidad y responsive.** Interfaz clara de superficies blancas con acentos navy, modo
   oscuro conmutable, navegación inferior en móvil y layouts para escritorio, tablet y móvil.

---

## Documentación

- [`docs/LEGAL-AUDIT.md`](docs/LEGAL-AUDIT.md) — auditoría del corpus: normas, artículos,
  fuentes oficiales, suplementos, derogaciones y limitaciones.
- [`docs/LEGAL-INGEST.md`](docs/LEGAL-INGEST.md) — cómo funciona y cómo se reproduce la
  ingesta del corpus legal.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitectura, modelo de datos, seguridad,
  flujos de IA y tiempo real.
- [`docs/PHASES.md`](docs/PHASES.md) — qué está hecho, en curso y pendiente, con criterios de
  aceptación.
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — despliegue web y hoja de ruta honesta para Play
  Store / App Store.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — dominio, hosting, HTTPS, Search Console, SEO y
  qué debe aportar la creadora.
- [`docs/STORES.md`](docs/STORES.md) — estado, costes y requisitos de Play Store, App Store y
  Microsoft Store, con borrador de ficha.

---

## Aviso

ETON LEX es una herramienta de estudio y apoyo. No sustituye asesoría legal profesional ni
la consulta de fuentes oficiales (SPIJ, El Peruano, Tribunal Constitucional, Poder Judicial).
El corpus integrado está verificado contra ediciones oficiales; las cinco normas sin fuente
oficial confirmada se muestran como «pendiente de integración» y no tienen texto cargado.

© 2026 Zalet Gozzer. Todos los derechos reservados.
