# Ingesta del corpus legal

Proceso reproducible que carga el texto oficial de las normas en la base de datos y en el índice de búsqueda. Toda la lógica vive en `apps/api/src/legal/` y `apps/api/src/scripts/legal-ingest.ts`.

## Principio

**Solo fuentes oficiales.** Cada norma debe tener una edición confirmada en «Normas Legales Actualizadas» del Diario Oficial *El Peruano*. Si no hay fuente oficial verificada, la norma no se ingiere y la interfaz la muestra como «pendiente de integración». El sistema nunca inventa ni reconstruye texto legal.

## Componentes

| Archivo | Función |
| --- | --- |
| `src/legal/registry.ts` | Registro de fuentes oficiales, `idNorma`, estado, mínimos, rangos derogados, suplementos y encabezados de página. |
| `src/legal/parse.ts` | Descarga y parseo del PDF oficial; normaliza numeración y estructura, retira encabezados repetidos y separa artículos. |
| `src/scripts/legal-ingest.ts` | Orquesta la ingesta: descarga, parseo, validación, escritura en SQLite y actualización de FTS. |
| `src/db/schema.sql` | Tablas `norms`, `articles`, `articles_fts`, `norm_versions`, `article_history`. |

## Flujo

1. **Registro.** Se recorre `LEGAL_SOURCES`. Cada entrada declara:
   - `slug` de la norma en `norms`;
   - `idNorma` oficial de *El Peruano*;
   - `expected`, un patrón que debe aparecer en las primeras páginas (verifica que el PDF descargado corresponde a la norma);
   - `minArticles` y `lastArticle` para validar cobertura;
   - `stopAt` opcional para cortar reglamentos o normas anexas;
   - `derogatedRanges` para bloques que la fuente declara derogados sin texto;
   - `supplements` para artículos ausentes en la capa de texto del PDF pero publicados en otra fuente oficial;
   - `pageHeaders` para retirar encabezados de página repetidos.
2. **Descarga.** Se obtiene el PDF oficial desde
   `https://diariooficial.elperuano.pe/Normas/obtenerDocumento?idNorma=<idNorma>`.
3. **Parseo.** Se extrae el texto, se normaliza el número de artículo (incluidas numeraciones alfabéticas como `108-B`) y se arma la estructura (`libro`, `sección`, `título`, `capítulo`) cuando la fuente la trae.
4. **Validación.** Antes de escribir:
   - el patrón `expected` debe coincidir;
   - se exige un mínimo de artículos (`minArticles`);
   - se detectan huecos dentro del rango (`lastArticle`);
   - si algo falla, la norma no reemplaza la versión existente.
5. **Escritura.** Se insertan artículos, se registra una fila en `norm_versions` con fecha, fuente y notas, y se actualizan `articles_fts` y `article_history`.
6. **Verificación.** La API expone el resultado en `GET /api/library/norms/:slug` (`textStats`, `provenance`, `status`).

## Ejecutar la ingesta

Desde la raíz del repositorio:

```powershell
npm --workspace apps/api run ingest:legal
```

Requiere conexión a internet y la ruta de *El Peruano*. La base resultante queda en `apps/api/data/eton-lex.db`.

Para migrar y sembrar datos base desde cero:

```powershell
npm run db:migrate
npm run db:seed
npm --workspace apps/api run ingest:legal
```

## Validar el resultado

```powershell
# Estado del sistema
Invoke-RestMethod http://localhost:4000/api/system/health

# Detalle de una norma
Invoke-RestMethod http://localhost:4000/api/library/norms/codigo-civil

# Búsqueda de un artículo exacto
Invoke-RestMethod "http://localhost:4000/api/library/search?q=articulo%20196%20del%20Codigo%20Civil"
```

El resultado esperado está documentado en [`LEGAL-AUDIT.md`](./LEGAL-AUDIT.md): 22 normas, 7 433 artículos y 0 huecos numéricos. El catálogo completo tiene 27 normas: las 5 restantes aparecen como pendientes de integración, sin texto cargado.

## Agregar una norma nueva

1. Confirmar la fuente oficial en *El Peruano* y obtener su `idNorma`.
2. Agregar la entrada en `LEGAL_SOURCES` con `expected`, `minArticles` y `lastArticle`.
3. Si el PDF repite encabezados, añadirlos en `PAGE_HEADERS`.
4. Si la edición incluye un reglamento, definir `stopAt`.
5. Si hay artículos derogados sin texto, registrarlos en `derogatedRanges` con la norma y fecha de derogación.
6. Si un artículo falta en la capa de texto pero consta en otra publicación oficial, añadirlo en `supplements` con `sourceUrl` y nota de procedencia.
7. Ejecutar `ingest:legal` y revisar `textStats.gaps`, `derogated`, `modified` y `supplemented`.

## Reglas de honestidad

- No se completan artículos con conocimiento del modelo ni con textos de terceros no oficiales.
- No se marcan como «vigentes» normas sin verificación.
- Los suplementos siempre llevan `provenance` y `sourceUrl`.
- Los artículos derogados sin texto se muestran como tales, no vacíos ni inventados.
- Las normas sin fuente oficial quedan en `PENDING_SLUGS` y se muestran como pendientes.
