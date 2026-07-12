import { ipcMain, type WebContents } from "electron";
import { getDb } from "../db/singleton";
import { getSourceById } from "../db/database";
import { loadSecret } from "../auth/storage";
import { getSetting } from "../db/database";
import { syncSource, type Connector } from "../sync/sync-manager";
import { NotionConnector } from "../connectors/notion";
import { DriveConnector } from "../connectors/drive";
import { getAuthenticatedClient, refreshIfNeeded } from "../auth/google-oauth";
import type { EmbedConfig } from "../search/embedder";

export const activeSyncs = new Map<string, AbortController>();

export function buildEmbedConfig(db: ReturnType<typeof getDb>): EmbedConfig {
  const provider = (getSetting(db, "embedding_provider") ?? "cohere") as
    | "cohere"
    | "ollama";
  const config: EmbedConfig = { provider };
  if (provider === "cohere") {
    config.apiKey = loadSecret(db, "cohere_api_key") ?? undefined;
  } else {
    config.ollamaModel =
      (getSetting(db, "ollama_model") as string) ?? undefined;
  }
  return config;
}

export async function getConnectorForSource(
  db: ReturnType<typeof getDb>,
  source: { provider: string; rootExternalId: string },
): Promise<Connector> {
  if (source.provider === "notion") {
    const token = loadSecret(db, "notion_token");
    if (!token) {
      throw new Error("Notion token not found. Connect Notion first.");
    }
    return new NotionConnector(token, source.rootExternalId);
  }

  if (source.provider === "google_drive") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
      );
    }
    const client = getAuthenticatedClient(db, clientId, clientSecret);
    await refreshIfNeeded(client, db);
    return new DriveConnector(client, source.rootExternalId);
  }

  throw new Error(
    `No connector available for provider: ${source.provider}. Connect a source first.`,
  );
}

export function cancelAllSyncs(): void {
  for (const [, controller] of activeSyncs) {
    controller.abort();
  }
  activeSyncs.clear();
}

export function registerSyncHandlers(): void {
  ipcMain.handle("sync:start", async (event, sourceId: string) => {
    const db = getDb();
    const source = getSourceById(db, sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);

    if (activeSyncs.has(sourceId)) {
      throw new Error(`Sync already in progress for source: ${sourceId}`);
    }

    const controller = new AbortController();
    activeSyncs.set(sourceId, controller);

    try {
      const connector = await getConnectorForSource(db, source);
      const embedConfig = buildEmbedConfig(db);
      const sender: WebContents = event.sender;

      await syncSource(
        db,
        sourceId,
        source.provider,
        connector,
        embedConfig,
        (progress) => {
          try {
            sender.send("sync:progress", progress);
          } catch {
            // sender destroyed between check and send
          }
        },
        controller.signal,
      );
    } finally {
      activeSyncs.delete(sourceId);
    }
  });

  ipcMain.handle("sync:cancel", (_, sourceId: string) => {
    const controller = activeSyncs.get(sourceId);
    if (controller) {
      controller.abort();
    }
  });
}
