# Despliegue gratuito en Suga Free

Esta es la ruta **sin costo** para publicar ETON LEX con HTTPS, base de datos y archivos
persistentes. No requiere dominio propio ni tarjeta. Requiere que la creadora tenga una cuenta
de **GitHub** y una cuenta de **Suga**; por seguridad, esas cuentas no se crean ni se operan
desde este repositorio.

> Estado: **página web pública desplegada y verificada** en
> https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run
>
> ETON LEX es una página web pública de acceso libre con registro de cuentas. No es una app de
> escritorio ni una app instalable; no presentes `localhost`, IP ni túneles como enlace oficial.

## Qué se preparó en el repo

- `Dockerfile`: imagen ligera que solo instala dependencias de producción y usa los artefactos
  ya compilados (`apps/api/dist`, `apps/web/dist`). Pensada para 0.1 vCPU / 256 MiB.
- `Dockerfile.full`: imagen completa, útil en un VPS con más RAM.
- `start:production`: migra la base, siembra fuentes/normas, importa el corpus jurídico
  verificado si la biblioteca está vacía y arranca la API.
- Respaldo automático diario a las 03:00 dentro de `/data/backups` (retención 14 días).
- Fuente oficial activa: **Diario Oficial El Peruano — Normas Legales**. La API revisa cada
  30 minutos y crea propuestas pendientes para validación humana.
- `npm run deploy:check -- --url <URL>`: verifica HTTPS, health, canonical, robots y sitemap.

## 1. Publicar el código en GitHub

Desde la raíz de `eton-lex`, con Node en el PATH:

```powershell
$env:PATH='C:\Users\Zalet\AppData\Local\eton-node\node-v26.13.1-win-x64;'+$env:PATH
npm.cmd run build
npm.cmd test
npm.cmd run typecheck
git init
git add .
git commit -m "ETON LEX: plataforma académica y jurídica funcional"
git branch -M main
git remote add origin https://github.com/<TU-USUARIO>/eton-lex.git
git push -u origin main
```

El repositorio debe ser **público** para que Suga Free pueda construir la imagen sin plan de pago.
Nunca subas `.env`, `.env.local`, `.env.production`, claves ni contraseñas; ya están ignorados.

Si el repo local ya existe, omite `git init` y usa `git status` antes de hacer commit.

## 2. Crear el servicio en Suga

1. Entra a https://suga.app con GitHub.
2. Crea una organización/proyecto nuevo.
3. Agrega un servicio desde **GitHub repository** y selecciona `eton-lex`.
4. Método de build: **Dockerfile** (raíz del repo). No hace falta build command externo.
5. Configura recursos:
   - CPU: `0.1 vCPU`
   - Memoria: `256 MiB`
   - Replicas: `1`
   - Volumen: `1 GB`, montado en `/data`
6. Suga asignará una URL HTTPS. Cópiala; se llama más abajo `<URL_PUBLICA>`.

El plan Free no incluye dominios propios, así que la URL definitiva será la asignada por Suga.
Eso cumple el requisito de HTTPS directo, sin IP, túnel ni enlace temporal.

## 3. Variables de entorno

En el servicio → **Env Vars**, marca como sensibles `JWT_SECRET`, `SEED_ADMIN_PASSWORD`,
`AI_API_KEY` y `SMTP_PASS` si las usas.

```bash
NODE_ENV=production
PORT=4000
DATA_DIR=/data
DATABASE_PATH=/data/eton-lex.db
BACKUP_DIR=/data/backups
BACKUP_RETENTION_DAYS=14
MAX_UPLOAD_MB=10

PUBLIC_WEB_URL=https://<URL_PUBLICA>
WEB_ORIGIN=https://<URL_PUBLICA>

JWT_SECRET=<CLAVE_ALEATORIA_DE_96_HEX>
SEED_ADMIN_EMAIL=<TU_CORREO>
SEED_ADMIN_PASSWORD=<CONTRASEÑA_LARGA>
SEED_ADMIN_NAME=Zalet Gozzer

AI_PROVIDER=none
AI_FALLBACK_PROVIDER=pollinations
AI_FALLBACK_MODEL=openai-fast
AI_FALLBACK_BASE_URL=https://text.pollinations.ai
AI_WEB_RESEARCH=true

# Recuperación de contraseña por código (Gmail con contraseña de aplicación)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=gozzerzalet@gmail.com
SMTP_PASS=<APP_PASSWORD_DE_16_CARACTERES>
SMTP_FROM=ETON LEX <gozzerzalet@gmail.com>

DEMO_MODE=false
```

Genera `JWT_SECRET` con:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`PUBLIC_WEB_URL` y `WEB_ORIGIN` deben contener la URL HTTPS exacta que dio Suga, sin barra final.
Si Suga entrega la URL solo después del primer despliegue, despliega con un valor provisional,
actualiza estas dos variables y vuelve a desplegar.

## 4. Verificación

Cuando el servicio esté arriba:

```powershell
npm.cmd run deploy:check -- --url https://<URL_PUBLICA>
```

El comando falla si hay IP, túnel, HTTP 511, redirección, canonical incorrecto, healthcheck o
sitemap ausentes. Además, comprueba manualmente:

- `https://<URL_PUBLICA>/api/system/health`
- `https://<URL_PUBLICA>/registro` con dos correos reales.
- `/salas`, crear sala, chat, pizarra y videollamada con ambas cuentas.
- `/actualizaciones`: deben aparecer propuestas procedentes de El Peruano.
- `/admin → Fuentes`: `elperuano` activa, sin error reciente.

