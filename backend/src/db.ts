import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'sra.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#4F46E5',
    points INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    last_active TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    blinding_enabled INTEGER DEFAULT 1,
    inclusion_criteria TEXT DEFAULT '',
    exclusion_criteria TEXT DEFAULT '',
    keywords TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS review_members (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'reviewer',
    invited_by TEXT,
    joined_at TEXT DEFAULT (datetime('now')),
    UNIQUE(review_id, user_id),
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS review_invites (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'reviewer',
    token TEXT UNIQUE NOT NULL,
    invited_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    title TEXT NOT NULL,
    authors TEXT DEFAULT '',
    abstract TEXT DEFAULT '',
    journal TEXT DEFAULT '',
    year INTEGER,
    volume TEXT DEFAULT '',
    issue TEXT DEFAULT '',
    pages TEXT DEFAULT '',
    doi TEXT DEFAULT '',
    pmid TEXT DEFAULT '',
    url TEXT DEFAULT '',
    source_db TEXT DEFAULT '',
    keywords TEXT DEFAULT '',
    full_text_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    duplicate_group_id TEXT,
    is_duplicate_primary INTEGER DEFAULT 1,
    import_batch TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS screening_decisions (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    time_spent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(article_id, user_id, phase),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS extraction_fields (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_label TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text',
    options TEXT DEFAULT '[]',
    required INTEGER DEFAULT 0,
    order_num INTEGER DEFAULT 0,
    section TEXT DEFAULT 'General',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS extraction_data (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    value TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(article_id, field_id, user_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES extraction_fields(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6B7280',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS article_tags (
    article_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (article_id, tag_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    review_id TEXT,
    badge_type TEXT NOT NULL,
    badge_name TEXT NOT NULL,
    description TEXT DEFAULT '',
    earned_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    review_id TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    resolution TEXT DEFAULT '',
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)() as T;
}

export default db;
