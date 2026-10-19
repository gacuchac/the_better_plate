import { useState } from "react";
import { useApp } from "../store.tsx";
import { clearTargets, saveTargets, useTargets } from "../targets.ts";
import { nutrientName, useT } from "../i18n.ts";
import { EmptyState } from "./common.tsx";

/**
 * Daily targets the person types in. Nothing is suggested or computed from body data; empty
 * means no percentages are shown for that nutrient.
 */
export function Targets() {
  const { account, catalog } = useApp();
  const t = useT();
  const saved = useTargets(account?.id);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(saved.map((s) => [s.key, String(s.amount)])));
  const [note, setNote] = useState<string | null>(null);

  if (catalog.status !== "ready" || !account) return <EmptyState title={t("catalog.notReady")}>{t("common.loading")}</EmptyState>;
  const defs = catalog.bundle.nutrients;
  const invalid = Object.values(draft).some((v) => v.trim() !== "" && !(Number(v) > 0 && Number(v) < 1_000_000));

  function save() {
    saveTargets(
      account!.id,
      defs.flatMap((d) => {
        const v = draft[d.key]?.trim();
        return v ? [{ key: d.key, unit: d.unit, amount: Number(v) }] : [];
      }),
    );
    setNote(t("targets.saved"));
  }

  function clear() {
    clearTargets(account!.id);
    setDraft({});
    setNote(t("targets.cleared"));
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("nav.you")}</p>
          <h1>{t("targets.title")}</h1>
        </div>
      </header>
      <p className="hint">{t("targets.intro")}</p>
      <ul className="target-list">
        {defs.map((d) => (
          <li key={d.key} className="target-row">
            <label htmlFor={`target-${d.key}`}>{nutrientName(d.key, d.name)}</label>
            <span className="target-input">
              <input
                id={`target-${d.key}`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={draft[d.key] ?? ""}
                placeholder={t("targets.none")}
                onChange={(e) => {
                  setDraft({ ...draft, [d.key]: e.target.value });
                  setNote(null);
                }}
              />
              <span className="target-unit">{d.unit}</span>
            </span>
          </li>
        ))}
      </ul>
      {invalid && (
        <p className="error" role="alert">
          {t("targets.invalid")}
        </p>
      )}
      <div className="stack">
        <button type="button" className="btn-primary" disabled={invalid} onClick={save}>
          {t("targets.save")}
        </button>
        {saved.length > 0 && (
          <button type="button" className="btn-link danger" onClick={clear}>
            {t("targets.clear")}
          </button>
        )}
      </div>
      {note && (
        <p className="hint" role="status" data-testid="targets-status">
          {note}
        </p>
      )}
      <p className="fine">{t("targets.fine")}</p>
    </div>
  );
}
