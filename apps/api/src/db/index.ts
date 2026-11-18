import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.paths.db), { recursive: true });

export const db = new DatabaseSync(config.paths.db);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export function migrate(): void {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Las bases creadas antes de la identidad pública no tienen estas columnas.
  // Deben agregarse antes de ejecutar el esquema, porque éste crea índices
  // sobre username/public_id y fallaría en una tabla users antigua.
  const legacyUserTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (legacyUserTable) {
    const existing = new Set(
      (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    // Se agregan todas las columnas que el esquema indexa o que el código usa.
    // Un subconjunto hacía fallar `db.exec(schema)` en bases muy antiguas con
    // índices sobre `university` u otras columnas de identidad.
    const essential: Array<[string, string]> = [
      ['avatar_url', 'TEXT'],
      ['university', 'TEXT'],
      ['university_id', 'TEXT'],
      ['campus_id', 'TEXT'],
      ['university_type', 'TEXT'],
      ['faculty', 'TEXT'],
      ['career', 'TEXT'],
      ['country', "TEXT DEFAULT 'Perú'"],
      ['city', 'TEXT'],
      ['cycle', 'TEXT'],
      ['bio', 'TEXT'],
      ['cover_url', 'TEXT'],
      ['username', 'TEXT'],
      ['public_id', 'TEXT'],
      ['links', "TEXT NOT NULL DEFAULT '[]'"],
      ['privacy_fields', "TEXT NOT NULL DEFAULT '{}'"],
      ['bubble_colors', "TEXT NOT NULL DEFAULT '{}'"],
      ['role', "TEXT NOT NULL DEFAULT 'student'"],
      ['email_verified', 'INTEGER NOT NULL DEFAULT 0'],
      ['privacy', 'TEXT NOT NULL DEFAULT \'{"profile":"community","activity":"friends"}\''],
      ['theme', "TEXT NOT NULL DEFAULT 'light'"],
      ['onboarded', 'INTEGER NOT NULL DEFAULT 0'],
      ['created_at', 'TEXT'],
      ['updated_at', 'TEXT'],
      ['last_seen_at', 'TEXT'],
    ];
    for (const [name, ddl] of essential) {
      if (!existing.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
    }
  }

  // Fase 2: la primera definición del índice FTS de fragmentos declaraba
  // `chunk_id` como UNINDEXED, lo que impedía limpiarlo al borrar un documento
  // en cascada. Si se detecta, se retira para que el esquema actual lo recree.
  const ftsDefinition = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_chunks_fts'",
  ).get() as { sql?: string } | undefined;
  if (ftsDefinition?.sql?.includes('UNINDEXED')) {
    db.exec(`
      DROP TRIGGER IF EXISTS document_chunks_ai;
      DROP TRIGGER IF EXISTS document_chunks_ad;
      DROP TRIGGER IF EXISTS document_chunks_au;
      DROP TABLE IF EXISTS document_chunks_fts;
    `);
  }

  db.exec(schema);

  // Reconstrucción idempotente del índice: si una versión anterior dejó menos
  // filas que fragmentos, se insertan solo los que faltan.
  const chunkCount = (db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get() as { n: number }).n;
  const ftsCount = (db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get() as { n: number }).n;
  if (ftsCount < chunkCount) {
    db.exec(`
      INSERT INTO document_chunks_fts(rowid, chunk_id, label, text)
      SELECT rowid, id, label, text FROM document_chunks
      WHERE rowid NOT IN (SELECT rowid FROM document_chunks_fts)
    `);
  }

  // Migraciones incrementales para bases de datos creadas antes de que el
  // articulado incorporara la estructura jerárquica y el estado por artículo.
  const articleColumns = new Set(
    (db.prepare('PRAGMA table_info(articles)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  const additions: Array<[string, string]> = [
    ['book', 'TEXT'],
    ['section', 'TEXT'],
    ['title', 'TEXT'],
    ['chapter', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT 'vigente'"],
    ['provenance', 'TEXT'],
  ];
  for (const [name, ddl] of additions) {
    if (!articleColumns.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${ddl}`);
  }

  const userColumns = new Set(
    (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  const userAdditions: Array<[string, string]> = [
    ['university_id', 'TEXT'],
    ['campus_id', 'TEXT'],
    ['faculty', 'TEXT'],
    ['career', 'TEXT'],
    ['cover_url', 'TEXT'],
    ['username', 'TEXT'],
    ['public_id', 'TEXT'],
    ["links", "TEXT NOT NULL DEFAULT '[]'"],
    ["privacy_fields", "TEXT NOT NULL DEFAULT '{}'"],
    ["bubble_colors", "TEXT NOT NULL DEFAULT '{}'"],
    ['email_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, ddl] of userAdditions) {
    if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
  }

  // Identidad pública estable para cuentas creadas antes de esta migración.
  db.exec(`
    UPDATE users
    SET public_id = COALESCE(public_id, UPPER(SUBSTR(id, 1, 8)))
    WHERE public_id IS NULL OR public_id = '';
    UPDATE users
    SET username = COALESCE(username, 'estudiante-' || SUBSTR(id, 1, 8))
    WHERE username IS NULL OR username = '';
  `);
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id_unique ON users(public_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_university_id ON users(university_id)');
  } catch { /* índices parciales ya presentes */ }

  const memberColumns = new Set(
    (db.prepare('PRAGMA table_info(conversation_members)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!memberColumns.has('pinned')) db.exec('ALTER TABLE conversation_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  if (!memberColumns.has('archived')) db.exec('ALTER TABLE conversation_members ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  if (!memberColumns.has('muted')) db.exec('ALTER TABLE conversation_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0');

  const messageColumns = new Set(
    (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!messageColumns.has('sticker_pack')) db.exec('ALTER TABLE messages ADD COLUMN sticker_pack TEXT');
  if (!messageColumns.has('one_time')) db.exec('ALTER TABLE messages ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0');
  if (!messageColumns.has('viewed_at')) db.exec('ALTER TABLE messages ADD COLUMN viewed_at TEXT');

  const sourceColumns = new Set(
    (db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!sourceColumns.has('last_error')) db.exec('ALTER TABLE sources ADD COLUMN last_error TEXT');

  // Las fuentes internacionales pasaron a ser todas en español. Los titulares
  // anteriores venían de fuentes en inglés: se retiran una sola vez y la ingesta
  // siguiente los repuebla con las fuentes hispanohablantes.
  db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  if (!db.prepare("SELECT 1 FROM schema_meta WHERE key = 'news_sources_spanish'").get()) {
    db.exec("DELETE FROM news WHERE scope = 'internacional'");
    db.prepare("INSERT INTO schema_meta (key) VALUES ('news_sources_spanish')").run();
  }
}

export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const uuid = () => crypto.randomUUID();

/** Transacción explícita (node:sqlite no incluye helper). */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* sin transacción activa */ }
    throw err;
  }
}

export function logAudit(userId: string | null, action: string, meta: unknown, ip?: string) {
  db.prepare(
    'INSERT INTO audit_log (id, user_id, action, meta, ip) VALUES (?, ?, ?, ?, ?)',
  ).run(uuid(), userId, action, JSON.stringify(meta ?? {}), ip ?? null);
}

migrate();
