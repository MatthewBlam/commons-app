# Commons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Electron desktop app that lets student clubs connect Notion and Google Drive docs, index them locally with Cohere embeddings, and search across everything with reranking.

**Architecture:** Electron main process handles all backend work (SQLite, API calls, OAuth, embeddings, search). React renderer communicates via typed IPC channels through a preload context bridge. Cosine similarity runs inline in the main process (~10-15ms for ~2,000 chunks, no worker needed at this scale). Sync is manual (user-triggered), fetch → extract → chunk → embed → store pipeline.

**Tech Stack:** Electron 42+ via electron-vite 2 (ESM), React + Tailwind CSS v4 + Coss UI, better-sqlite3, Cohere Embed v4 + Rerank v3.5, @notionhq/client, googleapis, pdf-parse, mammoth, electron-forge.

## Global Constraints

- **Node.js:** 20.19+ or 22.12+ (electron-vite requirement)
- **ESM-only:** `"type": "module"` in package.json, all configs use ESM syntax
- **electron-vite scaffold:** `npm create @quick-start/electron@latest` (NOT `npm create electron-vite@latest`)
- **Tailwind v4:** Use `@tailwindcss/vite` plugin, `@import "tailwindcss"` (NOT `@tailwind` directives)
- **Cohere API:** Raw `fetch` against `https://api.cohere.com/v2/` — no SDK dependency. Params are snake_case: `input_type`, `embedding_types`.
- **Cohere Embed model:** `embed-v4.0`, 1536 dimensions default, `input_type: 'search_document'` for docs, `'search_query'` for queries, max 96 texts per batch
- **Cohere Rerank model:** `rerank-v3.5`
- **Google Drive scope:** `drive.readonly` (NOT `drive.file` — too narrow to list folder contents)
- **Notion OAuth:** Fixed port loopback only (e.g., `http://localhost:21337/callback`). Random ports are rejected. Custom protocol schemes don't work.
- **Secure storage:** Electron `safeStorage` sync API (`encryptString`/`decryptString`). NOT keytar. Async variants aren't exposed in Electron 39's TypeScript types.
- **SQLite pragmas:** `journal_mode = WAL`, `foreign_keys = ON`
- **Platforms:** macOS (DMG) + Windows (Squirrel) only. No Linux for MVP.

## PRD Corrections

These were found during technology research and are incorporated into the plan:

1. **`drive.file` → `drive.readonly`** — `drive.file` only grants access to files the app created. Cannot list arbitrary user folders. `drive.readonly` is a sensitive scope (requires Google app verification for >100 users, 2-6 week process), but works immediately for development.
2. **Cohere API (no SDK)** — Use raw `fetch` against `https://api.cohere.com/v2/embed` and `/v2/rerank`. Params are snake_case: `input_type`, `embedding_types`. Avoids a dependency; consistent with the existing `auth:validate-cohere` handler.
3. **electron-vite v2 is ESM-only** — Config files must be ESM. Package.json needs `"type": "module"`.
4. **Scaffold command** — `npm create @quick-start/electron@latest`, not `npm create electron-vite@latest`.
5. **Notion OAuth** — Fixed port (e.g., 21337) must be pre-registered. Port 21337 is arbitrary but uncommon enough to avoid conflicts.
6. **Cosine similarity** — Runs inline in the main process. For ~2,000 chunks at 1536 dimensions, cosine sim takes ~10-15ms — fast enough without a worker thread. Can add a worker later if profiling shows it's needed at larger scale.
7. **Missing from PRD:** OAuth token refresh, embedding model mismatch detection, database migrations, chunk overlap, Content Security Policy.

## IPC API Surface

The preload context bridge exposes this typed API to the renderer:

```typescript
interface CommonsAPI {
  // Auth
  saveSecret(key: string, value: string): Promise<void>;
  loadSecret(key: string): Promise<string | null>;
  validateCohereKey(key: string): Promise<boolean>;
  checkOllama(): Promise<{ available: boolean; models: string[] }>;
  startNotionOAuth(): Promise<{ token: string; workspaceName: string }>;
  saveNotionToken(token: string): Promise<void>;
  startGoogleOAuth(): Promise<void>;

  // Sources
  listSources(): Promise<Source[]>;
  addSource(provider: string, config: SourceConfig): Promise<Source>;
  removeSource(id: string): Promise<void>;

  // Sync
  syncSource(sourceId: string): Promise<void>;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
  cancelSync(sourceId: string): Promise<void>;

  // Search
  search(query: string): Promise<SearchResult[]>;
  checkEmbeddingHealth(): Promise<EmbeddingHealth>;

  // App
  getStorageStats(): Promise<StorageStats>;
  clearAllData(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getEmbeddingProvider(): Promise<"cohere" | "ollama">;
  setEmbeddingProvider(provider: "cohere" | "ollama"): Promise<void>;
}
```

---

## Task 1: Project Scaffold + Database Layer

**Files:**

- Create: `package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/index.css`
- Create: `src/main/db/database.ts`, `src/main/db/migrations.ts`
- Create: `src/shared/types.ts`
- Test: `src/main/db/__tests__/database.test.ts`, `src/main/db/__tests__/migrations.test.ts`

**Interfaces:**

- Produces: `getDb(): BetterSqlite3.Database`, `runMigrations(db)`, typed query helpers (`insertSource`, `insertDocument`, `upsertChunks`, `getChunksBySourceId`, `upsertSetting`, `getSetting`, `deleteSource`)
- Produces: All shared TypeScript types (`Source`, `Document`, `Chunk`, `SyncProgress`, `SearchResult`, etc.)

**Steps:**

- [ ] **Step 1: Scaffold electron-vite project**

```bash
npm create @quick-start/electron@latest commons-app -- --template react-ts
cd commons-app
```

Verify `package.json` has `"type": "module"`. If not, add it.

- [ ] **Step 2: Install core dependencies**

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3 @electron/rebuild
```

Add to `package.json` scripts:

```json
"postinstall": "electron-rebuild"
```

- [ ] **Step 3: Configure Tailwind CSS v4**

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

In `electron.vite.config.ts`, add the Tailwind plugin to the renderer config only:

```typescript
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    /* ... */
  },
  preload: {
    /* ... */
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    // ...
  },
});
```

Replace contents of `src/renderer/src/index.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Install Coss UI**

```bash
pnpm dlx shadcn@latest add @coss/style
```

