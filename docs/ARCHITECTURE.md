# Arquitectura — ETON LEX

Documento técnico del sistema. Describe lo que existe en el repositorio, no lo que se
planea. Las decisiones se explican junto con sus límites.

---

## 1. Vista general

```
┌────────────────────────────────────────────────────────────────────┐
│  Navegador / PWA                                                    │
│  React 18 · Vite · Tailwind · TanStack Query · Zustand · Socket.IO  │
└───────────────┬───────────────────────────────┬────────────────────┘
                │ HTTPS / JSON + SSE            │ WSS
                ▼                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  API Node.js (Express + TypeScript)                                 │
│  Helmet · CORS · rate limit · Zod · JWT · multer                    │
│  ┌──────────────┬──────────────┬──────────────┬──────────────────┐  │
│  │ Auth/Users   │ Biblioteca   │ ETON AI      │ Noticias/Updates │  │
│  │ Comunidad    │ Mensajería   │ Archivos     │ Admin/Dashboard  │  │
│  └──────────────┴──────────────┴──────────────┴──────────────────┘  │
│  Socket.IO: presencia, typing, mensajes, notificaciones, WebRTC     │
│  node-cron: ingesta de noticias y actualizaciones                   │
└───────────────┬───────────────────────────────┬────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌────────────────────────────────┐
│ SQLite + FTS5                │   │ Servicios externos (opcionales)│
│ users, norms, articles,      │   │ · Proveedor de IA              │
│ news, messages, ai_*, ...    │   │ · Feeds RSS / NewsAPI          │
│ uploads/ en disco            │   │ · SMTP                         │
└──────────────────────────────┘   │ · STUN/TURN                    │
                                   └────────────────────────────────┘
```

Un solo proceso Node sirve la API y, si existe `apps/web/dist`, también el SPA. En
desarrollo, Vite corre aparte y hace proxy de `/api` y `/socket.io`.

---

## 2. Monorepo

| Ruta | Responsabilidad |
|---|---|
| `apps/api/src/app.ts` | Composición de Express, seguridad, orden de rutas, SPA |
| `apps/api/src/server.ts` | HTTP + Socket.IO + cron + apagado ordenado |
| `apps/api/src/realtime.ts` | Autenticación de sockets, salas, señalización |
| `apps/api/src/config.ts` | Lectura y validación de entorno |
| `apps/api/src/db/` | `schema.sql`, migración idempotente, seed |
| `apps/api/src/lib/` | Auth, errores HTTP, archivos, notificaciones |
| `apps/api/src/modules/*` | Un módulo por dominio, con rutas y lógica |
| `apps/web/src/pages/` | Una página por módulo visible |
| `apps/web/src/lib/` | Cliente API, socket, store, tipos, utilidades |

---

## 3. Modelo de datos

SQLite con `PRAGMA journal_mode = WAL`, claves foráneas activas y `node:sqlite`
(`DatabaseSync`). Las escrituras compuestas usan un helper `tx()` explícito.

### Identidad y acceso
- `users` — perfil, rol (`student` / `admin`), hash bcrypt, preferencias (`theme`,
  `privacy`, `onboarded`), estado de verificación.
- `sessions` — refresh tokens hasheados, IP, user-agent, expiración y revocación.
- `audit_log` — acciones administrativas y eventos sensibles.

### Biblioteca jurídica
- `legal_areas` — ramas del Derecho.
- `sources` — fuente oficial o medio, con `kind` (`rss`, `official`, `newsapi`) y estado.
- `norms` — catálogo: título, slug, tipo, año, área, fuente, `verification`
  (`pending` / `verified` / `disputed`).
- `norm_versions` — versiones de una norma.
- `articles` — artículo numerado, texto, versión, vigencia, metadatos.
- `article_history` — historial de cambios por artículo.
- `norm_updates` — publicaciones detectadas, en cola hasta confirmación humana.
- `follows` — seguimiento de normas o áreas por usuario.
- `articles_fts`, `norms_fts` — índices FTS5 mantenidos por triggers.

### Noticias
- `news` — título, resumen, contenido, URL canónica, medio, fecha, categoría.
- `news_fts` — índice FTS5.
- `ingest_runs` — cada ejecución de ingesta con estado y estadísticas.

### Comunidad y mensajería
- `friendships` — solicitudes y amistades aceptadas.
- `study_groups`, `group_members` — grupos de estudio.
- `posts`, `post_likes`, `post_comments` — feed.
- `reports` — denuncias de contenido con estado de moderación.
- `conversations`, `conversation_members` — chats directos y grupales.
- `messages` — texto, adjuntos, nota de voz, respuesta, edición, borrado lógico.
- `message_reactions` — reacciones por emoji y usuario.
- `call_history` — llamadas iniciadas, aceptadas, rechazadas o finalizadas.

