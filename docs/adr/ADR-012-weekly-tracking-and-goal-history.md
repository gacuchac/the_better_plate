# ADR-012: Weekly tracking on Your Kitchen and goal history

**Status:** proposed (PR into `dev`) · **Date:** 2026-11-11 · **Decided by:** owner (rolling last 7 days; each day counts with the goal it had), agent (design)

## Context

The owner asked for weekly metrics on the home page next to the daily view, so a day over or under still shows whether the week is on track. The owner chose a rolling last 7 days rather than Monday to Sunday, and said goals can change within those days, so the week must add up each day's goal as it was that day. Goals already carry `startDate` and `endDate` (ADR-008), but editing a goal overwrote it in place, so a changed amount rewrote the past.

## Decisions

1. **Goal history without a migration.** When the amounts (or nutrient, kind or period) of a goal that already applied before today change, the old goal now ends the day before the change and a new goal starts on it. The change starts today, or on the new start date when the person moved it later ("since Monday", "from next Monday"). Date-only edits, goals that started today or later, ended goals and starts moved earlier still overwrite, since the person is then correcting the goal itself. The same rule (`reviseGoal` in `packages/nutrition/src/weekly.ts`) runs in the Goals sheet, the companion's `set_goal` and the connector's `set_goal`. The Goals sheet says which days keep the old amount before saving. Deleting a goal still deletes it.
2. **Limit counts current goals.** Since each change keeps an ended goal, the 50-goal limit now counts goals still running or yet to start (with a day of slack for time zones on the server). A second cap of 1,000 goals in all, ended ones included, bounds storage.
3. **Rolling 7 days.** `rollingWeek` covers today and the six days before. For each nutrient with a daily goal, the week's target is the sum of each counted day's own goal (lower bound, upper bound or both). Counted days are days with a goal and at least one logged meal, plus today, which is still open. Days with nothing logged are left out of both sides, as in ADR-008 (not logged is not "ate nothing"). Weekly and monthly goals keep their calendar windows on the Goals screen and are not part of this.
4. **What today can still do.** Because the window is rolling, today is the one open day, so "left" is for today: still to go to the lower bound, room left under the upper bound, or how far the days are above it, stated plainly. Hidden in Gentle mode like the daily marks.

## Alternatives considered

- A goal history table (migration) written on every goal change: more complete (deletes would keep history too), but needs a new synced entity or endpoint for the offline client. Not needed while ended goals already describe the past.
- Seven times today's goal: rejected by the owner (goals change within the week).
- Counting unlogged days as zero: rejected (ADR-008); it would also ask for large amounts "today" after days the person simply didn't log.

## Consequences

- Goals edited before this change have already lost their earlier amounts; their whole span counts at the current amount.
- Ended goals accumulate on the Goals screen (shown last). Collapsing them is a later improvement.
- Supersedes ADR-008's rejection of rolling weeks for this home-page view only; goals themselves keep calendar periods.
