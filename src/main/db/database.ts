import type Database from 'better-sqlite3'

// --- Sources ---

export interface SourceRow {
  id: string
  provider: string
  name: string
  rootExternalId: string
  createdAt: string
}

interface SourceDbRow {
  id: string
  provider: string
  name: string
  root_external_id: string
  created_at: string
}

export function insertSource(db: Database.Database, source: SourceRow): void {
  db.prepare(
    'INSERT INTO sources (id, provider, name, root_external_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(source.id, source.provider, source.name, source.rootExternalId, source.createdAt)
}

export function getSourceById(db: Database.Database, id: string): SourceRow | null {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceDbRow | undefined
  if (!row) return null
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    rootExternalId: row.root_external_id,
    createdAt: row.created_at
  }
}

export function getAllSources(db: Database.Database): SourceRow[] {
  const rows = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all() as SourceDbRow[]
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    rootExternalId: row.root_external_id,
    createdAt: row.created_at
  }))
}

export function deleteSource(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM sources WHERE id = ?').run(id)
}

// --- Documents ---

export interface DocumentRow {
  id: string
  sourceId: string
  provider: string
  externalId: string
  title: string
  url: string | null
  mimeType: string | null
  modifiedAt: string | null
  contentHash: string | null
  lastSyncedAt: string | null
  syncStatus: string
}

interface DocumentDbRow {
  id: string
  source_id: string
  provider: string
  external_id: string
  title: string
  url: string | null
  mime_type: string | null
  modified_at: string | null
  content_hash: string | null
  last_synced_at: string | null
  sync_status: string
}

function mapDocRow(row: DocumentDbRow): DocumentRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    provider: row.provider,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    mimeType: row.mime_type,
    modifiedAt: row.modified_at,
    contentHash: row.content_hash,
    lastSyncedAt: row.last_synced_at,
    syncStatus: row.sync_status
  }
}

export function insertDocument(db: Database.Database, doc: DocumentRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO documents (id, source_id, provider, external_id, title, url, mime_type, modified_at, content_hash, last_synced_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    doc.id,
    doc.sourceId,
    doc.provider,
    doc.externalId,
    doc.title,
    doc.url,
    doc.mimeType,
    doc.modifiedAt,
    doc.contentHash,
    doc.lastSyncedAt,
    doc.syncStatus
  )
}

export function getDocumentsBySourceId(db: Database.Database, sourceId: string): DocumentRow[] {
  const rows = db
    .prepare('SELECT * FROM documents WHERE source_id = ?')
    .all(sourceId) as DocumentDbRow[]
  return rows.map(mapDocRow)
}

export function getDocumentByExternalId(
  db: Database.Database,
  sourceId: string,
  externalId: string
): DocumentRow | null {
  const row = db
    .prepare('SELECT * FROM documents WHERE source_id = ? AND external_id = ?')
    .get(sourceId, externalId) as DocumentDbRow | undefined
  if (!row) return null
  return mapDocRow(row)
}

export function updateDocumentSyncStatus(
  db: Database.Database,
  id: string,
  status: string
): void {
  db.prepare('UPDATE documents SET sync_status = ?, last_synced_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    id
  )
}

// --- Chunks ---

export interface ChunkRow {
  id: string
  documentId: string
  chunkIndex: number
  heading: string | null
  text: string
  embedding: Buffer | null
  embeddingModel: string | null
  tokenCount: number | null
  createdAt: string
}

interface ChunkDbRow {
  id: string
  document_id: string
  chunk_index: number
  heading: string | null
  text: string
  embedding: Buffer | null
  embedding_model: string | null
  token_count: number | null
  created_at: string
}

function mapChunkRow(row: ChunkDbRow): ChunkRow {
  return {
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    heading: row.heading,
    text: row.text,
    embedding: row.embedding,
    embeddingModel: row.embedding_model,
    tokenCount: row.token_count,
    createdAt: row.created_at
  }
}

export function upsertChunks(db: Database.Database, chunks: ChunkRow[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO chunks (id, document_id, chunk_index, heading, text, embedding, embedding_model, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const batch = db.transaction((items: ChunkRow[]) => {
    for (const c of items) {
      insert.run(
        c.id,
        c.documentId,
        c.chunkIndex,
        c.heading,
        c.text,
        c.embedding,
        c.embeddingModel,
        c.tokenCount,
        c.createdAt
      )
    }
  })
  batch(chunks)
}

export function getChunksByDocumentId(db: Database.Database, documentId: string): ChunkRow[] {
  const rows = db
    .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index')
    .all(documentId) as ChunkDbRow[]
  return rows.map(mapChunkRow)
}

export function getChunksWithEmbeddings(db: Database.Database): ChunkRow[] {
  const rows = db
    .prepare('SELECT * FROM chunks WHERE embedding IS NOT NULL')
    .all() as ChunkDbRow[]
  return rows.map(mapChunkRow)
}

export function deleteChunksByDocumentId(db: Database.Database, documentId: string): void {
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId)
}

// --- Settings ---

export function upsertSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  return row.value
}
