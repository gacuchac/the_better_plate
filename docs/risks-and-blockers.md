# Risks and blockers

| # | Item | Impact | Owner | Status |
|---|---|---|---|---|
| B1 | Cloud dev environment (preflight S1–S4) | Hosted pass and deploy | Gabriel | Resolved for dev: Railway dev live, autodeploys from `dev`; production still needs approval |
| B2 | Transactional email provider (S5) | Sign-in cannot send real email outside local | Gabriel picks provider; agent adds adapter | Open |
| B3 | Cloud agent sessions could not reach USDA hosts | Importer runs in GitHub Actions instead; online food search untestable here | Gabriel allowed hosts in a new environment on 2026-10-19; next sessions confirm | Mitigated |
| B4 | Food photography licenses (P5) | App is typographic for now | Gabriel | Open |
| R1 | Railway public-suffix domains block cross-subdomain cookies (ADR-002) | Needed same-origin serving | Agent | Resolved: one service serves API and PWA (ADR-001 amendment) |
| R2 | Rate limits in process memory | Not shared across replicas | Agent before scaling | Accepted for pilot |
| R3 | SR Legacy is frozen (2018) | Some values older than Foundation Foods | Agent: evaluate Foundation Foods per food | Open |
| R4 | Oil absorption not modeled; discard must be measured | Estimates count all oil unless the user weighs the discard; disclosed in UI | Product decision (no invented fractions) | Accepted |
| R5 | `sync_operations` grows without pruning | Storage growth | Agent: add pruning job | Open |
| R6 | No privacy notice or consent records yet (P3) | Cannot launch publicly | Gabriel/counsel | Open |
| R7 | Safe-temperature mapping from USDA food groups is heuristic (e.g. ham, cured meats, squid not in chart) | Some foods show no temperature | Agent: extend only with sourced chart rows | Accepted, disclosed in cook mode |
| R8 | Anonymous issue reports have no retention limit yet | Storage of free text | Agent: add retention job with P3 policy | Open |
