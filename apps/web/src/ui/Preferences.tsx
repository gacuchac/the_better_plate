import { useState } from "react";
import type { FoodPreferencesBody } from "@betterplate/contracts";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { PreferencesForm, preferencesOf, SubjectChips, useSubject } from "./People.tsx";

/** What a person tells us about food: allergies (always asked), likes, dislikes. Saved on this device first. */
export function Preferences() {
  const { engine, account, preferences, profiles, online } = useApp();
  const t = useT();
  const [subject, setSubject] = useSubject();
  const [saved, setSaved] = useState(false);
  const current = preferencesOf(preferences, account?.id, subject);
  const profile = profiles.find((p) => p.id === subject);

  async function save(body: FoodPreferencesBody) {
    if (!engine || !account) return;
    await engine.savePreferences(subject ?? account.id, { ...body, profileId: subject });
    setSaved(true);
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("nav.you")}</p>
          <h1>{t("prefs.title")}</h1>
        </div>
      </header>
      <p className="hint">{t("prefs.intro")}</p>
      <SubjectChips
        value={subject}
        onChange={(s) => {
          setSubject(s);
          setSaved(false);
        }}
      />
      {current?.state === "conflict" && (
        <div className="banner banner-warn" role="alert">
          <p>{t("prefs.conflict")}</p>
          <div className="banner-actions">
            <button type="button" className="btn-secondary" onClick={() => void engine?.resolveVersionedConflict("prefs", current.id, "mine")}>
              {t("conflict.keepMine")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void engine?.resolveVersionedConflict("prefs", current.id, "cloud")}>
              {t("conflict.keepCloud")}
            </button>
          </div>
        </div>
      )}
      {current?.state === "rejected" && (
        <p className="banner banner-warn" role="alert">
          {t("editor.rejected", { reason: current.rejection ?? "" })}
        </p>
      )}
      <PreferencesForm key={`${subject ?? "me"}:${current?.serverVersion ?? "new"}:${current?.state ?? ""}`} initial={current?.body} name={profile?.name ?? null} onSave={save} />
      {saved && (
        <p className="hint" role="status" data-testid="prefs-saved">
          {online ? t("editor.savedSyncing") : t("editor.savedOffline")}
        </p>
      )}
    </div>
  );
}
