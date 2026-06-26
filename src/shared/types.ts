export interface Source {
  id: string
  provider: 'notion' | 'google_drive'
  name: string
  rootExternalId: string
  createdAt: string
}

export interface Document {
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
  syncStatus: 'pending' | 'synced' | 'error'
}

export interface Chunk {
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

export interface SearchResult {
  documentTitle: string
  snippet: string
  heading: string | null
  url: string | null
  provider: string
  score: number
}

export interface SyncProgress {
  sourceId: string
  phase: 'fetching' | 'extracting' | 'chunking' | 'embedding' | 'storing'
  current: number
  total: number
  currentDocTitle: string | null
  errors: string[]
}

export interface EmbeddingHealth {
  provider: 'cohere' | 'ollama'
  model: string
  mismatchedChunks: number
  totalChunks: number
}

export interface StorageStats {
  sourceCount: number
  documentCount: number
  chunkCount: number
  dbSizeBytes: number
}

export type SourceConfig =
  | { provider: 'notion'; rootPageId: string; name: string }
  | { provider: 'google_drive'; folderId: string; folderName: string }
