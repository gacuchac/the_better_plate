import { useState } from "react";
import type { MealSlot, RecipeBody } from "@betterplate/contracts";
import { localDate, SLOTS, slotForNow } from "../meals.ts";
import { useApp } from "../store.tsx";
import { Sheet } from "./common.tsx";

function SlotPicker({ value, onChange }: { value: MealSlot; onChange: (s: MealSlot) => void }) {
  return (
    <div className="choice-row" role="group" aria-label="Meal">
      {SLOTS.map((s) => (
        <button key={s.value} type="button" aria-pressed={value === s.value} onClick={() => onChange(s.value)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function ServingsStepper({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  const step = (d: number) => onChange(Math.max(0.25, Math.round((value + d) * 4) / 4));
  return (
    <div className="stepper-row">
      <label htmlFor={id}>Servings</label>
      <div className="stepper">
        <button type="button" aria-label="Fewer servings" onClick={() => step(value > 1 ? -1 : -0.25)}>
          −
        </button>
        <input id={id} type="number" min={0.25} step={0.25} inputMode="decimal" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" aria-label="More servings" onClick={() => step(value >= 1 ? 1 : 0.25)}>
          +
        </button>
      </div>
    </div>
  );
}

/** Plan a recipe for a day. A plan is a reminder, never counted as eaten. */
export function PlanSheet({ recipeId, title, initialDate, onClose }: { recipeId: string; title: string; initialDate?: string; onClose: () => void }) {
  const { engine } = useApp();
  const [date, setDate] = useState(initialDate ?? localDate());
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [servings, setServings] = useState(1);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && servings > 0 && servings <= 100;

  async function save() {
    await engine!.savePlan(crypto.randomUUID(), { date, slot, recipeId, title, servings });
    onClose();
  }

  return (
    <Sheet title="Plan this meal" onClose={onClose}>
      <p className="hint">{title}</p>
      <label htmlFor="plan-date">Day</label>
      <input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label>Meal</label>
      <SlotPicker value={slot} onChange={setSlot} />
      <ServingsStepper id="plan-servings" value={servings} onChange={setServings} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>
          Add to plan
        </button>
      </div>
      <p className="fine">Plans are reminders. They never count toward what you ate until you mark them eaten.</p>
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
  const today = localDate();
  const [date, setDate] = useState(initialDate && initialDate <= today ? initialDate : today);
  const [slot, setSlot] = useState<MealSlot>(initialSlot ?? slotForNow());
  const [servings, setServings] = useState(initialServings);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && servings > 0 && servings <= 100;

  async function save() {
    // eatenAt keeps the real moment with its offset; localDate keeps the person's own calendar day.
    const now = new Date();
    const eatenAt = date === today ? now : new Date(`${date}T12:00:00`);
    const off = -eatenAt.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
    const iso = `${localDate(eatenAt)}T${pad(eatenAt.getHours())}:${pad(eatenAt.getMinutes())}:${pad(eatenAt.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
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
    <Sheet title="I ate this" onClose={onClose}>
      <p className="hint">{recipe.title}</p>
      <label htmlFor="log-date">Day</label>
      <input id="log-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
      <label>Meal</label>
      <SlotPicker value={slot} onChange={setSlot} />
      <ServingsStepper id="log-servings" value={servings} onChange={setServings} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>
          Save as eaten
        </button>
      </div>
      <p className="fine">Saved on this device first, then synced. Nutrition is an estimate from USDA data for the recipe as it is now.</p>
    </Sheet>
  );
}
