import { useState } from "react";
import { textFingerprint, type ImportedLine, type RecipeBody, type RecipeImport, type RecipeIngredientInput } from "@betterplate/contracts";
import type { FoodRecord } from "@betterplate/nutrition";
import { api, ApiRequestError } from "../api.ts";
import { useT } from "../i18n.ts";
import { Sheet } from "./common.tsx";
import { FoodPicker } from "./FoodPicker.tsx";

/** At most this many pixels on the long side are sent; plenty for print, and phone photos shrink a lot. */
const SEND_PX = 2400;
const MAX_PHOTOS = 4;

export async function photoToBase64(file: Blob): Promise<string> {
  let blob = file;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, SEND_PX / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.88));
    } catch {
      // Formats the browser can't draw (some HEIC) go as they are; the server reads them.
    }
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

interface ReviewLine {
  line: ImportedLine;
  keep: boolean;
  foodId: string | null;
  quantity: number | null;
  unit: RecipeIngredientInput["unit"];
  portionIndex: number | null;
}

const toReview = (line: ImportedLine): ReviewLine => ({
  line,
  keep: true,
  foodId: line.foodId,
  quantity: line.amount?.quantity ?? null,
  unit: line.amount?.unit ?? "g",
  portionIndex: line.amount?.portionIndex ?? null,
});

/**
 * Create → From a photo: pick up to four photos of one recipe, have it read, then check every
 * line before it becomes the recipe. Lines with no food or no amount have to be fixed or left out.
 */