Follow prompts to configure. This sets up the CSS variables, color system (neutral), and dark mode (`.dark` class). Then add specific components as needed:

```bash
pnpm dlx shadcn@latest add @coss/ui/button @coss/ui/input @coss/ui/card
```

Configure fonts in `src/renderer/src/index.css` (add Inter import via CSS `@import` or `<link>` in `index.html`).

- [ ] **Step 5: Set Content Security Policy**

In `src/renderer/index.html`, add:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.cohere.com http://localhost:11434; font-src 'self' https://fonts.gstatic.com"
/>
```

- [ ] **Step 6: Write shared types**

Create `src/shared/types.ts` with all domain types:

```typescript
export interface Source {
  id: string;
  provider: "notion" | "google_drive";
  name: string;
  rootExternalId: string;
  createdAt: string;
}

export interface Document {
  id: string;
  sourceId: string;
  provider: string;
  externalId: string;
  title: string;
  url: string | null;
  mimeType: string | null;
  modifiedAt: string | null;
  contentHash: string | null;
  lastSyncedAt: string | null;
  syncStatus: "pending" | "synced" | "error";
}

export interface Chunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  embedding: Buffer | null;
  embeddingModel: string | null;
  tokenCount: number | null;
  createdAt: string;
}

export interface SearchResult {
  documentTitle: string;
  snippet: string;
  heading: string | null;
  url: string | null;
  provider: string;
  score: number;
}

export interface SyncProgress {
  sourceId: string;
  phase: "fetching" | "extracting" | "chunking" | "embedding" | "storing";
  current: number;
  total: number;
  currentDocTitle: string | null;
  errors: string[];
}

export interface EmbeddingHealth {
  provider: "cohere" | "ollama";
  model: string;
  mismatchedChunks: number;
  totalChunks: number;
}

export interface StorageStats {
  sourceCount: number;
  documentCount: number;
  chunkCount: number;
  dbSizeBytes: number;
}

export type SourceConfig =
  | { provider: "notion"; rootPageId: string; name: string }
  | { provider: "google_drive"; folderId: string; folderName: string };
```

- [ ] **Step 7: Write failing tests for database and migrations**

Create `src/main/db/__tests__/database.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations";
import {
  insertSource,
  getSourceById,
  deleteSource,
  insertDocument,
  getDocumentsBySourceId,
  upsertChunks,
  getChunksByDocumentId,
  upsertSetting,
  getSetting,
} from "../database";

describe("migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => db.close());

  it("creates all tables on fresh database", () => {
    runMigrations(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("sources");
    expect(names).toContain("documents");
    expect(names).toContain("chunks");
    expect(names).toContain("settings");
    expect(names).toContain("schema_version");
  });

  it("is idempotent — running twice does not error", () => {
    runMigrations(db);
    runMigrations(db);
  });

  it("cascades deletes from sources to documents and chunks", () => {
    runMigrations(db);
    insertSource(db, {
      id: "s1",
      provider: "notion",
      name: "Test",
      rootExternalId: "ext1",
      createdAt: new Date().toISOString(),
    });
    insertDocument(db, {
      id: "d1",
      sourceId: "s1",
      provider: "notion",
      externalId: "e1",
      title: "Doc 1",
      url: null,
      mimeType: null,
      modifiedAt: null,
      contentHash: null,
      lastSyncedAt: null,
      syncStatus: "synced",
    });
    upsertChunks(db, [
      {
        id: "c1",
        documentId: "d1",
        chunkIndex: 0,
        heading: null,
        text: "hello",
        embedding: null,
        embeddingModel: null,
        tokenCount: 1,
        createdAt: new Date().toISOString(),
      },
    ]);

    deleteSource(db, "s1");

    expect(getDocumentsBySourceId(db, "s1")).toHaveLength(0);
    expect(getChunksByDocumentId(db, "d1")).toHaveLength(0);
  });
});

describe("settings", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });
  afterEach(() => db.close());

  it("round-trips a setting value", () => {
    upsertSetting(db, "embedding_provider", "cohere");
    expect(getSetting(db, "embedding_provider")).toBe("cohere");
  });

  it("upserts existing setting", () => {
    upsertSetting(db, "key", "v1");
    upsertSetting(db, "key", "v2");
    expect(getSetting(db, "key")).toBe("v2");
  });
});
```

Run: `pnpm vitest run src/main/db/__tests__/database.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 8: Implement migrations**

Create `src/main/db/migrations.ts`:

```typescript
import type Database from "better-sqlite3";

interface Migration {
  version: number;
  statements: string[];
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
      `CREATE UNIQUE INDEX idx_documents_external ON documents(source_id, external_id)`,
    ],
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const current = db
    .prepare("SELECT MAX(version) as v FROM schema_version")
    .get() as {
    v: number | null;
  };
  const currentVersion = current?.v ?? 0;

  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      for (const sql of migration.statements) {
        db.exec(sql);
      }
      db.prepare(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(migration.version, new Date().toISOString());
    }
  });
  applyAll();
}
```

- [ ] **Step 9: Implement database query helpers**

Create `src/main/db/database.ts` with `getDb()` singleton and all query helpers. Key pattern:

```typescript
import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "node:path";
import { runMigrations } from "./migrations";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = join(app.getPath("userData"), "commons.db");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

export function insertSource(
  db: Database.Database,
  source: {
    id: string;
    provider: string;
    name: string;
    rootExternalId: string;
    createdAt: string;
  },
): void {
  db.prepare(
    "INSERT INTO sources (id, provider, name, root_external_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    source.id,
    source.provider,
    source.name,
    source.rootExternalId,
    source.createdAt,
  );
}

export function deleteSource(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM sources WHERE id = ?").run(id);
}

// ... remaining helpers follow same pattern for documents, chunks, settings
// insertDocument, getDocumentsBySourceId, upsertChunks, getChunksByDocumentId
// upsertSetting, getSetting, getAllSources, getDocumentByExternalId
// updateDocumentSyncStatus, getChunksWithEmbeddings
```

Implement `upsertChunks` as a transaction for batch insert:

```typescript
export function upsertChunks(db: Database.Database, chunks: ChunkRow[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO chunks (id, document_id, chunk_index, heading, text, embedding, embedding_model, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
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
        c.createdAt,
      );
    }
  });
  batch(chunks);
}
```

- [ ] **Step 10: Run tests, verify pass**

