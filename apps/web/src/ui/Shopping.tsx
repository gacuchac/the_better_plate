import { useEffect, useMemo, useState } from "react";
import type { ShoppingList } from "@betterplate/contracts";
import { buildShoppingList, type FoodRecord, type ShoppingPlan } from "@betterplate/nutrition";
import { api, ApiRequestError } from "../api.ts";
import { dateLocale, useT } from "../i18n.ts";
import { addDays, formatDay, localDate } from "../meals.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { isAdminOf, SubjectChips, useSubject } from "./People.tsx";

/** Monday of the week that holds a day. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y!, m! - 1, d!).getDay();
  return addDays(date, -((day + 6) % 7));
}

/** Grams to buy, rounded for reading: whole grams, or kilograms above one kilo. */
export function formatGrams(grams: number): string {
  const n = (v: number, digits: number) => v.toLocaleString(dateLocale(), { maximumFractionDigits: digits });
  return grams >= 1000 ? `${n(grams / 1000, 2)} kg` : `${n(Math.round(grams), 0)} g`;
}

type Bought = Set<string>;
const boughtKey = (account: string, scope: string, week: string) => `bp.shop.${account}.${scope}.${week}`;

function readBought(key: string): Bought {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * What to buy for planned meals, a week at a time. A person's own list (and their profiles') is
 * worked out on this device, offline too; a group's whole list comes from the server.
 */
