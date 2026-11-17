# Lanzamiento real de ETON LEX

Este documento es la guía de ejecución. La infraestructura ya está implementada en el
repositorio: `Dockerfile`, `docker-compose.yml`, `deploy/Caddyfile`, `.env.production.example`,
`npm run backup` y `npm run deploy:check`. **No hay dominio, hosting ni tiendas contratados:** eso
requiere cuentas y pago a nombre de la creadora. No se inventa ningún despliegue.

## 1. Dominio

Consulta RDAP realizada el 17/11/2026:

| Dominio | Resultado |
|---|---|
| `etonlex.com` | RDAP 404 → aparece disponible |
| `etonlex.app` | RDAP 404 → aparece disponible |
| `etonlex.pe` | No verificable por RDAP público (requiere NIC Perú) |

Un registro RDAP 404 significa que el nombre no aparece registrado en ese momento; la
disponibilidad definitiva se confirma en el carrito del registrador.

Dónde registrarlo:

- Cloudflare Registrar: https://dash.cloudflare.com/?to=/:account/registrar/domains
- Porkbun: https://porkbun.com/
- NIC Perú (si se elige `.pe`): https://www.nic.pe/

Recomendación: `etonlex.com`. Coste orientativo: USD 10–20/año.

## 2. Hosting permanente

Se recomienda un VPS pequeño con Caddy (HTTPS automático) usando los archivos de este repo.
Otras opciones válidas: Render Web Service con disco, Railway o Fly.io con volumen.

VPS recomendado:

- Hetzner Cloud: https://console.hetzner.cloud/
- DigitalOcean: https://cloud.digitalocean.com/

Especificación mínima: 1 vCPU, 1–2 GB RAM, 25 GB SSD, Docker + Compose. Coste orientativo:
USD 5–12/mes.

Pasos en el servidor:

```bash
git clone <REPOSITORIO> /srv/eton-lex
cd /srv/eton-lex
cp .env.production.example .env.production
# Editar .env.production con dominio, JWT_SECRET, AI_API_KEY y SMTP
docker compose up -d --build
```

DNS: crear registros `A` (y `AAAA` si aplica) apuntando `@` y `www` a la IP del servidor.
Caddy obtiene y renueva el certificado de Let's Encrypt automáticamente.

Verificación:

```bash
npm run deploy:check -- --url https://etonlex.com
```

El comando falla si hay IP, túnel, HTTP 511, redirección, canonical incorrecto, healthcheck o
sitemap ausentes.

## 3. Base de datos, archivos y backups

- SQLite y uploads viven en el volumen `eton-data` (`/data`), no en el contenedor efímero.
- La API ejecuta migraciones al arrancar (`db/index.ts`).
- Seed administrador: `docker compose exec etonlex npm run db:seed:prod`.
- Backup manual: `docker compose run --rm backup`.
- Backup automático (crontab del servidor):

```cron
0 3 * * * cd /srv/eton-lex && docker compose run --rm backup >> /srv/eton-lex/backups/cron.log 2>&1
```

Cada backup guarda `eton-lex.db` mediante `VACUUM INTO`, `uploads/` y un `manifest.json` con
conteo de usuarios y normas. La retención se controla con `BACKUP_RETENTION_DAYS`.

## 4. Correo, IA y SEO

- SMTP: crear una clave en https://resend.com/api-keys o https://app.brevo.com/settings/keys/api
  y completar `SMTP_*`. Sin eso, verificación y recuperación siguen marcadas como pendientes.
- IA: crear clave en https://console.groq.com/keys y completar `AI_API_KEY`. El respaldo
  configurado es Pollinations (sin clave), así que no depende de Ollama en tu PC.
- Search Console: https://search.google.com/search-console
  Verificar por DNS (TXT) y enviar `https://etonlex.com/sitemap.xml`. No se afirma indexación
  hasta verla en el panel.

## 5. Tiendas

| Tienda | Acción requiere | Enlace |
|---|---|---|
| Google Play Console | Cuenta, US$ 25 pago único, keystore | https://play.google.com/console/signup |
| Apple Developer | Cuenta, US$ 99/año, Mac o build cloud | https://developer.apple.com/programs/enroll/ |
| Digital Asset Links | Publicar `/.well-known/assetlinks.json` tras elegir `applicationId` | https://developers.google.com/digital-asset-links |

No se puede subir un AAB ni un IPA sin esas credenciales y firmas. La PWA ya es instalable
desde el navegador cuando el dominio tiene HTTPS.

## 6. Lo que necesito exactamente de tu parte

1. Dominio registrado o acceso al registrador para configurar DNS.
2. Servidor/hosting con Docker, o un token de API de Render/Railway/Fly (nunca contraseña).
3. Clave SMTP para verificación y recuperación.
4. Clave de IA de producción (Groq recomendada).
5. Cuenta de Google para Search Console.
6. Cuentas de desarrollador y firmas si se quieren las tiendas.

Con 1–4 puedo dejar ETON LEX públicamente disponible y verificado en una sesión. Con 5 y 6 se
completan indexación y publicación en tiendas.
