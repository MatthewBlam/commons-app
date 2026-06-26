import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { runMigrations } from './migrations'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const dbPath = join(app.getPath('userData'), 'commons.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  runMigrations(_db)
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
