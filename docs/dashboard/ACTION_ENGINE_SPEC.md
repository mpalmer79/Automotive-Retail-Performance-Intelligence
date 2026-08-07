# Management Action Engine Specification

**Status:** Planning contract; implemented by `DASH.12`.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[KPI_EXTENSION_PLAN.md](KPI_EXTENSION_PLAN.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md)

A deterministic, explainable review-queue generator. **No language model, no learned model, no
scoring heuristic that cannot be recomputed by hand from the rule file and the export.** Same data +
same rules + same as-of date → byte-identical actions.

---

## 1. Where actions come from

Rules live in **`config/dashboard/action_rules.yaml`** (versioned; `config/` is the repository's
established YAML home). The export pipeline evaluates rules against the allowlisted datasets at
export time and writes `management-actions` as an ordinary dataset with manifest hashes. The console
renders actions; it never generates them client-side, so the queue is identical for every visitor of
a given dataset version.

## 2. Rule definition format

```yaml
schema: arpi.action_rules/1
defaults:
  expiry: dataset            # actions live exactly as long as the dataset version
rules:
  - rule_id: ACT-INV-001
    domain: inventory
    title: Aged unit with no recent markdown
    description: >
      Units past the aged threshold whose asking price has not moved within the
      markdown-recency window carry unmanaged carrying risk.
    entity_type: inventory_unit          # inventory_unit | deal | store | employee | account | source
    owner_role: Used-car manager
    enabled: true
    thresholds:                          # every value a labelled project default
      aged_days: 90
      markdown_recency_days: 30
    severity:
      high:   "days_in_stock >= 120"
      medium: "days_in_stock >= 90"
    evidence:                            # exported fields shown with the action
      - stock_reference
      - days_in_stock
      - current_asking_price
      - markdown_count_to_date
      - price_to_market_ratio
    suppression:
      - "unit not active at as-of date"
      - "below minimum evidence completeness"
    dedupe_key: "{rule_id}:{entity_id}"  # one open action per rule per entity per dataset
    drill_through: /dashboard/inventory?unit={entity_id}
    recommended_review: >
      Review pricing history and lead activity for this unit; compare to the
      store's aged-unit pattern before any pricing decision.
    limitations: >
      Threshold is a project default for a fictional group, not a market standard.
```

Field semantics:

| Field | Rule |
|---|---|
| `rule_id` | Permanent, `ACT-<DOMAIN>-NNN` (`INV`, `SLS`, `FNI`, `LED`, `ACC`); never reused |
| `severity` | Ordered predicate list evaluated top-down over exported fields only; first match wins; no match at any level → no action |
| `evidence` | Exported, non-personal fields only; the action carries their values verbatim |
| `owner_role` | Role vocabulary: Dealer principal, General manager, General sales manager, Used-car manager, F&I manager, BDC manager, Controller |
| `thresholds` | Numeric project defaults; rendered with the action ("project default: 90 days") |
| `suppression` | Documented conditions that veto an otherwise-firing rule (minimum sample, entity inactive, duplicate) |
| `dedupe_key` | Exactly one action per key per dataset version |
| Expiration | Actions are not stateful: each export regenerates the queue; an action "expires" by its condition no longer holding. No persistence, no acknowledgement, no history |
| `drill_through` | Must resolve to a registered route + valid params (checked at generation) |
| `enabled` | A disabled rule stays in the file with its id; deletion is prohibited |

## 3. Action output shape (`management-actions` dataset)

`action_id` (`{rule_id}:{entity_id}:{dataset_version}`) · `rule_id` · `as_of_date` · `store` ·
`entity_type` · `entity_id` · `severity` · `title` · `evidence` (name/value pairs) ·
`recommended_review` · `owner_role` · `drill_through` · `thresholds_used`.

## 4. Rule families (initial register)

**Inventory** — `ACT-INV-001` aged, no recent markdown · `ACT-INV-002` high age + low lead activity ·
`ACT-INV-003` high price-to-market + rising age · `ACT-INV-004` 90+ days with no appointment
activity · `ACT-INV-005` book/GL variance on the unit's account (`DASH.8`) · `ACT-INV-006` missing
accounting record (`DASH.8`) · `ACT-INV-007` model concentration above project default.

