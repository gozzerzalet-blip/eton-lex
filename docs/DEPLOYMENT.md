# Publicar ETON LEX en internet

Este documento describe cómo pasar de la ejecución local (`http://localhost:4000`) a una
dirección oficial con HTTPS, y qué decide el responsable antes de contratar nada.

> Estado actual: la plataforma funciona en local y está lista para desplegarse. **No se ha
> comprado ningún dominio ni contratado ningún servicio.** Todo lo que sigue son opciones y
> requisitos; la elección final corresponde a la creadora del proyecto.
>
> Implementación lista para producción (17/11/2026): `Dockerfile`, `docker-compose.yml`,
> `deploy/Caddyfile` (HTTPS automático), `.env.production.example`, respaldos con `npm run backup`
> y verificación con `npm run deploy:check`. Guía de ejecución: [`PRODUCTION-LAUNCH.md`](PRODUCTION-LAUNCH.md).

---

## 1. Qué se necesita para tener un enlace oficial

| Pieza | Para qué sirve | Quién la aporta |
|---|---|---|
| Dominio | Dirección estable (p. ej. `etonlex.com`) | Se registra a nombre de Zalet Gozzer |
| Hosting con Node.js | Ejecuta la API + frontend y guarda SQLite/uploads | Cuenta en el proveedor elegido |
| HTTPS | Obligatorio para cookies seguras y PWA | El hosting o un proxy (Cloudflare/Caddy) |
| DNS | Apuntar el dominio al hosting | Panel del registrador o de Cloudflare |
| Google Search Console | Indexación y sitemap | Cuenta de Google de la creadora |

Sin estos elementos no existe un enlace público permanente. Un túnel temporal (por ejemplo,
Cloudflare Quick Tunnel) puede mostrar la app desde este equipo, pero no es una dirección
oficial: depende de que la computadora esté encendida y no sirve para tiendas ni para SEO.

---

## 2. Elegir dominio (no se compra sin autorización)

Opciones habituales:

1. **`.com` / `.app` / `.pe` según disponibilidad.**
   - Registradores: Cloudflare Registrar (precio de costo), Porkbun, Namecheap.
   - Coste orientativo: USD 10–20 al año para `.com`/`.app` (verificar precio vigente).
   - `.pe` se registra en NIC Perú y puede requerir DNI/RUC y documentación; tarifa según
     NIC.pe.
2. **Recomendación técnica:** usar un dominio corto y coherente con la marca
   (`etonlex.com`, `etonlex.pe` o `etonlex.app`). Antes de decidir, comprobar disponibilidad
   y que no exista una marca registrada conflictiva.
3. **No usar** un subdominio gratuito de hosting (`*.onrender.com`, `*.vercel.app`) como
   dirección oficial: funciona para pruebas, pero no transmite confianza ni es estable para
   Search Console y tiendas.

Cuando esté elegido, el dominio se configura en el hosting y en estas variables:

```env
NODE_ENV=production
PUBLIC_WEB_URL=https://TU-DOMINIO
WEB_ORIGIN=https://TU-DOMINIO
```

`PUBLIC_WEB_URL` alimenta canonical, Open Graph, `robots.txt` y `sitemap.xml`.

---

## 3. Opciones de hosting

La app es un monolito Node.js que sirve el frontend compilado y la API, con SQLite y archivos
subidos en disco. Por eso necesita **disco persistente** (no sirve un hosting solo estático).

| Opción | Ventaja | Límite | Coste orientativo |
|---|---|---|---|
| Render (Web Service + disco) | Sencillo, HTTPS y dominio propio incluidos | Disco y suspensiones según plan | USD 7–25/mes |
| Railway / Fly.io | Buen soporte de volúmenes | Configuración algo mayor | USD 5–20/mes |
| VPS (Hetzner, DigitalOcean) + Caddy | Control total, HTTPS automático | Requiere administración y backups | USD 5–12/mes |
| Vercel/Netlify (solo frontend) | Muy rápido para el SPA | **No ejecuta la API ni SQLite**; haría falta otro backend | Gratis/desde USD 20/mes |

Recomendación si se quiere simplicidad: **Render con disco persistente** o **VPS pequeño con
Caddy**. En ambos casos se configura:

- Build: `npm ci && npm run build`
- Start: `npm start`
- Disco persistente montado en `apps/api/data` (base de datos, uploads, respaldos)
- Variables de entorno del apartado 2 + `JWT_SECRET` largo y aleatorio
- Health check: `GET /api/system/capabilities`

### HTTPS

