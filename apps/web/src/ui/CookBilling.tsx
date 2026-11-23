import { useCallback, useEffect, useState } from "react";
import type { CookMealSummary, CookReceipt, CookReceiptBody, CookReceiptSummary, CookShareParts, CookShareStatus, CookSharedMeal, CookSharedStatement, CookStatement, CookStatementList, GroupCookedMeal, MyCook, MyCookInvite } from "@betterplate/contracts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { formatDay } from "../meals.ts";
import { useApp } from "../store.tsx";
import { ErrorLine, MealRow, fromCents, minutesText, money, toCents, useErrors } from "./Cooking.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { FoodPicker } from "./FoodPicker.tsx";
import { Icon } from "./icons.tsx";
import { photoToBase64 } from "./PhotoImport.tsx";

/** Fetches a signed-in file (receipt photo, CSV) so it works when the API is on another origin. */
async function authedBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}

// ---------------------------------------------------------------- receipts

export function ReceiptsTab({ currency }: { currency: string }) {
  const t = useT();
  const [receipts, setReceipts] = useState<CookReceiptSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setReceipts((await api.cook.receipts()).receipts)), [run]);

  async function read(file: File) {
    setBusy(true);
    const receipt = await run(async () => api.cook.readReceipt(await photoToBase64(file)));
    setBusy(false);
    if (receipt) navigate(`/cooking/receipt/${receipt.id}`);
  }
  async function typed() {
    const receipt = await run(() => api.cook.addReceipt({ store: "", purchasedOn: null, subtotalCents: null, taxCents: 0, totalCents: null, lines: [] }));
    if (receipt) navigate(`/cooking/receipt/${receipt.id}`);
  }

  return (
    <section data-testid="cook-receipts">
      <p className="hint">{t("cooking.receiptsIntro")}</p>
      <div className="stack">
        <label className={`btn-primary${busy ? " disabled" : ""}`}>
          <Icon name="image" size={18} /> {busy ? t("cooking.reading") : t("cooking.receiptPhoto")}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            data-testid="receipt-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void read(f);
            }}
          />
        </label>
        <button type="button" className="btn-link" onClick={() => void typed()}>
          {t("cooking.typeReceipt")}
        </button>
      </div>
      <p className="fine">{t("cooking.receiptPhotoNote")}</p>
      <ErrorLine error={error} />
      <ul className="row-list">
        {receipts?.map((r) => (
          <li key={r.id}>
            <a className="row-item row-link" href={`#/cooking/receipt/${r.id}`} data-testid="cook-receipt-row">
              <span className="row-text">
                <span className="row-label">{r.store || t("cooking.unnamedStore")}</span>
                <span className="row-value">
                  {r.purchasedOn ? formatDay(r.purchasedOn, { day: "numeric", month: "short", year: "numeric" }) : t("cooking.noDate")} ·{" "}
                  {r.status === "confirmed" ? t("cooking.confirmed") : t("cooking.toCheck", { n: r.unassigned })}
                </span>
              </span>
              <span className="row-amount">{money(r.totalCents, currency)}</span>
            </a>
          </li>
        ))}
      </ul>
      {receipts && !receipts.length && <p className="hint">{t("cooking.noReceipts")}</p>}
    </section>
  );
}

type LineDraft = CookReceiptBody["lines"][number] & { candidates: CookReceipt["lines"][number]["candidates"]; foodDescription: string | null; priceText: string };

const toDraft = (r: CookReceipt) => ({
  store: r.store,
  purchasedOn: r.purchasedOn,
  subtotal: fromCents(r.subtotalCents),
  tax: fromCents(r.taxCents),
  total: fromCents(r.totalCents),
  lines: r.lines.map((l): LineDraft => ({ ...l, priceText: fromCents(l.priceCents) })),
});

