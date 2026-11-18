/**
 * Simula una base de la Fase 2 creada con el índice FTS defectuoso
 * (`chunk_id UNINDEXED`) y comprueba que la migración actual lo reconstruye sin
 * perder fragmentos y deja los triggers de borrado funcionando.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.DATABASE_PATH;
assert.ok(dbPath, 'DATABASE_PATH debe estar definido');

const raw = new DatabaseSync(dbPath);
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL
  );
  CREATE TABLE ai_conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE ai_documents (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT, name TEXT NOT NULL,
    mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, extracted TEXT,
    pages INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, conversation_id TEXT,
    chunk_index INTEGER NOT NULL, page INTEGER, char_offset INTEGER NOT NULL, section TEXT,
    label TEXT NOT NULL, text TEXT NOT NULL, chars INTEGER NOT NULL, embedding BLOB, dim INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
    chunk_id UNINDEXED, label, text
  );
`);
raw.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
  .run('usuario-antiguo', 'antiguo@prueba.local', 'hash', 'Usuario antiguo');
raw.prepare('INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, ?)')
  .run('conversacion-antigua', 'usuario-antiguo', 'Conversación antigua');
raw.prepare(`INSERT INTO ai_documents (id, user_id, conversation_id, name, mime, size, path, extracted, pages)
  VALUES (?, ?, ?, ?, 'text/plain', ?, 'documento-antiguo.txt', ?, 2)`)
  .run('documento-antiguo', 'usuario-antiguo', 'conversacion-antigua', 'Documento antiguo', 320, 'contenido de prueba del documento antiguo');
raw.prepare(`INSERT INTO document_chunks (id, document_id, user_id, conversation_id, chunk_index,
  page, char_offset, section, label, text, chars)
  VALUES (?, ?, ?, ?, 0, 1, 0, 'CAPÍTULO I', 'Documento antiguo', ?, ?)`)
  .run('fragmento-antiguo', 'documento-antiguo', 'usuario-antiguo', 'conversacion-antigua',
    'contenido de prueba del documento antiguo', 39);
raw.close();

const { db, migrate } = await import('../db/index.js');

const definition = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_chunks_fts'",
).get() as { sql: string };
assert.ok(!definition.sql.includes('UNINDEXED'), 'la migración debe quitar UNINDEXED');

const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'document_chunks_%'").all() as Array<{ name: string }>).map((r) => r.name);
assert.deepEqual(triggers.sort(), ['document_chunks_ad', 'document_chunks_ai', 'document_chunks_au']);

const chunks = (db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get() as { n: number }).n;
const indexed = (db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get() as { n: number }).n;
assert.equal(chunks, 1);
assert.equal(indexed, 1, 'el fragmento antiguo debe reindexarse');

// La migración repetida no debe duplicar ni borrar filas del índice.
migrate();
const afterSecond = (db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get() as { n: number }).n;
assert.equal(afterSecond, 1);

db.prepare('DELETE FROM ai_documents WHERE id = ?').run('documento-antiguo');
const afterDelete = (db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get() as { n: number }).n;
assert.equal(afterDelete, 0, 'el trigger corregido debe limpiar el índice en cascada');

console.log(JSON.stringify({
  ok: true,
  rebuilt: indexed === 1,
  triggers: triggers.length,
  idempotent: afterSecond === 1,
  cascadeCleanup: afterDelete === 0,
}));
db.close();