```bash
pnpm vitest run src/main/db/__tests__/database.test.ts
```

Expected: All tests PASS.

- [ ] **Step 11: Verify app launches**

```bash
pnpm run dev
```

Expected: Electron window opens with React content and Tailwind styles working.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with electron-vite, SQLite, Tailwind v4, and Coss UI"
```

---

## Task 2: Secure Storage + API Key Setup UI

**Files:**

- Create: `src/main/auth/storage.ts`
- Create: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts` — add context bridge
- Create: `src/renderer/src/pages/SetupPage.tsx`
- Create: `src/renderer/src/components/setup/ApiKeyForm.tsx`
- Create: `src/renderer/src/components/setup/OllamaOption.tsx`
- Modify: `src/renderer/src/App.tsx` — route to setup if no key
- Test: `src/main/auth/__tests__/storage.test.ts`

**Interfaces:**

- Consumes: `upsertSetting`, `getSetting` from Task 1
- Produces: `saveSecret(key, plaintext)`, `loadSecret(key): string | null`, `deleteSecret(key)`
- Produces: IPC channels `secrets:save`, `secrets:load`, `auth:validate-cohere`, `auth:check-ollama`

**Steps:**

- [ ] **Step 1: Write failing test for secure storage**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock safeStorage since tests don't run inside Electron
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptStringAsync: async (text: string) => Buffer.from(`enc:${text}`),
    decryptStringAsync: async (buf: Buffer) =>
      buf.toString().replace("enc:", ""),
  },
}));

import { saveSecret, loadSecret, deleteSecret } from "../storage";

