import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations";
import {
  insertSource,
  getDocumentsBySourceId,
  getChunksByDocumentId,
  getDocumentByExternalId,
} from "../../db/database";
import { syncSource, type Connector, type RawDocument } from "../sync-manager";
import type { EmbedConfig } from "../../search/embedder";
import type { SyncProgress } from "../../../shared/types";

vi.mock("../../search/embedder", () => ({
  embedDocuments: vi.fn(async (texts: string[]) =>
    texts.map(() => new Float32Array([0.1, 0.2, 0.3])),
  ),
  getEmbeddingModelName: vi.fn(() => "embed-v4.0"),
  embeddingToBuffer: vi.fn((emb: Float32Array) =>
    Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength),
  ),
}));

function makeConnector(docs: RawDocument[]): Connector {
  return {
    async *fetchDocuments() {
      for (const doc of docs) {
        yield doc;
      }
    },
  };
}

const testConfig: EmbedConfig = { provider: "cohere", apiKey: "test-key" };

describe("syncSource", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    insertSource(db, {
      id: "src-1",
      provider: "notion",
      name: "Test Source",
      rootExternalId: "ext-root",
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => db.close());

  it("syncs documents and creates chunks with embeddings", async () => {
    const connector = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Test Doc",
        url: "https://example.com",
        mimeType: "text/plain",
        modifiedAt: null,
        content:
          "# Intro\nHello world content here.\n## Details\nMore details.",
      },
    ]);

    const progress: SyncProgress[] = [];
    await syncSource(db, "src-1", "notion", connector, testConfig, (p) =>
      progress.push(p),
    );

    const docs = getDocumentsBySourceId(db, "src-1");
    expect(docs).toHaveLength(1);
    expect(docs[0].syncStatus).toBe("synced");
    expect(docs[0].contentHash).toBeTruthy();

    const chunks = getChunksByDocumentId(db, docs[0].id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].embedding).toBeTruthy();
    expect(chunks[0].embeddingModel).toBe("embed-v4.0");

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((p) => p.phase === "chunking")).toBe(true);
    expect(progress.some((p) => p.phase === "embedding")).toBe(true);
    expect(progress.some((p) => p.phase === "storing")).toBe(true);
  });

  it("skips unchanged documents via content hash", async () => {
    const content = "# Section\nSome content here.";
    const connector1 = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content,
      },
    ]);

    await syncSource(db, "src-1", "notion", connector1, testConfig, () => {});

    const { embedDocuments } = await import("../../search/embedder");
    (embedDocuments as ReturnType<typeof vi.fn>).mockClear();

    const connector2 = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content,
      },
    ]);

    await syncSource(db, "src-1", "notion", connector2, testConfig, () => {});

    expect(embedDocuments).not.toHaveBeenCalled();
  });

  it("re-processes documents when content changes", async () => {
    const connector1 = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "Version 1",
      },
    ]);
    await syncSource(db, "src-1", "notion", connector1, testConfig, () => {});

    const connector2 = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "Version 2 with changes",
      },
    ]);

    const { embedDocuments } = await import("../../search/embedder");
    (embedDocuments as ReturnType<typeof vi.fn>).mockClear();

    await syncSource(db, "src-1", "notion", connector2, testConfig, () => {});

    expect(embedDocuments).toHaveBeenCalled();
    const doc = getDocumentByExternalId(db, "src-1", "doc-ext-1");
    expect(doc?.syncStatus).toBe("synced");
  });

  it("handles embedding errors per document without aborting", async () => {
    const { embedDocuments } = await import("../../search/embedder");
    let callCount = 0;
    (embedDocuments as ReturnType<typeof vi.fn>).mockImplementation(
      async (texts: string[]) => {
        callCount++;
        if (callCount === 1) throw new Error("Cohere rate limit");
        return texts.map(() => new Float32Array([0.1, 0.2, 0.3]));
      },
    );

    const connector = makeConnector([
      {
        externalId: "doc-1",
        title: "Failing Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Heading\nContent that will fail embedding.",
      },
      {
        externalId: "doc-2",
        title: "Succeeding Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Heading\nContent that will succeed.",
      },
    ]);

    const progress: SyncProgress[] = [];
    await syncSource(db, "src-1", "notion", connector, testConfig, (p) =>
      progress.push(p),
    );

    const doc1 = getDocumentByExternalId(db, "src-1", "doc-1");
    expect(doc1?.syncStatus).toBe("error");

    const doc2 = getDocumentByExternalId(db, "src-1", "doc-2");
    expect(doc2?.syncStatus).toBe("synced");

    const lastProgress = progress[progress.length - 1];
    expect(lastProgress.errors).toHaveLength(1);
    expect(lastProgress.errors[0]).toContain("Failing Doc");
  });

  it("stops processing when abort signal fires", async () => {
    const controller = new AbortController();
    let yielded = 0;

    const connector: Connector = {
      async *fetchDocuments() {
        for (let i = 0; i < 10; i++) {
          yielded++;
          yield {
            externalId: `doc-${i}`,
            title: `Doc ${i}`,
            url: null,
            mimeType: null,
            modifiedAt: null,
            content: `# Section\nContent for doc ${i}.`,
          };
          if (yielded === 2) controller.abort();
        }
      },
    };

    await syncSource(
      db,
      "src-1",
      "notion",
      connector,
      testConfig,
      () => {},
      controller.signal,
    );

    const docs = getDocumentsBySourceId(db, "src-1");
    expect(docs.length).toBeLessThan(10);
  });

  it("handles documents with empty content", async () => {
    const connector = makeConnector([
      {
        externalId: "doc-empty",
        title: "Empty Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "   ",
      },
    ]);

    await syncSource(db, "src-1", "notion", connector, testConfig, () => {});

    const doc = getDocumentByExternalId(db, "src-1", "doc-empty");
    expect(doc?.syncStatus).toBe("synced");

    const chunks = getChunksByDocumentId(db, doc!.id);
    expect(chunks).toHaveLength(0);
  });

  it("emits done phase after successful sync", async () => {
    const connector = makeConnector([
      {
        externalId: "doc-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Heading\nSome content.",
      },
    ]);

    const progress: SyncProgress[] = [];
    await syncSource(db, "src-1", "notion", connector, testConfig, (p) =>
      progress.push(p),
    );

    const last = progress[progress.length - 1];
    expect(last.phase).toBe("done");
    expect(last.total).toBe(last.current);
    expect(last.errors).toHaveLength(0);
  });

  it("emits error phase when some documents fail", async () => {
    const { embedDocuments } = await import("../../search/embedder");
    (embedDocuments as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("API error"),
    );

    const connector = makeConnector([
      {
        externalId: "doc-fail",
        title: "Failing",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Heading\nContent.",
      },
    ]);

    const progress: SyncProgress[] = [];
    await syncSource(db, "src-1", "notion", connector, testConfig, (p) =>
      progress.push(p),
    );

    const last = progress[progress.length - 1];
    expect(last.phase).toBe("error");
    expect(last.errors.length).toBeGreaterThan(0);
  });

  it("re-embeds when embedding model changes even if content unchanged", async () => {
    const content = "# Section\nSome content here.";
    const connector1 = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content,
      },
    ]);

    await syncSource(db, "src-1", "notion", connector1, testConfig, () => {});

    const { embedDocuments, getEmbeddingModelName } = await import(
      "../../search/embedder"
    );
    (embedDocuments as ReturnType<typeof vi.fn>).mockClear();
    (getEmbeddingModelName as ReturnType<typeof vi.fn>).mockReturnValue(
      "new-model-v2",
    );

    const connector2 = makeConnector([
      {
        externalId: "doc-ext-1",
        title: "Doc",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content,
      },
    ]);

    await syncSource(db, "src-1", "notion", connector2, testConfig, () => {});

    expect(embedDocuments).toHaveBeenCalled();

    const doc = getDocumentByExternalId(db, "src-1", "doc-ext-1");
    const chunks = getChunksByDocumentId(db, doc!.id);
    expect(chunks[0].embeddingModel).toBe("new-model-v2");
  });

  it("syncs multiple documents", async () => {
    const connector = makeConnector([
      {
        externalId: "doc-a",
        title: "Doc A",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Alpha\nFirst document content.",
      },
      {
        externalId: "doc-b",
        title: "Doc B",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Beta\nSecond document content.",
      },
      {
        externalId: "doc-c",
        title: "Doc C",
        url: null,
        mimeType: null,
        modifiedAt: null,
        content: "# Gamma\nThird document content.",
      },
    ]);

    await syncSource(db, "src-1", "notion", connector, testConfig, () => {});

    const docs = getDocumentsBySourceId(db, "src-1");
    expect(docs).toHaveLength(3);
    expect(docs.every((d) => d.syncStatus === "synced")).toBe(true);
  });
});
