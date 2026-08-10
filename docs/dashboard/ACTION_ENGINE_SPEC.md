# Management Action Engine Specification

**Status:** **As built**, delivered by `DASH.12`.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[KPI_EXTENSION_PLAN.md](KPI_EXTENSION_PLAN.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md)
**Review:** [DASH-12-REVIEW.md](../reviews/DASH-12-REVIEW.md)

A deterministic, explainable review-queue generator. **No language model, no learned model, no
scoring heuristic that cannot be recomputed by hand from the rule file and the export.** Same data +
same rules + same as-of date → byte-identical actions.

> **This document was a planning contract until `DASH.12`.** Where the plan and the
> implementation differ, the implementation is described and the difference is stated. Two
> differences matter enough to name at the top:
>
> 1. **The 90-day aged example is withdrawn.** The plan's `ACT-INV-001` illustration used a
>    90-day aged threshold and a 120-day severity threshold. The implemented inventory
>    program established **60 days** as the governed project-default aged threshold, published
>    on every row as `aged_threshold_days`. The rule file does not restate it at any value: it
>    reads the governed boolean and discloses the row's own number. 120 days survives as a
>    **high-severity review threshold**, which is a different thing and is labelled as one.
> 2. **The register is mostly disabled, and that is the finding.** Twelve of the thirty
>    proposed identifiers are enabled. The other eighteen are retained, switched off, and
>    carry the audited reason the project cannot evaluate them honestly.

---

## 1. Where actions come from

Rules live in **`config/dashboard/action_rules.yaml`** (versioned; `config/` is the repository's
established YAML home). The export pipeline evaluates rules **against the datasets the export is
about to publish** — never against the database — and writes `management-actions.json` beside them
with its hashes in the manifest. The console renders actions; it never generates them, so the queue
is identical for every visitor of a given dataset version.

That ordering is the architecture. The engine sees exactly what a reader of the published export
sees, so any action can be recomputed by hand from files in the repository, and the offline
`--check` can re-derive the whole queue without a database.

## 2. Rule definition format (as built)

```yaml
schema: arpi.action_rules/1
ruleset_version: 1
defaults:
  expiry: dataset                      # the only model: an action lives as long as its version
change_drivers:                        # the DASH.12-03 display policy, section 8
  authority: reporting.vw_gross_change_bridge
  dataset: gross-change-bridge
  decomposition_order: [volume, front_pvr, back_pvr]
  materiality: {value: 500, units: USD, label: "… — project default", rationale: "…"}
rules:
  - rule_id: ACT-INV-001
    enabled: true
    domain: inventory                  # inventory | sales-gross | fi | leads | accounting
    entity_type: inventory_unit
    owner_role: Used-car manager
    title: Aged unit with no markdown since the prior snapshot
    description: >
      …
    state_reason: >                    # why this rule is in the state it is in
      …
    source_dataset: inventory-units    # the ONLY data the rule may see
    date_basis: snapshot date
    scope:
      as_of: snapshot_date             # | as_of_month: <col> | all: true
      filter: <predicate>              # optional, narrows the population first
    entity_key: [dealership_id, vehicle_id]
    store_field: dealership_id
    date_field: snapshot_date
    thresholds:                        # rule-OWNED review thresholds
      high_severity_days:
        value: 120
        units: days
        label: High-severity review threshold — project default
        rationale: >
          …
    disclosed_columns:                 # GOVERNED thresholds, read from the row
      - column: aged_threshold_days
        label: Aged threshold
        units: days
        authority: governed inventory aged-threshold project default, published per row
    minimum_sample:                    # optional; floors on the METRIC'S own denominator
      denominator: eligible_appointments
      floor: {authority: governed_minimum_sample}
      disclosure: eligible appointments on the scheduled date
    predicate: >
      is_aged_over_default_threshold == true and is_price_reduced_since_prior == false
    severity:                          # ordered, most severe first, first match wins
      - level: high
        predicate: days_in_stock >= @high_severity_days
      - level: medium                  # the final band may omit its predicate
    evidence: [days_in_stock, aged_threshold_days, …]
    recommended_review: >
      Review this unit's price movement against its age and the store's aged-unit pattern.
    limitations: >
      …
    suppression: [ … documented vetoes … ]
    drill_through:
      route: /dashboard/inventory      # may carry {slots} of its own
      params: {store: "{dealership_id}", unit: "{vehicle_id}"}
```

**What the plan left implied, and this schema declares.** Which dataset a rule reads, what
identifies its entity, which rows are in scope for an as-of date, which columns are evidence and
where the drill-through resolves. Left implied, each of those becomes an `if rule_id == …` branch in
Python — and a rule engine whose rule semantics live in Python is not a rule engine.
`arpi/dashboard/actions.py` contains no rule-specific code.

