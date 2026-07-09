import { useEffect, useRef, useState, Fragment } from "react";
import { FileTextIcon, ChevronRightIcon } from "lucide-react";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { Button } from "@renderer/components/ui/button";
import { Spinner } from "@renderer/components/ui/spinner";
import { ErrorBanner } from "@renderer/components/ui/error-banner";
import type { NotionItemSummary } from "../../../../shared/types";

interface NotionPickerProps {
  onSubmit: (selections: Array<{ id: string; name: string }>) => void;
  onCancel: () => void;
}

interface Breadcrumb {
  id: string;
  name: string;
}

export function NotionPicker({ onSubmit, onCancel }: NotionPickerProps): React.JSX.Element {
  const [items, setItems] = useState<NotionItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: "root", name: "Notion" }]);
  const cancelRef = useRef(false);

  async function fetchPage(pageId: string): Promise<void> {
    cancelRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.listNotionPages(pageId === "root" ? undefined : pageId);
      if (!cancelRef.current) setItems(result);
    } catch (err) {
      if (!cancelRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load Notion pages");
      }
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    window.api
      .listNotionPages()
      .then((result) => {
        if (!cancelled) {
          setItems(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Notion pages");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function navigateInto(item: NotionItemSummary): void {
    setBreadcrumbs((prev) => [...prev, { id: item.id, name: item.title }]);
    fetchPage(item.id);
  }

  function navigateTo(index: number): void {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    const targetId = breadcrumbs[index].id;
    fetchPage(targetId);
  }

  function toggleSelect(item: NotionItemSummary): void {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item.title);
      return next;
    });
  }

  function handleSubmit(): void {
    const selections = Array.from(selected.entries()).map(([id, name]) => ({
      id,
      name,
    }));
    onSubmit(selections);
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBanner>{error}</ErrorBanner>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Select pages to sync</p>

      <div className="flex items-center gap-0.5 text-xs text-muted-foreground overflow-x-auto">
        {breadcrumbs.map((crumb, i) => (
          <Fragment key={crumb.id}>
            {i > 0 && <ChevronRightIcon className="size-3 shrink-0" />}
            <button
              type="button"
              onClick={() => navigateTo(i)}
              className={`shrink-0 rounded px-1 py-0.5 hover:text-foreground transition-colors ${i === breadcrumbs.length - 1 ? "text-foreground font-medium" : ""}`}>
              {crumb.name}
            </button>
          </Fragment>
        ))}
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-input">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No sub-pages found</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center border-b border-input last:border-b-0">
              <div className="pl-3 pr-1 py-2">
                <Checkbox checked={selected.has(item.id)} onChange={() => toggleSelect(item)} />
              </div>
              <button type="button" onClick={() => navigateInto(item)} className="flex flex-1 items-center gap-2 py-2 pr-3 text-left text-sm hover:bg-accent/50 transition-colors min-w-0">
                {item.icon ? <span className="text-base shrink-0">{item.icon}</span> : <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{item.title}</span>
                <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={selected.size === 0}>
          {selected.size === 0 ? "Add sources" : `Add ${selected.size} source${selected.size !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
