-- ════════════════════════════════════════════════════════════════
--  ETON LEX — esquema de base de datos (SQLite)
--  Diseño: identidad → conocimiento jurídico → actividad → IA
-- ════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Identidad ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  avatar_url      TEXT,
  university      TEXT,
  university_id   TEXT,
  campus_id       TEXT,
  university_type TEXT CHECK (university_type IN ('publica','privada')),
  faculty         TEXT,
  career          TEXT,
  country         TEXT DEFAULT 'Perú',
  city            TEXT,
  cycle           TEXT,
  bio             TEXT,
  cover_url       TEXT,
  username        TEXT UNIQUE,
  public_id       TEXT UNIQUE,
  links           TEXT NOT NULL DEFAULT '[]',
  privacy_fields  TEXT NOT NULL DEFAULT '{}',
  role            TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','moderator','admin')),
  email_verified  INTEGER NOT NULL DEFAULT 0,
  privacy         TEXT NOT NULL DEFAULT '{"profile":"community","activity":"friends"}',
  theme           TEXT NOT NULL DEFAULT 'light',
  onboarded       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_university ON users(university);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_public_id ON users(public_id);
CREATE INDEX IF NOT EXISTS idx_users_career ON users(career);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Códigos de un solo uso para recuperar contraseña. Nunca se guarda el código
-- en texto plano: solo su hash. La sesión se revoca al completar el cambio.
CREATE TABLE IF NOT EXISTS password_resets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  requested_ip TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, consumed_at);

-- Códigos de un solo uso para confirmar el correo al crear una cuenta.
-- Igual que en recuperación: solo se guarda el hash, nunca el código en texto.
CREATE TABLE IF NOT EXISTS email_verifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  requested_ip TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, created_at DESC);

-- Códigos para iniciar sesión sin contraseña. Sirven para cualquier cuenta,
-- incluso cuando la persona olvidó su contraseña. Solo se guarda el hash.
CREATE TABLE IF NOT EXISTS login_codes (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  requested_ip TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at DESC);

CREATE TABLE IF NOT EXISTS legal_areas (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area    TEXT NOT NULL REFERENCES legal_areas(slug) ON DELETE CASCADE,
  PRIMARY KEY (user_id, area)
);

