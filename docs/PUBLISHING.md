# Publicación — ETON LEX

Este documento separa tres cosas que suelen mezclarse: **desplegar la web**, **empaquetar
para móvil** y **publicar en tiendas**. La primera depende solo del repositorio; las otras
dos dependen de cuentas, firmas y plataformas externas.

> Estado actual: la web está publicada de forma permanente en Suga. La app móvil y las
> tiendas **no están iniciadas**. No es posible publicar en Play Store ni App Store desde
> este equipo Windows sin cuentas de desarrollador, claves de firma y, en el caso de iOS,
> macOS/Xcode o un servicio de build en la nube.
>
> La URL pública oficial y el flujo de actualizaciones están documentados en
> [`PERMANENT-URL.md`](PERMANENT-URL.md). El túnel de la sección 1.1b es solo una
> demostración local; ya no debe compartirse como enlace de ETON LEX.

---

## 1. Despliegue web

### 1.1 Build

```bash
npm ci
npm run build          # web + API
NODE_ENV=production npm start
```

La API sirve `apps/web/dist` si existe. Un solo proceso atiende API, Socket.IO y SPA en
`PORT` (4000 por defecto).

### 1.1b Acceso público inmediato, sin costo (Cloudflare Quick Tunnel — solo histórico)

> ⚠️ **Solo para demostraciones.** No es el enlace de lanzamiento: depende de esta PC, el
> hostname cambia en cada arranque y no sirve para SEO, dominio propio ni tiendas. El lanzamiento
> real usa [`PRODUCTION-LAUNCH.md`](PRODUCTION-LAUNCH.md).

Para enseñar la app desde cualquier equipo sin dominio ni hosting:

```powershell
# 1. API local en :4000
npm start

# 2. En otra terminal, túnel público temporal
cloudflared tunnel --url http://localhost:4000 --no-autoupdate
```

Cloudflare imprime una URL `https://<palabras-aleatorias>.trycloudflare.com` que apunta a
esta PC mientras el proceso siga vivo. Es HTTPS real, gratis y sin cuenta.

Requisitos y límites:

- La PC debe estar encendida y con internet; al cerrar el túnel la URL deja de existir.
- La URL cambia en cada arranque. Si cambia, actualiza `PUBLIC_WEB_URL` y añádela a
  `WEB_ORIGIN` en `.env`, y reinicia la API.
- No es un dominio permanente ni sirve para SEO: para eso hace falta dominio + hosting
  (ver [`DEPLOYMENT.md`](./DEPLOYMENT.md)).
- `cloudflared` se descarga gratis desde
  `https://github.com/cloudflare/cloudflared/releases`; no requiere compra.


### 1.2 Variables mínimas de producción

```env
NODE_ENV=production
PORT=4000
WEB_ORIGIN=https://app.tudominio.pe
JWT_SECRET=<48+ bytes aleatorios>
DATABASE_PATH=/var/lib/eton-lex/eton-lex.db
DATA_DIR=/var/lib/eton-lex
MAX_UPLOAD_MB=25

# Recomendado desde el día uno
AI_PROVIDER=openai
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
NEWS_FEEDS=https://feeds.ejemplo.pe/derecho.xml
SMTP_HOST=smtp.proveedor.com
SMTP_USER=...
SMTP_PASS=...
WEBRTC_TURN_URL=turn:turn.tudominio.pe:3478
WEBRTC_TURN_USER=...
WEBRTC_TURN_PASS=...
```

`NODE_ENV=production` con el `JWT_SECRET` de ejemplo hace que el servidor **no arranque**.
Es intencional.

### 1.3 Requisitos de infraestructura

| Recurso | Requisito |
|---|---|
| CPU / RAM | 1 vCPU / 1 GB basta para un piloto |
| Disco | Persistente para SQLite y `uploads/` |
| Red | WebSocket habilitado (Socket.IO y WebRTC) |
| TLS | Obligatorio (HTTPS y WSS) |
| Backups | Copia diaria de la base y de uploads, con restauración probada |

**Importante:** no uses un sistema de archivos efímero (algunos PaaS borran el disco en cada
deploy). SQLite y los archivos deben vivir en un volumen persistente.

### 1.4 Proxy inverso

Ejemplo con Caddy (TLS automático y WebSocket sin configuración extra):

```
app.tudominio.pe {
    encode gzip
    reverse_proxy 127.0.0.1:4000
}
```

