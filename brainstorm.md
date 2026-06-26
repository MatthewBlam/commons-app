# ClubBrain Brainstorming

## 1. Product Goal

Build a simple Electron desktop app that lets Cal Poly clubs connect their club-specific Notion workspace/pages and Google Drive folder, index those docs locally, and ask questions in a chat interface.

The app should be:

- Local-first
- Simple to set up
- No hosted backend required
- Bring-your-own Cohere API key
- Free or low-cost depending on the user's Cohere usage
- Focused only on selected club docs, not an entire personal Notion or Drive account

Working product concept:

> Connect your club's Notion and Google Drive docs. Ask questions across onboarding guides, project specs, meeting notes, policies, and resources. Get answers with source links.

---

## 2. MVP Summary

### Core MVP

```text
Electron app
  -> User pastes their own Cohere API key
  -> User connects Notion and/or Google Drive
  -> User selects a specific Notion workspace/page/database and Drive folder
  -> App syncs selected docs locally
  -> App chunks and embeds documents
  -> User asks a question in chat
  -> App retrieves relevant chunks
  -> Cohere Rerank improves relevance
  -> App shows best sources and optionally generates an answer
```

### Key Constraint

The app should only index user-selected club spaces:

- A selected Notion page, database, or shared workspace area
- A selected Google Drive folder

It should not ask for broad access to a user's entire account unless absolutely necessary.

---

## 3. Recommended Architecture

```text
Notion API + Google Drive API
        ↓
Electron sync process
        ↓
Text extraction + chunking
        ↓
SQLite local database
        ↓
Cohere Embed for document chunks
        ↓
User question
        ↓
Cohere Embed for query
        ↓
Local vector search
        ↓
Cohere Rerank over top candidates
        ↓
Top source snippets
        ↓
Optional local/free model answer generation
```

### Main Design Choice

Use Cohere primarily for retrieval quality:

- **Cohere Embed**: create embeddings for chunks and user queries
- **Cohere Rerank**: rank the best retrieved chunks
- **Avoid Cohere Command by default** to reduce usage/cost

For answer generation, support either:

1. Search-results-only mode
2. Local Ollama model
3. Optional Cohere Command mode later

---

## 4. User Flow

### First-Time Setup

```text
Step 1: Add Cohere API key
Step 2: Choose answer mode
Step 3: Connect Notion
Step 4: Connect Google Drive
Step 5: Select docs/folders to index
Step 6: Sync docs
Step 7: Ask questions
```

### Step 1: Cohere Key Setup

The app should include a simple on-screen guide:

```text
1. Go to Cohere and create an account.
2. Create an API key.
3. Paste your API key here.
4. Trial keys are free but rate-limited.
5. Production keys are pay-as-you-go.
```

The app should not include a shared Cohere key. Each club/user brings their own key.

### Step 2: Answer Mode

Provide three options:

```text
Answer mode:
[ ] Search results only
[x] Local Ollama model
[ ] Cohere Command
```

Recommended default for MVP:

- Start with **Search results only** as the safest fallback.
- Add **Ollama** for free local answer generation.
- Keep **Cohere Command** as an optional advanced setting.

### Step 3: Connect Notion

The user connects Notion and selects/shares only the relevant club docs area.

The app indexes:

- Pages
- Child pages
- Databases
- Database pages
- Paragraphs
- Headings
- Bullets
- Toggles
- Callouts
- Tables, if simple enough

Skip for MVP:

- Comments
- Page history
- Advanced relations
- Notion write/edit features

### Step 4: Connect Google Drive

The user connects Google Drive and selects a specific club folder.

Recommended UX:

```text
Connect Google Drive
  -> Open Google Picker
  -> User selects club folder
  -> App recursively indexes files in that folder
```

Support for MVP:

- Google Docs export to text or HTML
- Markdown
- TXT
- PDF
- DOCX

Skip for MVP:

- Sheets parsing beyond basic export
- Slides parsing unless easy
- Images without text
- Comments and suggestions

---

## 5. Retrieval Flow

When a user asks a question:

```text
1. Embed the question using Cohere Embed
2. Search local chunk embeddings in SQLite
3. Select top 30-50 candidate chunks
4. Send candidates to Cohere Rerank
5. Keep top 5-8 chunks
6. Show source snippets
7. Optionally generate a final answer using Ollama or another model
```

### Recommended MVP Behavior

Start by returning source-backed results before generating an answer:

```text
Best matches:
1. Reimbursement Policy - Notion
   "Submit receipts within 14 days..."
   Open source

2. Treasurer Onboarding - Google Drive
   "All purchases over $50 require approval..."
   Open source

3. Officer FAQ - Notion
   "Email the treasurer before making purchases..."
   Open source
```

Then add a button:

```text
Generate answer from these sources
```

This reduces hallucinations and keeps the app useful even without a local LLM installed.

