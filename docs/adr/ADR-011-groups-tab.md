# ADR-011: Groups becomes a fifth root destination

**Status:** accepted (owner decision, Gabriel, 2026-10-21)

**Context:** PRODUCT.md §1 and §6 fixed four root destinations (Your Kitchen, Create, Explore, You). Groups (ADR-009) was nested under You at `#/groups`, two steps from a core journey (plan for a group member).

**Decision:** Add Groups as a fifth root destination between Explore and You, in the bottom nav and desktop rail. `#/groups`, `#/groups/:id` and `#/join/:id` highlight it. The You page keeps its Groups summary line, which links to the tab. PRODUCT.md §1 and §6 are amended to five.

**Consequences:** Five equal columns on the mobile bottom nav (about 75px each at 375px, above the 44px touch target). E2E and a11y tests cover the tab. Revert by removing the NAV entry.
