import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  insertSource,
  getSourceById,
  getAllSources,
  deleteSource,
  insertDocument,
  getDocumentsBySourceId,
  getDocumentByExternalId,
  updateDocumentSyncStatus,
  upsertChunks,
  getChunksByDocumentId,
  upsertSetting,
  getSetting
} from '../database'

describe('migrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  })

  afterEach(() => db.close())

  it('creates all tables on fresh database', () => {
    runMigrations(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('sources')
    expect(names).toContain('documents')
    expect(names).toContain('chunks')
    expect(names).toContain('settings')
    expect(names).toContain('schema_version')
  })

  it('is idempotent — running twice does not error', () => {
    runMigrations(db)
    runMigrations(db)
  })

  it('cascades deletes from sources to documents and chunks', () => {
    runMigrations(db)
    insertSource(db, {
      id: 's1',
      provider: 'notion',
      name: 'Test',
      rootExternalId: 'ext1',
      createdAt: new Date().toISOString()
    })
    insertDocument(db, {
      id: 'd1',
      sourceId: 's1',
      provider: 'notion',
      externalId: 'e1',
      title: 'Doc 1',
      url: null,
      mimeType: null,
      modifiedAt: null,
      contentHash: null,
      lastSyncedAt: null,
      syncStatus: 'synced'
    })
    upsertChunks(db, [
      {
        id: 'c1',
        documentId: 'd1',
        chunkIndex: 0,
        heading: null,
        text: 'hello',
        embedding: null,
        embeddingModel: null,
        tokenCount: 1,
        createdAt: new Date().toISOString()
      }
    ])

    deleteSource(db, 's1')

    expect(getDocumentsBySourceId(db, 's1')).toHaveLength(0)
    expect(getChunksByDocumentId(db, 'd1')).toHaveLength(0)
  })
})

describe('sources', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
  })
  afterEach(() => db.close())

  it('inserts and retrieves a source', () => {
    insertSource(db, {
      id: 's1',
      provider: 'notion',
      name: 'Test Source',
      rootExternalId: 'ext1',
      createdAt: '2024-01-01T00:00:00Z'
    })
    const source = getSourceById(db, 's1')
    expect(source).not.toBeNull()
    expect(source!.name).toBe('Test Source')
    expect(source!.provider).toBe('notion')
  })

  it('lists all sources', () => {
    insertSource(db, {
      id: 's1',
      provider: 'notion',
      name: 'Source 1',
      rootExternalId: 'ext1',
      createdAt: '2024-01-01T00:00:00Z'
    })
    insertSource(db, {
      id: 's2',
      provider: 'google_drive',
      name: 'Source 2',
      rootExternalId: 'ext2',
      createdAt: '2024-01-02T00:00:00Z'
    })
    expect(getAllSources(db)).toHaveLength(2)
  })
})

describe('documents', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    insertSource(db, {
      id: 's1',
      provider: 'notion',
      name: 'Test',
      rootExternalId: 'ext1',
      createdAt: '2024-01-01T00:00:00Z'
    })
  })
  afterEach(() => db.close())

  it('inserts and retrieves documents by source', () => {
    insertDocument(db, {
      id: 'd1',
      sourceId: 's1',
      provider: 'notion',
      externalId: 'e1',
      title: 'Doc 1',
      url: 'https://notion.so/doc1',
      mimeType: 'text/plain',
      modifiedAt: '2024-01-01T00:00:00Z',
      contentHash: 'abc123',
      lastSyncedAt: '2024-01-01T00:00:00Z',
      syncStatus: 'synced'
    })
    const docs = getDocumentsBySourceId(db, 's1')
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe('Doc 1')
  })

  it('finds document by external ID', () => {
    insertDocument(db, {
      id: 'd1',
      sourceId: 's1',
      provider: 'notion',
      externalId: 'e1',
      title: 'Doc 1',
      url: null,
      mimeType: null,
      modifiedAt: null,
      contentHash: null,
      lastSyncedAt: null,
      syncStatus: 'pending'
    })
    const doc = getDocumentByExternalId(db, 's1', 'e1')
    expect(doc).not.toBeNull()
    expect(doc!.id).toBe('d1')
  })

  it('updates sync status', () => {
    insertDocument(db, {
      id: 'd1',
      sourceId: 's1',
      provider: 'notion',
      externalId: 'e1',
      title: 'Doc 1',
      url: null,
      mimeType: null,
      modifiedAt: null,
      contentHash: null,
      lastSyncedAt: null,
      syncStatus: 'pending'
    })
    updateDocumentSyncStatus(db, 'd1', 'synced')
    const doc = getDocumentByExternalId(db, 's1', 'e1')
    expect(doc!.syncStatus).toBe('synced')
  })
})

describe('settings', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
  })
  afterEach(() => db.close())

  it('round-trips a setting value', () => {
    upsertSetting(db, 'embedding_provider', 'cohere')
    expect(getSetting(db, 'embedding_provider')).toBe('cohere')
  })

  it('upserts existing setting', () => {
    upsertSetting(db, 'key', 'v1')
    upsertSetting(db, 'key', 'v2')
    expect(getSetting(db, 'key')).toBe('v2')
  })

  it('returns null for missing key', () => {
    expect(getSetting(db, 'nonexistent')).toBeNull()
  })
})
