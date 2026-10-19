import { useState } from "react";
import type { MealSlot, RecipeBody } from "@betterplate/contracts";
import { eatenAtFor, localDate, SLOTS, slotForNow, slotLabel } from "../meals.ts";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { Sheet } from "./common.tsx";

function SlotPicker({ value, onChange }: { value: MealSlot; onChange: (s: MealSlot) => void }) {
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

function ServingsStepper({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
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
export function PlanSheet({ recipeId, title, initialDate, onClose }: { recipeId: string; title: string; initialDate?: string; onClose: () => void }) {
  const { engine } = useApp();
  const t = useT();
  const [date, setDate] = useState(initialDate ?? localDate());
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [servings, setServings] = useState(1);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && servings > 0 && servings <= 100;

  async function save() {
    await engine!.savePlan(crypto.randomUUID(), { date, slot, recipeId, title, servings });
    onClose();
  }

  return (
    <Sheet title={t("mealSheet.planTitle")} onClose={onClose}>
      <p className="hint">{title}</p>
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
  onClose,
}: {
  recipeId: string | null;
  recipe: Pick<RecipeBody, "title" | "servings" | "ingredients">;
  plannedMealId?: string | null;
  initialServings?: number;
  initialSlot?: MealSlot;
  initialDate?: string;
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
