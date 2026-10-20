import { useState } from "react";
import type { PhotoSearchResult, RecipeBody, RecipeImage } from "@betterplate/contracts";
import type { FoodRecord } from "@betterplate/nutrition";
import { track } from "../activity.ts";
import { api, ApiRequestError, imageUrl } from "../api.ts";
import { useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { Sheet } from "./common.tsx";
import { useAiSettings } from "./Companion.tsx";

const LICENSE_NAMES: Record<string, string> = { cc0: "CC0", pdm: "Public domain", by: "CC BY", "by-sa": "CC BY-SA" };
export const licenseName = (license: string, version: string | null) => `${LICENSE_NAMES[license] ?? license}${version && license !== "pdm" && license !== "cc0" ? ` ${version}` : ""}`;

/** A short description of the dish for photo search: its name and its main ingredients by weight. */
export function describeRecipe(body: Pick<RecipeBody, "title" | "ingredients">, foods: Map<string, FoodRecord>): string {
  const main = [...body.ingredients]
    .filter((i) => i.role !== "cooking_oil")
    .sort((a, b) => (b.unit === "g" ? b.quantity : 0) - (a.unit === "g" ? a.quantity : 0))
    .slice(0, 2)
    .map((i) => foods.get(i.foodId)?.description.split(",")[0]?.toLowerCase())
    .filter((w): w is string => !!w && !body.title.toLowerCase().includes(w));
  return [body.title.trim(), ...main].filter(Boolean).join(" with ").slice(0, 200);
}

/** The recipe's image with its credit, or the AI-generated label. Never shown without one of them. */
export function RecipePhoto({ image, compact = false }: { image: RecipeImage; compact?: boolean }) {
  const t = useT();
  return (
    <figure className={`recipe-photo${compact ? " compact" : ""}`} data-testid="recipe-photo">
      <img src={imageUrl(image.id)} alt={image.alt} loading="lazy" crossOrigin="use-credentials" />
      <figcaption className="photo-credit" data-testid="photo-credit">
        {image.kind === "upload" ? (
          <span>{t("photo.yours")}</span>
        ) : image.kind === "generated" ? (
          <>
            <span className="tag tag-amber">{t("photo.aiLabel")}</span> {t("photo.aiNote", { model: image.generator?.model ?? "" })}
          </>
        ) : image.credit ? (
          <>
            {image.credit.sourceUrl ? (
              <a href={image.credit.sourceUrl} target="_blank" rel="noopener noreferrer">
                {image.credit.title}
              </a>
            ) : (
              image.credit.title
            )}
            {image.credit.creator ? ` ${t("photo.by", { creator: image.credit.creator })}` : ""},{" "}
            {image.credit.licenseUrl ? (
              <a href={image.credit.licenseUrl} target="_blank" rel="noopener noreferrer">
                {licenseName(image.credit.license, image.credit.licenseVersion)}
              </a>
            ) : (
              licenseName(image.credit.license, image.credit.licenseVersion)
            )}
            {image.credit.provider ? `, ${t("photo.via", { provider: image.credit.provider })}` : ""}
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Find an openly licensed photo by describing it, or generate one (own OpenAI key, else the included companion). */
export function PhotoSheet({ initial, title, onPick, onClose }: { initial: string; title: string; onPick: (image: RecipeImage) => void; onClose: () => void }) {
  const { account, online } = useApp();
  const t = useT();
  const ai = useAiSettings(account?.id, online);
  const canGenerate = !!ai && (ai.providers.some((p) => p.provider === "openai" && p.connected) || ai.house.status === "available");
  const [description, setDescription] = useState(initial);
  const [results, setResults] = useState<PhotoSearchResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);

  const fail = (err: unknown) => setError(err instanceof ApiRequestError ? err.message : t("photo.offline"));

  async function search() {
    if (description.trim().length < 2) return;
    setBusy("search");
    setError(null);
    try {
      setResults((await api.searchPhotos(description.trim())).results);
      track("Searched photos");
    } catch (err) {
      fail(err);
    }
    setBusy(null);
  }

  async function pick(r: PhotoSearchResult) {
    setBusy(r.sourceId);
    setError(null);
    try {
      onPick(await api.importPhoto(r.sourceId, title || r.title));
      track("Chose a recipe photo");
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      onPick(await api.generateImage(prompt.trim(), title || prompt.trim()));
      track("Generated a recipe image");
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  }

  async function upload() {
    if (!file || !rights) return;
    setBusy("upload");
    setError(null);
    try {
      onPick(await api.uploadImage(await fileToBase64(file), title));
      track("Uploaded a recipe photo");
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  }

  return (
    <Sheet title={t("photo.sheetTitle")} onClose={onClose}>
      {!online ? (
        <p className="hint">{t("photo.needsOnline")}</p>
      ) : (
        <>
          <form
            className="photo-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label htmlFor="photo-description">{t("photo.describe")}</label>
            <div className="photo-search-row">
              <input id="photo-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder={t("photo.describePlaceholder")} />
              <button type="submit" className="btn-primary" disabled={busy !== null || description.trim().length < 2}>
                {busy === "search" ? t("photo.searching") : t("photo.find")}
              </button>
            </div>
            <p className="fine">{t("photo.licenseNote")}</p>
          </form>
          {results && results.length === 0 && <p className="hint">{t("photo.none")}</p>}
          {results && results.length > 0 && (
            <ul className="photo-grid" aria-label={t("photo.results")}>
              {results.map((r) => (
                <li key={r.sourceId}>
                  <button type="button" onClick={() => void pick(r)} disabled={busy !== null} data-testid="photo-result">
                    <img src={r.thumbnailUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
                    <span className="photo-title">{r.title}</span>
                    <small>
                      {licenseName(r.license, r.licenseVersion)}
                      {r.creator ? ` · ${r.creator}` : ""}
                    </small>
                    {busy === r.sourceId && <small>{t("photo.adding")}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <section className="photo-upload" data-testid="photo-upload">
            <h3>{t("photo.uploadTitle")}</h3>
            <label htmlFor="photo-file">{t("photo.uploadChoose")}</label>
            <input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <label className="check">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
              {t("photo.uploadRights")}
            </label>
            <p className="fine">{t("photo.uploadNote")}</p>
            <button type="button" className="btn-secondary" disabled={busy !== null || !file || !rights} onClick={() => void upload()}>
              {busy === "upload" ? t("photo.uploading") : t("photo.upload")}
            </button>
          </section>
          {canGenerate && (
            <section className="photo-generate">
              <h3>{t("photo.generateTitle")}</h3>
              <label htmlFor="photo-prompt" className="sr-only">
                {t("photo.generateTitle")}
              </label>
              <textarea id="photo-prompt" rows={2} maxLength={1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <p className="fine">{t("photo.generateNote")}</p>
              <button type="button" className="btn-secondary" disabled={busy !== null || prompt.trim().length < 3} onClick={() => void generate()}>
                {busy === "generate" ? t("photo.generating") : t("photo.generate")}
              </button>
            </section>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Server limit is 9 MB; bigger phone photos are scaled down here first (which also drops their metadata). */
const UPLOAD_LIMIT = 8_500_000;

async function fileToBase64(file: Blob): Promise<string> {
  let blob = file;
  if (file.size > UPLOAD_LIMIT && typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.9));
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}