export function Shopping({ groupId }: { groupId?: string }) {
  const { account, catalog, allPlans, recipes, groups, online } = useApp();
  const t = useT();
  const [subject, setSubject] = useSubject();
  const [week, setWeek] = useState(() => weekStart(localDate()));
  const [remote, setRemote] = useState<ShoppingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const to = addDays(week, 6);
  const scope = groupId ? `group:${groupId}` : (subject ?? "me");
  const key = boughtKey(account?.id ?? "", scope, week);
  const [bought, setBought] = useState<Bought>(() => readBought(key));
  useEffect(() => setBought(readBought(key)), [key]);
  const group = groups?.find((g) => g.id === groupId);

  const foods = catalog.status === "ready" ? catalog.foods : new Map<string, FoodRecord>();
  const local = useMemo(() => {
    if (groupId) return null;
    const mine = allPlans.filter((p) => (p.body.profileId ?? null) === subject && p.body.date >= week && p.body.date <= to);
    // Plans waiting for an admin's approval are not on the list until approved.
    const counted = mine.filter((p) => !p.meta || p.meta.status === "planned");
    const plans: ShoppingPlan[] = counted.map((p) => {
      const recipe = recipes.find((r) => r.id === p.body.recipeId);
      return { planId: p.id, date: p.body.date, title: p.body.title, servings: p.body.servings, recipe: recipe ? recipe.body : null };
    });
    return { from: week, to, ...buildShoppingList(plans, foods), awaitingApproval: mine.filter((p) => p.meta?.status === "proposed").length } satisfies ShoppingList;
  }, [groupId, allPlans, subject, week, to, recipes, foods]);

  useEffect(() => {
    if (!groupId) return;
    setRemote(null);
    setError(null);
    if (!online) return;
    let cancelled = false;
    api.shoppingList(week, to, { groupId }).then(
      (list) => !cancelled && setRemote(list),
      (err) => !cancelled && setError(err instanceof ApiRequestError ? err.message : t("groups.offline")),
    );
    return () => {
      cancelled = true;
    };
  }, [groupId, week, to, online]);

  if (catalog.status !== "ready") return <EmptyState title={t("catalog.notReady")}>{catalog.status === "unavailable" ? t("catalog.unavailable") : t("common.loading")}</EmptyState>;
  const list = groupId ? remote : local;

  const toggle = (foodId: string) => {
    const next = new Set(bought);
    if (next.has(foodId)) next.delete(foodId);
    else next.add(foodId);
    setBought(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Ticks last for this visit only.
    }
  };

  const amount = (i: ShoppingList["items"][number]) =>
    i.grams === null ? t("shop.amountUnknown") : `${formatGrams(i.grams)}${i.unresolved ? ` + ${t("shop.unresolved", { n: i.unresolved })}` : ""}`;

  async function share() {
    if (!list) return;
    const lines = list.items.filter((i) => !bought.has(i.foodId)).map((i) => `• ${i.description}: ${amount(i)}`);
    const text = `${t("shop.title")} (${formatDay(week, { day: "numeric", month: "short" })} – ${formatDay(to, { day: "numeric", month: "short" })})\n${lines.join("\n")}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setNote(t("shop.copied"));
      }
    } catch {
      // Cancelled by the person, or clipboard blocked.
    }
  }

  let lastCategory: string | null | undefined;
  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{group ? group.name : t("nav.kitchen")}</p>
          <h1>{t("shop.title")}</h1>
        </div>
      </header>
      {!groupId && <SubjectChips value={subject} onChange={setSubject} />}
      {!groupId && groups && groups.some((g) => isAdminOf(groups, g.id)) && (
        <div className="choice-row subject-row" role="group" aria-label={t("shop.groupLists")}>
          {groups.filter((g) => isAdminOf(groups, g.id)).map((g) => (
            <button key={g.id} type="button" onClick={() => navigate(`/shopping/group/${g.id}`)}>
              <Icon name="people" size={16} /> {g.name}
            </button>
          ))}
        </div>
      )}
      <div className="day-nav">
        <button type="button" className="icon-btn round" aria-label={t("meals.prevWeek")} onClick={() => setWeek(addDays(week, -7))}>
          <Icon name="back" />
        </button>
        <div className="day-title">
          <h2>{week === weekStart(localDate()) ? t("shop.thisWeek") : t("shop.weekOf", { date: formatDay(week, { day: "numeric", month: "long" }) })}</h2>
          <p>{`${formatDay(week, { weekday: "short", day: "numeric", month: "short" })} – ${formatDay(to, { weekday: "short", day: "numeric", month: "short" })}`}</p>
        </div>
        <button type="button" className="icon-btn round" aria-label={t("meals.nextWeek")} onClick={() => setWeek(addDays(week, 7))}>
          <Icon name="forward" />
        </button>
      </div>

      {groupId && !online && <p className="banner banner-info">{t("groups.offline")}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {groupId && online && !remote && !error && <p className="hint">{t("common.loading")}</p>}

      {list && (
        <>
          <p className="hint" data-testid="shop-summary">
            {list.plans ? t("shop.fromPlans", { n: list.plans }) : t("shop.noPlans")}
            {list.awaitingApproval > 0 && ` ${t("shop.awaiting", { n: list.awaitingApproval })}`}
          </p>
          {list.items.length > 0 && (
            <ul className="shopping-list" data-testid="shopping-list">
              {list.items.map((i) => {
                const header = i.category !== lastCategory ? (lastCategory = i.category) ?? t("shop.other") : null;
                return (
                  <li key={i.foodId}>
                    {header && <h3 className="shop-category">{header}</h3>}
                    <label className={`check shop-item${bought.has(i.foodId) ? " done" : ""}`} data-testid="shopping-item">
                      <input type="checkbox" checked={bought.has(i.foodId)} onChange={() => toggle(i.foodId)} />
                      <span className="shop-name">
                        {i.description}
                        <small>
                          {i.recipes.join(", ")}
                          {i.oil ? ` · ${t("shop.oilNote")}` : ""}
                          {i.preparedForm ? ` · ${t("shop.cookedNote")}` : ""}
                        </small>
                      </span>
                      <span className="shop-amount">{amount(i)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {list.missing.length > 0 && (
            <p className="hint" data-testid="shop-missing">
              {t("shop.missing", { list: list.missing.map((m) => m.title).join(", ") })}
            </p>
          )}
          {list.items.length > 0 && (
            <div className="sheet-actions">
              <button type="button" className="btn-secondary" onClick={() => void share()}>
                <Icon name="share" size={18} /> {t("shop.share")}
              </button>
            </div>
          )}
          {note && <p className="hint" role="status">{note}</p>}
          <p className="fine">{t("shop.fine")}</p>
        </>
      )}
    </div>
  );
}
