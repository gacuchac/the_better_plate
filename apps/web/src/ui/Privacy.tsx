import { useState } from "react";
import { PRIVACY_NOTICE } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import { useApp } from "../store.tsx";
import { useLang, useT } from "../i18n.ts";

function NoticeBody() {
  const t = useT();
  const lang = useLang();
  return (
    <>
      {lang !== "en" && (
        <p className="hint" lang={lang}>
          {t("privacy.englishOnly")}
        </p>
      )}
      {PRIVACY_NOTICE.sections.map((s) => (
        <section key={s.heading} className="notice-section" lang="en">
          <h2>{s.heading}</h2>
          <p>{s.body}</p>
        </section>
      ))}
      <p className="fine">
        {t("privacy.version", { version: PRIVACY_NOTICE.version })}{" "}
        {PRIVACY_NOTICE.reviewStatus === "draft" ? t("privacy.draft") : ""}
      </p>
    </>
  );
}

/** The full notice, readable before signing in. */
export function PrivacyPage() {
  const t = useT();
  return (
    <div className="public-page">
      <header className="public-head">
        <a className="public-brand" href="#/kitchen">
          The Better Plate
        </a>
      </header>
      <main id="main" className="public-main notice">
        <p className="eyebrow">{t("privacy.eyebrow")}</p>
        <h1 lang="en">{PRIVACY_NOTICE.title}</h1>
        <NoticeBody />
        <a className="btn-secondary" href="#/kitchen">
          {t("common.back")}
        </a>
      </main>
    </div>
  );
}

/** Asked once per notice version, after signing in and before the kitchen opens. */
export function ConsentScreen() {
  const { account, setAccount, signOut } = useApp();
  const t = useT();
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setProblem(null);
    try {
      const privacy = await api.consent(PRIVACY_NOTICE.version);
      track("Agreed to the privacy notice");
      setAccount({ ...account!, privacy });
    } catch (err) {
      setProblem(err instanceof NetworkError ? t("consent.offline") : err instanceof ApiRequestError ? err.message : t("common.tryAgain"));
      setBusy(false);
    }
  }

  const updated = account?.privacy?.acceptedVersion != null;
  return (
    <div className="public-page">
      <main id="main" className="public-main notice" data-testid="consent-screen">
        <p className="eyebrow">{updated ? t("consent.updated") : t("consent.beforeStart")}</p>
        <h1 lang="en">{PRIVACY_NOTICE.title}</h1>
        <NoticeBody />
        <label className="check consent-check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          {t("consent.adult")}
        </label>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="consent-actions">
          <button type="button" className="btn-primary" disabled={!adult || busy} onClick={() => void agree()}>
            {t("consent.agree")}
          </button>
          <button type="button" className="btn-link" onClick={() => void signOut()}>
            {t("common.signOut")}
          </button>
        </div>
      </main>
    </div>
  );
}
