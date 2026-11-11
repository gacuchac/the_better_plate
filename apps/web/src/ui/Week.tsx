import { useMemo } from "react";
import { rollingWeek, WATER_KEY, type WeekLine } from "@betterplate/nutrition";
import { intakeByDay, waterIntakeByDay } from "../goals.ts";
import { localDate } from "../meals.ts";
import { formatNutrient, nutrientName, useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { useGentle } from "../gentle.ts";
import { Meter } from "./Meter.tsx";

/**
 * The last seven days on Your Kitchen, next to today: what was eaten against the person's own
 * daily goals, each day counted with the goal it had, so one day over or under still shows where
 * the week stands. Logged meals only; days with nothing logged are left out; hidden in gentle mode.
 */
export function Week() {
  const { goals, logs, water, catalog } = useApp();
  const t = useT();
  const gentle = useGentle();
  const today = localDate();
  const week = useMemo(() => {
    if (catalog.status !== "ready") return null;
    const intake = intakeByDay(logs.filter((l) => !l.deleted), catalog.foods, catalog.bundle.nutrients);
    const live = goals.filter((g) => !g.deleted).map((g) => g.body);
    const waterIn = live.some((g) => g.nutrientKey === WATER_KEY) ? { key: WATER_KEY, intake: waterIntakeByDay(intake, water) } : undefined;
    return rollingWeek(live, intake, today, waterIn);
  }, [goals, logs, water, catalog, today]);

  if (gentle || !week || week.daysLogged === 0 || week.lines.length === 0) return null;
  const defs = catalog.status === "ready" ? catalog.bundle.nutrients : [];
  const qty = (line: WeekLine, n: number | null) => formatNutrient(line.nutrientKey, n, line.unit);
  const goalText = (line: WeekLine) => (line.min !== null && line.max !== null ? `${qty(line, line.min)}–${qty(line, line.max)}` : qty(line, line.max ?? line.min));
  const leftText = (line: WeekLine) => {
    if (line.eaten === null) return t("goals.status.notReported");
    if (line.toGo !== null) return t("week.toGo", { amount: qty(line, line.toGo) });
    if (line.over !== null) return t("week.over", { amount: qty(line, line.over) });
    if (line.roomLeft !== null) return t("week.roomLeft", { amount: qty(line, line.roomLeft) });
    return t("week.met");
  };

  return (
    <section className="card week-card" aria-labelledby="week-heading" data-testid="week-card">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2 id="week-heading">{t("week.title")}</h2>
        <span className="hint" style={{ margin: 0 }}>{t("common.estimated")}</span>
      </div>
      <ul className="week-lines">
        {week.lines.map((line) => {
          const name = nutrientName(line.nutrientKey, defs.find((d) => d.key === line.nutrientKey)?.name ?? line.nutrientKey);
          return (
            <li key={`${line.nutrientKey}|${line.unit}`} className="week-line" data-testid="week-line">
              <div className="week-line-head">
                <span className="stat-label">{name}</span>
                <span className="week-amount">{t("week.eatenOf", { eaten: qty(line, line.eaten), goal: goalText(line) })}</span>
              </div>
              <Meter amount={line.eaten} goal={line.max ?? line.min} />
              <p className="fine" data-testid="week-left">
                {leftText(line)} · {t("week.days", { n: line.days })}
              </p>
              {line.partial && line.eaten !== null && <p className="fine">{t("goals.partial")}</p>}
            </li>
          );
        })}
      </ul>
      <p className="fine">{t("week.hint")}</p>
    </section>
  );
}
