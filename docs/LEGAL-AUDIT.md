# Auditoría del corpus legal

**Fecha de corte:** 17 de noviembre de 2026
**Base de datos:** `apps/api/data/eton-lex.db`
**Fuente de todas las normas integradas:** «Normas Legales Actualizadas» del Diario Oficial *El Peruano* (`https://diariooficial.elperuano.pe/Normas/obtenerDocumento?idNorma=<idNorma>`).

Este documento registra qué texto legal está realmente cargado, de dónde salió y qué limitaciones tiene. No es asesoría legal. La plataforma no completa artículos de memoria: si una fuente oficial no está confirmada, la norma aparece como «pendiente de integración».

## Resultado general

| Métrica | Valor |
| --- | --- |
| Normas verificadas | 22 |
| Artículos cargados | 7 433 |
| Normas con huecos numéricos | 0 |
| Normas con versión de texto registrada | 22 |
| Normas pendientes de fuente oficial | 5 |

«Hueco numérico» significa que falta un número de artículo dentro del rango publicado por la propia edición oficial. Los artículos derogados que la fuente no reproduce se registran como rangos derogados con su nota, no como huecos.

## Detalle por norma

| # | Norma | Identificador | idNorma | Artículos | Huecos | Derogados | Modificados | Suplementos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Constitución Política del Perú | — | 1 | 213 | 0 | 1 | 59 | — |
| 2 | Código Civil | Decreto Legislativo 295 | 60 | 2 149 | 0 | 89 | 149 | art. 557 |
| 3 | Código Penal | Decreto Legislativo 635 | 2 | 638 | 0 | 20 | 208 | — |
| 4 | Código Procesal Constitucional | Ley 31307 | 7 | 132 | 0 | 0 | 7 | — |
| 5 | Código de los Niños y Adolescentes | Ley 27337 | 8 | 269 | 0 | 84 | 18 | — |
| 6 | Ley del Procedimiento Administrativo General | Ley 27444 | 12 | 275 | 0 | 0 | 23 | — |
| 7 | Ley de Conciliación | Ley 26872 | 13 | 43 | 0 | 0 | 16 | — |
| 8 | Ley General de Sociedades | Ley 26887 | 15 | 461 | 0 | 4 | 22 | — |
| 9 | Código de Protección y Defensa del Consumidor | Ley 29571 | 17 | 172 | 0 | 0 | 10 | — |
| 10 | Ley del Procedimiento de Ejecución Coactiva | Ley 26979 | 19 | 47 | 0 | 0 | 4 | — |
| 11 | Ley de Transparencia y Acceso a la Información Pública | Ley 27806 | 20 | 24 | 0 | 0 | 4 | — |
| 12 | Ley General de Contrataciones Públicas | Ley 32069 | 25 | 100 | 0 | 0 | 2 | — |
| 13 | Ley de Productividad y Competitividad Laboral | Decreto Legislativo 728 | 35 | 112 | 0 | 10 | 5 | — |
| 14 | Ley Universitaria | Ley 30220 | 50 | 139 | 0 | 0 | 12 | — |
| 15 | Ley de Títulos Valores | Ley 27287 | 63 | 279 | 0 | 0 | 3 | — |
| 16 | Ley Orgánica del Poder Judicial | Decreto Supremo 017-93-JUS | 71 | 323 | 0 | 60 | 41 | — |
| 17 | Ley Orgánica del Ministerio Público | Decreto Legislativo 052 | 72 | 122 | 0 | 34 | 19 | — |
| 18 | Código Tributario | Decreto Supremo 133-2013-EF | 90009 | 219 | 0 | 9 | 59 | — |
| 19 | Ley de Arbitraje | Decreto Legislativo 1071 | 40001 | 79 | 0 | 0 | 4 | — |
| 20 | Código Procesal Penal | Decreto Legislativo 957 | 70003 | 598 | 0 | 0 | 71 | — |
| 21 | Código de Ejecución Penal | Decreto Legislativo 654 | 70006 | 167 | 0 | 2 | 32 | — |
| 22 | Código Procesal Civil | Decreto Legislativo 768 | 120007 | 872 | 0 | 32 | 131 | — |

Total: **7 433 artículos**.

Las columnas «derogados» y «modificados» cuentan el estado por artículo registrado en la base, según las notas de la edición oficial y las modificaciones detectadas en la versión integrada.

## Casos especiales documentados

### Código Civil, artículo 557

La capa de texto del PDF oficial de *El Peruano* omite el cuerpo del artículo 557 y conserva solo su título. El texto se recuperó de la publicación oficial del Código Civil difundida por el Sistema Peruano de Información Jurídica (SPIJ):

