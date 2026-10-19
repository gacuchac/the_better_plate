import { useSyncExternalStore } from "react";
import { formatAmount } from "@betterplate/nutrition";
import { en } from "./locales/en.ts";
import { es, esExtra } from "./locales/es.ts";

/**
 * Interface strings by key. English is the source; every other language must define every key
 * (enforced by the type below and a unit test on placeholders). Food names, nutrient data and
 * server messages come from their sources and are not translated here.
 *
 * Message syntax: `{name}` inserts a value; `{n|one form|other form}` picks by count, with `#`
 * standing for the number.
 */
export type Lang = "en" | "es";
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

const STORAGE_KEY = "bp.lang";
const dictionaries: Record<Lang, Messages> = { en, es };
const extras: Record<Lang, Record<string, string>> = { en: {}, es: esExtra };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "es") return saved;
  } catch {
    // Storage blocked: fall back to the browser's language.
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered on this device; still applies for this visit.
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Locale for dates and numbers: the browser's own for English (as before), Spanish otherwise. */
export const dateLocale = (): string | undefined => (lang === "en" ? undefined : lang);

export type Vars = Record<string, string | number>;

export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (whole, name: string, one?: string, other?: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    if (one === undefined) return typeof value === "number" ? value.toLocaleString(dateLocale()) : value;
    const n = Number(value);
    return (n === 1 ? one : other!).replace(/#/g, n.toLocaleString(dateLocale()));
  });
}

export function t(key: MessageKey, vars?: Vars): string {
  return format(dictionaries[lang][key] ?? en[key], vars);
}

/** Looks up an optional key (nutrient or safety-chart names) and falls back to the source text. */
export function tOr(key: string, fallback: string, vars?: Vars): string {
  const template = extras[lang][key];
  return template === undefined ? fallback : format(template, vars);
}

/** Re-renders the component when the language changes. */
export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

export const nutrientName = (key: string, fallback: string) => tOr(`nutrient.${key}`, fallback);

/** A nutrient amount with its unit, in the interface language; "Not reported" is never shown as zero. */
export function formatQty(amount: number | null, unit: string): string {
  if (amount === null) return t("nutrition.notReported");
  if (lang === "en") return formatAmount(amount, unit);
  const abs = Math.abs(amount);
  const digits = amount === 0 || abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  return `${amount.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}
