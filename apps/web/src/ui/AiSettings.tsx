import { useEffect, useState } from "react";
import type { AiProvider, AiSettings as Settings } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError } from "../api.ts";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { publishAiSettings } from "./Companion.tsx";
import { EmptyState } from "./common.tsx";
import { ConnectedApps } from "./Connect.tsx";

const NAMES: Record<AiProvider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI (ChatGPT)" };
const KEY_PAGES: Record<AiProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

/** Bring-your-own-key settings. The key goes to the server once and never comes back. */
export function AiSettings() {
  const { account, online } = useApp();
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "offline">("loading");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [limit, setLimit] = useState("");

  function apply(s: Settings) {
    setSettings(s);
    setLimit(String(s.dailyRequestLimit));
    setState("ready");
    if (account) publishAiSettings(account.id, s);
  }

  useEffect(() => {
    if (!online) return setState("offline");
    api
      .aiSettings()
      .then(apply)
      .catch((err) => setState(err instanceof ApiRequestError && err.code === "feature_disabled" ? "unavailable" : "offline"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function run(action: () => Promise<Settings>, done?: string) {
    setError(null);
    setNote(null);
    try {
      apply(await action());
      if (done) setNote(done);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("ai.offline"));
    }
  }

  const head = (
    <header className="screen-head">
      <div>
        <p className="eyebrow">{t("nav.you")}</p>
        <h1>{t("ai.title")}</h1>
      </div>
    </header>
  );

  if (state !== "ready" || !settings) {
    return (
      <div className="screen">
        {head}
        {state === "loading" ? <p className="hint">{t("common.loading")}</p> : <EmptyState title={t(state === "unavailable" ? "ai.unavailable" : "ai.offline")} />}
        {state === "unavailable" && <ConnectedApps />}
      </div>
    );
  }

  const connected = settings.providers.filter((p) => p.connected);
  const invalidLimit = !(Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 2000);

  return (
    <div className="screen">
      {head}
      <p className="hint">{t("ai.intro")}</p>
      <p className="hint">{t("ai.privacy")}</p>

      {settings.house.status !== "off" && (
        <section className="ai-provider" data-testid="ai-included">
          <div className="ai-provider-head">
            <h2>{t("ai.includedTitle")}</h2>
            {settings.house.status === "available" && !settings.activeProvider ? <span className="tag tag-sage">{t("ai.inUse")}</span> : null}
          </div>
          <p className="hint">
            {settings.house.status === "not_invited"
              ? t("ai.includedNotInvited")
              : settings.house.status === "budget_reached"
                ? t("ai.includedUsedUp")
                : t("ai.includedHint", { model: settings.house.model ?? "" })}
          </p>
          {settings.house.status !== "not_invited" && (
            <p className="hint" data-testid="ai-included-usage">
              {t("ai.usage", { n: settings.house.requestsToday, limit: settings.house.dailyLimit })}
            </p>
          )}
        </section>
      )}

      {settings.providers.map((p) => (
        <section key={p.provider} className="ai-provider" data-testid={`ai-provider-${p.provider}`}>
          <div className="ai-provider-head">
            <h2>{NAMES[p.provider]}</h2>
            {p.connected && settings.activeProvider === p.provider ? (
              <span className="tag tag-sage">{t("ai.inUse")}</span>
            ) : p.connected ? (
              <button type="button" className="btn-link" onClick={() => void run(() => api.updateAiSettings({ activeProvider: p.provider }))}>
                {t("ai.use")}
              </button>
            ) : (
              <span className="hint">{t("ai.notConnectedShort")}</span>
            )}
          </div>
          {p.connected ? (
            <>
              <p className="hint" data-private>
                {t("ai.connected", { hint: p.keyHint ?? "" })}
              </p>
              <label>
                {t("ai.model")}
                <select value={p.model ?? ""} onChange={(e) => void run(() => api.updateAiSettings({ model: { provider: p.provider, model: e.target.value } }), t("ai.saved"))}>
                  {p.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-link danger"
                onClick={() => {
                  if (!confirm(t("ai.disconnectConfirm", { provider: NAMES[p.provider] }))) return;
                  track("Disconnected an AI provider");
                  void run(() => api.disconnectAi(p.provider));
                }}
              >
                {t("ai.disconnect")}
              </button>
            </>
          ) : (
            <ConnectForm provider={p.provider} onConnect={(key) => run(() => api.connectAi(p.provider, key).then((s) => (track("Connected an AI provider"), s)))} />
          )}
        </section>
      ))}

      {connected.length > 0 && (
        <section className="ai-provider">
          <label htmlFor="ai-limit">{t("ai.limit")}</label>
          <p className="hint">{t("ai.limitHint")}</p>
          <div className="ai-limit">
            <input id="ai-limit" type="number" min={1} max={2000} step={1} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
            <button type="button" className="btn-secondary" disabled={invalidLimit} onClick={() => void run(() => api.updateAiSettings({ dailyRequestLimit: Number(limit) }), t("ai.saved"))}>
              {t("ai.save")}
            </button>
          </div>
          <p className="hint" data-testid="ai-usage">
            {t("ai.usage", { n: settings.requestsToday, limit: settings.dailyRequestLimit })}
          </p>
        </section>
      )}

      <ConnectedApps />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

function ConnectForm({ provider, onConnect }: { provider: AiProvider; onConnect: (key: string) => Promise<void> }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onConnect(key.trim());
        setKey("");
        setBusy(false);
      }}
    >
      <label htmlFor={`ai-key-${provider}`}>{t("ai.keyLabel", { provider: NAMES[provider] })}</label>
      <input id={`ai-key-${provider}`} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} data-private />
      <button type="submit" className="btn-primary" disabled={busy || key.trim().length < 8}>
        {busy ? t("ai.checking") : t("ai.connectBtn")}
      </button>
      <a href={KEY_PAGES[provider]} target="_blank" rel="noopener noreferrer" className="hint">
        {t("ai.getKey")}
      </a>
    </form>
  );
}
