import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { FoodRecord } from "@betterplate/nutrition";
import { api, ApiRequestError, NetworkError, type CatalogBundle, type Me } from "./api.ts";
import { clearTargets } from "./targets.ts";
import { deleteUserDb, isQuotaError, openUserDb, readCatalog, STORAGE_FULL_EVENT, requestPersistentStorage, writeCatalog, type LocalLog, type LocalPlan, type LocalRecipe } from "./localdb.ts";
import { SyncEngine } from "./sync.ts";

const ACCOUNT_KEY = "bp.account";

/** Last signed-in account, so the app opens offline. Holds no secrets (session is an httpOnly cookie). */
function rememberedAccount(): Me | null {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null");
  } catch {
    return null;
  }
}

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; bundle: CatalogBundle; foods: Map<string, FoodRecord>; offline: boolean }
  | { status: "unavailable"; message: string };

/** evicted: the browser cleared this device's copy; full: a save failed for lack of space. */
export type StorageNotice = "evicted" | "full" | null;

interface AppState {
  account: Me | null;
  accountChecked: boolean;
  engine: SyncEngine | null;
  catalog: CatalogState;
  recipes: LocalRecipe[];
  plans: LocalPlan[];
  logs: LocalLog[];
  online: boolean;
  setAccount: (me: Me) => void;
  signOut: (opts?: { discardUnsynced?: boolean }) => Promise<void>;
  refreshRecipes: () => Promise<void>;
  storageNotice: StorageNotice;
  dismissStorageNotice: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function useSyncStatus(engine: SyncEngine | null) {
  return useSyncExternalStore(
    (fn) => engine?.subscribe(fn) ?? (() => {}),
    () => engine?.status ?? "saved-local",
  );
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

async function loadCatalog(): Promise<CatalogState> {
  const cached = await readCatalog();
  const ready = (bundle: CatalogBundle, offline: boolean): CatalogState => ({
    status: "ready",
    bundle,
    offline,
    foods: new Map(bundle.foods.map((f) => [f.id, f])),
  });
  try {
    const manifest = await api.manifest();
    if (cached && cached.version === manifest.version) return ready(cached, false);
    const bundle = await api.bundle(manifest.bundleUrl);
    // Out of space: keep using the foods for this visit and say so, rather than failing.
    await writeCatalog(bundle).catch((err) => {
      if (isQuotaError(err)) dispatchEvent(new Event(STORAGE_FULL_EVENT));
    });
    return ready(bundle, false);
  } catch (err) {
    if (cached) return ready(cached, err instanceof NetworkError);
    return { status: "unavailable", message: "Connect to the internet once to download the USDA foods." };
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Me | null>(rememberedAccount);
  const [accountChecked, setAccountChecked] = useState(false);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [recipes, setRecipes] = useState<LocalRecipe[]>([]);
  const [plans, setPlans] = useState<LocalPlan[]>([]);
  const [logs, setLogs] = useState<LocalLog[]>([]);
  const online = useOnline();
  const [storageNotice, setStorageNotice] = useState<StorageNotice>(null);

  useEffect(() => {
    const full = () => setStorageNotice("full");
    addEventListener(STORAGE_FULL_EVENT, full);
    return () => removeEventListener(STORAGE_FULL_EVENT, full);
  }, []);

  useEffect(() => {
    void loadCatalog().then(setCatalog);
    void requestPersistentStorage();
  }, []);

  // Confirm the session when online; offline, keep the remembered account.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (cancelled) return;
        const prev = rememberedAccount();
        if (prev && prev.id !== me.id) {
          void deleteUserDb(prev.id);
          clearTargets(prev.id);
        }
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(me));
        setAccountState(me);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) setAccountState(null);
      })
      .finally(() => !cancelled && setAccountChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Open the per-account database and sync engine.
  useEffect(() => {
    if (!account) {
      setEngine(null);
      setRecipes([]);
      setPlans([]);
      setLogs([]);
      return;
    }
    let disposed = false;
    let cleanup = () => {};
    void openUserDb(account.id, () => setStorageNotice("evicted")).then((db) => {
      if (disposed) return db.close();
      const e = new SyncEngine(db);
      const refresh = () =>
        void Promise.all([e.listRecipes(), e.listPlans(), e.listLogs()]).then(([r, p, l]) => {
          if (disposed) return;
          setRecipes(r);
          setPlans(p);
          setLogs(l);
        });
      const unsub = e.subscribe(refresh);
      const resume = () => document.visibilityState === "visible" && void e.syncNow();
      const reconnect = () => void e.syncNow();
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", reconnect);
      cleanup = () => {
        unsub();
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("online", reconnect);
        db.close();
      };
      setEngine(e);
      refresh();
      void e.syncNow();
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [account?.id]);

  const refreshRecipes = useCallback(async () => {
    if (engine) setRecipes(await engine.listRecipes());
  }, [engine]);

  const setAccount = useCallback((me: Me) => {
    const prev = rememberedAccount();
    if (prev && prev.id !== me.id) {
      void deleteUserDb(prev.id);
      clearTargets(prev.id);
    }
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(me));
    setAccountState(me);
    setAccountChecked(true);
  }, []);

  const signOut = useCallback(async () => {
    const id = account?.id;
    await api.signOut().catch(() => {});
    localStorage.removeItem(ACCOUNT_KEY);
    setAccountState(null);
    setEngine(null);
    // Personal records leave the device with the account; the shared catalog stays.
    if (id) {
      clearTargets(id);
      await deleteUserDb(id).catch(() => {});
    }
  }, [account?.id]);

  const value = useMemo<AppState>(
    () => ({ account, accountChecked, engine, catalog, recipes, plans, logs, online, setAccount, signOut, refreshRecipes, storageNotice, dismissStorageNotice: () => setStorageNotice(null) }),
    [account, accountChecked, engine, catalog, recipes, plans, logs, online, setAccount, signOut, refreshRecipes, storageNotice],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
