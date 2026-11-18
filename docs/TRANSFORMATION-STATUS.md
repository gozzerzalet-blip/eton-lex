# ETON LEX — Estado de la transformación integral

Este documento es la fuente de verdad del avance por fases. Se actualiza al
terminar **cada fase**, con pruebas reales ejecutadas, no con intenciones.

Última actualización: **2026-11-18 — Fase 5, ETON AI corregida y publicación centralizada**.

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
| **3 — Word/PowerPoint/Excel** | ✅ Completada | DOCX, PPTX y XLSX OOXML reales generados en backend; descarga, listado, borrado y aislamiento por usuario probados por HTTP; botones de exportación conectados a la última respuesta en ETON AI. | Sin PDF, como se pidió. |
| **4 — Voz en tiempo real** | ⏸️ Diferida por decisión del usuario | — | Requiere STT/TTS real; la Web Speech API actual no se presenta como voz de proveedor. |
| **5 — Tutor y evaluación** | ✅ Completada | Preguntas de completación construidas desde artículos vigentes o fragmentos de documentos propios; respuesta correcta oculta hasta responder; preguntas, intentos, progreso, resultado y borrado reales por HTTP con aislamiento por usuario. | Sin proveedor IA: funciona aunque `AI_PROVIDER=none`. |
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

## Detalle de la Fase 3

### Cambios aplicados

- Dependencias libres reales añadidas solo al backend: `docx`, `pptxgenjs` y
  `exceljs`. El frontend no recibe claves ni librerías de generación.
- `apps/api/src/config.ts`: `paths.generated` apunta a
  `DATA_DIR/uploads/generated`; el directorio se crea al arrancar y el backup
  existente ya lo incluye porque copia `uploads` completo.
- `apps/api/src/db/schema.sql`: tabla aditiva `generated_files` con
  `user_id`, `conversation_id`, `kind`, `name`, `mime`, `path`, `size` e
  índice por usuario. La ruta absoluta nunca se devuelve al cliente.
- `apps/api/src/modules/ai/generate.ts`: genera DOCX con `docx`, PPTX con
  `pptxgenjs` y XLSX con `exceljs`. Los tres son paquetes OOXML válidos; no se
  renombran archivos de texto ni se produce PDF. Los nombres se normalizan sin
  acentos ni caracteres peligrosos.
- `apps/api/src/modules/ai/ai.routes.ts`: `POST /api/ai/generated` acepta
  título, secciones, columnas/filas y opcionalmente `conversationId`; si solo se
  envía la conversación, usa la **última respuesta real guardada** en
  `ai_messages`. `GET /api/ai/generated`, `GET /api/ai/generated/:id/download`
  y `DELETE /api/ai/generated/:id` completan el ciclo. Toda consulta filtra por
  `user_id`; el borrado elimina primero el archivo en disco.
- `/api/ai/status` expone `exports` con los tres formatos habilitados, para que
  la interfaz no muestre botones decorativos si el backend no los soporta.
- `apps/web/src/pages/AiChat.tsx`: tres botones reales junto al selector de
  modo exportan la respuesta de la conversación activa a Word, PowerPoint o
  Excel, descargan el archivo desde `/api/ai/generated/:id/download` y avisan
  con un toast real. Quedan desactivados mientras no exista una respuesta.

### Pruebas añadidas

- `apps/api/src/tests/phase3-probe.ts`: comprueba la firma ZIP/OOXML de los
  tres formatos, lee el DOCX de vuelta con `mammoth`, carga el XLSX con
  `exceljs`, verifica hojas/celdas reales y valida `safeFileName`.
- `apps/api/src/tests/ai-generate-probe.ts`: levanta la API con base temporal,
  genera desde una conversación real, descarga con `Content-Type` y
  `Content-Disposition`, comprueba que otro usuario recibe 404 y confirma que
  `DELETE` retira archivo y fila.
- `apps/api/src/tests/phase3.test.ts`: integra ambos probes al script `test`.

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
- `npm --workspace apps/api run test`: **20/20 pruebas OK**
  (9 de humo + 2 de Fase 0 + 3 de Fase 1 + 3 de Fase 2 + 2 de Fase 3 + 1 de Fase 5).
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
  - Exportación: DOCX de 10.054 bytes, PPTX de 64.117 bytes y XLSX de 7.575
    bytes; el DOCX vuelve a leerse con su título y su tabla; el XLSX vuelve a
    cargarse con dos hojas, encabezado `Tema | Norma` y dos filas reales.
  - HTTP de generados: `/api/ai/status` anuncia los 3 formatos; la descarga
    devuelve el MIME correcto y el mismo tamaño guardado; otro usuario recibe
    404; el borrado retira el archivo del disco y la descarga posterior falla.
  - Tutor: la sesión pública no contiene `correctIndex`, `explanation` ni
    `sourceText`; las frases se comprueban literalmente contra la base; una
    respuesta correcta y una incorrecta producen feedback distinto; la sesión
    termina y el resultado revela todas las fuentes; otro usuario recibe 404;
    el borrado deja cero preguntas e intentos.
