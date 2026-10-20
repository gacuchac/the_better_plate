import { useMemo, useState } from "react";
import type { FoodPreferencesBody, GroupSummary } from "@betterplate/contracts";
import { ALLERGEN_SOURCE, ALLERGENS, allergenAlert, recipeAllergens, type Allergen, type FoodRecord, type RecipeForCalculation } from "@betterplate/nutrition";
import { useT, type MessageKey } from "../i18n.ts";
import type { LocalPreferences } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { Sheet } from "./common.tsx";
import { FoodPicker } from "./FoodPicker.tsx";
import { Icon } from "./icons.tsx";

export const ALLERGEN_LABEL: Record<Allergen, MessageKey> = {
  milk: "allergen.milk",
  egg: "allergen.egg",
  fish: "allergen.fish",
  shellfish: "allergen.shellfish",
  tree_nuts: "allergen.tree_nuts",
  peanut: "allergen.peanut",
  wheat: "allergen.wheat",
  soy: "allergen.soy",
  sesame: "allergen.sesame",
};

export const isAdminOf = (groups: GroupSummary[] | null, groupId: string | null | undefined) =>
  !!groupId && !!groups?.some((g) => g.id === groupId && (g.role === "owner" || g.role === "admin"));

/** null is the account itself; otherwise one of its profiles (a child without a login). */
export type Subject = string | null;

const SUBJECT_KEY = "bp.subject";

/** Whose meals the screens show; remembered for this visit so Meals and the shopping list agree. */
export function useSubject(): [Subject, (s: Subject) => void] {
  const { profiles } = useApp();
  const [subject, setSubject] = useState<Subject>(() => {
    try {
      return sessionStorage.getItem(SUBJECT_KEY) || null;
    } catch {
      return null;
    }
  });
  const valid = subject && profiles.some((p) => p.id === subject) ? subject : null;
  const set = (s: Subject) => {
    setSubject(s);
    try {
      if (s) sessionStorage.setItem(SUBJECT_KEY, s);
      else sessionStorage.removeItem(SUBJECT_KEY);
    } catch {
      // Storage blocked: the choice lasts for this screen only.
    }
  };
  return [valid, set];
}

