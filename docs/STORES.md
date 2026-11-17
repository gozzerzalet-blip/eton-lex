# Publicar ETON LEX en las tiendas

Este documento es la vista rápida de **qué falta para cada tienda**, cuánto cuesta y con qué
texto se publicará. El detalle técnico de empaquetado está en
[`PUBLISHING.md`](PUBLISHING.md); el dominio, el hosting y el SEO están en
[`DEPLOYMENT.md`](DEPLOYMENT.md).

> Estado: **ninguna tienda está publicada**. Todas requieren cuentas de desarrollador,
> tarifas y activos de firma que debe autorizar y aportar la creadora. No se ha contratado ni
> comprado nada.

---

## 1. Resumen por tienda

| Tienda | Plataforma | Vía técnica | Cuenta necesaria | Coste orientativo | Estado |
|---|---|---|---|---|---|
| Google Play | Android | TWA (Bubblewrap) o Capacitor | Google Play Console | US$ 25 pago único | ⛔ Bloqueado: falta cuenta y firma |
| Apple App Store | iPhone / iPad | Capacitor + Xcode o build en nube | Apple Developer Program | US$ 99 al año | ⛔ Bloqueado: falta cuenta y macOS/Xcode |
| Microsoft Store | Windows 10/11 | PWA empaquetada (PWABuilder / MSIX) o Electron | Microsoft Partner Center | US$ 19 pago único (cuenta individual) | ⛔ Bloqueado: falta cuenta y firma |
| Instalación directa | Windows / macOS | PWA instalable desde el navegador | Ninguna | Gratis | 🟡 Funciona con dominio + HTTPS |

La vía más rápida para tener «una app descargable» sin esperar revisiones es la **PWA
instalable**: el usuario entra al dominio oficial y elige «Instalar aplicación». No sustituye
a las tiendas, pero da icono, ventana propia y uso sin barra del navegador.

---

## 2. Google Play (Android)

### Vía recomendada: TWA con Bubblewrap