**Sales and gross** — `ACT-SLS-001` negative front-gross deal · `ACT-SLS-002` negative total-gross
deal · `ACT-SLS-003` material front-PVR decline vs comparison · `ACT-SLS-004` material back-PVR
decline · `ACT-SLS-005` high discount on low-age unit · `ACT-SLS-006` deal-gross identity failure.

**F&I** (`DASH.6`+) — `ACT-FNI-001` back-gross reconciliation failure · `ACT-FNI-002` product on
ineligible deal · `ACT-FNI-003` chargeback concentration (manager/provider/category) ·
`ACT-FNI-004` adjustment exceeding original gross · `ACT-FNI-005` financed deal without lender ·
`ACT-FNI-006` eligible retail deal without finance-manager attribution where the synthetic policy
requires one · `ACT-FNI-007` penetration change on sufficient sample.

**Leads** — `ACT-LED-001` lead without first response · `ACT-LED-002` response time above project
default · `ACT-LED-003` high volume + low contact rate · `ACT-LED-004` low show rate on set
appointments · `ACT-LED-005` low show-to-sale conversion.

**Accounting** (`DASH.8`+) — `ACT-ACC-001` GL control variance · `ACT-ACC-002` missing stock-level
schedule row · `ACT-ACC-003` orphaned adjustment · `ACT-ACC-004` duplicate accounting record ·
`ACT-ACC-005` posting-date lag above project default.

Every rate- or comparison-based rule embeds the minimum-sample suppression; no rule fires on an
employee below the sample floor.

## 5. Explanation text

Generated from per-rule templates with slot substitution from evidence fields only. Vocabulary is
restricted to review verbs — **review, investigate, validate, reconcile, compare, confirm** — and
the generator rejects a template containing operational verbs (reprice, terminate, deny, submit,
cancel, approve) or causal claims. No action ever states or implies that anything was assigned,
completed, or resolved; the console has no write-back and the queue is stateless by design.

## 6. Severity

Three levels — `high`, `medium`, `low` — mapped to the existing badge vocabulary (never color-only).
Severity logic is part of the rule file, visible in the UI's threshold disclosure.

## 7. The "Why did this change?" driver engine (same increment, same discipline)

Deterministic decomposition of a KPI's period-over-period change, computed in SQL
(`vw_gross_change_bridge`) and carried through the export:

- Components: unit-volume effect, front-PVR effect, back-PVR effect; documented mix components
  (new/used, store, sale type) only once their calculation order is documented.
- **Sequential decomposition with the order stated on the surface**; components reconcile exactly to
  the total change (integration-tested).
- Narratives are template-generated: "Total gross was lower by $X. The bridge attributes $Y to unit
  volume, $Z to front PVR, and $A to back PVR under the documented sequential decomposition." Causal
  wording is rejected by test.
- Effects below the materiality project default are grouped into a labelled remainder, never
  silently dropped (the bridge must still sum exactly).
- Incomparable or empty periods render the honest unavailable state.
- The same formulas are registered for future Power BI ownership (documented DAX or SQL source);
  TypeScript renders, and never re-derives, a second formula.

## 8. No-persistence boundary

No database writes, no local-storage workflow state, no cookie state, no "mark as done". The only
client state is presentation (filters in the URL). This boundary is what keeps the Action Center a
demonstration of analytical judgment rather than a fake workflow tool.

## 9. Limitations (rendered with the queue)

Thresholds are project defaults for a fictional group; actions are review prompts, not findings,
recommendations of business action, or evidence of real-world conditions; the queue regenerates with
each dataset version and holds no history.

## 10. Required tests

- **Rule engine unit tests:** each rule has at least one firing fixture and one suppressed fixture;
  determinism (double run, byte-equal); dedupe; severity ordering; template vocabulary rejection
  (operational verbs, causal claims); drill-through target validation against the route registry.
- **Schema tests:** rule file validates against `arpi.action_rules/1`; unknown fields rejected;
  disabled rules retained.
- **Cross-layer:** every evidence field exists in the exporting dataset's contract; every threshold
  rendered in the UI equals the configured value.
- **E2E:** queue renders with facets; a seeded high-severity fixture appears on `/dashboard` top
  actions; drill-throughs resolve; axe clean; no-JS renders the full queue.
- **Bridge tests:** exact reconciliation on every fixture; suppressed-remainder sums; unavailable
  state on incomparable periods; non-causal narrative assertion.
