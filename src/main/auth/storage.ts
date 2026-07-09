import { safeStorage } from "electron";
import type Database from "better-sqlite3";

function canEncrypt(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function saveSecret(
  db: Database.Database,
  key: string,
  plaintext: string,
): void {
  if (!canEncrypt()) {
    throw new Error(
      "OS keychain is unavailable — cannot securely store secrets. On Linux, install gnome-keyring or kwallet.",
    );
  }
  const encrypted = safeStorage.encryptString(plaintext);
  db.prepare("INSERT OR REPLACE INTO secrets (key, value) VALUES (?, ?)").run(
    key,
    encrypted.toString("base64"),
  );
}

export function loadSecret(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM secrets WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  if (!canEncrypt()) {
    throw new Error(
      "OS keychain is unavailable — cannot decrypt stored secrets.",
    );
  }
  const buf = Buffer.from(row.value, "base64");
  try {
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn(
      `Failed to decrypt secret "${key}", deleting corrupt entry: ${err instanceof Error ? err.message : err}`,
    );
    db.prepare("DELETE FROM secrets WHERE key = ?").run(key);
    return null;
  }
}

export function deleteSecret(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM secrets WHERE key = ?").run(key);
}
