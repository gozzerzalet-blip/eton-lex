# ETON LEX — Estado de la transformación integral

Este documento es la fuente de verdad del avance por fases. Se actualiza al
terminar **cada fase**, con pruebas reales ejecutadas, no con intenciones.

Última actualización: **2026-11-18 — Fase 2 completada**.

## Decisiones vigentes

| Tema | Decisión |
|---|---|
| Identidad | ETON LEX sigue siendo una plataforma propia; la mensajería toma iMessage como referencia visual, no como copia de WhatsApp/Telegram. |
| Proveedores IA | "El mejor" dentro de **solo opciones gratuitas**: Pollinations sin clave como base; OpenRouter/Groq en modo gratuito cuando exista `AI_API_KEY`. No se afirma que Claude/ChatGPT estén activos sin credenciales reales. |
| Presupuesto | US$ 0. Sin servicios de pago. Voz y video quedan diferidos. |
| Web Push | Se implementa con VAPID generado por el proyecto; la clave privada solo vive en el backend/Suga. |
| Despliegue | Repo `gozzerzalet-blip/eton-lex`, rama `main`, URL pública `https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run`. Deploy automático al hacer push. |

## Fases

| Fase | Estado | Qué quedó real | Pendiente / credenciales |
|---|---|---|---|
| **0 — Blindaje** | ✅ Completada | Aislamiento de documentos IA por conversación; token del socket actualizado tras refresh; `muted` suprime notificaciones; limpieza de `activeCalls` al desconectar; trigger FTS `news_au`; restore seguro; migración idempotente probada. | Nada. |
| **1 — Motor IA híbrido** | ✅ Completada | Router por capacidad honesto, síntesis de uno o dos pasos según modelo configurado, 3 tools ejecutadas en backend, verificación reforzada, `ai_usage`, `/api/ai/status` ampliado sin romper el SSE. | Nada; listo para activar roles gratuitos con variables de entorno. |
| **2 — Documentos extensos** | ✅ Completada | Extracción con páginas y secciones reales, `document_chunks` con `page`/`char_offset`/`section`, FTS5 por fragmento, citas precisas en el SSE, subida HTTP probada y migración de índices antiguos. | OCR solo con proveedor real; no se activa sin servicio configurado. |
| **3 — Word/PowerPoint/Excel** | ⏳ Siguiente | — | Generación real en backend; sin PDF, como se pidió. |
| **4 — Voz en tiempo real** | ⏸️ Diferida por decisión del usuario | — | Requiere STT/TTS real; la Web Speech API actual no se presenta como voz de proveedor. |
| **5 — Tutor y evaluación** | ⏳ Pendiente | — | `tutor_sessions` / `tutor_questions` / `tutor_attempts`. |
| **6 — Video** | ⏸️ Diferida por decisión del usuario | — | Solo se activará con API real; sin credenciales se entrega guion, nunca "video generado". |
| **7 — Memoria, push y UX final** | ⏳ Pendiente | — | `ai_memories`, preferencias de notificación, Web Push VAPID, selector cromático y continuidad. |

## Detalle de la Fase 0

### Cambios aplicados

- `apps/api/src/modules/ai/retrieval.ts`: `retrieveForChat` recibe `conversationId`;
  los documentos del usuario y sus fragmentos semánticos se filtran por
  `user_id` **y** `conversation_id`. El vector de la consulta se pasa por
  parámetro en vez de por `globalThis` (evitaba mezclar preguntas concurrentes).
- `apps/api/src/modules/ai/ai.routes.ts`: pasa `conv.id` al recovery y asocia a
  la conversación los documentos recién subidos cuando se adjuntan, de modo
  que el seguimiento sigue funcionando sin volver a cargarlos.
- `apps/web/src/lib/socket.ts` + `apps/web/src/lib/api.ts`: `updateSocketToken`
  reemplaza `socket.auth` tras cada refresh automático o bootstrap.
- `apps/api/src/lib/notify.ts`: `notifyMessage` consulta
  `conversation_members.muted` y suprime la notificación cuando está activo.
  `apps/api/src/modules/messaging/messaging.routes.ts` lo usa para mensajes
  nuevos; el mensaje y el evento en tiempo real siguen llegando igual.
- `apps/api/src/realtime.ts`: al desconectar se cierran las llamadas en curso
  del usuario, se actualiza `call_history` y se avisa a la otra parte.
- `apps/api/src/db/schema.sql`: trigger `news_au` para mantener `news_fts`
  sincronizado cuando se corrige una noticia.