### The predicate grammar

Predicates are **not Python**. `arpi/dashboard/action_predicate.py` is a tokenizer, a
recursive-descent parser and a three-valued evaluator over a grammar with no function calls, no
attribute access, no indexing and no name resolution beyond two closed vocabularies: the exported
columns of the rule's dataset, and the thresholds the rule declares.

```
expression  := disjunction
disjunction := conjunction ( "or" conjunction )*
conjunction := negation ( "and" negation )*
negation    := "not" negation | condition
condition   := "(" expression ")" | operand ( comparison operand | "is" [ "not" ] "null" )?
operand     := name | "@" name | "-@" name | number | string | "true" | "false"
```

`eval`, `exec`, `ast.literal_eval`-as-expression-engine and dynamic import are absent by
construction. Validation happens at **load time against the export contract**: an unknown column, an
unknown threshold, an operator undefined for its operands' kinds, or a comparison between a string
column and a number is refused before a row is read.

**Three-valued logic.** A comparison with a NULL operand is UNKNOWN; `and`/`or`/`not` follow
Kleene's tables; a rule fires only on TRUE. `is null` / `is not null` are the only ways to ask about
absence deliberately, and exactly two rules do. **Every numeric comparison is `Decimal`**; a numeric
literal is parsed from its source text and never through `float`.

`-@name` exists so a severity band symmetric about zero — a control variance reviewed on its size,
whichever side carries more — reads one declared threshold rather than a positive one and a
hand-kept negative twin.

## 3. Action output shape (`management-actions.json`)

`action_id` (`{rule_id}:{entity_id}:{dataset_version}`) · `rule_id` · `domain` · `as_of_date` ·
`store` · `entity_type` · `entity_id` · `severity` · `title` · `owner_role` · `recommended_review` ·
`limitations` · `date_basis` · `observed_date` · `drill_through` · `evidence` (name / value / type /
unit / display precision) · `thresholds_used` (name / label / value / units / source / authority).

Four fields beyond the plan's list, each earning its place: `domain` because the console's domain
facet is part of the contract; `limitations` because the plan already required them rendered with
the queue; `date_basis` and `observed_date` because an action about a snapshot and an action about a
delivery are measured on different clocks and a reader must be able to tell which.

`entity_id` is the rule's `entity_key` values joined by `|`, which keeps the documented identity
contract literally true for composite keys.

## 4. Rule families — the as-built register

Twelve enabled, eighteen retained and disabled. **A permanent identifier is never deleted and never
renumbered.** The four states a rule may be in:

| State | Meaning |
|---|---|
| `supported` | The governed data supports the rule honestly. Enabled. |
| `blocked-by-missing-data` | The project holds no such evidence. |
| `blocked-by-grain` | The evidence exists, but not at the rule's grain. |
| `duplicates-data-quality-gate` | The condition cannot survive into a valid export. |

### Inventory

| Rule | State | As built |
|---|---|---|
| `ACT-INV-001` aged, no recent markdown | **enabled** | Reads `is_price_reduced_since_prior` at unit grain over the published month-end snapshot series — a real markdown-recency relationship, not one inferred from `markdown_count_to_date`. A unit with no prior snapshot suppresses. |
| `ACT-INV-002` high age + low lead activity | disabled — missing data | Lead activity is modelled at store/source/campaign grain and never at vehicle grain. |
| `ACT-INV-003` high price-to-market + rising age | **enabled** | Both operands published at unit grain. A null market estimate suppresses. |
| `ACT-INV-004` 90+ days, no appointment activity | disabled — missing data | No fact links an appointment to a vehicle in stock. |
| `ACT-INV-005` book/GL variance on the unit's account | disabled — grain | The variance is a property of the control ACCOUNT. `ACT-ACC-001` owns it at the grain it is measured. |
| `ACT-INV-006` missing accounting record | disabled — DQ gate | Every unit in the as-of snapshot has a matching accounting row, both ways. |
| `ACT-INV-007` model concentration | disabled — grain | No governed concentration aggregate; the engine performs no aggregation of its own. |

### Sales and gross

| Rule | State | As built |
|---|---|---|
| `ACT-SLS-001` negative front-gross deal | **enabled** | Signed financial condition at deal grain, as-of month, retail only. |
| `ACT-SLS-002` negative total-gross deal | **enabled**, zero current actions | Every December negative-total deal is a Wholesale or Dealer Trade disposal, and the rule is scoped to retail. It matches real rows elsewhere in the window. |
| `ACT-SLS-003` material front-PVR decline | **enabled** | Reads the governed `effect_amount` from the bridge. No period figure is recomputed. |
| `ACT-SLS-004` material back-PVR decline | **enabled** | Same governed comparison output, at its own component. |
| `ACT-SLS-005` high discount on low-age unit | **enabled** | `discount_from_original` and `days_in_inventory_at_sale` on one deal row. |
| `ACT-SLS-006` deal-gross identity failure | disabled — DQ gate | A critical reconciliation fails the pipeline first. |

