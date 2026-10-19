import { useState } from "react";
import { PRIVACY_NOTICE } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import { useApp } from "../store.tsx";

function NoticeBody() {
  return (
    <>
      {PRIVACY_NOTICE.sections.map((s) => (
        <section key={s.heading} className="notice-section">
          <h2>{s.heading}</h2>
          <p>{s.body}</p>
        </section>
      ))}
      <p className="fine">
        Version {PRIVACY_NOTICE.version}.{" "}
        {PRIVACY_NOTICE.reviewStatus === "draft" ? "This is a draft for the pilot and hasn't been reviewed by a lawyer yet." : ""}
      </p>
    </>
  );
}

/** The full notice, readable before signing in. */
export function PrivacyPage() {
  return (
    <div className="public-page">
      <header className="public-head">
        <a className="public-brand" href="#/kitchen">
          The Better Plate
        </a>
      </header>
      <main id="main" className="public-main notice">
        <p className="eyebrow">Privacy</p>
        <h1>{PRIVACY_NOTICE.title}</h1>
        <NoticeBody />
        <a className="btn-secondary" href="#/kitchen">
          Back
        </a>
      </main>
    </div>
  );
}

/** Asked once per notice version, after signing in and before the kitchen opens. */
export function ConsentScreen() {
  const { account, setAccount, signOut } = useApp();
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
      setProblem(err instanceof NetworkError ? "You're offline. Connect once to agree, then the app works offline." : err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const updated = account?.privacy?.acceptedVersion != null;
  return (
    <div className="public-page">
      <main id="main" className="public-main notice" data-testid="consent-screen">
        <p className="eyebrow">{updated ? "Privacy notice updated" : "Before you start"}</p>
        <h1>{PRIVACY_NOTICE.title}</h1>
        <NoticeBody />
        <label className="check consent-check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          I'm 18 or older
        </label>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="consent-actions">
          <button type="button" className="btn-primary" disabled={!adult || busy} onClick={() => void agree()}>
            Agree and continue
          </button>
          <button type="button" className="btn-link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
