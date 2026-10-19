import { LANGS, setLang, useLang, useT, type Lang } from "../i18n.ts";

/** Interface language. Food names stay as USDA publishes them, in English. */
export function LanguagePicker({ id = "language", hideLabel = false }: { id?: string; hideLabel?: boolean }) {
  const lang = useLang();
  const t = useT();
  return (
    <div className="language-picker">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {t("lang.label")}
      </label>
      <select id={id} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGS.map((l) => (
          <option key={l.value} value={l.value} lang={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
