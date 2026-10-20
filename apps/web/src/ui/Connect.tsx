import { useEffect, useState } from "react";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError, type ConnectedApp, type OAuthClientInfo } from "../api.ts";
import { API_URL } from "../env.ts";
import { useT, type MessageKey } from "../i18n.ts";
import { ASSISTANTS_CHANGED } from "../store.tsx";

// Claude, ChatGPT or another assistant asks to reach this kitchen. The API sends the person here
// with a signed authorization query: `#/connect/login?…` before they were signed in, `#/connect?…`
// to approve. Nothing is granted until they press Allow.

const SIGNED_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];
const PENDING_KEY = "bp.connect";

const SCOPE_TEXT: Record<string, MessageKey> = {
  "kitchen:read": "connect.scopeRead",
  "kitchen:write": "connect.scopeWrite",
  offline_access: "connect.scopeOffline",
};

/** Remembers a connect request across a full-page sign-in (Google) so it can resume afterwards. */
export function rememberConnect() {
  try {
    if (location.hash.startsWith("#/connect")) sessionStorage.setItem(PENDING_KEY, location.hash.slice(1));
  } catch {
    // Storage blocked: the person can start the connection again from their assistant.
  }
}

export function takePendingConnect(): string | null {
  try {
    const path = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return path;
  } catch {
    return null;
  }
}

/** After signing in, hand the original request back to the authorization server. */
export function ResumeConnect({ query }: { query: string }) {
  const t = useT();
  useEffect(() => {
    const params = new URLSearchParams(query);
    for (const p of SIGNED_PARAMS) params.delete(p);
    const prompts = (params.get("prompt") ?? "").split(" ").filter((p) => p && p !== "login" && p !== "create");
    if (prompts.length) params.set("prompt", prompts.join(" "));
    else params.delete("prompt");
    location.replace(`${API_URL}/v1/auth/oauth2/authorize?${params}`);
  }, [query]);
  return <p className="hint pad">{t("connect.continuing")}</p>;
}

export function ConnectConsent({ query }: { query: string }) {
  const t = useT();
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id") ?? "";
  const scopes = (params.get("scope") ?? "").split(" ").filter((s) => s in SCOPE_TEXT);
  let redirectHost = "";
  try {
    redirectHost = new URL(params.get("redirect_uri") ?? "").host;
  } catch {
    redirectHost = "";
  }
  const [client, setClient] = useState<OAuthClientInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void api.oauthClient(clientId).then(setClient, () => setClient({ client_id: clientId }));
  }, [clientId]);

  async function answer(accept: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const { url } = await api.oauthConsent(accept, query);
      if (accept) track("Connected an assistant");
      location.assign(url);
    } catch (err) {
      setProblem(err instanceof NetworkError ? t("connect.offline") : err instanceof ApiRequestError && err.status === 400 ? t("connect.expired") : t("common.tryAgain"));
      setBusy(false);
    }
  }

  const name = client?.client_name || t("connect.unnamed");
  return (
    <div className="public-page">
      <main id="main" className="public-main notice" data-testid="connect-consent">
        <p className="eyebrow">{t("connect.eyebrow")}</p>
        <h1>{t("connect.title", { name })}</h1>
        <p className="lede">{t("connect.lede")}</p>
        {redirectHost && (
          <p className="hint" data-testid="connect-redirect">
            {t("connect.returnsTo", { host: redirectHost })}
          </p>
        )}
        <h2>{t("connect.canTitle")}</h2>
        <ul className="connect-scopes">
          {scopes.map((s) => (
            <li key={s}>{t(SCOPE_TEXT[s]!)}</li>
          ))}
        </ul>
        <p className="hint">{t("connect.cannot")}</p>
        <p className="hint">{t("connect.undo")}</p>
        <div className="connect-actions">
          <button type="button" className="btn-primary" disabled={busy || !client} onClick={() => void answer(true)}>
            {t("connect.allow")}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void answer(false)}>
            {t("connect.deny")}
          </button>
        </div>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </main>
    </div>
  );
}