### ETON AI
- `ai_conversations` — título, modo, usuario.
- `ai_messages` — rol, contenido, citas, tokens, modelo.
- `ai_documents` — archivos adjuntos a una conversación.
- `chunks` — fragmentos de texto con metadatos y, opcionalmente, embedding.

### Notificaciones
- `notifications` — tipo, payload, leída/no leída, referencia al recurso.

---

## 4. Autenticación y sesiones

1. Registro con email único y contraseña ≥ 8 caracteres; hash bcrypt (12 rondas).
2. Login devuelve **access token** (15 min por defecto) y **refresh token** (30 días).
3. El refresh token se guarda **hasheado** en `sessions`; cada refresh rota el token y
   revoca el anterior.
4. Logout revoca la sesión actual; «cerrar todas» revoca todas.
5. El middleware `requireAuth` valida el JWT y adjunta el usuario; `optionalAuth` permite
   endpoints públicos con contexto si hay token.
6. El socket se autentica con el mismo access token en el handshake; sin token válido se
   rechaza la conexión.

Controles adicionales: rate limit global (1200/15 min), login (20/15 min), registro
(10/hora) y AI (40/min); Helmet con CSP en producción; CORS restringido a `WEB_ORIGIN`;
límite de body 2 MB y de subida `MAX_UPLOAD_MB`.

---

## 5. ETON AI

### Flujo de una consulta

```
Usuario → POST /api/ai/conversations/:id/messages
        → verifica proveedor configurado (si no: 503 AI_NOT_CONFIGURED)
        → recupera contexto:
             · artículos y normas vía FTS5
             · noticias y actualizaciones verificadas
             · documentos del usuario (si adjuntó)
             · embeddings, si EMBEDDING_MODEL está configurado
        → construye prompt de sistema (veracidad + modo + alcance)
        → llama al proveedor (streaming SSE o JSON)
        → persiste mensaje, citas y uso
        → responde al cliente
```

### Reglas del prompt

- Prioridad máxima: no inventar artículos, leyes, sentencias, expedientes, fechas, autores
  ni citas.
- Distinguir texto legal, interpretación, doctrina y opinión.
- Si la pregunta requiere actualidad y no hay datos fechados verificables, decirlo e indicar
  dónde comprobarlo (El Peruano, SPIJ, TC, Poder Judicial).
- Especialidad principal: Derecho peruano y formación jurídica. También puede resolver
  consultas generales (historia, economía, ciencia, metodología) con conocimiento estable,
  marcando lo que requiere verificación y sin inventar cifras ni fuentes.
- No hay un límite temático artificial; el límite es la verificabilidad, no el tema.

### Proveedores

`apps/api/src/modules/ai/providers.ts` implementa:

| Proveedor | Protocolo |
|---|---|
| `openai` | OpenAI Chat Completions |
| `anthropic` | Messages API |
| `google` | Generative Language API |
| `ollama` | API compatible OpenAI en local |
| `openrouter`, `groq`, etc. | Compatible OpenAI vía `AI_BASE_URL` |

Si `AI_PROVIDER=none` o falta la clave, `configured` es `false` y el endpoint devuelve 503.
La UI muestra el aviso y desactiva el envío. **No hay respuestas de relleno.**

### Adjuntos

PDF (`pdf-parse`), DOCX (`mammoth`), TXT/MD e imágenes. El texto se extrae, se trocea y se
usa como contexto. Las imágenes se envían al proveedor solo si su modelo soporta visión.

---

## 6. Biblioteca y veracidad

- El seed carga **metadatos** de 24 normas peruanas con `verification = 'pending'`.
- El texto articulado se incorpora desde `/admin` con el formato:

  ```
  ## 1 | Título opcional del artículo
  Texto literal del artículo…

  ## 2
  Texto literal…
  ```

- Cada carga genera versión e historial. Un administrador marca la norma como `verified`
  solo después de contrastarla con la fuente oficial.
- La UI muestra el sello correspondiente y no presenta como vigente lo que está pendiente.
- La búsqueda usa FTS5 sobre título, resumen y texto; los resultados indican la norma y el
  artículo de origen.

---

## 7. Noticias y actualizaciones legislativas

- **ETON NEWS** ingesta RSS/Atom (`NEWS_FEEDS`) y, opcionalmente, NewsAPI. Guarda URL
  canónica, medio y fecha; deduplica por URL y hash de título.
- **Actualizaciones legislativas** revisan fuentes RSS oficiales registradas en `sources`.
  Cada hallazgo entra en `norm_updates` con estado `pending` y **no se publica** hasta que
  un administrador lo confirma.