describe("SecureStorage", () => {
  // Uses in-memory DB from test setup
  it("round-trips a secret", async () => {
    await saveSecret(db, "test_key", "my-secret");
    const result = await loadSecret(db, "test_key");
    expect(result).toBe("my-secret");
  });

  it("returns null for missing key", async () => {
    const result = await loadSecret(db, "nonexistent");
    expect(result).toBeNull();
  });

  it("deletes a secret", async () => {
    await saveSecret(db, "test_key", "my-secret");
    deleteSecret(db, "test_key");
    const result = await loadSecret(db, "test_key");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Implement secure storage**

```typescript
// src/main/auth/storage.ts
import { safeStorage } from "electron";
import type Database from "better-sqlite3";

export async function saveSecret(
  db: Database.Database,
  key: string,
  plaintext: string,
): Promise<void> {
  const encrypted = await safeStorage.encryptStringAsync(plaintext);
  const blob = Buffer.from(encrypted);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    blob.toString("base64"),
  );
}

export async function loadSecret(
  db: Database.Database,
  key: string,
): Promise<string | null> {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  const buf = Buffer.from(row.value, "base64");
  return safeStorage.decryptStringAsync(buf);
}

export function deleteSecret(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
```

- [ ] **Step 3: Set up IPC handlers and preload bridge**

`src/main/ipc/handlers.ts` — register all IPC handlers:

```typescript
import { ipcMain } from "electron";
import { CohereClientV2 } from "cohere-ai";
import { getDb } from "../db/database";
import { saveSecret, loadSecret, deleteSecret } from "../auth/storage";

export function registerIpcHandlers(): void {
  const db = getDb();

  ipcMain.handle("secrets:save", async (_, key: string, value: string) => {
    await saveSecret(db, key, value);
  });

  ipcMain.handle("secrets:load", async (_, key: string) => {
    return loadSecret(db, key);
  });

  ipcMain.handle("auth:validate-cohere", async (_, apiKey: string) => {
    try {
      const client = new CohereClientV2({ token: apiKey });
      await client.embed({
        model: "embed-v4.0",
        texts: ["test"],
        inputType: "search_query",
        embeddingTypes: ["float"],
      });
      return { valid: true };
    } catch {
      return { valid: false };
    }
  });

  ipcMain.handle("auth:check-ollama", async () => {
    try {
      const res = await fetch("http://localhost:11434/api/tags");
      if (!res.ok) return { available: false, models: [] };
      const data = await res.json();
      return {
        available: true,
        models: data.models?.map((m: any) => m.name) ?? [],
      };
    } catch {
      return { available: false, models: [] };
    }
  });
}
```

`src/preload/index.ts` — expose API to renderer:

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  saveSecret: (key: string, value: string) =>
    ipcRenderer.invoke("secrets:save", key, value),
  loadSecret: (key: string) => ipcRenderer.invoke("secrets:load", key),
  validateCohereKey: (key: string) =>
    ipcRenderer.invoke("auth:validate-cohere", key),
  checkOllama: () => ipcRenderer.invoke("auth:check-ollama"),
  // ... more channels added in later tasks
});
```

Call `registerIpcHandlers()` in `src/main/index.ts` after app ready.

- [ ] **Step 4: Build API key setup UI**

`SetupPage.tsx` with two paths: Cohere key input or Ollama option.
`ApiKeyForm.tsx`: paste input, "Validate" button, loading/success/error states.
`OllamaOption.tsx`: checks `window.api.checkOllama()`, shows available models or install prompt.

`App.tsx`: on mount, check `window.api.loadSecret('cohere_api_key')` and `window.api.loadSecret('embedding_provider')`. If neither exists, show `SetupPage`. Otherwise show main app shell.

- [ ] **Step 5: Run tests, verify app boots to setup screen**

```bash
pnpm vitest run src/main/auth/__tests__/storage.test.ts
pnpm run dev
```

Expected: Tests pass. App opens and shows the setup screen. Can paste a Cohere key, validate it, and proceed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add secure storage, IPC bridge, and API key setup UI"
```

---

## Task 3: Text Chunker

**Files:**

- Create: `src/main/search/chunker.ts`
- Test: `src/main/search/__tests__/chunker.test.ts`

**Interfaces:**

- Produces: `chunkText(text: string, title: string): ChunkData[]`
- `ChunkData = { index: number, heading: string | null, text: string, tokenCount: number }`

**Implementation details:**

1. Split text on heading patterns (`# `, `## `, `### `, etc., or `\n\n` double-newlines as fallback)
2. Each section becomes a chunk candidate
3. If a section exceeds 400 tokens, split at sentence boundaries (`. `, `? `, `! `)
4. Apply ~50-token overlap between split chunks (repeat last ~50 tokens of previous chunk at start of next)
5. Token estimation: `Math.ceil(text.split(/\s+/).length / 0.75)` (rough word-to-token ratio)
6. Skip empty chunks (whitespace-only after trimming)

**Steps:**

- [ ] **Step 1: Write failing tests**

Test cases: document with headings, flat document (no headings), single huge paragraph, empty string, document where one section exceeds max tokens.

```typescript
describe("chunkText", () => {
  it("splits on markdown headings", () => {
    const text = "# Intro\nHello world\n## Details\nMore info here";
    const chunks = chunkText(text, "Test Doc");
    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe("Intro");
    expect(chunks[1].heading).toBe("Details");
  });

  it("splits oversized sections at sentence boundaries with overlap", () => {
    const longText = Array(200).fill("This is a sentence.").join(" ");
    const chunks = chunkText(`# Big Section\n${longText}`, "Test");
    expect(chunks.length).toBeGreaterThan(1);
    // Verify overlap: end of chunk N appears at start of chunk N+1
    const endOfFirst = chunks[0].text.slice(-50);
    expect(chunks[1].text.startsWith(endOfFirst.trim())).toBe(true);
  });

  it("returns empty array for empty string", () => {
    expect(chunkText("", "Empty")).toHaveLength(0);
  });

  it("handles document with no headings", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = chunkText(text, "Flat Doc");
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement chunker**
- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add text chunker with heading-aware splitting and overlap"
```

---

## Task 4: Embedding Service

**Files:**

- Create: `src/main/search/embedder.ts`
- Test: `src/main/search/__tests__/embedder.test.ts`

**Interfaces:**

- Consumes: Cohere API key from secure storage
- Produces: `EmbedConfig = { provider: 'cohere' | 'ollama', apiKey?: string, ollamaModel?: string }`
- Produces: `embedDocuments(texts: string[], config: EmbedConfig): Promise<Float32Array[]>`
- Produces: `embedQuery(text: string, config: EmbedConfig): Promise<Float32Array>`
- Produces: `getEmbeddingModelName(config: EmbedConfig): string`
- Produces: `embeddingToBuffer(embedding: Float32Array): Buffer`, `bufferToEmbedding(buf: Buffer): Float32Array`

**Implementation details:**

Uses raw `fetch` for both Cohere and Ollama (no SDK dependency). All config is passed via an `EmbedConfig` object. Ollama model defaults to `nomic-embed-text` if not specified; the caller (sync manager) reads the user's preferred model from settings and passes it in.

Cohere path:

```typescript
async function embedWithCohere(
  texts: string[],
  inputType: "search_document" | "search_query",
  apiKey: string,
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  // Batch in groups of 96 (Cohere limit)
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96);
    const res = await fetch("https://api.cohere.com/v2/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "embed-v4.0",
        texts: batch,
        input_type: inputType,
        embedding_types: ["float"],
      }),
    });
    if (!res.ok)
      throw new Error(`Cohere embed failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const emb of data.embeddings.float) {
      results.push(new Float32Array(emb));
    }
  }
  return results;
}
```

Ollama path:

```typescript
async function embedWithOllama(
  texts: string[],
  model: string,
): Promise<Float32Array[]> {
  const res = await fetch("http://localhost:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok)
    throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.embeddings.map((e: number[]) => new Float32Array(e));
}
```

Float32Array → Buffer for SQLite storage:

```typescript
function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );
}

function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
```

**Steps:**

- [ ] **Step 1: Write failing tests** — mock `fetch`, test batch splitting at 96, test Float32Array ↔ Buffer round-trip, test Ollama HTTP call
- [ ] **Step 2: Implement embedder**
- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Manual test** — with a real Cohere key, embed a test string and verify 1536-dim output
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add embedding service with Cohere v4 and Ollama support"
```

---

## Task 5: Search Engine (Cosine Similarity + Rerank)

**Files:**

- Create: `src/main/search/searcher.ts` — orchestrates search pipeline with inline cosine similarity
- Create: `src/main/search/reranker.ts` — Cohere Rerank wrapper
- Modify: `src/main/db/database.ts` — add `getDocumentById()`
- Modify: `src/main/ipc/handlers.ts` — add `search:query` channel
- Modify: `src/preload/index.ts`, `src/preload/index.d.ts` — add `search` to preload bridge
- Test: `src/main/search/__tests__/searcher.test.ts`, `src/main/search/__tests__/reranker.test.ts`

**Interfaces:**

- Consumes: `getChunksWithEmbeddings()` from Task 1, `getDocumentById()` from Task 1, `embedQuery()` + `bufferToEmbedding()` from Task 4
- Produces: `search(db, query, embedConfig, cohereApiKey?): Promise<SearchResult[]>`

**Implementation details:**

Cosine similarity (inline in `searcher.ts`, no worker thread):

```typescript
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

Searcher orchestration:

1. Embed query via `embedQuery(query, embedConfig)`
2. Load all chunk embeddings from DB via `getChunksWithEmbeddings(db)`
3. Compute cosine similarity inline, get top 40
4. If `cohereApiKey` provided: rerank top 40 → return top 8
5. If no Cohere key (Ollama-only): return top 8 from cosine similarity directly
6. Look up document metadata via `getDocumentById()` for each result
7. Map to `SearchResult[]`

Reranker (`reranker.ts`) — raw `fetch`, no SDK:

```typescript
export async function rerank(
  query: string,
  candidates: { id: string; text: string }[],
  apiKey: string,
  topN = 8,
): Promise<{ id: string; score: number }[]> {
  const res = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "rerank-v3.5",
      query,
      documents: candidates.map((c) => c.text),
      top_n: topN,
    }),
  });
  if (!res.ok)
    throw new Error(`Cohere rerank failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.results.map((r: { index: number; relevance_score: number }) => ({
    id: candidates[r.index].id,
    score: r.relevance_score,
  }));
}
```

IPC handler (`search:query`):

```typescript
ipcMain.handle("search:query", async (_, query: string) => {
  const provider = (getSetting(db, "embedding_provider") ?? "cohere") as
    | "cohere"
    | "ollama";
  const cohereApiKey = loadSecret(db, "cohere_api_key");
  const embedConfig: EmbedConfig = {
    provider,
    apiKey: cohereApiKey ?? undefined,
  };
  return search(db, query, embedConfig, cohereApiKey ?? undefined);
});
```

**Steps:**

- [ ] **Step 1: Add `getDocumentById()` to database.ts**
- [ ] **Step 2: Write failing tests** — test cosine similarity with known vectors, test reranker mock, test full search pipeline with seeded in-memory DB
- [ ] **Step 3: Implement reranker**
- [ ] **Step 4: Implement searcher orchestration** (cosine similarity inline, no worker)
- [ ] **Step 5: Add IPC handler + preload bridge** — `search:query` channel, `search()` on `CommonsAPI`
- [ ] **Step 6: Run tests, verify pass**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add search engine with cosine similarity and Cohere reranking"
```