- `npm run build`: OK (`index-DUsj9Fxq.js`, `index-ceP4-9cu.css`).
- `npm run backup`: OK (`2026-11-18T20-14-55-852Z`), 36 usuarios y 27 normas,
  uploads —incluidos generados— incluidos.
- `npm run db:restore -- … --dry-run`: OK, integridad `ok`, 36 usuarios y
  27 normas, sin escribir archivos.

## Detalle de la Fase 5

### Cambios aplicados

- `apps/api/src/db/schema.sql`: tablas aditivas `tutor_sessions`,
  `tutor_questions` y `tutor_attempts`, con índices por usuario y sesión,
  unicidad de un intento por pregunta y borrado en cascada. El `document_id`
  referencia `ai_documents` con `ON DELETE SET NULL`, así que borrar un
  documento no destruye el historial de práctica.
- `apps/api/src/modules/ai/tutor.ts`: construye preguntas de completación con
  frases literales de `articles` vigentes o de `document_chunks` /
  `ai_documents.extracted` del propio usuario. Las opciones incorrectas son
  palabras reales de otras fuentes de la misma sesión, nunca texto inventado.
  Si no hay suficiente texto verificable, devuelve cero preguntas y la API lo
  informa. `publicQuestion()` oculta `correctIndex`, `explanation` y
  `sourceText`; `revealQuestion()` solo se usa al responder o ver resultados.
- `apps/api/src/modules/ai/tutor.routes.ts`: `GET /api/tutor/areas`,
  `POST /api/tutor/sessions`, `GET /api/tutor/sessions`,
  `GET /api/tutor/sessions/:id`, `POST /api/tutor/sessions/:id/answers`,
  `GET /api/tutor/sessions/:id/result` y `DELETE /api/tutor/sessions/:id`.
  Toda consulta filtra por `user_id`; no se puede responder dos veces la misma
  pregunta y la sesión se marca `completed` al responder la última.
- `apps/api/src/app.ts`: router montado bajo `/api/tutor` con límite propio de
  30 peticiones por minuto, sin tocar el límite ni el contrato SSE de ETON AI.
- `apps/web/src/pages/Tutor.tsx`: página real con filtros por área, tema y
  documento propio; muestra la pregunta, registra la respuesta, revela la
  explicación con su cita consultable, avanza solo cuando el estudiante lo pide
  y ofrece el resultado final con el texto de origen de cada respuesta.
- `CitationList` se exporta desde `AiChat.tsx` para reutilizar las mismas
  citas de la biblioteca; `/tutor` se registra en `App.tsx` y en el menú,
  móvil y buscador de `Layout.tsx`.

### Pruebas añadidas

- `apps/api/src/tests/tutor-probe.ts`: base temporal con seis artículos y un
  documento con fragmento paginado; verifica por HTTP que la respuesta pública
  no filtre la correcta, que cada frase exista literalmente en la base, que
  acertar y fallar devuelva feedback real, que la sesión se complete, que el
  resultado revele fuentes, que otro usuario reciba 404 y que el borrado limpie
  preguntas e intentos.
- `apps/api/src/tests/phase5.test.ts`: integra el probe al script `test`.

## Publicación y despliegue

- Commit publicado: `570fa8d` en `main` (`gozzerzalet-blip/eton-lex`). Se integró
  mediante rebase con los 107 commits que el repo local no tenía (mensajería
  iMessage, noticias y PWA), resolviendo los conflictos sin descartarlos.
- `npm run deploy:check -- --url https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run`:
  OK. Health, HTTPS, SEO básico y PWA responden; IA no configurada, correo
  configurado, demo desactivada.
- Verificación posterior al despliegue automático de Suga: el HTML público sirve
  el asset `index-DUsj9Fxq.js` (el nuevo build) y `GET /api/tutor/areas`
  responde `401 UNAUTHORIZED`, prueba de que el router de Fase 5 está activo en
  producción y exige sesión. El bloqueo anterior por falta de `git`/`gh` quedó
  resuelto instalando Git for Windows con winget.

## Corrección: explicaciones ya no caen en «Modo biblioteca»

### Causa

La configuración publicada dejaba `AI_PROVIDER=none` y configuraba solo el
respaldo gratuito (`AI_FALLBACK_PROVIDER=pollinations`). El código miraba
`providerInfo().configured`, que dependía del proveedor principal, así que el
respaldo nunca se usaba en el chat: cada «explícame…» terminaba en modo
biblioteca con el artículo transcrito.

### Cambios aplicados