### F&I

| Rule | State | As built |
|---|---|---|
| `ACT-FNI-001` back-gross reconciliation failure | disabled — DQ gate | 134 reconciliations, all passing; a failure never reaches an export. |
| `ACT-FNI-002` product on ineligible deal | disabled — DQ gate | Eligibility is enforced by the reference contract and the warehouse. |
| `ACT-FNI-003` chargeback concentration | disabled — grain | A share over a period; no governed dataset publishes one. |
| `ACT-FNI-004` adjustment exceeding original gross | disabled — DQ gate | Net product gross is non-negative on every exported deal. |
| `ACT-FNI-005` financed deal without lender | disabled — DQ gate | Null lenders occur only on Cash, Wholesale and Dealer Trade, where a lender is correctly absent. |
| `ACT-FNI-006` retail deal without finance-manager attribution | **enabled** | The modelled "nobody on the F&I desk" state, published deliberately as a distinct group. Its condition IS a null test. |
| `ACT-FNI-007` penetration change on sufficient sample | disabled — grain | The published F&I grain is per manager per DAY; every row reports `meets_minimum_sample = false`. |

### Leads

| Rule | State | As built |
|---|---|---|
| `ACT-LED-001` lead without first response | **enabled**, zero current actions | Aggregated at store × source × lead-creation date — never an individual lead. |
| `ACT-LED-002` response time above default | disabled — grain | `valid_leads` never exceeds 7 on any published row; the governed floor is 10. |
| `ACT-LED-003` high volume + low contact rate | disabled — grain | Same denominator ceiling; "high volume" is not a condition 7 leads can satisfy. |
| `ACT-LED-004` low show rate on set appointments | **enabled** | The one lead rate rule whose denominator reaches the floor. Scheduled-date basis, resolved on the day. |
| `ACT-LED-005` low show-to-sale conversion | disabled — grain | The only rows meeting the floor fall on the as-of date, where the cohort is immature by construction. |

### Accounting

| Rule | State | As built |
|---|---|---|
| `ACT-ACC-001` GL control variance | **enabled** | Reads the governed exception register. Severity by ABSOLUTE magnitude; the signed amount stays visible and neither direction is the good one. |
| `ACT-ACC-002` missing-side control position | **enabled** | Both missing-side codes. The absent amount stays null and is never coalesced. |
| `ACT-ACC-003` orphaned adjustment | disabled — missing data | No such exception is published; referential integrity prevents the condition. |
| `ACT-ACC-004` duplicate accounting record | disabled — DQ gate | Business-key uniqueness is asserted before writing. |
| `ACT-ACC-005` posting-date lag | disabled — missing data | ARPI holds no posting timestamp. `posting_lag_days` is `accounting_date − acquisition_date`, which is `days_in_stock` under another name, and its own column comment says so. |

**No employee action family exists.** `DASH.11` settled that employee comparison is a
fairness-governed surface with a sample floor and no composite score. An action family aimed at
people would need its own specification, and inventing one to fill a facet would be the opposite of
that decision.

## 5. Explanation text

Generated from per-rule templates with slot substitution from evidence fields only. The vocabulary
is restricted to review verbs — **review, investigate, validate, reconcile, compare, confirm** — and
the loader **rejects** a template containing an operational verb (reprice, terminate, deny, submit,
cancel, approve, assign, acknowledge, resolve) or a causal construction (caused, because, resulted
from, led to, due to, responsible for). The check runs over the rule file's own strings, so it
cannot fire on unrelated documentation.

It has already refused prose: an early `ACT-ACC-002` limitation used "because" in an explanatory
sense and was rewritten rather than exempted.

## 6. Severity

Three levels — `high`, `medium`, `low` — rendered with the existing badge vocabulary and **never
colour-only**. Bands are validated to run most severe first, so **the first match is also the most
severe match** and one entity can never produce three actions by qualifying for three levels.
Severity is the rule's classification of a matched condition: not a probability, a confidence, a
financial materiality score or a priority ranking.

Queue order is a total order over values every action carries: severity, then domain, then store,
then rule, then entity. No composite score, no recency weighting, no personalisation.

## 7. Suppression

Documented per rule and returned by the engine rather than discarded, so tests can prove the vetoes
fire. The published queue contains only firing actions; a suppressed pseudo-action is not a finding
and is never rendered. Current vetoes: below minimum sample, denominator not observed, no severity
band matched, duplicate dedupe key, and — through three-valued logic — any condition whose operands
are unknown.

