/**
 * Exporta el corpus jurídico verificado desde la base local a un activo
 * estático que puede viajar dentro de la imagen de producción.
 *
 * Uso: node scripts/export-legal-corpus.mjs
 *
 * Solo exporta tablas de conocimiento jurídico. No incluye usuarios,
 * sesiones, mensajes ni ningún dato personal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const dbPath = path.join(root, 'apps', 'api', 'data', 'eton-lex.db');
const outPath = path.join(root, 'apps', 'api', 'src', 'data', 'legal-corpus.json');

if (!fs.existsSync(dbPath)) {
  throw new Error(`No existe la base de origen: ${dbPath}`);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = ['sources', 'norms', 'norm_versions', 'articles', 'article_history'];
const corpus = {
  format: 'eton-lex-legal-corpus/v1',
  exportedAt: new Date().toISOString(),
  note: 'Textos oficiales extraídos de los PDF de Normas Legales Actualizadas del Diario Oficial El Peruano. Sin datos de usuarios.',
  tables: {},
};

for (const table of tables) {
  corpus.tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
}

const verified = corpus.tables.norms.filter((n) => n.verification === 'verified').length;
console.log(
  `Corpus exportado: ${corpus.tables.norms.length} normas (${verified} verificadas), ` +
    `${corpus.tables.articles.length} artículos, ${corpus.tables.article_history.length} versiones de artículos.`,
);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(corpus));
console.log(`→ ${path.relative(root, outPath)} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MiB)`);
