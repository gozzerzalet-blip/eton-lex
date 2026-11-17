# Fases — ETON LEX

Registro honesto del avance. Cada fase incluye su criterio de aceptación y su estado real.

**Leyenda:** ✅ hecho y verificado · 🟡 implementado, depende de configuración o datos ·
⛔ no iniciado

---

## Fase 0 — Fundaciones ✅

**Objetivo:** monorepo funcional, base de datos real, configuración segura.

- [x] npm workspaces `apps/api` + `apps/web`
- [x] TypeScript estricto en ambos paquetes
- [x] SQLite con `node:sqlite` y WAL
- [x] `schema.sql` como fuente única + migración idempotente
- [x] Seed de áreas, fuentes y catálogo de 24 normas
- [x] Configuración por `.env` con validación en producción
- [x] `.gitignore` para base de datos, uploads y secretos

**Aceptación:** `npm run db:migrate && npm run db:seed` deja una base consultable; el build
de API y web pasa.

---

## Fase 1 — Identidad y seguridad ✅

- [x] Registro, login, refresh rotativo, logout y logout global
- [x] bcrypt, JWT, sesiones revocables
- [x] Perfil, edición de datos, cambio de contraseña
- [x] Preferencias: tema, privacidad, onboarding
- [x] Rate limiting y Helmet
- [x] Auditoría de acciones administrativas

**Aceptación:** el e2e registra dos usuarios, inicia sesión, refresca y accede a `/me`.

---

## Fase 2 — Biblioteca jurídica ✅ / 🟡

- [x] Catálogo por áreas, tipos y años
- [x] Detalle de norma con artículos y versiones
- [x] Búsqueda FTS5 sobre normas y artículos
- [x] Seguimiento de normas y áreas
- [x] Sello de verificación visible
- [x] Carga de artículos y verificación desde admin
- [x] Historial por artículo
- [x] Corpus real: 22 normas y 7 433 artículos de fuentes oficiales, 0 huecos
- [x] Paginación del articulado para normas grandes (evita bloquear el navegador)
- [x] Procedencia visible para artículos recuperados de otra publicación oficial
- [🟡] Cinco normas pendientes de fuente oficial (Comercio, Procedimientos Penales,
  Delitos Aduaneros, Seguridad y Salud en el Trabajo, Nueva Ley Procesal del Trabajo)

**Aceptación:** la búsqueda devuelve resultados reales; una norma sin texto no aparenta
tenerlo. Ver [`LEGAL-AUDIT.md`](./LEGAL-AUDIT.md).

**Pendiente:** comparador de versiones lado a lado, anotaciones personales del estudiante.

---

## Fase 3 — ETON AI ✅ / 🟡

- [x] Conversaciones persistentes con modos (principiante → técnico)
- [x] Streaming de respuestas
- [x] Adjuntos PDF/DOCX/TXT/imagen
- [x] Recuperación FTS5 del corpus jurídico
- [x] Citas y trazabilidad
- [x] Prompt de veracidad y alcance general
- [x] Adaptadores OpenAI, Anthropic, Google, Ollama
- [x] Estado honesto `AI_NOT_CONFIGURED`
- [x] Modo biblioteca sin proveedor: extractos literales con fuente, sin simulación
- [x] Prioridad de artículo exacto aunque la consulta no lleve tildes
- [x] Cada cita abre el artículo exacto dentro de la biblioteca
- [x] Voz de entrada y lectura en voz alta (Web Speech API)
- [🟡] Respuestas reales: requieren proveedor configurado
- [🟡] Embeddings: opcionales; por defecto RAG léxico

**Aceptación:** sin proveedor, el chat responde en modo biblioteca con texto literal y
fuentes, y no muestra texto inventado. Con proveedor, la respuesta llega del modelo real y
se persiste con su uso.

**Pendiente:** evaluación automatizada de fidelidad, historial exportable, cuotas por plan.

---

## Fase 4 — ETON NEWS y actualizaciones legislativas ✅ / 🟡

- [x] Ingesta RSS/Atom y NewsAPI
- [x] Deduplicación y registro de ejecuciones
- [x] Categorías, búsqueda y detalle con enlace a la fuente
- [x] Ingesta de publicaciones oficiales
- [x] Cola de validación humana antes de publicar
- [x] Cron de 20 y 30 minutos
- [x] Aviso explícito cuando no hay fuentes
- [🟡] Contenido real: requiere feeds configurados

**Aceptación:** con feeds, aparecen noticias con URL y fecha verificables; sin feeds, la UI
lo dice y no inventa nada.

**Pendiente:** resumen automático con IA, filtro por relevancia jurídica, alertas push del
navegador.

---

## Fase 5 — Comunidad ✅

- [x] Amistades con solicitud y aceptación
- [x] Feed de publicaciones
- [x] Likes y comentarios
- [x] Grupos de estudio con membresía
- [x] Reportes de contenido
- [x] Actividad reciente
- [x] Búsqueda de estudiantes