---

## Task 6: Search UI

**Files:**

- Create: `src/renderer/src/pages/SearchPage.tsx`
- Create: `src/renderer/src/components/search/SearchInput.tsx`
- Create: `src/renderer/src/components/search/ResultCard.tsx`
- Create: `src/renderer/src/components/search/EmptyState.tsx`
- Modify: `src/renderer/src/App.tsx` — add search page route

**Interfaces:**

- Consumes: `window.api.search(query)` IPC channel from Task 5

**Implementation details:**

- `SearchInput`: text input with submit on Enter, loading spinner during search, debounce not needed (manual submit)
- `ResultCard`: shows document title, heading (if present), text snippet (first ~200 chars), provider badge (Notion/Drive icon), relevance score as subtle indicator, "Open source" button calling `window.api.openExternal(url)`
- `EmptyState`: grid of example question chips ("How do I get reimbursed?", "What does a tech lead do?", "Where are onboarding docs?", "How do we deploy?"). Clicking a chip fills the search input and submits.
- Loading state: skeleton cards while searching
- No results state: "No results found. Try a different question or sync more docs."

**Steps:**

- [ ] **Step 1: Build EmptyState component**
- [ ] **Step 2: Build ResultCard component**
- [ ] **Step 3: Build SearchInput component**
- [ ] **Step 4: Build SearchPage** — composes the above, manages state
- [ ] **Step 5: Wire into App.tsx** — show SearchPage after setup is complete
- [ ] **Step 6: Seed test data and manually verify** — insert sample chunks via DB, search, confirm results appear
- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add search UI with results, empty state, and example questions"
```

---

## Task 7: Sync Manager

**Files:**

- Create: `src/main/sync/sync-manager.ts`
- Create: `src/main/ipc/sync-handlers.ts`
- Modify: `src/preload/index.ts` — add sync IPC channels
- Test: `src/main/sync/__tests__/sync-manager.test.ts`

**Interfaces:**

- Consumes: `chunkText()` from Task 3, `embedDocuments(texts, config)` / `getEmbeddingModelName(config)` / `embeddingToBuffer()` from Task 4, `upsertChunks()` / `insertDocument()` from Task 1
- Consumes: Connector interface (produced by Tasks 8, 9): `{ fetchDocuments(): AsyncGenerator<RawDocument> }`
- Produces: `syncSource(sourceId: string, connector: Connector, onProgress: (p: SyncProgress) => void): Promise<void>`

**Implementation details:**

```typescript
export interface RawDocument {
  externalId: string;
  title: string;
  url: string | null;
  mimeType: string | null;
  modifiedAt: string | null;
  content: string;
}

export interface Connector {
  fetchDocuments(): AsyncGenerator<RawDocument>;
}