---

## 6. Free Model Options Instead of Cohere Command

### Recommended: Ollama

Use Ollama for local answer generation.

Electron can check whether Ollama is running at:

```text
http://localhost:11434
```

The app can send the top retrieved chunks to a local model and ask it to answer only using those sources.

### Suggested Local Models

| Model | Why Use It |
|---|---|
| `llama3.2:3b` | Good lightweight default for laptops |
| `gemma3:4b` | Good small model option |
| `qwen2.5:7b` | Stronger quality if hardware can handle it |
| `mistral:7b` | Solid general local model |
| `phi4-mini` | Lightweight model for constrained machines |

### Local Model Prompt Pattern

```text
You are answering a question using only the provided club documentation snippets.

Rules:
- If the answer is not in the snippets, say you could not find it.
- Cite the source title for every claim.
- Keep the answer concise and helpful.

Question:
{question}

Sources:
{top_chunks}
```

### MVP Fallback

If Ollama is not installed:

```text
Ollama was not detected. You can still use search-results-only mode, or install Ollama to generate full answers locally.
```

---

## 7. Cost Strategy

### Free or Low-Cost Approach

The app itself has no backend hosting cost.

Users supply their own Cohere API key, so costs depend on their usage.

### Cost-Minimizing Design

Use Cohere only for:

1. Embedding new or changed document chunks during sync
2. Embedding each user question
3. Reranking a limited set of candidate chunks

Avoid sending every full document to Cohere repeatedly.

### Important Cost Controls

- Cache embeddings locally
- Only re-embed changed docs
- Use manual sync first, not live sync
- Limit rerank candidates to top 30-50 chunks
- Provide search-results-only mode
- Use local Ollama for generation

---

## 8. Local Storage

Use SQLite for the local database.

### Recommended Tables

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- notion | google_drive
  name TEXT NOT NULL,
  root_external_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  modified_at TEXT,
  content_hash TEXT,
  last_synced_at TEXT
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  embedding BLOB,
  token_count INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Token and Key Storage

Do not store API keys or OAuth tokens as plain text in SQLite.

Use OS keychain storage:

- macOS Keychain
- Windows Credential Manager
- Linux Secret Service

In Electron, use `keytar` or a similar secure storage package.

---

## 9. Vector Search Options

### MVP Option: Brute Force Cosine Similarity

For a small club doc set, brute force search over embeddings stored in SQLite is likely fine.

Good for:

- Fast implementation
- A few thousand chunks
- MVP demo

### Better Local Option: sqlite-vec

Use `sqlite-vec` when scaling beyond a small prototype.

Good for:

- Keeping everything inside SQLite
- Faster vector search
- Local-first architecture

### Alternative: LanceDB

Use LanceDB only if SQLite vector search becomes painful.

---

## 10. Sync Strategy

Use manual sync first.

```text
User clicks "Sync now"
  -> App fetches metadata
  -> App checks modified time or content hash
  -> Unchanged docs are skipped
  -> Changed docs are extracted, chunked, embedded, and stored
```

### Why Manual Sync First

- Easier to implement
- Avoids rate limit issues
- Reduces Cohere usage
- Gives user control
- Good enough for club docs, which do not change constantly

### Later Improvements

- Daily reminder to sync
- Background sync
- Incremental sync
- Sync progress UI
- Failed document retry queue

---

## 11. Notion API Implementation Notes

Use the direct Notion API instead of MCP for the MVP.

Reason:

> The app is building a local searchable index. Direct API access is better for reliable syncing, chunking, caching, and source tracking.

### Notion Sync Steps

```text
1. User connects Notion
2. User shares/selects relevant club page or database
3. App recursively fetches child blocks
4. App converts blocks to plain text
5. App chunks text by headings and length
6. App embeds new/changed chunks
7. App stores source URL and metadata
```

### Handle Rate Limits

- Sync slowly
- Retry after rate-limit responses
- Cache fetched pages
- Avoid crawling everything repeatedly

---

## 12. Google Drive API Implementation Notes

Use Google Drive API with folder selection.

### Recommended Flow

```text
1. User connects Google
2. App opens Google Picker
3. User selects a specific club folder
4. App recursively lists files in that folder
5. App exports or downloads supported files
6. App extracts text
7. App chunks and embeds changed files
```

### Supported File Types for MVP

| File Type | Handling |
|---|---|
| Google Docs | Export as text or HTML |
| PDF | Extract text with PDF parser |
| DOCX | Extract with Mammoth |
| TXT | Read directly |
| Markdown | Read directly |

### OAuth Scope Preference

Start with the narrowest practical scope.

Preferred:

```text
drive.file
```

Fallback if needed:

```text
drive.readonly
```

Avoid requesting broad permissions unless necessary.

---

## 13. Suggested Tech Stack