-- ── Biblioteca jurídica ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  kind            TEXT NOT NULL, -- rss | html | api | manual
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_hash       TEXT,
  last_error      TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS norms (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  short_title   TEXT,
  number        TEXT,
  type          TEXT NOT NULL, -- constitucion | codigo | ley | decreto_legislativo | decreto_supremo | resolucion | reglamento | tratado
  area          TEXT REFERENCES legal_areas(slug),
  entity        TEXT,
  published_at  TEXT,
  effective_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'por_verificar', -- vigente | modificado | parcialmente_derogado | derogado | por_verificar
  official_url  TEXT,
  source_id     TEXT REFERENCES sources(id),
  summary       TEXT,
  verification  TEXT NOT NULL DEFAULT 'pending', -- pending | verified | mismatch
  verified_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_norms_area ON norms(area);
CREATE INDEX IF NOT EXISTS idx_norms_type ON norms(type);

CREATE TABLE IF NOT EXISTS norm_versions (
  id            TEXT PRIMARY KEY,
  norm_id       TEXT NOT NULL REFERENCES norms(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  published_at  TEXT,
  source_url    TEXT,
  content_hash  TEXT,
  verification  TEXT NOT NULL DEFAULT 'pending',
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_versions_norm ON norm_versions(norm_id);

CREATE TABLE IF NOT EXISTS articles (
  id          TEXT PRIMARY KEY,
  norm_id     TEXT NOT NULL REFERENCES norms(id) ON DELETE CASCADE,
  version_id  TEXT REFERENCES norm_versions(id) ON DELETE SET NULL,
  number      TEXT NOT NULL,
  heading     TEXT,
  text        TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  source_url  TEXT,
  book        TEXT,
  section     TEXT,
  title       TEXT,
  chapter     TEXT,
  status      TEXT NOT NULL DEFAULT 'vigente',
  provenance  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_norm ON articles(norm_id);
CREATE INDEX IF NOT EXISTS idx_articles_number ON articles(norm_id, number);

CREATE TABLE IF NOT EXISTS article_history (
  id          TEXT PRIMARY KEY,
  article_id  TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version_id  TEXT,
  text        TEXT NOT NULL,
  change_type TEXT NOT NULL DEFAULT 'modificacion',
  changed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source_url  TEXT,
  norm_ref    TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_article ON article_history(article_id);

CREATE TABLE IF NOT EXISTS norm_updates (
  id              TEXT PRIMARY KEY,
  norm_id         TEXT REFERENCES norms(id) ON DELETE SET NULL,
  article_id      TEXT REFERENCES articles(id) ON DELETE SET NULL,
  type            TEXT NOT NULL, -- modificacion | incorporacion | derogacion | nueva_norma | jurisprudencia | precedente
  title           TEXT NOT NULL,
  summary         TEXT,
  previous_text   TEXT,
  current_text    TEXT,
  modifying_norm  TEXT,
  published_at    TEXT,
  source_url      TEXT,
  source_key      TEXT,
  external_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  detected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at    TEXT,
  confirmed_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_updates_external ON norm_updates(source_key, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_updates_status ON norm_updates(status, published_at);

CREATE TABLE IF NOT EXISTS follows (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('norm','article','area')),
  target_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_type, target_id)
);

-- ── Noticias ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news (
  id           TEXT PRIMARY KEY,
  external_id  TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT,
  body         TEXT,
  source_name  TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  image_url    TEXT,
  country      TEXT DEFAULT 'Perú',
  scope        TEXT NOT NULL DEFAULT 'nacional' CHECK (scope IN ('nacional','internacional')),
  category     TEXT,
  relevance    TEXT,
  published_at TEXT,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  hash         TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_scope ON news(scope, published_at DESC);

-- ── Documentos privados ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  path       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'file', -- file | ai_upload
  extracted  TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

CREATE TABLE IF NOT EXISTS document_shares (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (document_id, user_id)
);

-- ── Comunidad ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id           TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked','rejected')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id, status);

CREATE TABLE IF NOT EXISTS study_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  area        TEXT REFERENCES legal_areas(slug),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   TEXT REFERENCES study_groups(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','question','document','news','norm')),
  title      TEXT,
  body       TEXT,
  ref_type   TEXT,
  ref_id     TEXT,
  visibility TEXT NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends','group','public')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Mensajería ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('direct','group')),
  title           TEXT,
  avatar_url      TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_read_at    TEXT,
  muted           INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT,
  kind            TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','file','audio','link','norm','news')),
  attachment_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
  reply_to        TEXT REFERENCES messages(id) ON DELETE SET NULL,
  sticker_pack    TEXT,
  one_time        INTEGER NOT NULL DEFAULT 0,
  viewed_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at       TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS call_history (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  caller_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('audio','video')),
  status          TEXT NOT NULL CHECK (status IN ('completed','missed','declined','failed')),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  duration_s      INTEGER
);

-- ── Stickers, salas y colaboración ──────────────────────────────
CREATE TABLE IF NOT EXISTS sticker_packs (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stickers (
  id          TEXT PRIMARY KEY,
  pack_id     TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,
  keywords    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code  TEXT NOT NULL UNIQUE,
  visibility   TEXT NOT NULL DEFAULT 'link' CHECK (visibility IN ('link','community')),
  whiteboard   INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'participant',
  hand_raised INTEGER NOT NULL DEFAULT 0,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  left_at    TEXT,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_messages (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT,
  attachment_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whiteboard_pages (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL DEFAULT 1,
  title       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, page_number)
);

CREATE TABLE IF NOT EXISTS whiteboard_elements (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES whiteboard_pages(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whiteboard_page ON whiteboard_elements(page_id, created_at);

CREATE TABLE IF NOT EXISTS room_screen_shares (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT
);

-- ── IA ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Nueva consulta',
  mode       TEXT NOT NULL DEFAULT 'auto', -- auto | principiante | intermedio | avanzado | examen | tecnico | directo
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aiconv_user ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  citations       TEXT NOT NULL DEFAULT '[]',
  sources         TEXT NOT NULL DEFAULT '[]',
  model           TEXT,
  latency_ms      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aimsg_conv ON ai_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_documents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  path            TEXT NOT NULL,
  extracted       TEXT,
  pages           INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Corpus para RAG: fragmentos con embeddings opcionales
CREATE TABLE IF NOT EXISTS chunks (
  id         TEXT PRIMARY KEY,
  ref_type   TEXT NOT NULL, -- article | news | norm | userdoc
  ref_id     TEXT NOT NULL,
  label      TEXT NOT NULL,
  text       TEXT NOT NULL,
  embedding  BLOB,
  dim        INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chunks_ref ON chunks(ref_type, ref_id);

-- ── Notificaciones y sistema ────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal',
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  meta       TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id          TEXT PRIMARY KEY,
  source_key  TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running',
  stats       TEXT,
  error       TEXT
);

-- ── Búsqueda de texto completo (FTS5) ───────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  number, heading, text, content='articles', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, number, heading, text) VALUES (new.rowid, new.number, new.heading, new.text);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, number, heading, text) VALUES ('delete', old.rowid, old.number, old.heading, old.text);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, number, heading, text) VALUES ('delete', old.rowid, old.number, old.heading, old.text);
  INSERT INTO articles_fts(rowid, number, heading, text) VALUES (new.rowid, new.number, new.heading, new.text);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(
  title, summary, body, content='news', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS news_ai AFTER INSERT ON news BEGIN
  INSERT INTO news_fts(rowid, title, summary, body) VALUES (new.rowid, new.title, new.summary, new.body);
END;
CREATE TRIGGER IF NOT EXISTS news_ad AFTER DELETE ON news BEGIN
  INSERT INTO news_fts(news_fts, rowid, title, summary, body) VALUES ('delete', old.rowid, old.title, old.summary, old.body);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS norms_fts USING fts5(
  title, short_title, number, summary, content='norms', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS norms_ai AFTER INSERT ON norms BEGIN
  INSERT INTO norms_fts(rowid, title, short_title, number, summary) VALUES (new.rowid, new.title, new.short_title, new.number, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS norms_ad AFTER DELETE ON norms BEGIN
  INSERT INTO norms_fts(norms_fts, rowid, title, short_title, number, summary) VALUES ('delete', old.rowid, old.title, old.short_title, old.number, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS norms_au AFTER UPDATE ON norms BEGIN
  INSERT INTO norms_fts(norms_fts, rowid, title, short_title, number, summary) VALUES ('delete', old.rowid, old.title, old.short_title, old.number, old.summary);
  INSERT INTO norms_fts(rowid, title, short_title, number, summary) VALUES (new.rowid, new.title, new.short_title, new.number, new.summary);
END;