## Despliegue real ejecutado (17 de noviembre de 2026)

- Repositorio público: https://github.com/gozzerzalet-blip/eton-lex
- Organización Suga: `ETON LEX` (plan Free), región `US Central 1 / Iowa`.
- Proyecto: `eton-lex`, ID `adffe9c7-f1b2-4f9c-8445-863b97942ce1`.
- Environment: `production`, ID `32268cfb-c073-4753-ba26-ac97c5f2c455`.
- Servicio: `eton-lex`, nodo `a7yp4cd07ujg`.
- Build: **Service from GitHub → Dockerfile**, rama `main`, raíz `(root)`, archivo `Dockerfile`.
- Recursos: `0.1 vCPU`, `256 MiB`, `1 réplica`, volumen `eton-lex-data` de `1 GiB` en `/data`.
- URL pública HTTPS: https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run

Procedimiento que funcionó:

1. Instalar la GitHub App de Suga con acceso de lectura al repositorio.
2. Crear el proyecto desde **New project → gozzerzalet-blip/eton-lex**.
3. Elegir **Build method: Dockerfile** y el archivo `Dockerfile` (no Compose: el importador Compose
   ignora `build` y `env_file`).
4. En el canvas del servicio configurar puerto `4000`, URL pública, volumen `/data` y las
   variables de la sección 3. Marcar `JWT_SECRET` y `SEED_ADMIN_PASSWORD` como sensibles.
5. Hacer clic en **Deploy** y esperar a “Everything is deployed” y a que el servicio esté `Running`.

Verificación ejecutada contra la URL pública:

- `npm.cmd run deploy:check -- --url https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run`
  → `OK: enlace directo, HTTPS, health, SEO básico y PWA responden.`
- `E2E_BASE_URL=https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run npm.cmd --workspace apps/api run e2e`
  → registro real de dos cuentas, sesión JWT, login, biblioteca verificada, mensajería,
  notificaciones, WebRTC y permisos.
- El corpus jurídico se incluye en la imagen como `apps/api/dist/data/legal-corpus.json`:
  27 normas, 22 verificadas, 7,433 artículos y 1,412 versiones históricas. Se importa una sola
  vez, cuando la biblioteca está vacía; nunca sobrescribe datos creados después.

## Correos reales: verificación, ingreso y recuperación

Con las variables `SMTP_*` anteriores, ETON LEX puede enviar códigos reales a **cualquier correo
registrado** (no solo al del administrador):

- **Registro:** al crear la cuenta se envía un código de 6 dígitos; el paso 03 de `/registro`
  permite confirmarlo. Después se puede reenviar desde `/perfil`.
- **Ingreso sin contraseña:** desde `/login`, **Ingresar con código en mi correo** envía un código
  a cualquier cuenta, aunque la persona haya olvidado su contraseña. El código vale 10 minutos,
  permite 5 intentos y se invalida al usarse.
- **Recuperación de contraseña:** **¿Olvidaste tu contraseña?** envía un código de 6 dígitos,
  vence en 15 minutos, permite 5 intentos y cierra las sesiones anteriores al cambiar la clave.

Los códigos se guardan solo como hash bcrypt, nunca se muestran en la página ni se devuelven en la
respuesta. El remitente debe ser la misma cuenta de Gmail autenticada (`SMTP_USER`), porque Gmail
rechaza remitentes distintos. Los destinatarios pueden ser cualquier correo, no solo Gmail.

Si `SMTP_PASS` no está configurado, `/api/system/capabilities` reporta
`email.configured: false`, `email.passwordReset: false`, `email.emailVerification: false` y
`email.loginCode: false`. Los formularios responden **503** con un mensaje honesto: nunca se simula
un envío ni se muestra el código en pantalla.

### Acceso inmediato del administrador

Si se olvidó `SEED_ADMIN_PASSWORD` y no hay correo configurado, se puede reemplazar el valor en
**Variables** (Suga lo trata como sensible: se puede cambiar, no ver). En el siguiente reinicio,
`seed.ts` aplica la contraseña nueva **una sola vez** al administrador y escribe un marcador con el
hash del valor aplicado en `/data/.admin-password-applied`. Después, la contraseña la administra la
propia cuenta desde la página. Cambiar la variable otra vez vuelve a aplicarla una vez.

Actualizar la página web cuando haya cambios:

```powershell
# hacer commit y push a main, luego en Suga: proyecto → Canvas → Deploy
```

Suga reconstruye desde el commit de `main`. Las variables sensibles no se reenvían: se conservan
en el environment.

## Límites honestos del plan Free

- 1 GB de almacenaje compartido entre base de datos, uploads y backups. Por eso
  `MAX_UPLOAD_MB=10`.
- 5 Mbit/s de salida: las descargas grandes son lentas.
- El plan Free no incluye dominio propio ni correo SMTP. La verificación, el ingreso por código
  y la recuperación dependen de las variables `SMTP_*` (Gmail con contraseña de aplicación);
  sin ellas no se activan.
- TURN no está configurado; las llamadas funcionan P2P y pueden fallar en NAT estricto.
- Un solo replica porque SQLite vive en el volumen.
- Los backups están dentro del mismo volumen: protegen contra borrados accidentales, no contra
  la pérdida del proveedor.

## Siguiente salto cuando haya presupuesto

Con `etonlex.com` y un VPS pequeño, usa `docs/PRODUCTION-LAUNCH.md`: Caddy renueva HTTPS,
SMTP y TURN se configuran como secretos, y los backups pueden salir del servidor.