- Render/Railway/Fly ya entregan HTTPS.
- En VPS, Caddy obtiene y renueva el certificado de Let's Encrypt automáticamente:

```caddy
etonlex.com {
  reverse_proxy 127.0.0.1:4000
}
```

Con HTTPS activo, las cookies `secure` funcionan y la PWA se puede instalar en móviles.

---

## 4. Pasos de despliegue (cuando existan dominio y hosting)

1. Crear el servicio con Node 22.5+ y disco persistente.
2. Configurar las variables de entorno (nunca subir `.env` al repositorio).
3. Ejecutar migraciones y crear el administrador real:

```bash
npm run db:migrate
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_NAME="Zalet Gozzer" npm run db:seed
```

4. Verificar:
   - `https://TU-DOMINIO/login` carga con candado y sin errores de consola.
   - `https://TU-DOMINIO/robots.txt` y `https://TU-DOMINIO/sitemap.xml` responden.
   - `https://TU-DOMINIO/api/system/capabilities` responde JSON.
   - El manifest y los iconos responden 200.
5. Programar respaldos del disco (`eton-lex.db`, `uploads/`).
6. Rotar `JWT_SECRET` invalida todas las sesiones: hacerlo solo con aviso.

Checklist de seguridad mínima:

- [ ] `JWT_SECRET` aleatorio (no el valor de desarrollo).
- [ ] `NODE_ENV=production`, cookies `secure`, HTTPS obligatorio.
- [ ] `WEB_ORIGIN` y `PUBLIC_WEB_URL` con el dominio real.
- [ ] Rate limits activos (ya vienen configurados).
- [ ] Cuenta administradora real; cambiar o eliminar las cuentas demo.
- [ ] `DEMO_MODE=false`.
- [ ] Respaldos automáticos y prueba de restauración.
- [ ] Revisar la política de privacidad y los términos con un abogado.

---

## 5. Google Search Console y SEO

Ya implementado en el proyecto:

- Título, descripción, `author`/`creator` (Zalet Gozzer), canonical, Open Graph y Twitter Card.
- Datos estructurados JSON-LD (`Organization`, `WebSite`, `SoftwareApplication`) con la
  creadora.
- `robots.txt` dinámico que permite solo las páginas públicas y bloquea API, socket.io y
  rutas privadas.
- `sitemap.xml` dinámico con `/login`, `/registro`, `/acerca`, `/privacidad` y `/terminos`.
- `noindex,nofollow` en todas las rutas con sesión (panel, biblioteca privada, noticias,
  comunidad, mensajes, perfiles, configuración y administración).
- Páginas públicas `/acerca`, `/privacidad` y `/terminos` con crédito de autoría.
- Imagen Open Graph 1200×630 (`/og-image.png`).

Pasos en Search Console (requieren cuenta de Google de la creadora):

1. Añadir la propiedad con el dominio (`https://TU-DOMINIO`).
2. Verificar por DNS (registro TXT en Cloudflare/registrador) o subiendo un archivo HTML a
   `apps/web/public/`.
3. Enviar `https://TU-DOMINIO/sitemap.xml`.
4. Usar «Inspección de URL» → «Solicitar indexación» para `/login`, `/registro`, `/acerca`.
5. Revisar en 1–2 semanas: cobertura, páginas excluidas y consultas.
6. Opcional: crear un perfil de empresa en Google si se quiere reforzar la marca.

Nota honesta sobre el SEO: posicionar «ETON LEX» es viable porque es una marca única, pero
Google necesita tiempo, contenido público útil y enlaces entrantes. No se puede garantizar
la primera posición ni una fecha exacta.

---

## 6. Qué necesito de tu parte

Para poder darte un enlace público y avanzar a las tiendas:

1. **Dominio:** confirmar el nombre exacto y si lo registras tú o quieres que prepare la guía
   paso a paso. No compraré nada sin tu autorización.
2. **Hosting:** elegir proveedor y crear la cuenta (o darme acceso temporal mediante tokens,
   nunca tu contraseña).
3. **DNS:** acceso al panel del dominio para los registros A/CNAME/TXT.
4. **Google:** cuenta de Google para Search Console.
5. **Datos legales:** correo oficial de contacto y, si corresponde, razón social/RUC para la
   política de privacidad y los términos.
6. **Tiendas:** cuentas de desarrollador (Google Play, Apple Developer, Microsoft Partner
   Center) y presupuesto de las tarifas.
7. **Contenido:** capturas de pantalla reales y textos de ficha que apruebes.

Con esos elementos, el despliegue puede completarse y verificarse en una sola sesión de
trabajo.