Una TWA (Trusted Web Activity) empaqueta la PWA en un `.aab` sin reescribir la app. Requiere
que el dominio oficial ya esté publicado con HTTPS y un `assetlinks.json` correcto.

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://TU-DOMINIO/manifest.webmanifest
bubblewrap build
```

Alternativa: Capacitor (ver `PUBLISHING.md` §3), útil si más adelante se necesitan funciones
nativas como notificaciones push o cámara.

### Qué se necesita

- [ ] Dominio público con HTTPS y la PWA funcionando.
- [ ] Cuenta de Google Play Console (US$ 25, pago único) a nombre de Zalet Gozzer.
- [ ] Keystore de firma y contraseñas guardadas fuera del repositorio.
- [ ] `applicationId` definitivo, p. ej. `pe.etonlex.app`.
- [ ] Política de privacidad pública (`/privacidad`).
- [ ] Formulario de seguridad de datos.
- [ ] Clasificación de contenido.
- [ ] Icono 512×512, gráfico de funciones 1024×500 y capturas de teléfono.
- [ ] Prueba cerrada con testers si Google la exige para cuentas nuevas.

### Riesgo a tener en cuenta

Google puede rechazar una TWA que sea solo un envoltorio de baja calidad. Por eso la app debe
aportar valor real (biblioteca, comunidad, mensajería) y no mostrar estados vacíos.

---

## 3. Apple App Store (iPhone / iPad)

### Vía técnica

Capacitor + Xcode. **No se puede compilar ni subir una app iOS desde Windows**: hace falta un
Mac con Xcode o un servicio de build en la nube (Codemagic, Bitrise, GitHub Actions con
runner macOS).

### Qué se necesita

- [ ] Cuenta de Apple Developer Program (US$ 99 al año).
- [ ] Mac con Xcode **o** servicio de build en la nube.
- [ ] Certificados de distribución y perfiles de aprovisionamiento.
- [ ] `Bundle ID` definitivo, p. ej. `pe.etonlex.app`.
- [ ] App Store Connect: ficha, capturas por tamaño (6.9", 6.5", 5.5", iPad), icono 1024×1024.
- [ ] Política de privacidad y términos accesibles sin sesión.
- [ ] Eliminación de cuenta desde la app (Apple lo exige si hay registro).
- [ ] Declaración de privacidad (datos, archivos, audio, IA).
- [ ] Cumplir la guía 4.2 (funcionalidad mínima) y las reglas de contenido generado por usuarios.

### Riesgo a tener en cuenta

La guía **4.2 de Apple** rechaza apps que son solo una web empaquetada sin funciones nativas
suficientes. Para reducir el riesgo conviene añadir notificaciones push, cámara/archivos,
almacenamiento offline y una experiencia de navegación propia antes de enviar.

---

## 4. Microsoft Store / tienda de laptop (Windows)

### Opción A: PWA empaquetada como MSIX (recomendada)

1. Publicar la PWA con HTTPS.
2. Usar [PWABuilder](https://www.pwabuilder.com/) para generar el paquete MSIX de Windows.
3. Firmar el paquete y subirlo a Microsoft Partner Center.

Ventaja: reutiliza la misma PWA y se actualiza con la web. Límite: menos integración nativa.

### Opción B: Electron

Empaqueta el frontend como aplicación de escritorio. Útil si se necesita acceso a archivos
locales o funcionamiento sin conexión más profundo. Añade tamaño y mantenimiento.

### Qué se necesita

- [ ] Cuenta de Microsoft Partner Center (US$ 19 pago único para cuenta individual; verificar
      tarifa vigente).
- [ ] Nombre reservado para la app en la tienda.
- [ ] Paquete MSIX firmado o instalador firmado.
- [ ] Certificado de firma de código (recomendado; algunos antivirus bloquean instaladores sin
      firma).
- [ ] Capturas 1366×768 o 1920×1080, icono y descripción.
- [ ] Política de privacidad pública.

> «Tienda de laptop» no es una tienda única: Windows usa Microsoft Store y macOS usa la App
> Store de Apple. En macOS, la vía más realista al inicio es la **PWA instalable** desde Safari
> o Chrome, no la App Store de macOS.

---

## 5. Ficha de tienda (borrador aprobable)

Texto base para Play Store, App Store y Microsoft Store. Debe ser veraz: no promete funciones
que aún no están configuradas (IA, noticias, correo) como si ya funcionaran.

**Nombre:** ETON LEX

**Subtítulo:** El Derecho, siempre a tu alcance

**Descripción corta (80 caracteres):**
> Plataforma jurídica para estudiantes de Derecho del Perú, creada por Zalet Gozzer.

**Descripción completa:**

> ETON LEX es la plataforma jurídica creada por **Zalet Gozzer** para estudiantes de Derecho
> del Perú.
>
> Reúne en un solo lugar:
>
> • Biblioteca normativa peruana con enlace a la fuente oficial (SPIJ / El Peruano).
> • ETON AI, un asistente que cita la norma, el artículo y la fuente cuando puede verificarlos,
>   y que indica cuándo no puede confirmar un dato.
> • Noticias y actualizaciones legislativas con revisión humana antes de publicarse.
> • Comunidad académica privada: grupos de estudio, apuntes y mensajería.
> • Experiencia instalable (PWA) en teléfono y computadora.
>
> ETON LEX no sustituye la asesoría legal profesional. Toda información jurídica debe
> contrastarse con la fuente oficial vigente.
>
> Creada por Zalet Gozzer.

**Categoría:** Educación / Referencia.

**Palabras clave:** derecho peruano, legislación, estudiantes de derecho, biblioteca jurídica,
SPIJ, ETON LEX.

**Crédito obligatorio en la ficha:** «Creada por Zalet Gozzer».

---

## 6. Activos gráficos que hay que preparar

| Activo | Tamaño | Estado |
|---|---|---|
| Icono de app | 512×512 (Play), 1024×1024 (iOS/MS) | ✅ Base lista en `apps/web/public/icon.svg` y PNG |
| Icono adaptativo Android | 432×432 con zona segura | ✅ `icon-maskable-512.png` sirve de base |
| Gráfico destacado Play | 1024×500 | ⛔ Pendiente de diseñar |
| Capturas de teléfono | 1080×1920 aprox. | ⛔ Pendiente: deben ser de la app real |
| Capturas de tableta | Según tienda | ⛔ Pendiente |
| Capturas de escritorio | 1366×768 / 1920×1080 | ⛔ Pendiente |
| Imagen Open Graph | 1200×630 | ✅ `og-image.png` |

Las capturas deben hacerse con datos reales o con datos de demostración claramente
identificados. No se deben presentar datos simulados como reales.

---

## 7. Orden recomendado

1. **Dominio + HTTPS + PWA** (ver `DEPLOYMENT.md`). Sin dominio no hay TWA, ni Search Console,
   ni verificación de tiendas.
2. **PWA instalable** en Android, iOS y Windows: ya cubre «descargar la app» sin cuentas.
3. **Google Play** con TWA: menor fricción y coste bajo.
4. **Microsoft Store** con MSIX: reutiliza la PWA.
5. **Apple App Store** al final: requiere Mac o build en nube y refuerzo de funciones nativas.

---

## 8. Qué necesito de tu parte antes de enviar nada

1. Autorización expresa para crear cuentas de desarrollador y pagar las tarifas indicadas.
2. Cuenta de Google (Play Console) y de Microsoft Partner Center.
3. Apple Developer Program (y confirmar si tienes Mac o contratamos build en nube).
4. `applicationId` / `Bundle ID` definitivos (propuesta: `pe.etonlex.app`).
5. Correo oficial de contacto y datos legales para privacidad y términos.
6. Capturas reales aprobadas y el texto final de la ficha.
7. Decisión sobre funciones nativas (push, cámara, offline) antes de iOS.

Sin estos elementos no es posible publicar ni prometer una fecha de disponibilidad en tiendas.
