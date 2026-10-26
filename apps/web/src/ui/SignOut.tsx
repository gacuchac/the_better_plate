import { useState } from "react";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { downloadJson, navigate, Sheet } from "./common.tsx";

/** Header button. With unsynced changes it asks first: export, sign out anyway, or cancel. */
export function SignOutButton() {
  const { engine, signOut } = useApp();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  async function finish() {
    setBusy(true);
    setPending(0);
    await signOut();
    navigate("/kitchen");
    setBusy(false);
  }

  async function request() {
    const count = (await engine?.pendingCount()) ?? 0;
    if (count) setPending(count);
    else await finish();
  }

  async function exportThenSignOut() {
    if (engine) downloadJson(await engine.exportUnsynced(), "better-plate-unsynced");
    await finish();
  }

  return (
    <>
      <button type="button" className="btn-link inline signout-btn" disabled={busy} onClick={() => void request()}>
        {t("common.signOut")}
      </button>
      {pending > 0 && (
        <Sheet title={t("you.signOutTitle")} onClose={() => setPending(0)}>
          <p>{t("you.signOutConfirm", { n: pending })}</p>
          <div className="stack">
            <button type="button" className="btn-primary" onClick={() => void exportThenSignOut()}>
              {t("you.signOutExport")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void finish()}>
              {t("you.signOutAnyway")}
            </button>
            <button type="button" className="btn-link" onClick={() => setPending(0)}>
              {t("common.cancel")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