export async function syncSource(
  db: Database.Database,
  sourceId: string,
  connector: Connector,
  embedConfig: EmbedConfig,
  onProgress: (p: SyncProgress) => void,
): Promise<void> {
  const errors: string[] = [];
  let current = 0;

  for await (const rawDoc of connector.fetchDocuments()) {
    current++;
    onProgress({
      sourceId,
      phase: "fetching",
      current,
      total: 0,
      currentDocTitle: rawDoc.title,
      errors,
    });

    // Check content hash — skip unchanged docs
    const contentHash = createHash("sha256")
      .update(rawDoc.content)
      .digest("hex");
    const existing = getDocumentByExternalId(db, sourceId, rawDoc.externalId);
    if (existing?.contentHash === contentHash) continue;

    // Upsert document
    const docId = existing?.id ?? crypto.randomUUID();
    insertDocument(db, {
      ...rawDoc,
      id: docId,
      sourceId,
      contentHash,
      syncStatus: "pending",
    });

    try {
      // Chunk
      onProgress({ ...progress, phase: "chunking" });
      const chunks = chunkText(rawDoc.content, rawDoc.title);

      // Embed
      onProgress({ ...progress, phase: "embedding" });
      const embeddings = await embedDocuments(
        chunks.map((c) => c.text),
        embedConfig,
      );

      // Store
      onProgress({ ...progress, phase: "storing" });
      const modelName = getEmbeddingModelName(embedConfig);
      deleteChunksByDocumentId(db, docId);
      upsertChunks(
        db,
        chunks.map((c, i) => ({
          id: crypto.randomUUID(),
          documentId: docId,
          chunkIndex: c.index,
          heading: c.heading,
          text: c.text,
          embedding: embeddingToBuffer(embeddings[i]),
          embeddingModel: modelName,
          tokenCount: c.tokenCount,
          createdAt: new Date().toISOString(),
        })),
      );

      updateDocumentSyncStatus(db, docId, "synced");
    } catch (err) {
      errors.push(
        `${rawDoc.title}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      updateDocumentSyncStatus(db, docId, "error");
    }
  }
}
```

IPC handler pushes progress via `webContents.send()`:

```typescript
ipcMain.handle("sync:start", async (event, sourceId: string) => {
  const connector = getConnectorForSource(db, sourceId); // resolves to Notion or Drive connector
  const embedConfig = buildEmbedConfig(db); // reads provider + API key from settings/secrets
  await syncSource(db, sourceId, connector, embedConfig, (progress) => {
    event.sender.send("sync:progress", progress);
  });
});
```

**Steps:**

- [ ] **Step 1: Write failing tests** — mock connector that yields test documents, verify chunks are created with embeddings, verify unchanged docs are skipped via content hash, verify error recovery
- [ ] **Step 2: Implement sync manager**
- [ ] **Step 3: Wire IPC handlers**
- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add sync manager with content hashing and error recovery"
```

---

## Task 8: Notion Connector

**Files:**

- Create: `src/main/auth/notion-oauth.ts`
- Create: `src/main/connectors/notion.ts`
- Modify: `src/main/ipc/handlers.ts` — add Notion auth channels
- Modify: `src/preload/index.ts` — expose Notion auth
- Test: `src/main/connectors/__tests__/notion.test.ts`

**Interfaces:**

- Consumes: `saveSecret()` / `loadSecret()` from Task 2
- Produces: `NotionConnector` implementing `Connector` interface from Task 7
- Produces: IPC channels: `auth:notion-oauth-start`, `auth:notion-paste-token`

**Implementation details:**

OAuth flow (`notion-oauth.ts`):

1. Start HTTP server on fixed port 21337
2. Open system browser: `https://api.notion.com/v1/oauth/authorize?client_id=...&redirect_uri=http://localhost:21337/callback&response_type=code&owner=user`
3. Server receives callback with `code` param
4. Exchange code for token: `POST https://api.notion.com/v1/oauth/token` with Basic auth (client_id:client_secret)
5. Store token via `saveSecret(db, 'notion_token', token)`
6. Close HTTP server
7. Return workspace name from the token response

Paste-token fallback: user pastes internal integration token directly, stored the same way.

Connector (`notion.ts`):

```typescript
import { Client } from "@notionhq/client";

export class NotionConnector implements Connector {
  private client: Client;
  private rootPageId: string;

  constructor(token: string, rootPageId: string) {
    this.client = new Client({ auth: token });
    this.rootPageId = rootPageId;
  }

  async *fetchDocuments(): AsyncGenerator<RawDocument> {
    yield* this.walkPage(this.rootPageId, 0);
  }

  private async *walkPage(
    pageId: string,
    depth: number,
  ): AsyncGenerator<RawDocument> {
    if (depth > 10) return; // max depth guard

    const page = await this.client.pages.retrieve({ page_id: pageId });
    const title = extractPageTitle(page);
    const url = (page as any).url ?? null;

    const blocks = await this.fetchAllBlocks(pageId);
    const content = blocksToText(blocks);

    if (content.trim()) {
      yield {
        externalId: pageId,
        title,
        url,
        mimeType: "text/plain",
        modifiedAt: (page as any).last_edited_time ?? null,
        content,
      };
    }

    // Recurse into child pages
    for (const block of blocks) {
      if (block.type === "child_page") {
        yield* this.walkPage(block.id, depth + 1);
      }
      if (block.type === "child_database") {
        yield* this.walkDatabase(block.id, depth + 1);
      }
    }
  }

  private async fetchAllBlocks(blockId: string): Promise<Block[]> {
    const blocks: Block[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.rateLimited(() =>
        this.client.blocks.children.list({
          block_id: blockId,
          start_cursor: cursor,
          page_size: 100,
        }),
      );
      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor! : undefined;
    } while (cursor);
    return blocks;
  }
}
```

Block-to-text conversion — handle: paragraph, headings (h1/h2/h3), bulleted_list_item, numbered_list_item, toggle, callout, code, table, quote. Skip: image, video, embed, file, bookmark.

Rate limiting: simple queue with 3 req/sec limit and exponential backoff on 429:

```typescript
private async rateLimited<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  await this.throttle() // ensures 333ms between calls
  try {
    return await fn()
  } catch (err: any) {
    if (err.status === 429 && retries > 0) {
      const delay = Math.pow(2, 3 - retries) * 1000
      await new Promise(r => setTimeout(r, delay))
      return this.rateLimited(fn, retries - 1)
    }
    throw err
  }
}
```

**Steps:**

- [ ] **Step 1: Write failing tests** — mock @notionhq/client, test block-to-text conversion for each block type, test pagination, test rate limit retry, test depth guard
- [ ] **Step 2: Implement `blocksToText` conversion**
- [ ] **Step 3: Implement `NotionConnector` with recursive walking**
- [ ] **Step 4: Implement OAuth flow and paste-token flow**
- [ ] **Step 5: Wire IPC handlers**
- [ ] **Step 6: Run tests, verify pass**
- [ ] **Step 7: Manual test** — connect a real Notion workspace, sync a page, verify content appears in DB
- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add Notion connector with OAuth, recursive page walking, and rate limiting"
```

---

## Task 9: Google Drive Connector

**Files:**

- Create: `src/main/auth/google-oauth.ts`
- Create: `src/main/connectors/drive.ts`
- Modify: `src/main/ipc/handlers.ts` — add Drive auth channels
- Modify: `src/preload/index.ts` — expose Drive auth
- Test: `src/main/connectors/__tests__/drive.test.ts`

**Interfaces:**

- Consumes: `saveSecret()` / `loadSecret()` from Task 2
- Produces: `DriveConnector` implementing `Connector` interface from Task 7
- Produces: IPC channels: `auth:google-oauth-start`

**Implementation details:**

OAuth flow (`google-oauth.ts`):

```typescript
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import http from "node:http";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const REDIRECT_PORT = 21338;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export async function startGoogleOAuth(
  clientId: string,
  clientSecret: string,
): Promise<OAuth2Client> {
  const client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force refresh token
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      if (!code) {
        reject(new Error("No code"));
        return;
      }

      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Connected! You can close this tab.</h1>");
      server.close();

      resolve(client);
    });
    server.listen(REDIRECT_PORT);
    shell.openExternal(authUrl);
  });
}
```

Token refresh — store `{ access_token, refresh_token, expiry_date }` encrypted. Before each API call:

```typescript
async function getAuthenticatedClient(
  db: Database.Database,
): Promise<OAuth2Client> {
  const tokensJson = await loadSecret(db, "google_tokens");
  if (!tokensJson) throw new Error("Not authenticated with Google");
  const tokens = JSON.parse(tokensJson);
  const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  client.setCredentials(tokens);

  // Refresh if expired or expiring within 5 minutes
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 300_000) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    await saveSecret(db, "google_tokens", JSON.stringify(credentials));
  }

  return client;
}
```

Connector (`drive.ts`):

```typescript
export class DriveConnector implements Connector {
  private drive: drive_v3.Drive;
  private folderId: string;

  constructor(auth: OAuth2Client, folderId: string) {
    this.drive = google.drive({ version: "v3", auth });
    this.folderId = folderId;
  }

  async *fetchDocuments(): AsyncGenerator<RawDocument> {
    yield* this.walkFolder(this.folderId);
  }

