/**
 * Importa el corpus jurídico verificado incluido en la imagen de producción.
 *
 * Es idempotente: solo actúa cuando la biblioteca está vacía. Si ya hay
 * artículos (por ejemplo, tras una ingesta oficial o por actividad de un
 * administrador), no sobrescribe nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx } from '../db/index.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.join(__dirname, '..', 'data', 'legal-corpus.json');
function values(row, columns) {
    return columns.map((c) => (row[c] === undefined ? null : row[c]));
}
function insert(table, row, columns) {
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values(row, columns));
}
function main() {
    const existing = db.prepare('SELECT COUNT(*) c FROM articles').get();
    if (existing.c > 0) {
        console.log(`· corpus jurídico ya presente (${existing.c} artículos), sin cambios`);
        return;
    }
    if (!fs.existsSync(corpusPath)) {
        console.warn('· no se encontró legal-corpus.json; la biblioteca quedará pendiente de ingesta oficial');
        return;
    }
    const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
    if (corpus.format !== 'eton-lex-legal-corpus/v1') {
        throw new Error('Formato de corpus jurídico no reconocido.');
    }
    const sourceByKey = new Map(db.prepare('SELECT id, key FROM sources').all().map((s) => [s.key, s.id]));
    const normBySlug = new Map(db.prepare('SELECT id, slug FROM norms').all().map((n) => [n.slug, n.id]));
    const normIdMap = new Map();
    const result = tx(() => {
        // Las normas del catálogo ya existen desde db:seed. Solo completamos su
        // estado de verificación y conservamos los identificadores locales.
        const normColumns = [
            'id', 'slug', 'title', 'short_title', 'number', 'type', 'area', 'entity',
            'published_at', 'effective_at', 'status', 'official_url', 'summary',
            'verification', 'verified_at',
        ];
        for (const row of corpus.tables.norms) {
            const slug = String(row.slug);
            const local = normBySlug.get(slug);
            if (local) {
                const sourceKey = row.source_id ? String(row.source_id).replace(/^src_/, '') : null;
                const sourceId = sourceKey ? sourceByKey.get(sourceKey) ?? null : null;
                db.prepare(`
          UPDATE norms SET
            title = ?, short_title = ?, number = ?, type = ?, area = ?, entity = ?,
            published_at = ?, effective_at = ?, status = ?, official_url = ?, source_id = ?,
            summary = ?, verification = ?, verified_at = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(...[
                    row.title, row.short_title, row.number, row.type, row.area, row.entity,
                    row.published_at, row.effective_at, row.status, row.official_url, sourceId,
                    row.summary, row.verification, row.verified_at, local,
                ].map((v) => v ?? null));
                normIdMap.set(String(row.id), local);
            }
            else {
                insert('norms', row, normColumns);
                normIdMap.set(String(row.id), String(row.id));
            }
        }
        const versionById = new Set(db.prepare('SELECT id FROM norm_versions').all().map((v) => v.id));
        for (const row of corpus.tables.norm_versions) {
            if (versionById.has(String(row.id)))
                continue;
            insert('norm_versions', {
                ...row,
                norm_id: normIdMap.get(String(row.norm_id)) ?? row.norm_id,
            }, ['id', 'norm_id', 'label', 'published_at', 'source_url', 'content_hash', 'verification', 'notes', 'created_at']);
        }
        const hasArticle = db.prepare('SELECT 1 FROM articles WHERE id = ?');
        const articleColumns = [
            'id', 'norm_id', 'version_id', 'number', 'heading', 'text', 'order_index',
            'source_url', 'book', 'section', 'title', 'chapter', 'status', 'provenance', 'updated_at',
        ];
        for (const row of corpus.tables.articles) {
            if (hasArticle.get(String(row.id)))
                continue;
            insert('articles', {
                ...row,
                norm_id: normIdMap.get(String(row.norm_id)) ?? row.norm_id,
            }, articleColumns);
        }
        const hasHistory = db.prepare('SELECT 1 FROM article_history WHERE id = ?');
        for (const row of corpus.tables.article_history) {
            if (hasHistory.get(String(row.id)))
                continue;
            insert('article_history', row, ['id', 'article_id', 'version_id', 'text', 'change_type', 'changed_at', 'source_url', 'norm_ref']);
        }
        return {
            norms: corpus.tables.norms.length,
            articles: corpus.tables.articles.length,
            history: corpus.tables.article_history.length,
        };
    });
    console.log(`· corpus importado: ${result.norms} normas, ${result.articles} artículos, ${result.history} versiones históricas`);
}
main();
//# sourceMappingURL=import-corpus.js.map