export function PhotoImportSheet({ foods, online, onClose, onUse }: { foods: Map<string, FoodRecord>; online: boolean; onClose: () => void; onUse: (body: RecipeBody) => void }) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeImport | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [picking, setPicking] = useState<string | null>(null);

  async function readPhotos() {
    setBusy(true);
    setError(null);
    try {
      const images = await Promise.all(files.map(photoToBase64));
      const result = await api.importRecipe(images);
      setDraft(result);
      setLines(result.lines.map(toReview));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("import.offline"));
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, p: Partial<ReviewLine>) => setLines((ls) => ls.map((l) => (l.line.id === id ? { ...l, ...p } : l)));
  const problem = (l: ReviewLine) => (!l.keep ? null : !l.foodId ? "food" : !l.quantity || l.quantity <= 0 ? "amount" : null);
  const open = lines.filter((l) => problem(l) !== null).length;

  function use() {
    if (!draft) return;
    const ingredients: RecipeIngredientInput[] = lines
      .filter((l) => l.keep && l.foodId && l.quantity)
      .map((l) => ({
        id: l.line.id,
        foodId: l.foodId!,
        quantity: l.quantity!,
        unit: l.unit,
        portionIndex: l.unit === "portion" ? l.portionIndex : null,
        role: l.line.role,
        oilDiscardedGrams: null,
      }));
    onUse({
      title: draft.title || t("import.untitled"),
      description: draft.description,
      servings: draft.servings ?? 2,
      ingredients,
      method: draft.method,
      image: null,
      origin: { kind: "photo", importedAt: draft.importedAt, methodFingerprint: textFingerprint(draft.method) },
    });
  }

  if (picking) {
    return (
      <Sheet title={t("import.pickFood")} onClose={() => setPicking(null)}>
        <FoodPicker
          foods={foods}
          online={online}
          onPick={(food) => {
            patch(picking, { foodId: food.id, unit: "g", portionIndex: null });
            setPicking(null);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={draft ? t("import.reviewTitle") : t("import.title")} onClose={onClose}>
      {!draft ? (
        <section className="photo-upload" data-testid="import-pick">
          <p className="hint">{t("import.intro")}</p>
          <label htmlFor="import-files">{t("import.choose", { n: MAX_PHOTOS })}</label>
          <input
            id="import-files"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
            onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, MAX_PHOTOS))}
          />
          {files.length > 0 && <p className="hint">{t("import.chosen", { n: files.length })}</p>}
          <label className="check">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            {t("import.rights")}
          </label>
          <p className="fine">{t("import.note")}</p>
          <button type="button" className="btn-primary" disabled={busy || !files.length || !rights || !online} onClick={() => void readPhotos()}>
            {busy ? t("import.reading") : t("import.read")}
          </button>
        </section>
      ) : (
        <section data-testid="import-review">
          <p className="hint">
            <strong>{draft.title || t("import.untitled")}</strong>
            {draft.servings ? ` · ${t("common.servings", { n: draft.servings })}` : ""}
          </p>
          <p className="hint">{open ? t("import.toFix", { n: open }) : t("import.allSet")}</p>
          <ul className="ingredients">
            {lines.map((l) => {
              const food = l.foodId ? foods.get(l.foodId) : undefined;
              const issue = problem(l);
              return (
                <li key={l.line.id} className={`ingredient${l.keep ? "" : " is-off"}`} data-testid="import-line" data-issue={issue ?? "none"}>
                  <div className="ingredient-name">“{l.line.original}”</div>
                  {l.keep && (
                    <>
                      <label htmlFor={`if-${l.line.id}`}>{t("import.food")}</label>
                      <select
                        id={`if-${l.line.id}`}
                        value={l.foodId ?? ""}
                        onChange={(e) => {
                          if (e.target.value === "__other") setPicking(l.line.id);
                          else patch(l.line.id, { foodId: e.target.value || null, unit: l.unit === "portion" ? "g" : l.unit, portionIndex: null });
                        }}
                      >
                        <option value="">{t("import.noFood")}</option>
                        {l.foodId && !l.line.candidates.some((c) => c.foodId === l.foodId) && <option value={l.foodId}>{food?.description ?? l.foodId}</option>}
                        {l.line.candidates.map((c) => (
                          <option key={c.foodId} value={c.foodId}>
                            {c.description}
                          </option>
                        ))}
                        <option value="__other">{t("import.searchOther")}</option>
                      </select>
                      <div className="ingredient-controls">
                        <label className="sr-only" htmlFor={`iq-${l.line.id}`}>
                          {t("editor.amount")}
                        </label>
                        <input
                          id={`iq-${l.line.id}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={l.quantity ?? ""}
                          placeholder={t("import.amountNeeded")}
                          onChange={(e) => patch(l.line.id, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                        <label className="sr-only" htmlFor={`iu-${l.line.id}`}>
                          {t("editor.unit")}
                        </label>
                        <select
                          id={`iu-${l.line.id}`}
                          value={l.unit === "portion" ? `p:${l.portionIndex ?? 0}` : l.unit}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith("p:")) patch(l.line.id, { unit: "portion", portionIndex: Number(v.slice(2)) });
                            else patch(l.line.id, { unit: v as RecipeIngredientInput["unit"], portionIndex: null });
                          }}
                        >
                          <option value="g">g</option>
                          <option value="oz">oz</option>
                          <option value="kg">kg</option>
                          <option value="lb">lb</option>
                          {food?.portions.map((p, idx) => (
                            <option key={idx} value={`p:${idx}`}>
                              × {p.label} ({p.gramWeight} g)
                            </option>
                          ))}
                        </select>
                      </div>
                      {issue && (
                        <p className="error" data-testid="import-issue">
                          {issue === "food" ? t("import.needsFood") : t("import.needsAmount")}
                        </p>
                      )}
                    </>
                  )}
                  <button type="button" className="btn-link" onClick={() => patch(l.line.id, { keep: !l.keep })}>
                    {l.keep ? t("import.leaveOut") : t("import.putBack")}
                  </button>
                </li>
              );
            })}
          </ul>
          {draft.readsLeftToday !== null && <p className="fine">{t("import.readsLeft", { n: draft.readsLeftToday })}</p>}
          <button type="button" className="btn-primary" disabled={open > 0} onClick={use} data-testid="import-use">
            {t("import.use")}
          </button>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