- `apps/api/src/scripts/restore.ts`: restauración con `PRAGMA integrity_check`,
  validación del manifest, copia `pre-restore-*`, borrado de `-wal`/`-shm` y
  fusión de uploads. Modos `--dry-run` y `--confirm`.

## Detalle de la Fase 1

### Cambios aplicados

- `apps/api/src/config.ts`: `roleConfig(prefix)` añade `AI_REASONING_*`,
  `AI_CLARITY_*` y `AI_VISION_*`. Un rol solo se considera configurado si tiene
  proveedor distinto de `none`, modelo declarado y clave cuando el proveedor la
  requiere. No se anuncia un modelo que no está conectado.
- `apps/api/src/modules/ai/providers.ts`: exporta `Target` y `UsageInfo`, añade
  `streamChatWith` (destino concreto) y `completeChat` (pasada de razonamiento),
  y captura `usage` real de OpenAI, Anthropic y Google. `streamChat` conserva
  el respaldo anterior sin mezclar respuestas.
- `apps/api/src/modules/ai/router.ts`: `route(role)` elige el modelo por
  capacidad. Si el rol no está configurado, usa el principal y lo declara:
  `routerStatus().mode` es `single-model`. Solo pasa a `hybrid` si existe un
  rol con destino verdaderamente distinto.
- `apps/api/src/modules/ai/synthesizer.ts`: ejecuta razonamiento solo cuando el
  modelo es distinto; siempre redacta con claridad; emite `status` por SSE para
  cada etapa. Nunca finge una síntesis de dos modelos.
- `apps/api/src/modules/ai/tools.ts`: herramientas ejecutadas en backend:
  `search_library` (recuperación en biblioteca y documentos de la conversación),
  `open_official_source` (consulta al catálogo por número de ley) y
  `calculate_deadline` (cómputo orientativo con advertencia explícita de que no
  sustituye la norma procesal). Cada resultado entra como bloque `kind: 'tool'`
  citables con `[F#]`.
- `apps/api/src/modules/ai/verify.ts`: verificación posterior al modelo de
  artículos no respaldados, citas textuales inventadas, leyes no verificadas,
  figuras ajenas al ordenamiento peruano, `[F#]` inválidos, uso de «verificado»
  sin fuente, vigencia no confirmada y listas de fuentes no vinculadas.
- `apps/api/src/modules/ai/ai.routes.ts`: integra router, síntesis, tools y
  verificación. `meta` añade `tools`; `done` añade `roles` y `verification`;
  `/api/ai/status` expone `router`, `tools` y `modes`. Cada llamada registra
  `ai_usage` con rol, proveedor, modelo, caracteres, latencia y resultado real.
  El modo biblioteca y el contrato SSE (`meta`, `status`, `delta`, `done`,
  `error`) se mantienen intactos.
- `apps/api/src/db/schema.sql`: tabla aditiva `ai_usage` con índice por usuario.

### Pruebas añadidas

- `apps/api/src/tests/phase1-probe.ts` + `phase1.test.ts`: router con un solo
  modelo y con rol de razonamiento distinto, ejecución de las 3 tools, 6
  comprobaciones de verificación y registro de consumo.
- `apps/api/src/tests/ai-contract-probe.ts`: levanta la API real con base
  temporal y usuario autenticado; comprueba `/api/ai/status`, el SSE completo y
  el registro `ai_usage` del modo biblioteca sin llamadas externas.

## Detalle de la Fase 2

### Cambios aplicados

- `apps/api/src/lib/files.ts`: nuevas funciones aditivas `extractDocument` y
  `chunkDocument`. `extractText` queda intacto para los módulos existentes.
  Se conservan los separadores de página (`\\f`) y se detectan encabezados
  reales (`CAPÍTULO`, `TÍTULO`, `ARTÍCULO`, etc.). Cuando el formato no define
  paginación —DOCX, TXT— `pages` es `null`; no se inventa una página.
- `apps/api/src/db/schema.sql`: tablas aditivas `document_chunks` y
  `document_chunks_fts`, con índice por usuario/conversación y triggers de
  inserción, borrado y actualización. El borrado se hace por `chunk_id` para que
  funcione también con `ON DELETE CASCADE`.
- `apps/api/src/db/index.ts`: la migración detecta el índice FTS antiguo con
  `chunk_id UNINDEXED`, lo reconstruye y reindexa solo las filas faltantes.
  También completa columnas de `users` que el esquema indexa y que faltaban en
  bases muy antiguas (por ejemplo `university`). Sigue siendo idempotente.
