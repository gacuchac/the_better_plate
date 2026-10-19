import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AiSettings } from "@betterplate/contracts";
import { sessionFor, type AgentStep, type ChatItem } from "../agent.ts";
import { api, ApiRequestError } from "../api.ts";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { navigate } from "./common.tsx";
import { Icon } from "./icons.tsx";

/** null: not checked yet; false: the companion is switched off on this server. */
type Availability = AiSettings | false | null;

let cachedSettings: { accountId: string; settings: AiSettings | false } | null = null;
const settingsListeners = new Set<(s: AiSettings | false) => void>();

/** AI settings screens call this after a change so the panel follows without a reload. */
export function publishAiSettings(accountId: string, settings: AiSettings) {
  cachedSettings = { accountId, settings };
  settingsListeners.forEach((fn) => fn(settings));
}

export function useAiSettings(accountId: string | undefined, online: boolean): Availability {
  const [value, setValue] = useState<Availability>(() => (cachedSettings && cachedSettings.accountId === accountId ? cachedSettings.settings : null));
  useEffect(() => {
    settingsListeners.add(setValue);
    return () => void settingsListeners.delete(setValue);
  }, []);
  useEffect(() => {
    if (!accountId || !online || (cachedSettings?.accountId === accountId && cachedSettings.settings !== null)) return;
    let cancelled = false;
    api
      .aiSettings()
      .then((s) => !cancelled && publishAiSettings(accountId, s))
      .catch((err) => {
        if (cancelled || !(err instanceof ApiRequestError) || err.code !== "feature_disabled") return;
        cachedSettings = { accountId, settings: false };
        setValue(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, online]);
  return value;
}

/**
 * The companion panel. It is not modal: on desktop it sits beside the app, on phones it covers
 * the lower part, so the person can watch the screens change as the agent works.
 */
export function Companion() {
  const { account, engine, catalog, online } = useApp();
  const t = useT();
  const settings = useAiSettings(account?.id, online);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const session = account ? sessionFor(account.id) : null;
  const snap = useSyncExternalStore(session?.subscribe ?? (() => () => {}), session?.getSnapshot ?? (() => EMPTY));

  useEffect(() => {
    document.body.classList.toggle("companion-open", open);
    return () => document.body.classList.remove("companion-open");
  }, [open]);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [snap.items.length, snap.running]);

  if (!account || !session || settings === false) return null;

  const provider = settings ? settings.activeProvider : null;
  const ready = !!provider && catalog.status === "ready" && !!engine;

  function send() {
    const message = text.trim();
    if (!message || !ready || !online || snap.running) return;
    setText("");
    void session!.send(message, provider!, { engine: engine!, foods: catalog.status === "ready" ? catalog.foods : new Map(), nutrients: catalog.status === "ready" ? catalog.bundle.nutrients : [], accountId: account!.id, navigate });
  }

  if (!open) {
    return (
      <button type="button" className="companion-fab" onClick={() => setOpen(true)} data-testid="companion-open">
        <Icon name="sparkle" size={20} />
        <span>{t("agent.open")}</span>
      </button>
    );
  }

  return (
    <aside className="companion" aria-label={t("agent.title")} data-testid="companion">
      <header className="companion-head">
        <h2>
          <Icon name="sparkle" size={18} /> {t("agent.title")}
        </h2>
        <span className="companion-head-actions">
          {snap.items.length > 0 && !snap.running && (
            <button type="button" className="btn-link" onClick={() => session.reset()}>
              {t("agent.newChat")}
            </button>
          )}
          <button type="button" className="icon-btn round" aria-label={t("agent.close")} onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </span>
      </header>

      <ol className="companion-log" ref={logRef} aria-live="polite" aria-relevant="additions">
        {snap.items.length === 0 && (
          <li className="companion-hint">
            <p>{t("agent.intro")}</p>
            <p className="fine">{t("agent.disclaimer")}</p>
          </li>
        )}
        {snap.items.map((item) => (
          <ChatRow key={item.id} item={item} onUndo={(id) => void session.undo(id)} onConfirm={(id, ok) => session.confirm(id, ok)} />
        ))}
        {snap.running && !snap.items.some((i) => i.kind === "step" && (i.step.status === "running" || i.step.status === "waiting")) && (
          <li className="companion-thinking">{t("agent.thinking")}</li>
        )}
      </ol>

      {settings === null ? null : !provider ? (
        <div className="companion-foot">
          <p className="hint">{t("agent.notConnected")}</p>
          <button type="button" className="btn-secondary" onClick={() => navigate("/ai")}>
            {t("agent.connect")}
          </button>
        </div>
      ) : (
        <form
          className="companion-foot"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {!online && <p className="hint">{t("agent.needsOnline")}</p>}
          <label className="sr-only" htmlFor="companion-input">
            {t("agent.placeholder")}
          </label>
          <textarea
            id="companion-input"
            ref={inputRef}
            rows={2}
            maxLength={4000}
            value={text}
            placeholder={t("agent.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {snap.running ? (
            <button type="button" className="btn-secondary" onClick={() => session.stop()}>
              <Icon name="stop" size={16} /> {t("agent.stop")}
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={!text.trim() || !online || !ready}>
              {t("agent.send")}
            </button>
          )}
        </form>
      )}
    </aside>
  );
}

const EMPTY = { items: [] as ChatItem[], running: false };

function ChatRow({ item, onUndo, onConfirm }: { item: ChatItem; onUndo: (id: string) => void; onConfirm: (id: string, ok: boolean) => void }) {
  const t = useT();
  if (item.kind === "user") return <li className="bubble bubble-user">{item.text}</li>;
  if (item.kind === "assistant") return <li className="bubble bubble-agent">{item.text}</li>;
  if (item.kind === "notice") return <li className="companion-notice" role="status">{item.text}</li>;
  const s: AgentStep = item.step;
  return (
    <li className={`step step-${s.status}`} data-testid="companion-step" data-tool={s.tool} data-status={s.status}>
      <span className="step-mark" aria-hidden="true">
        {s.status === "done" ? <Icon name="check" size={16} /> : s.status === "undone" ? <Icon name="undo" size={16} /> : s.status === "failed" ? "!" : "•"}
      </span>
      <span className="step-text">
        <span className="step-label">{s.label}</span>
        {s.detail && <span className="step-detail">{s.detail}</span>}
        <span className="sr-only">
          {s.status === "failed" ? t("agent.failedStep") : s.status === "undone" ? t("agent.undone") : s.status === "declined" ? t("agent.declined") : s.status === "waiting" ? t("agent.waiting") : ""}
        </span>
        {s.status === "undone" && <span className="step-detail">{t("agent.undone")}</span>}
        {s.status === "declined" && <span className="step-detail">{t("agent.declined")}</span>}
      </span>
      {s.canUndo && s.status === "done" && (
        <button type="button" className="btn-link step-action" onClick={() => onUndo(s.id)}>
          {t("agent.undo")}
        </button>
      )}
      {s.status === "waiting" && (
        <span className="step-confirm">
          <button type="button" className="btn-danger" onClick={() => onConfirm(s.id, true)}>
            {t("agent.confirmDelete")}
          </button>
          <button type="button" className="btn-secondary" onClick={() => onConfirm(s.id, false)}>
            {t("agent.keep")}
          </button>
        </span>
      )}
    </li>
  );
}
