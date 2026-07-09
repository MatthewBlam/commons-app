import { useEffect, useState, useRef } from "react";
import { SunIcon, MoonIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { ErrorBanner } from "@renderer/components/ui/error-banner";
import type { StorageStats } from "../../../shared/types";

interface SettingsPageProps {
  visible: boolean;
  dark: boolean;
  onToggleTheme: () => void;
  onProviderReset: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsPage({ visible, dark, onToggleTheme, onProviderReset }: SettingsPageProps): React.JSX.Element {
  const [provider, setProvider] = useState<string>("cohere");
  const [hasKey, setHasKey] = useState(false);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [newKey, setNewKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!visible || loaded.current) return;
    loaded.current = true;
    Promise.all([window.api.getEmbeddingProvider(), window.api.loadSecret("cohere_api_key"), window.api.getStorageStats()])
      .then(([p, key, s]) => {
        setProvider(p);
        setHasKey(key !== null);
        setStats(s);
        setLoadError(null);
      })
      .catch(() => {
        setLoadError("Failed to load settings.");
      });
  }, [visible]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  async function handleUpdateKey(): Promise<void> {
    const trimmed = newKey.trim();
    if (!trimmed) return;
    setValidating(true);
    setKeyError(null);
    setKeySuccess(false);

    try {
      const result = await window.api.validateCohereKey(trimmed);
      if (result.valid) {
        await window.api.saveSecret("cohere_api_key", trimmed);
        setHasKey(true);
        setNewKey("");
        setKeySuccess(true);
        successTimerRef.current = setTimeout(() => setKeySuccess(false), 3000);
      } else {
        setKeyError("Invalid API key. Please check and try again.");
      }
    } catch {
      setKeyError("Failed to validate key. Check your connection.");
    } finally {
      setValidating(false);
    }
  }

  async function handleRemoveKey(): Promise<void> {
    if (!confirm("Remove your Cohere API key? Search will stop working.")) return;
    try {
      await window.api.deleteSecret("cohere_api_key");
      setHasKey(false);
    } catch {
      setKeyError("Failed to remove key.");
    }
  }

  async function handleSwitchProvider(newProvider: "cohere" | "ollama"): Promise<void> {
    if (newProvider === provider) return;
    if (stats && stats.chunkCount > 0 && !confirm("Switching providers requires re-embedding all documents. Continue?")) return;
    try {
      await window.api.setEmbeddingProvider(newProvider);
      setProvider(newProvider);
      if (newProvider === "ollama") {
        onProviderReset();
      }
    } catch {
      setLoadError("Failed to switch provider.");
    }
  }

  async function handleClearAllData(): Promise<void> {
    if (!confirm("Delete all sources, documents, and settings? This cannot be undone.")) return;
    setClearing(true);
    try {
      await window.api.clearAllData();
      onProviderReset();
    } catch {
      setLoadError("Failed to clear data.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-10 py-3">
      <h1 className="text-2xl font-semibold mb-1">Settings</h1>
      <p className="text-muted-foreground text-sm mb-6">Manage your embedding provider and app data</p>

      {loadError && (
        <ErrorBanner variant="error" className="mb-6">
          {loadError}
        </ErrorBanner>
      )}

      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-4">
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Embedding Provider</h2>
            <div className="flex gap-2">
              <Button variant={provider === "cohere" ? "default" : "outline"} size="sm" onClick={() => handleSwitchProvider("cohere")}>
                Cohere API
              </Button>
              <Button variant={provider === "ollama" ? "default" : "outline"} size="sm" onClick={() => handleSwitchProvider("ollama")}>
                Ollama (Local)
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Appearance</h2>
            <div className="flex gap-2">
              <Button variant={!dark ? "default" : "outline"} size="sm" onClick={() => dark && onToggleTheme()}>
                <SunIcon className="size-4 mr-1.5" />
                Light
              </Button>
              <Button variant={dark ? "default" : "outline"} size="sm" onClick={() => !dark && onToggleTheme()}>
                <MoonIcon className="size-4 mr-1.5" />
                Dark
              </Button>
            </div>
          </section>
        </div>

        {provider === "cohere" && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Cohere API Key</h2>
            {hasKey ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">Key configured</span>
                <span className="text-xs text-muted-foreground">••••••••</span>
                <Button variant="ghost" size="xs" onClick={handleRemoveKey}>
                  Remove
                </Button>
              </div>
            ) : (
              <ErrorBanner variant="warning">No API key configured. Search will not work.</ErrorBanner>
            )}
            <div className="flex gap-2">
              <Input type="password" placeholder="Paste new Cohere API key" value={newKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKey(e.target.value)} />
              <Button size="sm" onClick={handleUpdateKey} loading={validating} disabled={!newKey.trim()}>
                {hasKey ? "Update" : "Save"}
              </Button>
            </div>
            {keyError && <ErrorBanner variant="error">{keyError}</ErrorBanner>}
            {keySuccess && <p className="text-sm text-success-foreground">API key updated successfully.</p>}
          </section>
        )}

        <div className="border-t border-border" />

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Storage</h2>
          {stats ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-2xl font-semibold">{stats.sourceCount}</p>
                <p className="text-xs text-muted-foreground">Sources</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-2xl font-semibold">{stats.documentCount}</p>
                <p className="text-xs text-muted-foreground">Documents</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-2xl font-semibold">{stats.chunkCount}</p>
                <p className="text-xs text-muted-foreground">Chunks</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-2xl font-semibold">{formatBytes(stats.dbSizeBytes)}</p>
                <p className="text-xs text-muted-foreground">Database size</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-1">
                  <div className="h-7 w-12 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-border" />

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Danger Zone</h2>
          <Button variant="destructive-outline" size="sm" onClick={handleClearAllData} loading={clearing}>
            Clear all data
          </Button>
          <p className="text-xs text-muted-foreground">Removes all sources, documents, embeddings, and settings — you will need to set up the app again</p>
        </section>
      </div>
    </div>
  );
}
