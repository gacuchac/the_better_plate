import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { FoodRecord } from "@betterplate/nutrition";
import { api, ApiRequestError, NetworkError, type CatalogBundle, type Me } from "./api.ts";
import { clearTargets, migrateTargets } from "./targets.ts";
import { endSession } from "./agent.ts";
import type { GroupSummary } from "@betterplate/contracts";
import {
  deleteUserDb,
  isQuotaError,
  openUserDb,
  readCatalog,
  STORAGE_FULL_EVENT,
  requestPersistentStorage,
  writeCatalog,
  type CachedGroups,
  type LocalFeedback,
  type LocalGoal,
  type LocalLog,
  type LocalPlan,
  type LocalPreferences,
  type LocalProfile,
  type LocalRecipe,
} from "./localdb.ts";
import { SyncEngine } from "./sync.ts";

const ACCOUNT_KEY = "bp.account";
const LIVE_PULL_MS = 5000;
/** Fired after connecting or disconnecting an assistant, so live updates start or stop. */
export const ASSISTANTS_CHANGED = "bp:assistants-changed";

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
  /** The account's own plans and eaten meals; profiles' are in allPlans/allLogs. */
  plans: LocalPlan[];
  logs: LocalLog[];
  allPlans: LocalPlan[];
  allLogs: LocalLog[];
  goals: LocalGoal[];
  preferences: LocalPreferences[];
  feedback: LocalFeedback[];
  profiles: LocalProfile[];
  /** Groups as last seen online; null until known. */
  groups: GroupSummary[] | null;
  refreshGroups: () => Promise<void>;
  /** True once this account's records have been read from the device. */
  kitchenLoaded: boolean;
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
  const [goals, setGoals] = useState<LocalGoal[]>([]);
  const [preferences, setPreferences] = useState<LocalPreferences[]>([]);
  const [feedback, setFeedback] = useState<LocalFeedback[]>([]);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [kitchenLoaded, setKitchenLoaded] = useState(false);
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
      if (typeof caches !== "undefined") void caches.delete("recipe-images").catch(() => false);
          if (typeof caches !== "undefined") void caches.delete("recipe-images").catch(() => false);
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
      setGoals([]);
      setPreferences([]);
      setFeedback([]);
      setProfiles([]);
      setGroups(null);
      setKitchenLoaded(false);
      return;
    }
    let disposed = false;
    let cleanup = () => {};
    void openUserDb(account.id, () => setStorageNotice("evicted")).then((db) => {
      if (disposed) return db.close();
      const e = new SyncEngine(db);
      const refresh = () =>
        void Promise.all([e.listRecipes(), e.listAllPlans(), e.listAllLogs(), e.listGoals(), e.listPreferences(), e.listFeedback(), e.listProfiles()]).then(
          ([r, p, l, g, prefs, fb, profs]) => {
            if (disposed) return;
            setRecipes(r);
            setPlans(p);
            setLogs(l);
            setGoals(g);
            setPreferences(prefs);
            setFeedback(fb);
            setProfiles(profs);
            setKitchenLoaded(true);
          },
        );
      const unsub = e.subscribe(refresh);
      // With Claude or ChatGPT connected, their changes show up within seconds while the app is
      // open (and only then): a quiet pull every few seconds when the tab is visible.
      let assistantConnected = false;
      const checkAssistants = () =>
        void api.connectedApps().then(
          (apps) => void (assistantConnected = apps.length > 0),
          () => void (assistantConnected = false),
        );
      const live = setInterval(() => {
        if (assistantConnected && document.visibilityState === "visible") void e.pullQuietly();
      }, LIVE_PULL_MS);
      const resume = () => {
        if (document.visibilityState !== "visible") return;
        void e.syncNow();
        checkAssistants();
      };
      const reconnect = () => void e.syncNow();
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", reconnect);
      window.addEventListener(ASSISTANTS_CHANGED, checkAssistants);
      checkAssistants();
      cleanup = () => {
        unsub();
        clearInterval(live);
        window.removeEventListener(ASSISTANTS_CHANGED, checkAssistants);
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("online", reconnect);
        db.close();
      };
      setEngine(e);
      refresh();
      void db.get("meta", "groups").then((cached) => !disposed && cached && setGroups(cached as CachedGroups));
      // Daily targets from before goals were synced move into goals once, then leave the device.
      void migrateTargets(account.id, e).finally(() => void e.syncNow());
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [account?.id]);

  // Which groups this account is in, when online. Copies of recipes from groups it has left go.
  const refreshGroups = useCallback(async () => {
    if (!engine) return;
    try {
      const { groups: list } = await api.groups();
      setGroups(list);
      await engine.db.put("meta", list, "groups");
      await engine.forgetGroupRecipes(new Set(list.map((g) => g.id)));
    } catch {
      // Offline: keep what was last seen.
    }
  }, [engine]);

  useEffect(() => {
    if (engine && online) void refreshGroups();
  }, [engine, online, refreshGroups]);

  const refreshRecipes = useCallback(async () => {
    if (engine) setRecipes(await engine.listRecipes());
  }, [engine]);

  const setAccount = useCallback((me: Me) => {
    const prev = rememberedAccount();
    if (prev && prev.id !== me.id) {
      void deleteUserDb(prev.id);
      clearTargets(prev.id);
      if (typeof caches !== "undefined") void caches.delete("recipe-images").catch(() => false);
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
    endSession();
    // Recipe images cached for offline use go with the account.
    if (typeof caches !== "undefined") await caches.delete("recipe-images").catch(() => false);
    // Personal records leave the device with the account; the shared catalog stays.
    if (id) {
      clearTargets(id);
      await deleteUserDb(id).catch(() => {});
    }
  }, [account?.id]);

  const value = useMemo<AppState>(() => {
    const own = <T extends { body: { profileId?: string | null } }>(list: T[]) => list.filter((x) => !x.body.profileId);
    return {
      account, accountChecked, engine, catalog, recipes, plans: own(plans), logs: own(logs), allPlans: plans, allLogs: logs, goals,
      preferences, feedback, profiles, groups, refreshGroups, kitchenLoaded, online, setAccount, signOut, refreshRecipes, storageNotice,
      dismissStorageNotice: () => setStorageNotice(null),
    };
  }, [account, accountChecked, engine, catalog, recipes, plans, logs, goals, preferences, feedback, profiles, groups, refreshGroups, kitchenLoaded, online, setAccount, signOut, refreshRecipes, storageNotice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
