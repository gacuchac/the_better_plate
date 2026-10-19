import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useApp, useSyncStatus } from "../store.tsx";
import { Icon } from "./icons.tsx";

// ---------- tiny hash router (deep-linkable, works offline from the cached shell) ----------

function currentHash() {
  return window.location.hash.replace(/^#/, "") || "/kitchen";
}

export function useRoute(): string {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("hashchange", fn);
      return () => window.removeEventListener("hashchange", fn);
    },
    currentHash,
  );
}

export function navigate(path: string) {
  window.location.hash = path;
}

// ---------- sync status chip (precise words from PRODUCT.md §6) ----------

export function SyncChip() {
  const { engine, online } = useApp();
  const status = useSyncStatus(engine);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!engine) return;
    const update = () => void engine.pendingCount().then(setPending);
    update();
    return engine.subscribe(update);
  }, [engine]);

  let label: string;
  let tone: "ok" | "busy" | "warn" | "muted";
  if (status === "attention") [label, tone] = ["Needs attention", "warn"];
  else if (status === "signed-out") [label, tone] = ["Sign in to sync", "warn"];
  else if (status === "syncing") [label, tone] = ["Syncing", "busy"];
  else if (!online || status === "offline") [label, tone] = [pending ? "Offline · Saved on this device" : "Offline", "muted"];
  else if (pending || status === "saved-local") [label, tone] = ["Saved on this device", "muted"];
  else [label, tone] = ["Synced", "ok"];

  return (
    <button
      type="button"
      className={`chip chip-${tone}`}
      data-testid="sync-status"
      aria-live="polite"
      title="Sync now"
      onClick={() => void engine?.syncNow()}
    >
      <span className="dot" aria-hidden="true" />
      {label}
    </button>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn round" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
