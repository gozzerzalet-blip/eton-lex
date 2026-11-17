# Despliegue gratuito en Suga Free

Esta es la ruta **sin costo** para publicar ETON LEX con HTTPS, base de datos y archivos
persistentes. No requiere dominio propio ni tarjeta. Requiere que la creadora tenga una cuenta
de **GitHub** y una cuenta de **Suga**; por seguridad, esas cuentas no se crean ni se operan
desde este repositorio.

> Estado: artefactos listos y verificados en local. **Todavía no hay URL pública** porque no se
> ha conectado el repositorio ni creado el servicio. No presentes `localhost`, IP ni túneles
> como enlace oficial.

## Qué se preparó en el repo

- `Dockerfile`: imagen ligera que solo instala dependencias de producción y usa los artefactos
  ya compilados (`apps/api/dist`, `apps/web/dist`). Pensada para 0.1 vCPU / 256 MiB.
- `Dockerfile.full`: imagen completa, útil en un VPS con más RAM.
- `start:production`: migra la base, siembra fuentes/normas y arranca la API.
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

## Límites honestos del plan Free

- 1 GB de almacenaje compartido entre base de datos, uploads y backups. Por eso
  `MAX_UPLOAD_MB=10`.
- 5 Mbit/s de salida: las descargas grandes son lentas.
- No hay dominio propio ni correo SMTP incluidos. La verificación de correo seguirá marcada
  como pendiente hasta configurar SMTP.
- TURN no está configurado; las llamadas funcionan P2P y pueden fallar en NAT estricto.
- Un solo replica porque SQLite vive en el volumen.
- Los backups están dentro del mismo volumen: protegen contra borrados accidentales, no contra
  la pérdida del proveedor.

## Siguiente salto cuando haya presupuesto

Con `etonlex.com` y un VPS pequeño, usa `docs/PRODUCTION-LAUNCH.md`: Caddy renueva HTTPS,
SMTP y TURN se configuran como secretos, y los backups pueden salir del servidor.