**Aceptación:** dos usuarios pueden conectar, publicar, comentar y reportar; todo persiste.

**Pendiente:** moderación automática, notificaciones granulares por tipo, bloqueo de
usuarios.

---

## Fase 6 — Mensajería y llamadas ✅

- [x] Conversaciones directas y grupales
- [x] Mensajes en tiempo real
- [x] Adjuntos y notas de voz (`MediaRecorder`)
- [x] Respuestas, edición y borrado
- [x] Reacciones
- [x] Confirmaciones de lectura
- [x] Typing y presencia
- [x] Búsqueda dentro de conversaciones
- [x] Llamadas de audio y video WebRTC
- [x] Historial de llamadas
- [x] Credenciales ICE autenticadas
- [🟡] TURN: opcional; sin él, NAT estricto puede fallar

**Aceptación:** el e2e entrega un mensaje por Socket.IO, registra reacción y lectura, y
completa invitación → aceptación → señal → fin de llamada.

**Pendiente:** llamadas grupales (SFU), compartir pantalla, transcripción, mensajes
efímeros.

---

## Fase 7 — Administración ✅

- [x] Dashboard con métricas y ejecuciones de ingesta
- [x] Gestión de usuarios y roles
- [x] Validación de normas y carga de artículos
- [x] Cola de actualizaciones legislativas
- [x] Fuentes RSS: alta y activación
- [x] Reportes y resolución
- [x] Auditoría
- [x] Notificaciones broadcast
- [x] Protección por rol verificada en e2e

**Aceptación:** un usuario `student` recibe 403 en `/api/admin/*`; un `admin` opera todo.

---

## Fase 8 — Calidad ✅

- [x] Smoke tests (`npm test`)
- [x] E2E real contra servidor (`npm run e2e`), 16 verificaciones
- [x] Build de producción de API y web
- [x] Typecheck del frontend
- [ ] Pruebas de carga
- [ ] Pruebas de accesibilidad automatizadas
- [ ] Auditoría de seguridad externa

---

## Fase 9 — Documentación ✅

- [x] `README.md` con estado real y puesta en marcha
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/PHASES.md`
- [x] `docs/PUBLISHING.md`

---

## Fase 10 — Despliegue web ⛔

- [ ] Dominio y DNS
- [ ] Servidor o PaaS con volumen persistente para SQLite y uploads
- [ ] TLS y proxy inverso
- [ ] `JWT_SECRET` y variables de producción
- [ ] Backups automáticos verificados
- [ ] Monitoreo y alertas
- [ ] Correo transaccional (SMTP)
- [ ] TURN para llamadas confiables

**Criterio:** URL pública con HTTPS, health check verde y un backup restaurado en un entorno
de prueba.

---

## Fase 11 — PWA y móvil 🟡

- [x] `manifest.webmanifest` e iconos (192, 512, maskable y apple-touch)
- [x] Service worker y estrategia offline: shell precacheado, assets inmutables en caché y
      `/api` siempre por red (nunca se cachean datos privados)
- [x] Metadatos de instalación (manifest, `theme-color` claro/oscuro, apple-touch-icon)
- [ ] Instalación en Android/iOS en dispositivo físico (los criterios ya se cumplen en
      Chromium)
- [ ] Notificaciones push web
- [ ] Adaptación táctil fina completa (safe area ya aplicada en la navegación inferior;
      faltan gestos y revisión en dispositivo)

**Criterio:** instalable, abre offline la shell, y las llamadas y adjuntos funcionan en
móvil.

**Verificado:** el manifest se sirve como `application/manifest+json`, el service worker se
registra y precachea el shell, y con el servidor apagado la navegación sigue abriendo la
aplicación desde caché. Falta la prueba de instalación y llamadas en un dispositivo real.

---

## Fase 12 — Tiendas ⛔

- [ ] Cuenta de desarrollador Google Play
- [ ] Apple Developer Program
- [ ] Wrapper nativo (Capacitor) o app nativa
- [ ] Firma Android y perfiles iOS
- [ ] Política de privacidad pública
- [ ] Fichas de tienda, capturas y clasificación
- [ ] Revisión y publicación

Ver [`PUBLISHING.md`](PUBLISHING.md) para el detalle y los requisitos externos.

---

## Backlog priorizado

1. **Importador SPIJ** con revisión por diff y verificación asistida.
2. **Citas enlazadas**: cada cita de ETON AI abre el artículo exacto.
3. **PWA + push** para llevar la plataforma al móvil sin tiendas.
4. **TURN gestionado** para llamadas confiables.
5. **PostgreSQL** si se requiere más de una instancia.
6. **Evaluación de fidelidad de IA** con conjunto de preguntas y respuestas contrastadas.
7. **Moderación asistida** de comunidad y reportes.
8. **Anotaciones y resúmenes personales** en la biblioteca.
9. **Plan de estudios y repaso espaciado**.
10. **Wrapper Capacitor** y publicación en tiendas.
