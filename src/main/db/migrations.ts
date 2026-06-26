import type Database from 'better-sqlite3'

interface Migration {
  version: number
  statements: string[]
}

const migrations: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        root_external_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        mime_type TEXT,
        modified_at TEXT,
        content_hash TEXT,
        last_synced_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending'
      )`,
      `CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        heading TEXT,
        text TEXT NOT NULL,
        embedding BLOB,
        embedding_model TEXT,
        token_count INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE INDEX idx_documents_source_id ON documents(source_id)`,
      `CREATE INDEX idx_chunks_document_id ON chunks(document_id)`,
      `CREATE UNIQUE INDEX idx_documents_external ON documents(source_id, external_id)`
    ]
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)

  const current = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as {
    v: number | null
  }
  const currentVersion = current?.v ?? 0

  const pending = migrations.filter((m) => m.version > currentVersion)
  if (pending.length === 0) return

  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      for (const sql of migration.statements) {
        db.exec(sql)
      }
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString()
      )
    }
  })
  applyAll()
}
