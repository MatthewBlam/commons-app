import { useEffect, useState, useRef } from "react";
import { Button } from "@renderer/components/ui/button";
import { Spinner } from "@renderer/components/ui/spinner";
import type { SyncProgress } from "../../../../shared/types";

interface SyncPanelProps {
  sourceId: string;
  sourceName: string;
  onComplete: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  fetching: "Fetching documents",
  chunking: "Chunking text",
  embedding: "Generating embeddings",
  storing: "Storing data",
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function SyncPanel({ sourceId, sourceName, onComplete }: SyncPanelProps): React.JSX.Element {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [status, setStatus] = useState<"syncing" | "complete" | "canceled" | "error">("syncing");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    unsubRef.current = window.api.onSyncProgress((p) => {
      if (p.sourceId === sourceId) {
        setProgress(p);
      }
    });

    window.api
      .syncSource(sourceId)
      .then(() => {
        setStatus((prev) => (prev === "syncing" ? "complete" : prev));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Sync failed");
        setStatus("error");
      });

    return () => {
      startedRef.current = false;
      unsubRef.current?.();
    };
  }, [sourceId]);

  useEffect(() => {
    if (status !== "syncing") return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [status]);

  function handleCancel(): void {
    window.api.cancelSync(sourceId).catch(() => {});
    setStatus("canceled");
  }

  const phaseLabel = progress ? (PHASE_LABELS[progress.phase] ?? progress.phase) : "Starting sync";

  const statusLabel = status === "complete" ? "Sync complete" : status === "canceled" ? "Sync canceled" : `Syncing ${sourceName}`;

  return (
    <div className="border-x border-b border-border rounded-b-lg bg-card/50 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{statusLabel}</h3>
        {status === "syncing" && (
          <Button variant="ghost" size="xs" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {status === "syncing" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>{phaseLabel}</span>
            <span className="ml-auto tabular-nums">{formatElapsed(elapsed)}</span>
          </div>

          {progress && progress.current > 0 && (
            <p className="text-xs text-muted-foreground">
              {progress.current} document{progress.current !== 1 ? "s" : ""} processed
            </p>
          )}

          {progress?.currentDocTitle && <p className="text-xs text-muted-foreground truncate">{progress.currentDocTitle}</p>}
        </div>
      )}

      {error && <p className="text-sm text-destructive-foreground">{error}</p>}

      {progress && progress.errors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-warning-foreground">
            {progress.errors.length} error
            {progress.errors.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {progress.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {status !== "syncing" && (
        <Button size="sm" variant="outline" onClick={onComplete}>
          Done
        </Button>
      )}
    </div>
  );
}