`https://spijlibre.minjus.gob.pe/content/publicaciones_oficiales/img/Codigo-Civil.pdf`

El artículo se muestra con `provenance` y una nota que explica el origen. No se reconstruyó de memoria.

### Artículos derogados sin texto

Cuando la edición oficial declara derogado un bloque y no reproduce su texto, la base registra el rango con su norma derogatoria y fecha. Casos registrados:

- **Código Penal**, arts. 262–269: capítulo I «Contrabando», derogado por la tercera disposición final de la Ley 26461 (08/06/1995).
- **Código de los Niños y Adolescentes**, arts. 183–241 y 243–244: derogados por el Decreto Legislativo 1348 (07/01/2017) y el Decreto Legislativo 1297 (30/12/2016).
- **Ley de Productividad y Competitividad Laboral**, arts. 97–106: Título V derogado por la quinta disposición transitoria, complementaria y final de la Ley 27626 (09/01/2002).

En la interfaz esos artículos aparecen como derogados, con la nota oficial, sin texto inventado.

### Código Procesal Civil, edición oficial de 2025

El Texto Único Ordenado aprobado por la Resolución Ministerial 010-93-JUS se ingirió desde la edición oficial actualizada al 7 de junio de 2025 de *El Peruano* (`idNorma=120007`). La edición termina en el **artículo 847**: después vienen las disposiciones complementarias y finales, que no son artículos numerados. El índice impreso conserva una referencia antigua a «Artículos 749 al 840», pero el cuerpo real de la edición llega al 847.

La fuente no reproduce el texto de tres bloques que declara derogados; se registran como rangos derogados con su norma y fecha, no como huecos:

- **Arts. 469–472**: derogados por la única disposición derogatoria del Decreto Legislativo 1069 (28/06/2008).
- **Arts. 540–545**: derogados por la Primera Disposición Derogatoria de la Ley 27584 (07/12/2001).
- **Arts. 697–703**: derogados por la única disposición complementaria derogatoria del Decreto Legislativo 1069 (28/06/2008).

La edición incluye artículos con sufijo alfabético (119-A, 392-A, 506-A, 523-A, 565-A, 566-A, 647-A, 690-A a 690-F, 692-A, 705-A) y diez artículos preliminares en números romanos. No se agregó ningún artículo que la fuente no publique.

### Normas pendientes de integración

No se cargaron porque no se confirmó una fuente oficial completa y fiable:

- Código de Comercio (norma histórica de 1902, vigente de forma parcial y supletoria).
- Código de Procedimientos Penales (derogado por el Código Procesal Penal, con vigencia residual).
- Ley de Delitos Aduaneros (Ley 28008).
- Ley de Seguridad y Salud en el Trabajo (Ley 29783).
- Nueva Ley Procesal del Trabajo (Ley 29497).

La plataforma las muestra como «pendiente de integración», sin texto inventado. El catálogo
tiene 27 normas en total: 22 con texto verificado y 5 pendientes.

## Cómo verificar esta auditoría

Con la API en ejecución (`http://localhost:4000`):

```powershell
# Detalle de una norma: artículos, huecos, derogados, modificados y suplementos
Invoke-RestMethod http://localhost:4000/api/library/norms/codigo-civil

# Búsqueda global
Invoke-RestMethod "http://localhost:4000/api/library/search?q=articulo%20557%20del%20Codigo%20Civil"
```

Cada respuesta incluye `textStats.gaps`, `textStats.derogated`, `textStats.modified`, `textStats.supplemented`, y cada artículo incluye `status`, `provenance` y `source_url`.

La fuente de verdad de las fuentes oficiales está en `apps/api/src/legal/registry.ts`.

## Limitaciones conocidas

1. **Actualización legislativa:** la ingesta se ejecuta manualmente (`npm --workspace apps/api run ingest:legal`). No hay todavía un diff automático contra *El Peruano* que detecte reformas nuevas.
2. **Estado por artículo:** «modificado» y «derogado» reflejan las notas de la edición oficial integrada; no sustituyen la consulta de la última publicación.
3. **Texto vigente vs. texto histórico:** se conserva una versión por norma. El historial por artículo (`article_history`) registra cambios de la ingesta, no todas las reformas históricas.
4. **Normas no integradas:** las cinco pendientes no tienen texto en la plataforma.
5. **Uso académico:** el corpus es una ayuda de estudio; para un caso real debe contrastarse con la publicación oficial vigente.