- `apps/api/src/config.ts`: si no hay proveedor principal pero sí un respaldo
  válido, ese respaldo se promueve a principal. El destino no se duplica como
  respaldo. Además, un proveedor sin modelo ya no se anuncia como conectado.
- `apps/api/src/modules/ai/ai.routes.ts`: sin modelo activo, las consultas de
  explicación usan un modo guiado honesto: ordenan la lectura de la fuente,
  muestran un fragmento máximo de 25 palabras y nunca transcriben el artículo
  completo. Las consultas literales conservan el modo biblioteca.
- `apps/web/src/pages/AiChat.tsx`: el aviso sin proveedor dice «Modo guiado» y
  explica la diferencia entre explicación orientada y texto literal.
- `docs/SUGA-FREE.md`: instalaciones nuevas usan Pollinations como principal;
  las ya desplegadas con `AI_PROVIDER=none` + respaldo gratuito siguen válidas.
- Pruebas: `ai-config.test.ts` comprueba la promoción del respaldo, que sin
  proveedor no se finja configuración y que un proveedor sin modelo no se
  anuncie; `ai-contract-probe.ts` comprueba que «Explícame…» devuelve
  `Explicación guiada` y no `Modo biblioteca`.

### Verificación local

- `npm run typecheck`: OK.
- `npm --workspace apps/api run test`: **23/23 pruebas OK**
  (9 humo + 2 Fase 0 + 3 configuración IA + 3 Fase 1 + 3 Fase 2 + 2 Fase 3 + 1 Fase 5).
- Reproducción HTTP con las variables de Suga (`AI_PROVIDER=none`,
  `AI_FALLBACK_PROVIDER=pollinations`): `configured=true`,
  `provider=pollinations`, `libraryMode=false` en el primer `meta`, sin evento
  `error`, y una explicación redactada por el modelo sobre la posesión.
- `npm run build`: OK (`index-D3SJ0-xx.js`, `index-ceP4-9cu.css`).
- `npm run deploy:check`: OK. Después del despliegue automático, Suga sirve
  `index-D3SJ0-xx.js` y `/api/system/capabilities` informa
  `ai.configured=true`, `provider=pollinations`, `model=openai-fast`.
- Commit publicado: `a0ade7b` en `main`.

## Enlace permanente y CI/CD

### Auditoría

- La publicación real es un único servicio de Suga en
  `https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run`, desplegado
  desde `main` con el Dockerfile de la raíz.
- La URL contiene el ID del servicio, el entorno y el clúster; no se regenera
  por commit. Los últimos cuatro pushes actualizaron el mismo hostname.
- `etonlex.com` y `www.etonlex.com` no resuelven DNS. El plan Suga Free permite
  **0 dominios propios**; hacer el proxy por Cloudflare tampoco funciona: con
  `Host: etonlex.com` el edge responde `421 Misdirected Request`.
- El túnel Cloudflare de `docs/PUBLISHING.md` era temporal y ya no resuelve.

### Cambios aplicados

- `.github/workflows/publicar.yml`: `develop` ejecuta typecheck, pruebas y build;
  solo si todo pasa hace `merge --ff-only` en `main`. Suga publica `main` en la
  misma URL.
- `apps/api/src/config.ts`: `LEGACY_PUBLIC_URLS` conserva los hosts anteriores;
  por defecto incluye la URL actual de Suga, que solo redirige cuando el
  canonical cambia.
- `apps/api/src/app.ts`: redirección `308` de hosts antiguos al canonical,
  preservando ruta y parámetros mediante `X-Forwarded-Host`/`Host`.
- `apps/api/src/modules/system/system.routes.ts`: `/api/system/capabilities`
  expone `deployment.canonicalUrl` y `deployment.legacyRedirects`.
- `apps/web/public/sw.js`: versión `v10` para invalidar cachés anteriores.
- `docs/PERMANENT-URL.md`: fuente de verdad del enlace, el flujo, la caché, los
  datos y lo que falta para `etonlex.com`.
- Prueba nueva `legacy-link.test.ts`: `antiguo.suga.run/registro?...` responde
  `308` a `https://etonlex.com/registro?...` y el host canonical responde `200`.

### Resultado

- Enlace permanente disponible hoy: URL de Suga indicada arriba.
- `etonlex.com` **no está configurado**; requiere dominio propio, acceso DNS y
  Suga Pro u otro hosting, además de actualizar `PUBLIC_WEB_URL`, `WEB_ORIGIN` y
  `LEGACY_PUBLIC_URLS`.

## Reglas que se mantienen en todas las fases

1. Ninguna función se marca terminada si solo tiene interfaz.
2. Ninguna respuesta de IA se presenta como verificada sin fuente consultada.
3. Ninguna clave API se escribe en el frontend ni en el repo.
4. Ninguna migración destruye datos: siempre aditiva e idempotente.
5. Si un servicio externo no está configurado, la interfaz lo dice y no simula
   el resultado.
