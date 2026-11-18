# Enlace público permanente y actualizaciones automáticas

## Estado real hoy

ETON LEX se publica en un **único servicio** de Suga, impulsado por el repo
`gozzerzalet-blip/eton-lex`, rama `main`, Dockerfile de la raíz.

**URL pública permanente actual:**

```text
https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run
```

Esa URL es del servicio, no de cada despliegue. Suga la describe como
`https://<id-servicio>-<entorno>-<cluster>.suga.run`; un push a la rama
vigilada reconstruye la imagen y la despliega **sobre el mismo servicio**.
No se genera un enlace nuevo por commit, corrección o funcionalidad.

Evidencia observada:

- Los pushes `570fa8d`, `fdf2cbe`, `a0ade7b` y `20b8432` actualizaron el mismo
  hostname.
- Tras el último push, el HTML sirvió el asset nuevo `index-D3SJ0-xx.js` en la
  misma URL; no apareció otro dominio.
- `/api/system/capabilities` refleja la configuración activa del servicio en la
  misma URL.

## Cómo se publicarán las futuras modificaciones

El flujo quedó centralizado en `.github/workflows/publicar.yml`:

1. Los cambios se confirman y se envían a la rama `develop`.
2. GitHub Actions ejecuta:
   - `npm run typecheck`
   - `npm --workspace apps/api run test`
   - `npm run build`
   - verificación de que `apps/api/dist` y `apps/web/dist` están versionados;
3. Si todo pasa, el mismo workflow hace `merge --ff-only` de `develop` en
   `main` y empuja `main`.
4. Suga detecta el push a `main`, construye el Dockerfile y actualiza el
   servicio existente.
5. Todos los usuarios siguen entrando por la misma URL y reciben la versión
   nueva.

`main` es la única rama que Suga publica. `develop` es solo la puerta de
verificación; no crea otro enlace ni otra plataforma.

Si necesitas publicar una corrección urgente, también puedes empujar a `main`
directamente, pero entonces la verificación ocurre en local antes del push. El
flujo recomendado es `develop → CI → main`.

## Compatibilidad con enlaces antiguos

- La URL de Suga indicada arriba sigue siendo válida: Suga mantiene el dominio
  autogenerado cuando se añade un dominio propio.
- Si se configura un dominio propio, `PUBLIC_WEB_URL` pasa a ser ese dominio y
  `LEGACY_PUBLIC_URLS` conserva la URL anterior. El backend responde `308` desde
  el host antiguo al nuevo, conservando ruta y parámetros:

  ```text
  https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run/registro?invitado=ana
    → https://etonlex.com/registro?invitado=ana
  ```

- El enlace temporal de Cloudflare que aparece en `docs/PUBLISHING.md` era solo
  de prueba local, cambia en cada arranque y ya no debe compartirse. Aparece
  como histórico, no como enlace oficial.

## Caché y PWA

- Vite genera JS y CSS con hash de contenido (`index-D3SJ0-xx.js`,
  `index-ceP4-9cu.css`). Esos archivos pueden cachearse porque su nombre cambia
  cuando cambia el contenido.
- El `index.html` se sirve con `Cache-Control: no-cache` y se reescribe en cada
  respuesta con el canonical correcto.
- `sw.js` y `manifest.webmanifest` se sirven con `no-cache`.
- El Service Worker usa cachés versionadas (`eton-lex-v10-shell`,
  `eton-lex-v10-runtime`), navigation **network-first**, assets con hash
  **cache-first**, y borra las cachés de versiones anteriores al activarse.
- La app envía `SKIP_WAITING` cuando detecta un worker nuevo, para activarlo sin
  obligar a la persona a borrar datos del navegador.

## Datos de usuarios

El código y los datos están separados:

- La base SQLite y los archivos viven en el volumen persistente `/data`
  (`DATABASE_PATH=/data/eton-lex.db`, `BACKUP_DIR=/data/backups`).
- `start:production` ejecuta migraciones idempotentes, seed sin sobrescritura e
  importación del corpus solo cuando la biblioteca está vacía; después arranca
  la API. Un redeploy no borra el volumen.
- Las cuentas, conversaciones, mensajes, contactos, preferencias y archivos no
  se versionan en Git ni se reemplazan por el build.

Para verificar conservación de datos en Suga se necesita acceso autenticado a
la API de producción o al volumen. Sin ese acceso no se puede contar
directamente a los usuarios de producción; sí se comprobó que el servicio sigue
respondiendo y que la configuración persistente (correo, IA) sobrevivió a varias
publicaciones.

## Lo que falta para usar `https://etonlex.com`

No está configurado todavía. No lo des por hecho. Verificación actual:

- `etonlex.com` y `www.etonlex.com` **no resuelven DNS**.
- El plan Suga actual es Free, y la documentación oficial de Suga indica
  **0 dominios propios** en Free (Pro incluye 10).
- Un CNAME externo a la URL de Suga responde `421 Misdirected Request`, así que
  no basta con apuntar DNS por fuera: Suga debe registrar el hostname.

Necesito exactamente esto:

1. Que el dominio `etonlex.com` te pertenezca y tengas acceso a su DNS.
2. Acceso a la cuenta de Suga (o que ejecutes tú estos pasos en el dashboard):
   - actualizar a **Pro**, o contratar otro hosting permanente con dominio
     propio;
   - en el servicio → **Config → Public Networking → + Custom Domain**,
     agregar `etonlex.com` (y, si quieres, `www.etonlex.com`) y el puerto `4000`;
   - copiar los registros CNAME/TXT que muestra Suga y publicarlos en el DNS;
   - esperar la verificación y el certificado TLS.
3. Cambiar estas variables de entorno en Suga y redesplegar:

   ```bash
   PUBLIC_WEB_URL=https://etonlex.com
   WEB_ORIGIN=https://etonlex.com
   LEGACY_PUBLIC_URLS=https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run
   ```

   Si usas `www`, agrégalo también a `LEGACY_PUBLIC_URLS` cuando corresponda.
4. Si el DNS está en Cloudflare, dejar el registro CNAME hacia Suga en
   **DNS only** (nube gris) durante la verificación.

Después de eso, la URL definitiva será `https://etonlex.com` y la URL de Suga
seguirá funcionando como enlace antiguo redirigido. Hasta que eso ocurra, la URL
permanente real es la de Suga indicada al inicio.

## Verificación

```bash
npm run typecheck
npm --workspace apps/api run test
npm run build
npm run deploy:check -- --url https://a7yp4cd07ujg-production-zay69hs2.us-central1.suga.run
```

La prueba `legacy-link.test.ts` comprueba que un host antiguo redirige con `308`
a `https://etonlex.com/registro?...`, conservando la query, y que el host
canonical responde `200`.
