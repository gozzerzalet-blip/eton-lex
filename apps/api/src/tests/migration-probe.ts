/**
 * Se ejecuta en un proceso hijo con una base de datos temporal. Importar
 * `db/index.js` ya ejecuta migrate(); llamarla de nuevo comprueba que la
 * migración es idempotente sobre una base recién creada.
 */
import { db, migrate } from '../db/index.js';

let secondRunOk = true;
let secondRunError = '';
try {
  migrate();
} catch (err) {
  secondRunOk = false;
  secondRunError = (err as Error).message;
}

const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger')").all() as Array<{ type: string; name: string }>;
const names = objects.map((o) => o.name);
const triggers = objects.filter((o) => o.type === 'trigger').map((o) => o.name);
const schemaMeta = (db.prepare('SELECT key FROM schema_meta ORDER BY key').all() as Array<{ key: string }>).map((r) => r.key);
const aiDocColumns = (db.prepare('PRAGMA table_info(ai_documents)').all() as Array<{ name: string }>).map((c) => c.name);
const newsColumns = (db.prepare('PRAGMA table_info(news)').all() as Array<{ name: string }>).map((c) => c.name);

console.log(JSON.stringify({
  secondRunOk,
  secondRunError,
  tables: names.filter((n) => objects.find((o) => o.name === n)?.type === 'table').length,
  triggers,
  schemaMeta,
  hasConversationColumn: aiDocColumns.includes('conversation_id'),
  newsHasHash: newsColumns.includes('hash'),
}));
db.close();