  private async *walkFolder(folderId: string): AsyncGenerator<RawDocument> {
    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
        pageSize: 100,
        pageToken,
      });

      for (const file of res.data.files ?? []) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          yield* this.walkFolder(file.id!);
          continue;
        }

        const content = await this.extractContent(file);
        if (!content) continue;

        yield {
          externalId: file.id!,
          title: file.name!,
          url: file.webViewLink ?? null,
          mimeType: file.mimeType ?? null,
          modifiedAt: file.modifiedTime ?? null,
          content,
        };
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  private async extractContent(
    file: drive_v3.Schema$File,
  ): Promise<string | null> {
    const mime = file.mimeType!;

    if (mime === "application/vnd.google-apps.document") {
      const res = await this.drive.files.export({
        fileId: file.id!,
        mimeType: "text/plain",
      });
      return res.data as string;
    }

    if (mime === "application/pdf") {
      const res = await this.drive.files.get(
        { fileId: file.id!, alt: "media" },
        { responseType: "arraybuffer" },
      );
      const pdf = await import("pdf-parse");
      const parsed = await pdf.default(Buffer.from(res.data as ArrayBuffer));
      return parsed.text;
    }

    if (
      mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const res = await this.drive.files.get(
        { fileId: file.id!, alt: "media" },
        { responseType: "arraybuffer" },
      );
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(res.data as ArrayBuffer),
      });
      return result.value;
    }

    if (mime === "text/plain" || mime === "text/markdown") {
      const res = await this.drive.files.get({
        fileId: file.id!,
        alt: "media",
      });
      return res.data as string;
    }

    return null; // unsupported file type
  }
}
```

Drive folder URL parsing:

```typescript
export function extractFolderIdFromUrl(url: string): string | null {
  // Handles: https://drive.google.com/drive/folders/FOLDER_ID
  // and: https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}
```

Edge cases:

- Files > 50MB: skip with warning logged
- PDF > 100 pages: pdf-parse handles this fine in memory for typical club docs, but add a 200-page safety limit
- Token refresh failure (refresh token revoked): catch, delete stored tokens, surface "Reconnect Google Drive" in UI

**Steps:**

- [ ] **Step 1: Write failing tests** — test folder URL parsing, mock googleapis for file listing, test content extraction dispatch by MIME type, test token refresh logic
- [ ] **Step 2: Implement `extractFolderIdFromUrl`**
- [ ] **Step 3: Implement `DriveConnector` with recursive folder walking**
- [ ] **Step 4: Implement Google OAuth flow with token refresh**
- [ ] **Step 5: Wire IPC handlers**
- [ ] **Step 6: Run tests, verify pass**
- [ ] **Step 7: Manual test** — connect Google Drive, paste a folder URL, sync, verify PDFs/Docs are indexed
- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add Google Drive connector with OAuth, folder walking, and file parsing"
```

---

## Task 10: Source Management UI

**Files:**

- Create: `src/renderer/src/pages/SourcesPage.tsx`
- Create: `src/renderer/src/components/sources/SourceList.tsx`
- Create: `src/renderer/src/components/sources/ConnectNotionButton.tsx`
- Create: `src/renderer/src/components/sources/ConnectDriveButton.tsx`
- Create: `src/renderer/src/components/sources/DriveFolderInput.tsx`
- Create: `src/renderer/src/components/sources/NotionPicker.tsx`
- Create: `src/renderer/src/components/sync/SyncPanel.tsx`
- Modify: `src/renderer/src/App.tsx` — add sources/sync navigation

**Interfaces:**

- Consumes: `window.api.listSources()`, `window.api.addSource()`, `window.api.removeSource()`, `window.api.syncSource()`, `window.api.onSyncProgress()`

**Implementation details:**

Main layout: sidebar navigation with Search / Sources / Settings tabs.

`SourcesPage`:

- Top: "Connect a source" section with Notion and Drive buttons
- Below: list of connected sources as cards
- Each card shows: provider icon, name, doc count, last synced time, "Sync" button, "Disconnect" button (with confirmation dialog)

`ConnectNotionButton`: triggers OAuth flow or shows paste-token modal. After auth, shows a page/database selector (simplified: user pastes the Notion page URL, app extracts the page ID).

`DriveFolderInput`: text input for pasting Drive folder URL. Validates format, extracts folder ID, shows folder name from API.

`SyncPanel`: shown during sync. Listens to `sync:progress` events. Shows:

- Current phase (Fetching → Chunking → Embedding → Storing)
- Progress bar (current / total docs)
- Current document name
- Error list (collapsible)
- "Retry failed" button after sync completes with errors

**Steps:**

- [ ] **Step 1: Build SourceList component**
- [ ] **Step 2: Build ConnectNotionButton + NotionPicker**
- [ ] **Step 3: Build ConnectDriveButton + DriveFolderInput**
- [ ] **Step 4: Build SyncPanel with progress tracking**
- [ ] **Step 5: Build SourcesPage, compose above**
- [ ] **Step 6: Add navigation to App.tsx** — sidebar with Search / Sources / Settings
- [ ] **Step 7: Manual end-to-end test** — connect Notion, connect Drive, sync both, search across both
- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add source management UI with connect, sync, and disconnect flows"
```

---

## Task 11: Polish + Error Handling

**Files:**

- Create: `src/renderer/src/pages/SettingsPage.tsx`
- Create: `src/renderer/src/components/ui/ErrorBanner.tsx`
- Create: `src/renderer/src/components/setup/OnboardingWizard.tsx`
- Modify: various existing components — add loading states, error states, empty states

**Interfaces:**

- Consumes: all existing IPC channels
- Produces: `window.api.getStorageStats()`, `window.api.clearAllData()`

**Implementation details:**

Settings page:

- Change/remove Cohere API key (re-validate on change)
- Switch embedding provider (Cohere ↔ Ollama) with warning: "Switching providers requires re-embedding all documents"
- "Re-embed all documents" button (triggers re-sync of all sources)
- Storage stats: source count, doc count, chunk count, DB file size
- "Clear all data" with confirmation dialog (wipes DB tables, not the DB file)

Embedding model mismatch handling:

- `checkEmbeddingHealth()` IPC channel: queries chunks table, counts distinct `embedding_model` values, returns warning if mismatched
- Show banner on SearchPage if mismatch detected: "Some documents were embedded with a different model. Results may be less accurate. Re-sync to fix."

Error handling:

- Cohere API unreachable: search falls back to cosine-sim only, banner: "Reranking unavailable — results may be less accurate"
- OAuth token expired: inline "Reconnect" button on the source card
- Invalid API key: redirect to setup page
- Network errors during sync: per-document error tracking, "Retry failed" button

Onboarding wizard:

- Step 1: Welcome screen ("Commons — Search your club's docs")
- Step 2: API key or Ollama setup
- Step 3: Connect at least one source
- Step 4: Sync
- Step 5: Try a search
- Progress indicator (dots or step count)
- Can skip steps and come back later

Loading states: skeleton loaders for search results, source list. Subtle spinner for sync button.

**Steps:**

- [ ] **Step 1: Build SettingsPage**
- [ ] **Step 2: Build ErrorBanner component**
- [ ] **Step 3: Implement embedding health check**
- [ ] **Step 4: Add graceful degradation for Cohere unavailability**
- [ ] **Step 5: Build OnboardingWizard**
- [ ] **Step 6: Add loading/empty states to all pages**
- [ ] **Step 7: Full manual walkthrough** — fresh install experience, connect sources, sync, search, disconnect, change settings
- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add settings, onboarding wizard, error handling, and loading states"
```

---

## Task 12: Packaging + Distribution

**Files:**

- Create: `forge.config.ts` — electron-forge configuration (replaces `electron-builder.yml`)
- Modify: `package.json` — `main` field → `./dist/main/index.js`, replace build scripts with forge commands
- Modify: `electron.vite.config.ts` — set `build.outDir` per-target to `dist/`, externalize `better-sqlite3`
- Modify: `src/main/index.ts` — add `electron-squirrel-startup` handler for Windows
- Modify: `pnpm-workspace.yaml` — add `nodeLinker: hoisted` (required by electron-forge)
- Create: `.npmrc` — `node-linker=hoisted`
- Delete: `electron-builder.yml` — replaced by `forge.config.ts`

**Interfaces:**

- Consumes: built app from electron-vite (output in `dist/`)

**Implementation details:**

The project uses `electron-forge` for packaging with `electron-vite` handling the build step. electron-vite outputs to `dist/` (not `out/`) so forge can use `out/` for its packaging output. The `forge.config.ts` configures:

- `packagerConfig`: app identity (`com.commons.app`), icons (`./build/icon`), asar unpacking for `resources/`, macOS entitlements and code signing, `ignore` function to exclude source files
- `rebuildConfig`: rebuilds `better-sqlite3` for Electron's Node version
- Makers: `maker-dmg` (macOS), `maker-zip` (macOS fallback), `maker-squirrel` (Windows — per-user install, no admin required)
- Plugins: `plugin-auto-unpack-natives` (unpacks `.node` binaries from asar)

Build flow:

1. `pnpm run build` (electron-vite builds main + preload + renderer to `dist/`)
2. `pnpm run make:mac` or `pnpm run make:win` (electron-forge packages into installers in `out/make/`)

**Steps:**

- [ ] **Step 1: Verify forge.config.ts** — check signing, entitlements, makers, ignore function
- [ ] **Step 2: Create app icons** (placeholder is fine for MVP)
- [ ] **Step 3: Build on macOS** — `pnpm run make:mac`, verify DMG installs and app launches
- [ ] **Step 4: Build on Windows** — `pnpm run make:win`, verify Squirrel installer works (or note as TODO if no Windows machine available)
- [ ] **Step 5: Upload to GitHub Releases with version tag**
- [ ] **Step 6: Write minimal README** — setup instructions (get Cohere key, connect sources, sync, search)
- [ ] **Step 7: Commit**

```bash
git commit -m "feat: configure electron-forge packaging for macOS DMG and Windows Squirrel"
```

---

## Verification Plan

### Per-task verification

Each task has its own test suite (unit tests via Vitest) and manual verification steps noted in the task.

### End-to-end verification (after all tasks complete)

1. **Clean install test:** Build the DMG, install on a fresh macOS machine (or clean user account). The app should launch, show the onboarding wizard, and guide through setup.

2. **Cohere path:** Paste a real Cohere API key → validate succeeds → connect a Notion workspace with club docs → connect a Google Drive folder with PDFs/Docs → sync both sources → search "how do I get reimbursed?" → get relevant results with source links → click "Open source" → browser opens to the correct Notion page or Drive file.

3. **Ollama path:** Choose Ollama mode (with Ollama running locally) → connect sources → sync → search. Verify results appear but without reranking (cosine sim only).

4. **Error scenarios:**
   - Disconnect WiFi mid-sync → verify partial sync is recoverable, "Retry failed" works
   - Paste an invalid Cohere key → error shown, not stored
   - Revoke Notion token → next sync shows "Reconnect" prompt
   - Close Ollama → search still works (no reranking), embed calls fail gracefully

5. **Edge cases:**
   - Sync a large Notion workspace (50+ pages) → verify rate limiting works, no 429 errors
   - Sync a Drive folder with PDFs, DOCX, TXT, Google Docs → all parsed correctly
   - Search with no indexed docs → empty state shown
   - Disconnect a source → cascaded deletion confirmed (doc count drops to 0)

6. **Performance:** With ~2,000 chunks indexed, search should return results in <2 seconds (embed query + cosine sim + rerank).

---

## Prerequisites (not implementation tasks)

These setup steps must be done before development begins but are not part of the code plan:

1. **Notion public integration:** Create at https://notion.so/my-integrations. Set redirect URI to `http://localhost:21337/callback`. Note the client ID and client secret.

2. **Google Cloud project:** Create at console.cloud.google.com. Enable Google Drive API. Configure OAuth consent screen (external, testing mode). Add redirect URI `http://localhost:21338/callback`. Note client ID and client secret.

3. **Cohere account:** Create at cohere.com. Get an API key (trial or production).

4. **Client secrets storage:** Store Notion and Google client IDs/secrets as environment variables or in a `.env` file (gitignored). These are build-time secrets, not user secrets.

---

## Open Questions

1. **Google OAuth app verification timeline:** `drive.readonly` is a sensitive scope. For >100 users, Google requires app verification (2-6 weeks). Plan to submit early in Week 4 if targeting wider distribution.

2. **Notion workspace discovery:** The current plan has users paste a page URL to select their root page. A better UX would be to list the user's pages after OAuth and let them select. The Notion API's `search` endpoint can list accessible pages. Consider this as a fast-follow enhancement.

3. **Ollama model selection:** The plan defaults to `nomic-embed-text` for Ollama embeddings. Different models produce different dimensions. The `embedding_model` column handles this, but the UI should let users pick from installed models (already supported via the `auth:check-ollama` channel).