- Sin fuentes configuradas, el servidor lo informa al arrancar y la UI muestra «sin fuentes
  configuradas». No se generan noticias ficticias.
- Cron: noticias cada 20 minutos; actualizaciones cada 30 minutos. También hay ingesta
  manual (`npm run ingest`).

---

## 8. Tiempo real

Socket.IO con autenticación JWT y salas por usuario y por conversación.

| Evento (cliente → servidor) | Efecto |
|---|---|
| `presence:sync` | Devuelve la lista de usuarios en línea |
| `conversation:join` | Une al socket a una conversación si es miembro |
| `typing` | Difunde el indicador de escritura a la sala |
| `call:invite` | Invita a una llamada 1:1 |
| `call:accept` / `call:decline` | Respuesta a la invitación |
| `call:signal` | Intercambio SDP/ICE |
| `call:end` | Finaliza y registra duración |

| Evento (servidor → cliente) | Cuándo |
|---|---|
| `message:new`, `message:updated`, `message:deleted` | Cambios en mensajes |
| `reaction:update` | Reacciones |
| `read:update` | Confirmaciones de lectura |
| `typing` | Alguien escribe |
| `presence:update`, `presence:list` | Conexión/desconexión |
| `notification:new` | Notificación persistida |
| `call:incoming`, `call:accepted`, `call:declined`, `call:signal`, `call:ended` | Señalización |

### Llamadas

WebRTC P2P real. El servidor solo señaliza; el audio/video viaja entre navegadores. STUN
por defecto es el de Google; TURN es opcional. Sin TURN, algunas redes corporativas o NAT
simétrico pueden impedir la conexión: la UI lo advierte en lugar de fingir una llamada.

---

## 9. Archivos

- `multer` con límite de tamaño y nombres UUID.
- Metadatos en `documents`; binarios en `DATA_DIR/uploads`.
- `visibility` `private` (solo propietario) o `shared` (destinatarios explícitos en
  `document_shares`).
- `GET /api/files/:id` valida propietario, destinatario o visibilidad compartida autenticada.
- Avatares en `uploads/avatars` con servido controlado.

---

## 10. Administración

Rutas bajo `/api/admin`, todas con `requireRole('admin')`:

- Métricas generales y últimas ingestas.
- Usuarios: listado y cambio de rol.
- Reportes: listado y resolución.
- Fuentes: alta, edición, activación.
- Normas: alta, carga de artículos, verificación.
- Auditoría: últimas acciones.
- Broadcast de notificaciones.

Toda acción sensible se registra en `audit_log`.

---

## 11. Seguridad y privacidad

- Contraseñas con bcrypt; tokens de refresco hasheados.
- Validación de entrada con Zod en las rutas críticas.
- Consultas parametrizadas en todas las capas (sin interpolación de SQL).
- Control de acceso por recurso (conversaciones, archivos, documentos de IA).
- Rate limiting por ruta y global.
- Helmet, CSP y `frame-ancestors 'none'` en producción.
- CORS explícito; cookies `httpOnly` para refresh cuando aplica.
- Registro de auditoría y de ejecuciones de ingesta.
- Datos en disco: `apps/api/data` está fuera de git.

### Limitaciones conocidas

- SQLite es mononodo; para escalar horizontalmente habría que migrar a PostgreSQL.
- No hay cifrado en reposo a nivel de aplicación; depende del disco del servidor.
- No hay verificación de correo activa sin SMTP.
- La moderación es reactiva (reportes), no automática.
- La recuperación de contraseña requiere SMTP; sin él, un administrador debe intervenir.

---

## 12. Pruebas

| Prueba | Cobertura |
|---|---|
| `npm test` | Configuración, DB, FTS5, seed, helpers |
| `npm run e2e` | Salud, registro/login/JWT, biblioteca, AI 503, Socket.IO, mensajería, typing, reacciones, leídos, notificaciones, archivos privados/compartidos, ICE, invitación/aceptación/señal/fin de llamada, permisos de admin |

El e2e corre contra una API real y crea cuentas temporales; no usa mocks de red.

---

## 13. Operación

- **Desarrollo:** `npm run dev`.
- **Producción:** `npm run build && NODE_ENV=production npm start`.
- **Respaldo:** copiar `apps/api/data/eton-lex.db` (con WAL: usar `VACUUM INTO` o detener el
  servicio) y `apps/api/data/uploads`.
- **Migraciones:** `npm run db:migrate` es idempotente.
- **Logs:** salida estándar; en producción conviene un colector externo.
- **Health check:** `GET /api/system/health`.
- **Capacidades:** `GET /api/system/capabilities` informa qué está configurado (IA, noticias,
  SMTP, TURN).