export function ReceiptScreen({ id }: { id: string }) {
  const t = useT();
  const { catalog, online } = useApp();
  const [receipt, setReceipt] = useState<CookReceipt | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof toDraft> | null>(null);
  const [meals, setMeals] = useState<CookMealSummary[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const { error, run } = useErrors();
  const load = useCallback((r: CookReceipt) => {
    setReceipt(r);
    setDraft(toDraft(r));
  }, []);
  useEffect(() => {
    void run(async () => load(await api.cook.receipt(id)));
    void run(async () => setMeals((await api.cook.meals({ unbilled: true })).meals));
  }, [id, run, load]);
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);
  if (!receipt || !draft) return <EmptyState title={t("cooking.receipt")}>{error ?? t("common.loading")}</EmptyState>;
  const c = receipt.currency;
  const locked = receipt.status === "confirmed";
  const lineSum = draft.lines.reduce((s, l) => s + (toCents(l.priceText) ?? 0), 0) + (toCents(draft.tax) ?? 0);
  const total = toCents(draft.total);
  const difference = total === null ? null : lineSum - total;

  const body = (): CookReceiptBody => ({
    store: draft.store,
    purchasedOn: draft.purchasedOn || null,
    subtotalCents: toCents(draft.subtotal),
    taxCents: toCents(draft.tax) ?? 0,
    totalCents: toCents(draft.total),
    lines: draft.lines.map((l) => ({ id: l.id, text: l.text, priceCents: toCents(l.priceText) ?? 0, foodId: l.foodId, grams: l.grams, mealId: l.personal ? null : l.mealId, personal: l.personal })),
  });
  const setLine = (lineId: string, patch: Partial<LineDraft>) => setDraft({ ...draft, lines: draft.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) });
  const save = () => run(async () => { const r = await api.cook.saveReceipt(id, body()); load(r); return r; });

  return (
    <div className="screen" data-testid="cook-receipt">
      <header className="screen-head">
        <div>
          <p className="eyebrow">
            <a href="#/cooking/receipts">{t("cooking.receipts")}</a>
          </p>
          <h1>{receipt.store || t("cooking.receipt")}</h1>
        </div>
      </header>
      {locked ? <p className="banner banner-info">{t("cooking.receiptConfirmedNote")}</p> : <p className="hint">{t("cooking.receiptCheckIntro")}</p>}
      <ErrorLine error={error} />

      <section className="card">
        <div className="field">
          <label htmlFor="r-store">{t("cooking.store")}</label>
          <input id="r-store" value={draft.store} disabled={locked} maxLength={120} onChange={(e) => setDraft({ ...draft, store: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="r-date">{t("cooking.date")}</label>
          <input id="r-date" type="date" value={draft.purchasedOn ?? ""} disabled={locked} onChange={(e) => setDraft({ ...draft, purchasedOn: e.target.value || null })} />
        </div>
        {receipt.hasImage && (
          <button
            type="button"
            className="btn-link"
            onClick={() => void run(async () => setPhoto(URL.createObjectURL(await authedBlob(api.cook.receiptImageUrl(id)))))}
          >
            {t("cooking.seePhoto")}
          </button>
        )}
        {photo && <img className="receipt-photo" src={photo} alt={t("cooking.receiptPhotoAlt")} />}
      </section>

      <section className="card" aria-labelledby="r-lines">
        <h2 id="r-lines">{t("cooking.lines")}</h2>
        <ul className="receipt-lines">
          {draft.lines.map((l) => (
            <li key={l.id} className="receipt-line" data-testid="receipt-line">
              <div className="receipt-line-top">
                <label className="sr-only" htmlFor={`l-text-${l.id}`}>{t("cooking.lineText")}</label>
                <input id={`l-text-${l.id}`} value={l.text} disabled={locked} maxLength={200} onChange={(e) => setLine(l.id, { text: e.target.value })} />
                <label className="sr-only" htmlFor={`l-price-${l.id}`}>{t("cooking.amount")}</label>
                <input id={`l-price-${l.id}`} className="price-input" inputMode="decimal" value={l.priceText} disabled={locked} onChange={(e) => setLine(l.id, { priceText: e.target.value })} />
              </div>
              <div className="receipt-line-food">
                {l.foodId ? (
                  <span className="hint">{l.foodDescription ?? l.foodId}</span>
                ) : (
                  <span className="hint">{t("cooking.noFood")}</span>
                )}
                {!locked && (
                  <>
                    {l.candidates.filter((x) => x.foodId !== l.foodId).slice(0, 2).map((x) => (
                      <button key={x.foodId} type="button" className="chip" onClick={() => setLine(l.id, { foodId: x.foodId, foodDescription: x.description })}>
                        {x.description}
                      </button>
                    ))}
                    {catalog.status === "ready" && (
                      <button type="button" className="btn-link" onClick={() => setPicking(l.id)}>
                        {t("cooking.pickFood")}
                      </button>
                    )}
                    {l.foodId && (
                      <button type="button" className="btn-link" onClick={() => setLine(l.id, { foodId: null, foodDescription: null })}>
                        {t("cooking.notFood")}
                      </button>
                    )}
                  </>
                )}
              </div>
              {l.foodId && (
                <div className="field inline-field">
                  <label htmlFor={`l-grams-${l.id}`}>{t("cooking.grams")}</label>
                  <input
                    id={`l-grams-${l.id}`}
                    type="number"
                    min={0}
                    inputMode="decimal"
                    disabled={locked}
                    value={l.grams ?? ""}
                    onChange={(e) => setLine(l.id, { grams: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
                  />
                </div>
              )}
              <div className="field inline-field">
                <label htmlFor={`l-meal-${l.id}`}>{t("cooking.boughtFor")}</label>
                <select
                  id={`l-meal-${l.id}`}
                  disabled={locked}
                  value={l.personal ? "personal" : (l.mealId ?? "")}
                  onChange={(e) => setLine(l.id, e.target.value === "personal" ? { personal: true, mealId: null } : { personal: false, mealId: e.target.value || null })}
                >
                  <option value="">{t("cooking.chooseMeal")}</option>
                  <option value="personal">{t("cooking.personal")}</option>
                  {meals.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {formatDay(m.cookedOn, { day: "numeric", month: "short" })}
                    </option>
                  ))}
                  {l.mealId && !meals.some((m) => m.id === l.mealId) && <option value={l.mealId}>{t("cooking.otherMeal")}</option>}
                </select>
              </div>
              {!locked && (
                <button type="button" className="btn-link" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((x) => x.id !== l.id) })}>
                  {t("cooking.removeLine")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {!locked && (
          <button
            type="button"
            className="btn-link"
            onClick={() => setDraft({ ...draft, lines: [...draft.lines, { id: crypto.randomUUID(), text: "", priceCents: 0, priceText: "", foodId: null, grams: null, mealId: null, personal: false, candidates: [], foodDescription: null }] })}
          >
            {t("cooking.addLine")}
          </button>
        )}
      </section>

      <section className="card">
        <div className="cook-minutes">
          <div className="field">
            <label htmlFor="r-sub">{t("cooking.subtotal")}</label>
            <input id="r-sub" inputMode="decimal" value={draft.subtotal} disabled={locked} onChange={(e) => setDraft({ ...draft, subtotal: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="r-tax">{t("cooking.tax")}</label>
            <input id="r-tax" inputMode="decimal" value={draft.tax} disabled={locked} onChange={(e) => setDraft({ ...draft, tax: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="r-total">{t("cooking.total")}</label>
            <input id="r-total" inputMode="decimal" value={draft.total} disabled={locked} onChange={(e) => setDraft({ ...draft, total: e.target.value })} />
          </div>
        </div>
        <p className={difference === 0 ? "hint" : "error"} data-testid="receipt-difference">
          {difference === null ? t("cooking.noTotal") : difference === 0 ? t("cooking.adds") : t("cooking.offBy", { amount: money(Math.abs(difference), c) })}
        </p>
        {!locked ? (
          <div className="stack">
            <button type="button" className="btn-secondary" onClick={() => void save()}>
              {t("cooking.saveDraft")}
            </button>
            <button
              type="button"
              className="btn-primary"
              data-testid="receipt-confirm"
              onClick={() => void run(async () => { await api.cook.saveReceipt(id, body()); load(await api.cook.confirmReceipt(id)); })}
            >
              {t("cooking.confirmReceipt")}
            </button>
            <p className="fine">{t("cooking.confirmNote")}</p>
          </div>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => void run(async () => load(await api.cook.reopenReceipt(id)))}>
            {t("cooking.reopen")}
          </button>
        )}
      </section>
      <button
        type="button"
        className="btn-link danger"
        onClick={() => {
          if (confirm(t("cooking.deleteReceiptConfirm"))) void run(async () => { await api.cook.deleteReceipt(id); navigate("/cooking/receipts"); });
        }}
      >
        {t("cooking.deleteReceipt")}
      </button>

      {picking && catalog.status === "ready" && (
        <Sheet title={t("cooking.pickFood")} onClose={() => setPicking(null)}>
          <FoodPicker
            foods={catalog.foods}
            online={online}
            onPick={(food) => {
              setLine(picking, { foodId: food.id, foodDescription: food.description });
              setPicking(null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- statements

type StatementRow = CookStatementList["statements"][number];

const statusLabel = (t: ReturnType<typeof useT>, s: string) => (s === "draft" ? t("cooking.draft") : s === "sent" ? t("cooking.sent") : s === "paid" ? t("cooking.paid") : t("cooking.void"));

export function StatementsTab({ currency }: { currency: string }) {
  const t = useT();
  const [list, setList] = useState<StatementRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setList((await api.cook.statements()).statements)), [run]);
  return (
    <section data-testid="cook-statements">
      <p className="hint">{t("cooking.statementsIntro")}</p>
      <div className="stack">
        <button type="button" className="btn-secondary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> {t("cooking.newStatement")}
        </button>
      </div>
      <ErrorLine error={error} />
      <ul className="row-list">
        {list?.map((s) => (
          <li key={s.id}>
            <a className="row-item row-link" href={`#/cooking/statement/${s.id}`} data-testid="cook-statement-row">
              <span className="row-text">
                <span className="row-label">{s.title}</span>
                <span className="row-value">
                  {s.target.kind === "me" ? t("cooking.forMe") : s.target.name} · {t("cooking.mealCount", { n: s.mealCount })} · {statusLabel(t, s.status)}
                </span>
              </span>
              <span className="row-amount">{money(s.totals.totalCents, currency)}</span>
            </a>
          </li>
        ))}
      </ul>
      {list && !list.length && <p className="hint">{t("cooking.noStatements")}</p>}
      {creating && <NewStatementSheet currency={currency} onClose={() => setCreating(false)} />}
    </section>
  );
}

function NewStatementSheet({ currency, onClose }: { currency: string; onClose: () => void }) {
  const t = useT();
  const [meals, setMeals] = useState<CookMealSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setMeals((await api.cook.meals({ unbilled: true })).meals)), [run]);
  const first = meals?.find((m) => m.id === picked[0]);
  const sameTarget = (m: CookMealSummary) => !first || (m.target.kind === first.target.kind && (m.target.groupId ?? null) === (first.target.groupId ?? null) && (m.target.memberId ?? null) === (first.target.memberId ?? null) && (m.target.clientId ?? null) === (first.target.clientId ?? null));
  const sum = meals?.filter((m) => picked.includes(m.id)).reduce((s, m) => s + m.totals.totalCents, 0) ?? 0;
  async function create() {
    const s = await run(() => api.cook.createStatement({ id: crypto.randomUUID(), title: title.trim(), mealIds: picked }));
    if (s) navigate(`/cooking/statement/${s.id}`);
  }
  return (
    <Sheet title={t("cooking.newStatement")} onClose={onClose}>
      <div className="field">
        <label htmlFor="st-title">{t("cooking.statementTitle")}</label>
        <input id="st-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t("cooking.statementTitleHint")} />
      </div>
      <p className="hint">{t("cooking.pickMeals")}</p>
      {meals && !meals.length && <p className="hint">{t("cooking.nothingToBill")}</p>}
      <ul className="check-list" data-testid="statement-meals">
        {meals?.map((m) => (
          <li key={m.id}>
            <label className={`check${sameTarget(m) ? "" : " muted"}`}>
              <input
                type="checkbox"
                checked={picked.includes(m.id)}
                disabled={!sameTarget(m) || m.timerRunning}
                onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))}
              />
              <span>
                {m.name} · {formatDay(m.cookedOn, { day: "numeric", month: "short" })} · {m.target.kind === "me" ? t("cooking.forMe") : m.target.name}
                {m.timerRunning ? ` · ${t("cooking.timerOn")}` : ""}
              </span>
              <span className="row-amount">{money(m.totals.totalCents, currency)}</span>
            </label>
          </li>
        ))}
      </ul>
      {picked.length > 0 && <p className="hint">{t("cooking.statementSum", { amount: money(sum, currency) })}</p>}
      <ErrorLine error={error} />
      <button type="button" className="btn-primary" disabled={!title.trim() || !picked.length} onClick={() => void create()} data-testid="statement-create">
        {t("cooking.create")}
      </button>
    </Sheet>
  );
}

export function StatementScreen({ id }: { id: string }) {
  const t = useT();
  const [s, setS] = useState<CookStatement | null>(null);
  const [sharing, setSharing] = useState(false);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setS(await api.cook.statement(id))), [id, run]);
  if (!s) return <EmptyState title={t("cooking.statement")}>{error ?? t("common.loading")}</EmptyState>;
  const c = s.currency;
  const act = (a: "send" | "paid" | "void") => void run(async () => setS(await api.cook.statementAction(id, a)));
  async function csv() {
    const blob = await authedBlob(api.cook.statementCsvUrl(id));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${s!.title.replace(/[^\w-]+/g, "-").slice(0, 60) || "statement"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <div className="screen statement" data-testid="cook-statement">
      <header className="screen-head">
        <div>
          <p className="eyebrow no-print">
            <a href="#/cooking/statements">{t("cooking.statements")}</a> · {statusLabel(t, s.status)}
          </p>
          <h1>{s.title}</h1>
          <p className="hint">
            {s.target.kind === "me" ? t("cooking.forMe") : s.target.name}
            {s.sentAt ? ` · ${t("cooking.sentOn", { date: formatDay(s.sentAt.slice(0, 10), { day: "numeric", month: "long", year: "numeric" }) })}` : ""}
          </p>
        </div>
      </header>
      {s.status !== "draft" && <p className="banner banner-info no-print">{s.status === "void" ? t("cooking.voidNote") : t("cooking.frozenNote")}</p>}
      <ErrorLine error={error} />
      <section className="card">
        <table className="statement-table">
          <thead>
            <tr>
              <th scope="col">{t("cooking.date")}</th>
              <th scope="col">{t("cooking.meal")}</th>
              <th scope="col">{t("cooking.groceries")}</th>
              <th scope="col">{t("cooking.timeShort")}</th>
              <th scope="col">{t("cooking.total")}</th>
            </tr>
          </thead>
          <tbody>
            {s.meals.map((m) => (
              <tr key={m.id}>
                <td>{formatDay(m.cookedOn, { day: "numeric", month: "short" })}</td>
                <td>{m.name}</td>
                <td>{money(m.totals.groceriesCents, c)}</td>
                <td>{money(m.totals.timeCents, c)}</td>
                <td>{money(m.totals.totalCents, c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="cook-totals">
          <dt>{t("cooking.groceries")}</dt>
          <dd>{money(s.totals.groceriesCents, c)}</dd>
          <dt>{t("cooking.time", { time: minutesText(s.totals.minutes) })}</dt>
          <dd>{money(s.totals.timeCents, c)}</dd>
          {s.totals.expensesCents > 0 && (
            <>
              <dt>{t("cooking.otherCosts")}</dt>
              <dd>{money(s.totals.expensesCents, c)}</dd>
            </>
          )}
          {s.totals.flatFeeCents > 0 && (
            <>
              <dt>{t("cooking.fee")}</dt>
              <dd>{money(s.totals.flatFeeCents, c)}</dd>
            </>
          )}
          <dt className="total">{t("cooking.total")}</dt>
          <dd className="total" data-testid="statement-total">
            {money(s.totals.totalCents, c)}
          </dd>
        </dl>
        <p className="fine">{t("cooking.noTaxNote")}</p>
      </section>
      <div className="stack no-print">
        {s.status === "draft" && (
          <button type="button" className="btn-primary" onClick={() => act("send")} data-testid="statement-send">
            {t("cooking.markSent")}
          </button>
        )}
        {s.status === "sent" && (
          <button type="button" className="btn-primary" onClick={() => act("paid")}>
            {t("cooking.markPaid")}
          </button>
        )}
        {(s.status === "sent" || s.status === "paid") && (
          <button type="button" className="btn-secondary" onClick={() => setSharing(true)} data-testid="statement-share">
            <Icon name="share" size={18} /> {s.shared ? t("cooking.sharedUpdate") : t("cooking.share")}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={() => window.print()}>
          {t("cooking.print")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => void run(csv)}>
          {t("cooking.csv")}
        </button>
        {(s.status === "sent" || s.status === "paid") && (
          <button type="button" className="btn-link danger" onClick={() => confirm(t("cooking.voidConfirm")) && act("void")}>
            {t("cooking.voidIt")}
          </button>
        )}
        {(s.status === "draft" || s.status === "void") && (
          <button type="button" className="btn-link danger" onClick={() => void run(async () => { await api.cook.deleteStatement(id); navigate("/cooking/statements"); })}>
            {t("cooking.deleteStatement")}
          </button>
        )}
      </div>
      <p className="fine no-print">{t("cooking.markSentNote")}</p>
      {sharing && <ShareSheet kind="statement" id={id} onClose={() => setSharing(false)} onChanged={() => void run(async () => setS(await api.cook.statement(id)))} />}
    </div>
  );
}

// ---------------------------------------------------------------- sharing

export function ShareSheet({ kind, id, onClose, onChanged }: { kind: "meal" | "statement"; id: string; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<CookShareStatus | null | undefined>(undefined);
  const [parts, setParts] = useState<CookShareParts>({ groceries: false, time: false, totals: false });
  const [link, setLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const { error, run } = useErrors();
  useEffect(
    () =>
      void run(async () => {
        try {
          const s = kind === "meal" ? await api.cook.mealShare(id) : await api.cook.statementShare(id);
          setStatus(s);
          setParts(s.parts);
          setLink(!!s.linkUrl);
        } catch (err) {
          if ((err as { status?: number }).status === 404) setStatus(null);
          else throw err;
        }
      }),
    [kind, id, run],
  );
  const everything = parts.groceries && parts.time && parts.totals;
  async function save() {
    const s = await run(() => (kind === "meal" ? api.cook.shareMeal(id, parts, link) : api.cook.shareStatement(id, parts, link)));
    if (s) {
      setStatus(s);
      onChanged();
    }
  }
  async function stop() {
    await run(() => (kind === "meal" ? api.cook.unshareMeal(id) : api.cook.unshareStatement(id)));
    setStatus(null);
    setLink(false);
    onChanged();
  }
  const toggle = (k: keyof CookShareParts) => setParts({ ...parts, [k]: !parts[k] });
  return (
    <Sheet title={kind === "meal" ? t("cooking.shareMeal") : t("cooking.shareStatement")} onClose={onClose}>
      <p className="hint">{t("cooking.shareIntro")}</p>
      <ul className="check-list" data-testid="share-parts">
        <li>
          <label className="check">
            <input type="checkbox" checked disabled />
            <span>{t("cooking.shareBasics")}</span>
          </label>
        </li>
        <li>
          <label className="check">
            <input type="checkbox" checked={parts.groceries} onChange={() => toggle("groceries")} />
            <span>{t("cooking.shareGroceries")}</span>
          </label>
        </li>
        <li>
          <label className="check">
            <input type="checkbox" checked={parts.time} onChange={() => toggle("time")} />
            <span>{t("cooking.shareTime")}</span>
          </label>
        </li>
        <li>
          <label className="check">
            <input type="checkbox" checked={parts.totals} onChange={() => toggle("totals")} />
            <span>{t("cooking.shareTotals")}</span>
          </label>
        </li>
      </ul>
      <button type="button" className="btn-link" onClick={() => setParts(everything ? { groceries: false, time: false, totals: false } : { groceries: true, time: true, totals: true })}>
        {everything ? t("cooking.shareBasicsOnly") : t("cooking.shareEverything")}
      </button>
      <label className="check">
        <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
        <span>{t("cooking.shareLink")}</span>
      </label>
      {status?.audience && (
        <p className="fine">
          {status.audience.client ? t("cooking.audienceClient") : status.audience.group ? t("cooking.audienceGroup") : t("cooking.audienceNone")}
        </p>
      )}
      <p className="fine">{t("cooking.shareSnapshot")}</p>
      <ErrorLine error={error} />
      <button type="button" className="btn-primary" onClick={() => void save()} data-testid="share-save">
        {status ? t("cooking.shareUpdate") : t("cooking.shareSave")}
      </button>
      {status?.linkUrl && (
        <div className="stack" data-testid="share-link">
          <input readOnly value={status.linkUrl} aria-label={t("cooking.shareLinkLabel")} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void navigator.clipboard?.writeText(status.linkUrl!).then(() => setCopied(true), () => setCopied(false))}
          >
            <Icon name="link" size={18} /> {copied ? t("cooking.copied") : t("cooking.copyLink")}
          </button>
        </div>
      )}
      {status && (
        <button type="button" className="btn-link danger" onClick={() => void stop()}>
          {t("cooking.stopSharing")}
        </button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- what others see

export function SharedMealView({ meal }: { meal: CookSharedMeal }) {
  const t = useT();
  const c = meal.currency;
  return (
    <article className="card shared-cooked" data-testid="shared-cooked-meal">
      <h3>{meal.name}</h3>
      <p className="hint">
        {formatDay(meal.cookedOn, { day: "numeric", month: "long", year: "numeric" })} · {t("cooking.cookedBy", { name: meal.cookName })}
      </p>
      {meal.recipes.map((r, i) => (
        <div key={i}>
          <strong>{r.title}</strong> <small>{t("common.servings", { n: r.servings })}</small>
          {r.description && <p className="hint">{r.description}</p>}
        </div>
      ))}
      {meal.groceries && (
        <>
          <h4>{t("cooking.groceries")}</h4>
          <ul className="cook-ingredients">
            {meal.groceries.lines.map((l, i) => (
              <li key={i}>
                <span>{l.text}</span>
                <span>{money(l.costCents, c)}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{t("cooking.groceriesTotal", { amount: money(meal.groceries.totalCents, c) })}</p>
        </>
      )}
      {meal.time && <p className="hint">{t("cooking.sharedTime", { time: minutesText(meal.time.minutes), amount: money(meal.time.costCents, c) })}</p>}
      {meal.totals && (
        <p className="shared-total">
          {t("cooking.total")}: <strong>{money(meal.totals.totalCents, c)}</strong>
        </p>
      )}
    </article>
  );
}

function SharedStatementView({ statement }: { statement: CookSharedStatement }) {
  const t = useT();
  return (
    <section data-testid="shared-statement">
      <h2>{statement.title}</h2>
      <p className="hint">
        {t("cooking.cookedBy", { name: statement.cookName })} · {statement.status === "paid" ? t("cooking.paid") : t("cooking.sent")}
      </p>
      {statement.meals.map((m, i) => (
        <SharedMealView key={i} meal={m} />
      ))}
      {statement.totals && (
        <p className="shared-total">
          {t("cooking.total")}: <strong>{money(statement.totals.totalCents, statement.currency)}</strong>
        </p>
      )}
    </section>
  );
}

/** A link a cook shared: works signed out. */
export function PublicCooked({ token }: { token: string }) {
  const t = useT();
  const [share, setShare] = useState<Awaited<ReturnType<typeof api.cook.publicShare>> | null>(null);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setShare(await api.cook.publicShare(token))), [token, run]);
  return (
    // Outside the signed-in shell, so it brings its own page margins like the shared recipe page.
    <div className="public-page">
      <header className="public-head">
        <a className="public-brand" href="#/home">
          The Better Plate
        </a>
      </header>
      <main id="main" className="public-main" data-testid="public-cooked">
        <header className="screen-head">
          <div>
            <p className="eyebrow">{t("cooking.sharedWithYou")}</p>
            <h1>{share?.meal?.name ?? share?.statement?.title ?? t("cooking.sharedTitle")}</h1>
          </div>
        </header>
        {error && <p className="hint">{t("cooking.shareGone")}</p>}
        {share?.meal && <SharedMealView meal={share.meal} />}
        {share?.statement && <SharedStatementView statement={share.statement} />}
        <p className="fine">{t("cooking.publicNote")}</p>
      </main>
    </div>
  );
}

/** You → Cooks who cook for you: invites to accept, then every meal they cooked for you. */
export function MyCooks() {
  const t = useT();
  const [invites, setInvites] = useState<MyCookInvite[] | null>(null);
  const [cooks, setCooks] = useState<MyCook[] | null>(null);
  const { error, run } = useErrors();
  const load = useCallback(
    () =>
      void run(async () => {
        const [i, c] = await Promise.all([api.cook.myInvites(), api.cook.myCooks()]);
        setInvites(i.invites);
        setCooks(c.cooks);
      }),
    [run],
  );
  useEffect(load, [load]);
  return (
    <div className="screen" data-testid="my-cooks">
      <header className="screen-head">
        <div>
          <p className="eyebrow">
            <a href="#/you">{t("nav.you")}</a>
          </p>
          <h1>{t("cooking.myCooks")}</h1>
        </div>
      </header>
      <ErrorLine error={error} />
      {invites?.map((i) => (
        <section className="card" key={i.id} data-testid="cook-invite">
          <h2>{t("cooking.inviteFrom", { name: i.cookName })}</h2>
          <p className="hint">{t("cooking.inviteExplain", { name: i.cookName })}</p>
          <div className="stack">
            <button type="button" className="btn-primary" onClick={() => void run(async () => { await api.cook.acceptInvite(i.id); load(); })} data-testid="cook-invite-accept">
              {t("cooking.accept")}
            </button>
            <button type="button" className="btn-link" onClick={() => void run(async () => { await api.cook.declineInvite(i.id); load(); })}>
              {t("cooking.decline")}
            </button>
          </div>
        </section>
      ))}
      {cooks && !cooks.length && !invites?.length && <p className="hint">{t("cooking.noCooks")}</p>}
      {cooks?.map((c) => (
        <section key={c.clientId} aria-label={c.cookName}>
          <h2 className="section-h">{c.cookName}</h2>
          {c.statements.map((s) => (
            <SharedStatementView key={s.id} statement={s} />
          ))}
          <ul className="row-list">
            {c.meals.map((m) =>
              m.shared ? (
                <li key={m.id}>
                  <SharedMealView meal={m.shared} />
                </li>
              ) : (
                <li key={m.id} className="row-item" data-testid="my-cooked-meal">
                  <span className="row-text">
                    <span className="row-label">{m.name}</span>
                    <span className="row-value">{formatDay(m.cookedOn, { day: "numeric", month: "long", year: "numeric" })}</span>
                  </span>
                </li>
              ),
            )}
          </ul>
          <button
            type="button"
            className="btn-link danger"
            onClick={() => {
              if (confirm(t("cooking.leaveConfirm", { name: c.cookName }))) void run(async () => { await api.cook.leaveCook(c.clientId); load(); });
            }}
          >
            {t("cooking.leave")}
          </button>
        </section>
      ))}
    </div>
  );
}

/** Group screen: meals cooked for the group, as shared. The owner can switch off member sharing. */
export function GroupCookedMeals({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const t = useT();
  const [meals, setMeals] = useState<GroupCookedMeal[] | null>(null);
  const [memberShares, setMemberShares] = useState(true);
  const { error, run } = useErrors();
  useEffect(
    () =>
      void run(async () => {
        const r = await api.cook.groupCookedMeals(groupId);
        setMeals(r.meals);
        setMemberShares(r.memberShares);
      }),
    [groupId, run],
  );
  if (!meals || (!meals.length && !isOwner)) return null;
  return (
    <section aria-labelledby="group-cooked" data-testid="group-cooked">
      <h2 id="group-cooked" className="section-h">
        {t("cooking.groupCooked")}
      </h2>
      <ErrorLine error={error} />
      {!meals.length && <p className="hint">{t("cooking.groupNoCooked")}</p>}
      {meals.map((m) => (
        <SharedMealView key={m.id} meal={m.meal} />
      ))}
      {isOwner && (
        <label className="check">
          <input type="checkbox" checked={memberShares} onChange={(e) => void run(async () => setMemberShares((await api.cook.setGroupCookSettings(groupId, e.target.checked)).memberShares))} />
          <span>{t("cooking.memberSharesSetting")}</span>
        </label>
      )}
    </section>
  );
}