```text
Electron + Vite + React
Node main process for sync/auth/filesystem work
SQLite via better-sqlite3
Cohere JS SDK
Notion SDK
Google APIs Node client
Google Picker
keytar for secure token storage
pdf-parse for PDFs
mammoth for DOCX
Ollama local HTTP API for free answer generation
```

### Suggested Packages

```text
@notionhq/client
googleapis
cohere-ai
better-sqlite3
keytar
pdf-parse
mammoth
```

Optional later:

```text
sqlite-vec
lancedb
```

---

## 14. MVP UI Screens

### 1. Welcome Screen

```text
Welcome to ClubBrain
Ask questions across your club's Notion and Google Drive docs.
Everything is indexed locally on your computer.
```

### 2. Cohere Key Setup

```text
Paste your Cohere API key

Need one?
1. Create a Cohere account
2. Go to API keys
3. Copy your key
4. Paste it here

Your key is stored securely on your device.
```

### 3. Data Sources

```text
Connect sources

[Connect Notion]
[Connect Google Drive]

Connected:
- Notion: Codebox Workspace
- Google Drive: Hack4Impact Club Folder
```

### 4. Sync Screen

```text
Selected sources:
- Notion: Codebox Docs
- Google Drive: Club Shared Drive / Onboarding

[Sync now]

Last synced: Today at 4:12 PM
Documents indexed: 84
Chunks indexed: 912
```

### 5. Chat Screen

```text
Ask your club docs anything...

Example questions:
- How do I join a project?
- What does a tech lead do?
- Where are reimbursement instructions?
- How do we deploy projects?
```

### 6. Answer Screen

```text
Answer:
Based on the reimbursement policy, members should submit receipts within 14 days and get approval for purchases over $50.

Sources:
1. Reimbursement Policy - Notion
2. Treasurer Onboarding - Google Drive
3. Officer FAQ - Notion
```

---

## 15. Privacy Positioning

Important product promise:

> Your club docs are indexed locally on your computer. We do not host your data.

Clarification:

> Search queries and selected snippets may be sent to Cohere when using Cohere Embed or Rerank. If you enable local answer generation, final answer generation happens on your machine.

Be transparent about this in settings.

---

## 16. What Not to Build in the MVP

Avoid these until the core app works:

- Hosted backend
- Shared Cohere key
- Real-time sync
- Multi-user admin dashboard
- Full permission mirroring
- Editing Notion or Drive docs
- Slack integration
- Gmail integration
- Meeting transcription
- Complex agent workflows
- MCP integration

MCP can be useful later, but direct APIs are simpler for indexing.

---

## 17. Development Milestones

### Milestone 1: Local App Shell

- Electron app boots
- SQLite database works
- Settings screen exists
- Cohere key can be saved securely

### Milestone 2: Cohere Retrieval Test

- Add sample documents manually
- Chunk text
- Embed chunks
- Ask a question
- Retrieve top chunks
- Rerank with Cohere
- Show source snippets

### Milestone 3: Notion Connector

- Connect Notion
- Select/share a club docs page/database
- Fetch pages and child blocks
- Convert to text
- Store documents and chunks
- Embed changed chunks

### Milestone 4: Google Drive Connector

- Connect Google
- Select a Drive folder
- Recursively list files
- Export Google Docs
- Extract PDF/DOCX/TXT/MD text
- Store and embed changed chunks

### Milestone 5: Chat UX

- Ask question in chat
- Show answer or results
- Include source links
- Add confidence/relevance indicators

### Milestone 6: Local Generation

- Detect Ollama
- Let user choose local model
- Generate answer from top chunks
- Fall back to search-results-only mode

---

## 18. Recommended Build Order

Build in this order:

```text
1. Electron + SQLite app shell
2. Cohere key setup screen
3. Manual sample-doc indexing
4. Cohere Embed + Rerank retrieval
5. Search-results-only answer UI
6. Notion connector
7. Google Drive connector
8. Ollama answer generation
9. Better sync and source management
```

This keeps the MVP useful at every stage.

---

## 19. Product Name Ideas

- ClubBrain
- ClubSearch
- DocNest
- AskClub
- ClubDocs AI
- PolyBrain
- CampusBrain

Recommended placeholder name: **ClubBrain**.

---

## 20. MVP Definition of Done

The MVP is complete when a club officer can:

1. Install the Electron app
2. Paste their own Cohere key
3. Connect a Notion page/database
4. Connect a Google Drive folder
5. Sync selected docs locally
6. Ask a question
7. See relevant answers or source snippets
8. Open the original Notion or Drive source
9. Use the app without you hosting a backend

---

## 21. One-Sentence Pitch

> ClubBrain is a local-first desktop app that lets student clubs connect their Notion and Google Drive docs, then ask questions across all their scattered knowledge using Cohere-powered search.