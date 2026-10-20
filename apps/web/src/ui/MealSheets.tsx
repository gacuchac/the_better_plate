import { useState } from "react";
import type { MealFeedbackBody, MealSlot, RecipeBody } from "@betterplate/contracts";
import type { FoodRecord } from "@betterplate/nutrition";
import type { LocalLog } from "../localdb.ts";
import { eatenAtFor, localDate, SLOTS, slotForNow, slotLabel } from "../meals.ts";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { Sheet } from "./common.tsx";
import { AllergenAlert, listedAllergens, preferencesOf } from "./People.tsx";

export function SlotPicker({ value, onChange }: { value: MealSlot; onChange: (s: MealSlot) => void }) {
  const t = useT();
  return (
    <div className="choice-row" role="group" aria-label={t("mealSheet.meal")}>
      {SLOTS.map((s) => (
        <button key={s.value} type="button" aria-pressed={value === s.value} onClick={() => onChange(s.value)}>
          {slotLabel(s.value)}
        </button>
      ))}
    </div>
  );
}

export function ServingsStepper({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  const t = useT();
  const step = (d: number) => onChange(Math.max(0.25, Math.round((value + d) * 4) / 4));
  return (
    <div className="stepper-row">
      <label htmlFor={id}>{t("editor.servings")}</label>
      <div className="stepper">
        <button type="button" aria-label={t("mealSheet.fewer")} onClick={() => step(value > 1 ? -1 : -0.25)}>
          −
        </button>
        <input id={id} type="number" min={0.25} step={0.25} inputMode="decimal" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" aria-label={t("mealSheet.more")} onClick={() => step(value >= 1 ? 1 : 0.25)}>
          +
        </button>
      </div>
    </div>
  );
}

/** Plan a recipe for a day. A plan is a reminder, never counted as eaten. */
export function PlanSheet({
  recipeId,
  title,
  initialDate,
  profileId = null,
  onClose,
}: {
  recipeId: string;
  title: string;
  initialDate?: string;
  /** For one of the account's profiles; null for the account itself. */
  profileId?: string | null;
  onClose: () => void;
}) {
  const { engine, recipes, preferences, profiles, account, catalog } = useApp();
  const t = useT();
  const recipe = recipes.find((r) => r.id === recipeId);
  const listed = listedAllergens(preferencesOf(preferences, account?.id, profileId)?.body);
  const who = profiles.find((p) => p.id === profileId)?.name ?? null;
  const [date, setDate] = useState(initialDate ?? localDate());
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [servings, setServings] = useState(1);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && servings > 0 && servings <= 100;

  async function save() {
    await engine!.savePlan(crypto.randomUUID(), { date, slot, recipeId, title, servings, profileId });
    onClose();
  }

  return (
    <Sheet title={t("mealSheet.planTitle")} onClose={onClose}>
      <p className="hint">{who ? t("people.titleFor", { title, name: who }) : title}</p>
      {recipe && catalog.status === "ready" && <AllergenAlert recipe={recipe.body} listed={listed} name={who} foods={catalog.foods} />}
      <label htmlFor="plan-date">{t("meals.day")}</label>
      <input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label>{t("mealSheet.meal")}</label>
      <SlotPicker value={slot} onChange={setSlot} />
      <ServingsStepper id="plan-servings" value={servings} onChange={setServings} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>
          {t("mealSheet.addToPlan")}
        </button>
      </div>
      <p className="fine">{t("mealSheet.planFine")}</p>
    </Sheet>
  );
}

/** Record food actually eaten. Saved on this device first; every log is its own event. */
export function LogSheet({
  recipeId,
  recipe,
  plannedMealId = null,
  initialServings = 1,
  initialSlot,
  initialDate,
  profileId = null,
  onClose,
}: {
  recipeId: string | null;
  recipe: Pick<RecipeBody, "title" | "servings" | "ingredients">;
  plannedMealId?: string | null;
  initialServings?: number;
  initialSlot?: MealSlot;
  initialDate?: string;
  profileId?: string | null;
  onClose: () => void;
}) {
  const { engine } = useApp();
  const t = useT();
  const today = localDate();
  const [date, setDate] = useState(initialDate && initialDate <= today ? initialDate : today);
  const [slot, setSlot] = useState<MealSlot>(initialSlot ?? slotForNow());
  const [servings, setServings] = useState(initialServings);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && servings > 0 && servings <= 100;

  async function save() {
    // eatenAt keeps the real moment with its offset; localDate keeps the person's own calendar day.
    const iso = eatenAtFor(date);
    await engine!.logMeal({
      plannedMealId,
      recipeId,
      recipe: { title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients },
      servings,
      slot,
      localDate: date,
      eatenAt: iso,
      profileId,
    });
    onClose();
  }

  return (
    <Sheet title={t("meals.iAteThis")} onClose={onClose}>
      <p className="hint">{recipe.title}</p>
      <label htmlFor="log-date">{t("meals.day")}</label>
      <input id="log-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
      <label>{t("mealSheet.meal")}</label>
      <SlotPicker value={slot} onChange={setSlot} />
      <ServingsStepper id="log-servings" value={servings} onChange={setServings} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>
          {t("mealSheet.saveEaten")}
        </button>
      </div>
      <p className="fine">{t("mealSheet.logFine")}</p>
    </Sheet>
  );
}

/**
 * After eating: liked it or not, a comment, and ingredients not liked. Saved on this device first;
 * disliked ingredients can also go on the person's dislikes.
 */
export function FeedbackSheet({ log, onClose }: { log: LocalLog; onClose: () => void }) {
  const { engine, feedback, preferences, account, catalog } = useApp();
  const t = useT();
  const existing = feedback.find((f) => f.id === log.id);
  const [rating, setRating] = useState<MealFeedbackBody["rating"]>(existing?.body.rating ?? null);
  const [comment, setComment] = useState(existing?.body.comment ?? "");
  const [disliked, setDisliked] = useState<string[]>(existing?.body.dislikedFoodIds ?? []);
  const subject = log.body.profileId ?? null;
  const prefs = preferencesOf(preferences, account?.id, subject);
  const [addToDislikes, setAddToDislikes] = useState(true);
  const foods = catalog.status === "ready" ? catalog.foods : new Map<string, FoodRecord>();
  const foodIds = [...new Set(log.body.recipe.ingredients.map((i) => i.foodId))];

  async function save() {
    if (!engine || !account) return;
    await engine.saveFeedback(log.id, { rating, comment: comment.trim(), dislikedFoodIds: disliked });
    const fresh = disliked.filter((id) => !prefs?.body.dislikes.includes(id));
    if (prefs && addToDislikes && fresh.length) {
      const { body } = prefs;
      await engine.savePreferences(prefs.id, { ...body, dislikes: [...body.dislikes, ...fresh], likes: body.likes.filter((id) => !fresh.includes(id)) });
    }
    onClose();
  }

  return (
    <Sheet title={t("feedback.title")} onClose={onClose}>
      <p className="hint">{log.body.recipe.title}</p>
      <div className="choice-row" role="group" aria-label={t("feedback.title")}>
        <button type="button" aria-pressed={rating === "liked"} onClick={() => setRating(rating === "liked" ? null : "liked")}>
          {t("feedback.likedIt")}
        </button>
        <button type="button" aria-pressed={rating === "disliked"} onClick={() => setRating(rating === "disliked" ? null : "disliked")}>
          {t("feedback.notForMe")}
        </button>
      </div>
      <label htmlFor="feedback-comment">{t("feedback.comment")}</label>
      <textarea id="feedback-comment" rows={2} maxLength={1000} value={comment} placeholder={t("feedback.commentPlaceholder")} onChange={(e) => setComment(e.target.value)} />
      {foodIds.length > 0 && (
        <fieldset className="plain">
          <legend className="field-legend">{t("feedback.whichNot")}</legend>
          {foodIds.map((id) => (
            <label key={id} className="check">
              <input type="checkbox" checked={disliked.includes(id)} onChange={() => setDisliked((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))} />
              {foods.get(id)?.description ?? id}
            </label>
          ))}
        </fieldset>
      )}
      {disliked.length > 0 &&
        (prefs ? (
          <label className="check">
            <input type="checkbox" checked={addToDislikes} onChange={(e) => setAddToDislikes(e.target.checked)} />
            {t("feedback.addToDislikes")}
          </label>
        ) : (
          <p className="hint">{t("feedback.noPrefsYet")}</p>
        ))}
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={rating === null && !comment.trim() && disliked.length === 0} onClick={() => void save()}>
          {t("feedback.save")}
        </button>
      </div>
      <p className="fine">{t("feedback.fine")}</p>
    </Sheet>
  );
}
