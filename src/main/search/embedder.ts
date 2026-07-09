export interface EmbedConfig {
  provider: "cohere" | "ollama";
  apiKey?: string;
  ollamaModel?: string;
}

const COHERE_MODEL = "embed-v4.0";
const COHERE_BATCH_SIZE = 96;
const OLLAMA_BATCH_SIZE = 32;
const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";

const COHERE_TIMEOUT_MS = 30_000;
const OLLAMA_TIMEOUT_MS = 120_000;
const COHERE_MAX_RETRIES = 3;
const COHERE_RETRY_BACKOFF = [1000, 2000, 4000];

interface CohereEmbedResponse {
  embeddings: {
    float: number[][];
  };
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number,
  backoffMs: number[],
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) return res;

    if (isRetryableStatus(res.status) && attempt < maxRetries) {
      lastError = new Error(`${res.status} ${res.statusText}`);
      await new Promise((r) => setTimeout(r, backoffMs[attempt]));
      continue;
    }

    return res;
  }

  throw lastError;
}

async function embedWithCohere(
  texts: string[],
  inputType: "search_document" | "search_query",
  apiKey: string,
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += COHERE_BATCH_SIZE) {
    const batch = texts.slice(i, i + COHERE_BATCH_SIZE);
    const res = await fetchWithRetry(
      "https://api.cohere.com/v2/embed",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: COHERE_MODEL,
          texts: batch,
          input_type: inputType,
          embedding_types: ["float"],
        }),
      },
      COHERE_TIMEOUT_MS,
      COHERE_MAX_RETRIES,
      COHERE_RETRY_BACKOFF,
    );

    if (!res.ok) {
      throw new Error(`Cohere embed failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as CohereEmbedResponse;
    for (const emb of data.embeddings.float) {
      results.push(new Float32Array(emb));
    }
  }

  return results;
}

async function embedWithOllama(
  texts: string[],
  model: string,
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += OLLAMA_BATCH_SIZE) {
    const batch = texts.slice(i, i + OLLAMA_BATCH_SIZE);
    const res = await fetch("http://localhost:11434/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: batch }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as OllamaEmbedResponse;
    for (const emb of data.embeddings) {
      results.push(new Float32Array(emb));
    }
  }

  return results;
}

export async function embedDocuments(
  texts: string[],
  config: EmbedConfig,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  if (config.provider === "cohere") {
    if (!config.apiKey) throw new Error("Cohere API key required");
    return embedWithCohere(texts, "search_document", config.apiKey);
  }
  return embedWithOllama(texts, config.ollamaModel ?? DEFAULT_OLLAMA_MODEL);
}

export async function embedQuery(
  text: string,
  config: EmbedConfig,
): Promise<Float32Array> {
  if (config.provider === "cohere") {
    if (!config.apiKey) throw new Error("Cohere API key required");
    const [result] = await embedWithCohere(
      [text],
      "search_query",
      config.apiKey,
    );
    return result;
  }
  const [result] = await embedWithOllama(
    [text],
    config.ollamaModel ?? DEFAULT_OLLAMA_MODEL,
  );
  return result;
}

export function getEmbeddingModelName(config: EmbedConfig): string {
  return config.provider === "cohere"
    ? COHERE_MODEL
    : (config.ollamaModel ?? DEFAULT_OLLAMA_MODEL);
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  const copy = Buffer.alloc(embedding.byteLength);
  copy.set(new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength));
  return copy;
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
}