- `apps/api/src/modules/ai/ai.routes.ts`: `POST /api/ai/documents` usa
  `extractDocument`, guarda `pages`, calcula los fragmentos una sola vez al
  subir y devuelve `pages` y `chunks`.
  `GET /api/ai/documents/:id/chunks` expone fragmentos propios con página, sección y
  desplazamiento. La subida sigue respetando el tamaño y los tipos permitidos.
- `apps/api/src/modules/ai/retrieval.ts`: los fragmentos se buscan por FTS5
  dentro de la **misma conversación**, se filtran por `user_id`, y cada bloque
  lleva `page`, `section`, `charOffset`, `chunkIndex` y `documentName`. Los
  documentos pequeños sin fragmentos se entregan completos como antes.
  `citationFor` propaga esa localización al SSE.
- `apps/api/src/modules/ai/prompts.ts`: se instruye al modelo para citar
  página/sección solo cuando aparecen en la etiqueta recuperada, nunca
  inventarlas.

### Pruebas añadidas

- `apps/api/src/tests/phase2-probe.ts`: extrae un archivo con 3 páginas y 3
  capítulos, valida offsets contra el texto original, comprueba aislamiento por
  conversación y limpieza FTS al borrar.
- `apps/api/src/tests/ai-documents-probe.ts`: sube un `.txt` real por
  `FormData`, consulta `/chunks` y verifica que el SSE cite un fragmento con
  página, sección y `documentId` reales.
- `apps/api/src/tests/legacy-fts-probe.ts`: simula una base anterior con FTS
  `UNINDEXED`, verifica reconstrucción, idempotencia y borrado en cascada.
- `apps/api/src/tests/phase2.test.ts`: integra los tres probes al script
  `test`.

## Comandos

```bash
npm run typecheck
npm --workspace apps/api run test
npm run build
npm run backup
npm run db:restore -- <directorio-del-respaldo> --dry-run
npm run db:restore -- <directorio-del-respaldo> --confirm
```

## Pruebas ejecutadas (resultado real)

- `npm run typecheck`: OK.
- `npm --workspace apps/api run test`: **17/17 pruebas OK**
  (9 de humo + 2 de Fase 0 + 3 de Fase 1 + 3 de Fase 2).
  - Migración ejecutada dos veces sobre una base temporal: sin errores, los
    9 triggers FTS existen una sola vez, `schema_meta` no se duplica.
  - Dos documentos de IA del mismo usuario en conversaciones distintas: cada
    recuperación devuelve solo el suyo. Conversación silenciada: 0
    notificaciones; conversación normal: 1 notificación.
  - Router sin roles configurados: `single-model`, `reasoningDistinct=false`.
    Con `AI_REASONING_PROVIDER=pollinations` y modelo distinto: `hybrid`,
    `reasoningDistinct=true`.
  - Tools ejecutadas: `search_library`, `open_official_source` y
    `calculate_deadline`, con norma y fecha reales en el resultado.
  - Verificación: detecta artículos, citas y leyes no verificados, `[F9]` sin
    fuente, «verificado» sin marcador y vigencia no confirmada.
  - Contrato HTTP: `/api/ai/status` responde 200 con `router` (3 roles),
    `tools` (3) y `modes` (7); el SSE conserva `meta` → `delta` → `done`, con
    `libraryMode=true` y consumo registrado.
  - Documentos: extracción de 3 páginas y 3 capítulos reales; los offsets
    apuntan al texto original; la conversación A recibe fragmentos y la B
    ninguno; borrar el documento deja el FTS en 0 filas.
  - Subida HTTP: archivo de 2 páginas indexado en varios fragmentos;
    `GET /api/ai/documents/:id/chunks` devuelve secciones `CAPÍTULO`; el SSE
    cita `page`, `section`, `charOffset` y `documentId` reales.
  - Migración legacy: base con FTS `UNINDEXED` se reindexa, mantiene 3 triggers
    únicos, sobrevive a una segunda migración y limpia el índice al borrar.
- `npm run build`: OK (`index-C6wphhlr.js`, `index-CJgOui3-.css`).
- `npm run backup`: OK (`2026-11-18T19-14-39-113Z`), 36 usuarios y 27 normas,
  uploads incluidos.
- `npm run db:restore -- … --dry-run`: OK, integridad `ok`, 36 usuarios y
  27 normas, sin escribir archivos.

## Reglas que se mantienen en todas las fases

1. Ninguna función se marca terminada si solo tiene interfaz.
2. Ninguna respuesta de IA se presenta como verificada sin fuente consultada.
3. Ninguna clave API se escribe en el frontend ni en el repo.
4. Ninguna migración destruye datos: siempre aditiva e idempotente.
5. Si un servicio externo no está configurado, la interfaz lo dice y no simula
   el resultado.
