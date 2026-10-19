import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { format, formatQty, getLang, setLang, t, tOr } from "./i18n.ts";
import { en } from "./locales/en.ts";
import { es, esExtra } from "./locales/es.ts";

// Names only: a language may need a plural form where English doesn't.
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]))].sort();

describe("interface strings", () => {
  it("Spanish has every key with the same placeholders, and nothing empty", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(es[key], key).toBeTruthy();
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("every key is used by the app", () => {
    const dir = join(import.meta.dirname, "ui");
    const source = [...readdirSync(dir).map((f) => join(dir, f)), join(import.meta.dirname, "meals.ts"), join(import.meta.dirname, "i18n.ts")]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unused = Object.keys(en).filter((k) => !source.includes(`"${k}"`));
    expect(unused).toEqual([]);
  });

  it("covers every nutrient in the catalog and every safety-chart group", async () => {
    const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/catalog/starter-catalog.json"), "utf8")) as { nutrients: { key: string }[] };
    for (const n of catalog.nutrients) expect(esExtra[`nutrient.${n.key}`], n.key).toBeTruthy();
    const { SAFETY_RULES } = await import("@betterplate/nutrition");
    for (const rule of Object.values(SAFETY_RULES)) {
      expect(esExtra[`safety.${rule.id}.label`], rule.id).toBeTruthy();
      if (rule.note) expect(esExtra[`safety.${rule.id}.note`], rule.id).toBeTruthy();
    }
  });

  it("fills values and picks singular or plural", () => {
    expect(format("{n|1 serving|# servings}", { n: 1 })).toBe("1 serving");
    expect(format("{n|1 serving|# servings}", { n: 2.5 })).toBe("2.5 servings");
    expect(format("Hi {name}", { name: "Ana" })).toBe("Hi Ana");
    expect(format("Hi {name}")).toBe("Hi {name}");
  });

  it("switches language, formats amounts, and keeps 'not reported' distinct from zero", () => {
    const before = getLang();
    try {
      setLang("es");
      expect(t("nav.kitchen")).toBe("Cocina");
      expect(t("common.servings", { n: 2 })).toBe("2 porciones");
      expect(formatQty(1.25, "g")).toBe("1,3 g");
      expect(formatQty(0, "mg")).toBe("0 mg");
      expect(formatQty(null, "mg")).toBe("Sin dato");
      expect(tOr("nutrient.protein", "Protein")).toBe("Proteína");
      expect(tOr("nutrient.unknown_key", "Fallback")).toBe("Fallback");
      setLang("en");
      expect(formatQty(1.25, "g")).toBe("1.3 g");
      expect(formatQty(null, "mg")).toBe("Not reported");
      expect(tOr("nutrient.protein", "Protein")).toBe("Protein");
    } finally {
      setLang(before);
    }
  });
});