/** "Me / Lucy / Max": shown only when this account looks after someone. */
export function SubjectChips({ value, onChange }: { value: Subject; onChange: (s: Subject) => void }) {
  const { profiles } = useApp();
  const t = useT();
  if (profiles.length === 0) return null;
  return (
    <div className="choice-row subject-row" role="group" aria-label={t("people.whose")}>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>
        {t("people.me")}
      </button>
      {profiles.map((p) => (
        <button key={p.id} type="button" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** Preferences of a person in this kitchen: the account's (its own id) or a profile's. */
export function preferencesOf(preferences: LocalPreferences[], accountId: string | undefined, subject: Subject) {
  return preferences.find((p) => p.id === (subject ?? accountId));
}

/** Allergens listed by someone, only when they said they have some. */
export const listedAllergens = (p?: { allergyAnswer: string; allergens: readonly string[] } | null): string[] =>
  p?.allergyAnswer === "listed" ? [...p.allergens] : [];

/**
 * An alert, never a block: the allergens a person listed that the recipe's ingredient names carry,
 * worked out on this device from the catalog's names (FDA's nine major allergens).
 */
export function AllergenAlert({ recipe, listed, name, foods }: { recipe: Pick<RecipeForCalculation, "ingredients">; listed: readonly string[]; name: string | null; foods: Map<string, FoodRecord> }) {
  const t = useT();
  const alert = useMemo(() => allergenAlert(recipeAllergens(recipe, foods), listed), [recipe, listed, foods]);
  if (listed.length === 0) return null;
  const list = alert.matches.map((a) => t(ALLERGEN_LABEL[a])).join(", ");
  if (alert.matches.length) {
    return (
      <div className="banner banner-warn" role="status" data-testid="allergen-alert">
        <p>
          <strong>{t("allergy.headsUp")}</strong> {name ? t("allergy.matchesThem", { list, name }) : t("allergy.matchesYou", { list })} {t("allergy.stillOk")}
        </p>
        <p className="fine">{t("allergy.fromNames")}</p>
      </div>
    );
  }
  return alert.possible ? (
    <p className="hint" data-testid="allergen-possible">
      {t("allergy.possible")}
    </p>
  ) : null;
}

/** What the ingredient names say about major allergens; shown with the recipe. */
export function RecipeAllergens({ recipe, foods }: { recipe: Pick<RecipeForCalculation, "ingredients">; foods: Map<string, FoodRecord> }) {
  const t = useT();
  const tags = useMemo(() => recipeAllergens(recipe, foods), [recipe, foods]);
  if (recipe.ingredients.length === 0) return null;
  return (
    <div className="allergen-line" data-testid="recipe-allergens">
      <p className="hint">
        {tags.allergens.length
          ? t("allergy.inRecipe", { list: tags.allergens.map((a) => t(ALLERGEN_LABEL[a])).join(", ") })
          : t("allergy.noneFound")}
        {tags.mayContainOthers.length > 0 && ` ${t("allergy.mixed")}`}
      </p>
      <p className="fine">
        {t("allergy.fromNames")}{" "}
        <a href={ALLERGEN_SOURCE.url} target="_blank" rel="noopener noreferrer" lang="en">
          {ALLERGEN_SOURCE.publisher}
        </a>
      </p>
    </div>
  );
}

const EMPTY: FoodPreferencesBody = { allergyAnswer: "prefer_not", allergens: [], likes: [], dislikes: [], notes: "" };

/** Allergies (always asked, never inferred), likes, dislikes and notes, as the person tells us. */
export function PreferencesForm({
  initial,
  name,
  busy,
  onSave,
}: {
  initial: FoodPreferencesBody | undefined;
  /** Whose preferences these are, when not the person using the app. */
  name: string | null;
  busy?: boolean;
  onSave: (body: FoodPreferencesBody) => void | Promise<void>;
}) {
  const { catalog, online } = useApp();
  const t = useT();
  const [answer, setAnswer] = useState<FoodPreferencesBody["allergyAnswer"] | null>(initial ? initial.allergyAnswer : null);
  const [allergens, setAllergens] = useState<string[]>(initial?.allergens ?? []);
  const [likes, setLikes] = useState<string[]>(initial?.likes ?? []);
  const [dislikes, setDislikes] = useState<string[]>(initial?.dislikes ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [picking, setPicking] = useState<"likes" | "dislikes" | null>(null);
  const foods = catalog.status === "ready" ? catalog.foods : new Map<string, FoodRecord>();
  const valid = answer !== null && (answer !== "listed" || allergens.length > 0);

  const toggle = (a: string) => setAllergens((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]));
  const foodName = (id: string) => foods.get(id)?.description ?? id;

  function save() {
    if (!valid) return;
    void onSave({ ...EMPTY, allergyAnswer: answer!, allergens: answer === "listed" ? (ALLERGENS.filter((a) => allergens.includes(a)) as FoodPreferencesBody["allergens"]) : [], likes, dislikes, notes: notes.trim() });
  }

  const foodList = (kind: "likes" | "dislikes", list: string[], setList: (l: string[]) => void) => (
    <section className="pref-foods" aria-labelledby={`pref-${kind}`}>
      <div className="section-head">
        <h3 id={`pref-${kind}`}>{t(kind === "likes" ? "prefs.likes" : "prefs.dislikes")}</h3>
        <button type="button" className="btn-soft" disabled={catalog.status !== "ready"} onClick={() => setPicking(kind)}>
          <Icon name="plus" size={18} /> {t("prefs.addFood")}
        </button>
      </div>
      {list.length === 0 ? (
        <p className="hint">{t(kind === "likes" ? "prefs.noLikes" : "prefs.noDislikes")}</p>
      ) : (
        <ul className="tag-list">
          {list.map((id) => (
            <li key={id} className="tag" data-testid={`pref-${kind}-item`}>
              <span>{foodName(id)}</span>
              <button type="button" className="icon-btn" aria-label={t("prefs.removeFood", { name: foodName(id) })} onClick={() => setList(list.filter((x) => x !== id))}>
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="prefs-form">
      <fieldset className="plain">
        <legend className="field-legend">{name ? t("prefs.allergyQuestionFor", { name }) : t("prefs.allergyQuestion")}</legend>
        <div className="choice-row" role="group">
          <button type="button" aria-pressed={answer === "listed"} onClick={() => setAnswer("listed")}>
            {t("prefs.answerYes")}
          </button>
          <button type="button" aria-pressed={answer === "none"} onClick={() => setAnswer("none")}>
            {t("prefs.answerNone")}
          </button>
          <button type="button" aria-pressed={answer === "prefer_not"} onClick={() => setAnswer("prefer_not")}>
            {t("prefs.answerPreferNot")}
          </button>
        </div>
        {answer === "listed" && (
          <div className="allergen-grid" role="group" aria-label={t("prefs.whichAllergens")}>
            {ALLERGENS.map((a) => (
              <label key={a} className="check">
                <input type="checkbox" checked={allergens.includes(a)} onChange={() => toggle(a)} />
                {t(ALLERGEN_LABEL[a])}
              </label>
            ))}
          </div>
        )}
        {answer === "listed" && allergens.length === 0 && <p className="hint">{t("prefs.pickOne")}</p>}
        <p className="fine">{t("prefs.allergyFine")}</p>
      </fieldset>
      {foodList("likes", likes, setLikes)}
      {foodList("dislikes", dislikes, setDislikes)}
      <label htmlFor="pref-notes">{t("prefs.notes")}</label>
      <textarea id="pref-notes" rows={3} maxLength={1000} value={notes} placeholder={t("prefs.notesPlaceholder")} onChange={(e) => setNotes(e.target.value)} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!valid || busy} onClick={save}>
          {t("prefs.save")}
        </button>
      </div>
      {picking && (
        <Sheet title={t(picking === "likes" ? "prefs.addLike" : "prefs.addDislike")} onClose={() => setPicking(null)}>
          <FoodPicker
            foods={foods}
            online={online}
            onPick={(f) => {
              const [list, set, other, setOther] = picking === "likes" ? [likes, setLikes, dislikes, setDislikes] : [dislikes, setDislikes, likes, setLikes];
              if (!list.includes(f.id)) set([...list, f.id]);
              // A food is liked or disliked, not both.
              if (other.includes(f.id)) setOther(other.filter((x) => x !== f.id));
              setPicking(null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