## 8. The "Why did this change?" driver engine (`DASH.12-03`)

`reporting.vw_gross_change_bridge` owns the decomposition, its sequential order and its arithmetic.
`DASH.3` already rendered it exactly, verifying the identity the view guarantees (the three
numerators sum to denominator × change) before dividing for display. **`DASH.12` reuses that
implementation rather than writing a second one**: it moved from `sales-gross.ts` into
`change-drivers.ts` unchanged, so the Executive Overview and the Action Center could render the same
decomposition without acquiring a 95 kB trend dataset to do it.

What `DASH.12` adds is a **display policy and no formula**: effects below the configured materiality
are grouped into one labelled remainder. Grouped, **never dropped** — and the remainder is derived
by SUBTRACTION from the period change rather than by adding the grouped parts, which makes the
reconciliation exact by construction rather than exact by luck. It also absorbs the cent-level
residual that rounding three exact quotients leaves behind, because absorbing that into a listed
component would misstate that component.

Components are `volume`, `front_pvr`, `back_pvr` — validated against the dataset's own
`component_code` enumeration, so a mix effect SQL does not compute cannot be named in YAML. **No
new/used, store or sale-type mix component exists**, and none is invented in TypeScript.

Narratives are template-generated and use attribution wording — "the bridge attributes", "the
decomposition assigns", "contribution". Causal wording is rejected by test. A sequential
decomposition apportions an observed change in a documented order; change the order and the
apportionment changes, which is precisely why it is not a causal claim.

Incomparable or empty periods render the honest unavailable state with the reason. The period change
is still shown when its decomposition is not, because the two are different facts and `$0` would
state that nothing moved.

The materiality threshold lives in `config/dashboard/action_rules.yaml` and travels in the export
manifest. **There is no numeric literal for it in TypeScript.**

## 9. No-persistence boundary

No database writes, no local-storage workflow state, no cookie state, no "mark as done". The only
client state is presentation (facets in the URL). Asserted end-to-end: no checkbox exists, no
outcome-claiming button exists, no POST form exists, `localStorage` and `sessionStorage` are empty,
and a reload reconstructs a byte-identical queue.

## 10. Limitations (rendered with the queue)

Thresholds are project defaults for a fictional group; actions are review prompts, not findings,
recommendations of business action, or evidence of real-world conditions; the queue regenerates with
each dataset version and holds no history. `price_to_market_ratio` rests on a **synthetic** market
estimate and is not a valuation.

## 11. Governance: the rule file is an input to published data

Changing a review threshold changes the queue even though no business fact moved. The export
therefore treats the rule file as a governed input:

- the manifest records the ruleset's **schema, version, path, content hash, expiry model, rule
  count, and the enabled and disabled identifier lists**;
- `export_dashboard_dataset.py --check` **re-derives the queue offline** from the current rule file
  and the committed datasets, and fails on any difference in bytes, hash, row count, counts, ruleset
  hash or change-driver policy;
- the hashes do not chain circularly: the rule file's hash and the action file's hash are both
  recorded IN the manifest, and neither is computed OVER it.

## 12. Cross-language validation

Python guarantees the drill-through URL is well formed and deterministic. **TypeScript guarantees it
resolves**, because `site.ts` and `filters.ts` own the routes and copying that registry into Python
would build a second source of truth. The generator checks every action's destination against the
route registry and the destination's own filter-support matrix before writing anything.

That check earned its place immediately: `/dashboard/deals/{sale_id}` reached it unsubstituted,
because Python filled slots in query parameters but not in the route path.

## 13. Required tests — as built

- **Predicate grammar:** 27 hostile expressions, each of which would execute under `eval`, required
  to fail before any row is read; static typing against the contract; Kleene truth tables; exact
  decimal comparison; boundary inclusivity.
- **Register:** every proposed identifier present; every disabled rule audited, definition-free and
  silent; the DQ and missing-data claims asserted against the export rather than narrated.
- **Engine:** identity contract, dedupe, one-severity-per-entity, total ordering, suppression,
  determinism (double run and reversed input), no timestamp, committed queue equals re-derived queue.
- **Privacy:** prohibited evidence refused loudly rather than stripped; no personal field in the
  committed queue.
- **Console:** facet parsing, canonical serialisation, URL round-trip, counts over the whole queue,
  drill-through resolution, empty state.
- **Drivers:** exact reconciliation on every store scope, all-immaterial and none-immaterial cases,
  unavailable states, non-causal narrative.
- **E2E:** queue renders with facets; top actions on `/`; drill-throughs resolve; no-JS complete;
  no workflow control exists.