Ejemplo con nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name app.tudominio.pe;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 1.5 Verificación posterior al despliegue

```bash
curl https://app.tudominio.pe/api/system/health
curl https://app.tudominio.pe/api/system/capabilities
```

`capabilities` debe reflejar exactamente lo configurado. Si `ai` dice `false`, ETON AI
responderá 503 y la UI lo mostrará: es el comportamiento correcto, no un bug.

### 1.6 Backups

Con WAL activo, copiar el `.db` en caliente puede producir una copia inconsistente. Opciones:

```bash
# Consistente sin detener el servicio
sqlite3 /var/lib/eton-lex/eton-lex.db "VACUUM INTO '/backups/eton-$(date +%F).db'"

# O detener, copiar base + uploads, reiniciar
systemctl stop eton-lex
tar czf /backups/eton-$(date +%F).tar.gz /var/lib/eton-lex
systemctl start eton-lex
```

Prueba una restauración completa antes de abrir el registro al público.

### 1.7 Operación continua

- Logs a un colector (journald, Loki, CloudWatch).
- Alerta si `/api/system/health` falla 2 veces seguidas.
- Alerta si el disco supera 80 %.
- Revisar `ingest_runs` para detectar feeds caídos.
- Rotar `JWT_SECRET` invalida todas las sesiones: planifícalo.

---

## 2. PWA (camino intermedio recomendado)

Antes de las tiendas, una PWA da instalación, icono y pantalla completa en Android e iOS.

Estado: **implementado y verificado en Chromium**.

1. ✅ `manifest.webmanifest` con nombre, colores, iconos 192/512/maskable y `display: standalone`
   (`apps/web/public/manifest.webmanifest`).
2. ✅ Service worker manual con precache de la shell, caché de assets inmutables y fallback
   offline; `/api` y `/socket.io` nunca se cachean (`apps/web/public/sw.js`).
3. 🟡 `safe-area-inset-*` aplicado en la navegación inferior de iOS; falta revisar el resto de
   pantallas en dispositivo.
4. ⛔ Pruebas de llamadas y subida de archivos en Safari iOS y Chrome Android.
5. ⛔ Notificaciones push web (requiere service worker y VAPID).

Los iconos se regeneran con `powershell -NoProfile -ExecutionPolicy Bypass -File apps/web/scripts/build-icons.ps1`
(requiere Chrome; rasteriza los SVG de `apps/web/public/`).

Ventaja: se actualiza al instante y no pasa por revisión. Límite: en iOS las push web son
más restringidas y la instalación es menos visible.

---

## 3. Empaquetado móvil con Capacitor

La vía de menor fricción para reutilizar el frontend actual. Convierte el SPA en una app
nativa que carga los assets locales y apunta la API al servidor.

### 3.1 Preparación

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "ETON LEX" pe.etonlex.app --web-dir=apps/web/dist
npm install @capacitor/android @capacitor/ios
npm run build
npx cap add android
npx cap add ios        # requiere macOS para compilar
npx cap sync
```

### 3.2 Ajustes necesarios en el código

- **URL de API configurable**: hoy el cliente usa rutas relativas. En la app nativa debe
  apuntar a `https://app.tudominio.pe` (variable en build, p. ej. `VITE_API_URL`).