/** "Connected apps" under AI settings: who can reach the kitchen, and a way to cut them off. */
export function ConnectedApps() {
  const t = useT();
  const [apps, setApps] = useState<(ConnectedApp & { name: string })[] | null>(null);
  const [off, setOff] = useState(false);

  async function load() {
    try {
      const consents = await api.connectedApps();
      const named = await Promise.all(
        consents.map(async (c) => ({ ...c, name: (await api.oauthClient(c.clientId).catch(() => null))?.client_name || t("connect.unnamed") })),
      );
      setApps(named);
    } catch (err) {
      // 404: the connector is switched off on this server.
      if (err instanceof ApiRequestError && err.status === 404) setOff(true);
      else setApps([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (off) return null;
  return (
    <section className="ai-provider" data-testid="connected-apps">
      <div className="ai-provider-head">
        <h2>{t("connect.appsTitle")}</h2>
      </div>
      <p className="hint">{t("connect.appsHint")}</p>
      <p className="hint">{t("connect.appsUrl")}</p>
      <ConnectorAddress />
      <AssistantButtons />
      {apps && apps.length === 0 && <p className="hint">{t("connect.appsNone")}</p>}
      {apps?.map((a) => (
        <div key={a.id} className="ai-provider-head" data-testid="connected-app">
          <span>{a.name}</span>
          <button
            type="button"
            className="btn-link"
            onClick={() =>
              void api.disconnectApp(a.id).then(() => {
                track("Disconnected an assistant");
                window.dispatchEvent(new Event(ASSISTANTS_CHANGED));
                return load();
              })
            }
          >
            {t("connect.disconnect")}
          </button>
        </div>
      ))}
    </section>
  );
}

const ASSISTANTS = [
  { name: "Claude", url: "https://claude.ai/new" },
  { name: "ChatGPT", url: "https://chatgpt.com/" },
] as const;

/** Opens Claude or ChatGPT in its own window; on wide screens it sits beside the app. */
function openAssistant(url: string) {
  const width = 480;
  const wide = window.screen.availWidth >= 1200;
  const features = wide ? `popup,width=${width},height=${window.screen.availHeight},left=${window.screen.availWidth - width},top=0` : "";
  track("Opened an outside assistant");
  window.open(url, "bp-assistant", features ? `${features},noopener` : "noopener");
}

export function AssistantButtons() {
  const t = useT();
  return (
    <div className="assistant-buttons">
      {ASSISTANTS.map((a) => (
        <button key={a.name} type="button" className="btn-secondary" onClick={() => openAssistant(a.url)}>
          {t("connect.open", { name: a.name })}
        </button>
      ))}
    </div>
  );
}

export function ConnectorAddress() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const address = `${API_URL}/mcp`;
  return (
    <div className="connector-address">
      <code data-testid="connector-url">{address}</code>
      <button
        type="button"
        className="btn-link"
        onClick={() =>
          void navigator.clipboard?.writeText(address).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? t("connect.copied") : t("connect.copy")}
      </button>
    </div>
  );
}

/** Inside the companion: the alternative of using the person's own Claude or ChatGPT. */
export function UseYourAssistant({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <div className="companion-hint use-assistant" data-testid="use-assistant">
      <h3>{t("connect.useTitle")}</h3>
      <p>{t("connect.useLede")}</p>
      <ol className="use-assistant-steps">
        <li>
          {t("connect.useStep1")}
          <ConnectorAddress />
        </li>
        <li>{t("connect.useStep2")}</li>
        <li>{t("connect.useStep3")}</li>
      </ol>
      <AssistantButtons />
      <p className="fine">{t("connect.useNote")}</p>
      <button type="button" className="btn-link" onClick={onBack}>
        {t("connect.useBack")}
      </button>
    </div>
  );
}

let connectorAvailable: Promise<boolean> | null = null;

/** Whether this server offers the connector (it answers 404 when switched off). */
export function useConnectorAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    connectorAvailable ??= api.connectedApps().then(
      () => true,
      (err) => {
        // Only "switched off" is final; other failures (offline) are asked again later.
        if (!(err instanceof ApiRequestError && err.status === 404)) connectorAvailable = null;
        return false;
      },
    );
    void connectorAvailable.then(setAvailable);
  }, []);
  return available;
}
