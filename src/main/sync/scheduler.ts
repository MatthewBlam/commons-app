import { BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { getAllSources, getSetting, upsertSetting } from "../db/database";
import { activeSyncs, buildEmbedConfig, getConnectorForSource } from "../ipc/sync-handlers";
import { syncSource } from "./sync-manager";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

class SyncScheduler {
  private db: Database.Database | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private running = false;
  private enabled = false;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private lastSyncedAt: string | null = null;

  start(db: Database.Database): void {
    this.db = db;
    this.enabled = getSetting(db, "auto_sync_enabled") === "true";
    this.intervalMs = parseInt(getSetting(db, "auto_sync_interval_ms") ?? "", 10) || DEFAULT_INTERVAL_MS;
    this.lastSyncedAt = getSetting(db, "auto_sync_last_synced_at") ?? null;

    if (this.enabled) {
      this.scheduleInterval();
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.db) return;
    this.enabled = enabled;
    upsertSetting(this.db, "auto_sync_enabled", String(enabled));

    if (enabled) {
      this.scheduleInterval();
    } else {
      this.clearInterval();
    }
  }

  setIntervalMs(ms: number): void {
    if (!this.db) return;
    const clamped = Math.max(60_000, Math.min(ms, 24 * 60 * 60_000));
    this.intervalMs = clamped;
    upsertSetting(this.db, "auto_sync_interval_ms", String(clamped));

    if (this.enabled) {
      this.clearInterval();
      this.scheduleInterval();
    }
  }

  stop(): void {
    this.clearInterval();
    this.abortController?.abort();
    this.abortController = null;
    this.db = null;
  }

  getState(): { enabled: boolean; intervalMs: number; lastSyncedAt: string | null; syncing: boolean } {
    return { enabled: this.enabled, intervalMs: this.intervalMs, lastSyncedAt: this.lastSyncedAt, syncing: this.running };
  }

  private scheduleInterval(): void {
    this.clearInterval();
    this.intervalHandle = setInterval(() => this.tick(), this.intervalMs);
  }

  private clearInterval(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running || !this.db) return;
    this.running = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    let anySuccess = false;

    try {
      const sources = getAllSources(this.db);
      const embedConfig = buildEmbedConfig(this.db);

      for (const source of sources) {
        if (signal.aborted) break;
        if (activeSyncs.has(source.id)) continue;

        const controller = new AbortController();
        activeSyncs.set(source.id, controller);
        signal.addEventListener("abort", () => controller.abort(), { once: true });

        try {
          const connector = await getConnectorForSource(this.db!, source);
          const sender = BrowserWindow.getAllWindows()[0]?.webContents;
          await syncSource(this.db!, source.id, source.provider, connector, embedConfig, (progress) => {
            try {
              sender?.send("sync:progress", progress);
            } catch {
              // sender destroyed
            }
          }, controller.signal);
          anySuccess = true;
        } catch (err) {
          console.error(`Auto-sync failed for source ${source.id}:`, err);
        } finally {
          activeSyncs.delete(source.id);
        }
      }
    } finally {
      if (anySuccess && this.db) {
        this.lastSyncedAt = new Date().toISOString();
        upsertSetting(this.db, "auto_sync_last_synced_at", this.lastSyncedAt);
      }
      this.running = false;
      this.abortController = null;
    }
  }
}

export const syncScheduler = new SyncScheduler();