- **CORS**: añadir `capacitor://localhost` y `https://localhost` a `WEB_ORIGIN`.
- **Cookies**: revisar `SameSite` y `Secure` para el origen nativo.
- **Permisos**: micrófono y cámara en `AndroidManifest.xml` e `Info.plist`
  (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`).
- **Descargas y adjuntos**: usar Filesystem/Share en lugar de `blob:` cuando corresponda.
- **Teclado y safe areas**: probar en dispositivos reales.

### 3.3 Android

```bash
npx cap open android
# Android Studio: Build > Generate Signed Bundle / APK > Android App Bundle
```

Requisitos habituales (verifica los vigentes antes de publicar):

- Cuenta de Google Play Console (pago único).
- App Bundle (`.aab`) firmado; guarda el keystore y sus contraseñas.
- `targetSdkVersion` actualizado al mínimo exigido por Google.
- Política de privacidad pública.
- Formulario de seguridad de datos.
- Clasificación de contenido.
- Para cuentas personales nuevas, Google suele exigir una prueba cerrada con un número
  mínimo de testers durante varios días antes de producción.

### 3.4 iOS

```bash
npx cap open ios
# Xcode: Product > Archive > Distribute App
```

Requisitos habituales:

- Apple Developer Program (suscripción anual).
- Mac con Xcode o un servicio de build en la nube (Codemagic, Bitrise, GitHub Actions con
  runners macOS).
- Certificados y perfiles de aprovisionamiento.
- App Store Connect: ficha, capturas por tamaño, privacidad, clasificación.
- Cumplir las guías de revisión: funcionalidad mínima, cuentas, moderación de contenido.

---

## 4. Requisitos de tienda que impactan el producto

Estas no son tareas de marketing; son requisitos técnicos y de política.

### 4.1 Contenido generado por usuarios

ETON LEX tiene comunidad y mensajería. Las tiendas suelen exigir:

- [x] Mecanismo de reporte de contenido (existe `POST /api/community/reports`)
- [ ] Bloqueo de usuarios (pendiente)
- [ ] Filtro de contenido objetable (pendiente)
- [ ] Términos de uso y política de privacidad públicas
- [ ] Proceso de moderación con tiempos de respuesta
- [ ] Eliminación de cuenta desde la app (Apple lo exige si hay creación de cuenta)

### 4.2 Privacidad

- Política de privacidad accesible sin iniciar sesión.
- Declaración de datos recolectados (email, nombre, universidad, mensajes, archivos, audio).
- Explicar el uso de IA: qué se envía al proveedor y con qué finalidad.
- Consentimiento para micrófono, cámara y notificaciones.
- Retención y eliminación de datos.

### 4.3 Cuentas y pagos

- Si en el futuro hay suscripciones dentro de la app, Apple y Google exigen sus sistemas de
  pago in-app para contenido digital. Planifícalo antes de agregar cobros.
- La eliminación de cuenta debe ser posible desde la app.

---

## 5. Costos estimados

| Concepto | Costo aproximado |
|---|---|
| Dominio `.pe` | S/ 40–80 al año |
| Servidor 1 vCPU / 1 GB | US$ 5–12 al mes |
| TURN gestionado | US$ 0–20 al mes según uso |
| Google Play Console | US$ 25 pago único |
| Apple Developer Program | US$ 99 al año |
| Build iOS en nube (si no hay Mac) | US$ 0–100 al mes |
| Proveedor de IA | Variable por tokens |

---

## 6. Lo que está bloqueado en este equipo

| Bloqueo | Por qué | Qué se necesita |
|---|---|---|
| Publicar en Play Store | Falta cuenta y keystore | Google Play Console + firma |
| Publicar en App Store | Falta cuenta y macOS/Xcode | Apple Developer + Mac o build en nube |
| Dominio y TLS | Falta dominio y servidor | Acceso al proveedor de DNS/hosting |
| Correo real | Falta SMTP | Credenciales del proveedor |
| Llamadas tras NAT estricto | Falta TURN | Servidor TURN o servicio gestionado |
| IA real | Falta proveedor | `AI_API_KEY` y `AI_MODEL` |

Ninguno de estos bloqueos se resuelve con código: requieren cuentas, credenciales o
infraestructura que debe aportar el titular del proyecto.

---

## 7. Checklist de lanzamiento web

- [ ] Dominio y DNS configurados
- [ ] TLS activo y renovación automática
- [ ] `JWT_SECRET` fuerte y respaldado
- [ ] `NODE_ENV=production`
- [ ] Volumen persistente para base y uploads
- [ ] Backups automáticos + restauración probada
- [ ] SMTP configurado y probado
- [ ] Proveedor de IA configurado y probado con preguntas jurídicas
- [ ] Feeds de noticias verificados
- [ ] TURN configurado y llamada probada en red móvil
- [ ] Cuenta admin creada con `SEED_ADMIN_*`
- [ ] Normas prioritarias cargadas y verificadas
- [ ] Política de privacidad y términos publicados
- [ ] Monitoreo y alertas activos
- [ ] `npm test` y `npm run e2e` en verde contra el entorno desplegado

---

## 8. Orden recomendado

1. Desplegar la web con IA, SMTP y backups.
2. Publicar política de privacidad y términos.
3. Añadir PWA e instalación móvil.
4. Implementar bloqueo de usuarios y moderación mínima.
5. Empaquetar con Capacitor y probar en dispositivos reales.
6. Publicar primero en Google Play (menor fricción).
7. Publicar en App Store cuando exista Mac o build en nube.

Publicar antes de tener moderación, privacidad y eliminación de cuenta suele terminar en
rechazo. El orden importa más que la velocidad.
