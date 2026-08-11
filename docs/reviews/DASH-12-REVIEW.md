# `DASH.12` review — Management Action Center and change drivers

**Increment:** `DASH.12` · **Status:** Implemented · **Route added:** `/dashboard/actions`
**Spec:** [ACTION_ENGINE_SPEC.md](../dashboard/ACTION_ENGINE_SPEC.md) ·
**Rules:** [`config/dashboard/action_rules.yaml`](../../config/dashboard/action_rules.yaml)

Every question below is answered with the implementation evidence and the test evidence behind it.
A question answered **No** carries the reason and the qualification.

---

## Summary of what was built

| | |
|---|---|
| Permanent rule identifiers | 30 |
| Enabled | 12 |
| Retained and disabled | 18 |
| Actions in the committed queue | 47 |
| Ruleset hash | `911c6bd4a226…` |
| Action file | `management-actions.json`, 85,774 bytes, one file |
| New reporting views | **0** |
| Power BI artifacts changed | **0** |

**Counts.** By severity: high 18, medium 29, low 0. By domain: inventory 17, sales-gross 16, F&I 7,
accounting 4, leads 3. By store: GSA-001 15, GSA-002 24, GSA-003 8. By review role: Used-car manager
17, General sales manager 13, F&I manager 8, Controller 4, BDC manager 3, General manager 2.
By rule: `ACT-INV-001` 11, `ACT-SLS-001` 10, `ACT-FNI-006` 7, `ACT-INV-003` 6, `ACT-LED-004` 3,
`ACT-SLS-005` 3, `ACT-ACC-001` 2, `ACT-ACC-002` 2, `ACT-SLS-003` 2, `ACT-SLS-004` 1.

**Queue density.** `ACT-INV-001` and `ACT-SLS-001` together produce 45% of the queue. That is the
truth of the data — 101 of 250 units at the as-of snapshot are past the governed aged threshold —
and no threshold was moved to flatten it.

---

## A. Architecture

**1. Is the engine deterministic?** **Yes.** Same ruleset, rows and as-of date produce byte-identical
output. *Implementation:* `arpi/dashboard/actions.py` sorts on a total order and holds no clock or
randomness. *Test:* `test_action_rules.py::TestDeterminism` runs it twice, runs it again with every
input list reversed, and asserts the committed bytes equal the re-derived bytes.

**2. Is there any LLM?** **No.** No provider client, no prompt, no model call anywhere in the
increment. Every word of every action comes from a rule template and every number from an exported
column. *Test:* the language tests read only the committed queue, which is reproducible from files.

**3. Is there any learned model?** **No.** No training, no weights, no embedding, no scoring
heuristic. Severity is a rule predicate.

**4. Is any rule logic hidden in React?** **No.** The console evaluates no rule, decides no severity,
reads no threshold and builds no URL. *Test:* `dashboard-actions.test.ts` asserts filtering only ever
removes rows from the exported queue, and `dashboard-boundaries.test.ts` holds the aggregation
registry to its declared members.

**5. Is any KPI recomputed in Python?** **No.** The engine performs no aggregation, no join and no
division. Every rate, PVR, penetration and variance it reads is a column SQL published at the grain
SQL published it. *Implementation:* the rule schema has no aggregation construct to express one.

**6. Is `eval`/`exec` used?** **No.** `action_predicate.py` is a tokenizer, parser and evaluator over
a grammar with no call production. *Test:* `test_action_predicate.py::TestHostileExpressions` — 27
payloads including `__import__("os")`, `open(...)`, `lambda`, attribute access, subscripting, SQL and
JavaScript syntax, each required to fail before any row is read.

**7. Does the engine read only approved public/governed data?** **Yes.** It is handed
already-serialised export records and holds no connection, cursor or credential. A rule naming a
dataset the export contract does not declare is refused at load time.

**8. Is the rule file version controlled?** **Yes.** `config/dashboard/action_rules.yaml`, with
`ruleset_version` and a content hash in the manifest.

**9. Does rule configuration stale the export?** **Yes.** Verified by changing `show_rate_review` from
0.70 to 0.90 and running `--check`: six problems, naming the ruleset hash mismatch and the disagreeing
counts. Reverting restored the check to clean.

**10. Is the ruleset hash recorded?** **Yes**, with the schema, version, path, expiry model, rule
count and both identifier lists.

---

## B. Rule register

**11. Are all permanent ACT IDs accounted for?** **Yes**, all 30. *Test:*
`TestTheRegister::test_every_proposed_identifier_is_still_present` pins the list in order.

**12. Which are enabled?** `ACT-INV-001`, `ACT-INV-003`, `ACT-SLS-001`, `ACT-SLS-002`, `ACT-SLS-003`,
`ACT-SLS-004`, `ACT-SLS-005`, `ACT-FNI-006`, `ACT-LED-001`, `ACT-LED-004`, `ACT-ACC-001`,
`ACT-ACC-002`.

**13. Which are disabled?** The other eighteen.

**14. Why is every disabled rule disabled?** Each carries an audited `state_reason` in the rule file
and a row in [ACTION_ENGINE_SPEC §4](../dashboard/ACTION_ENGINE_SPEC.md#4-rule-families--the-as-built-register).
Summarised:

| Reason | Rules |
|---|---|
| **Missing data** — the project holds no such evidence | `ACT-INV-002`, `ACT-INV-004` (no unit-grain lead or appointment activity), `ACT-ACC-003` (no orphaned-adjustment exception), `ACT-ACC-005` (no posting timestamp) |
| **Wrong grain** — the evidence exists elsewhere | `ACT-INV-005`, `ACT-INV-007`, `ACT-FNI-003`, `ACT-FNI-007`, `ACT-LED-002`, `ACT-LED-003`, `ACT-LED-005` |
| **Duplicates a hard DQ gate** | `ACT-INV-006`, `ACT-SLS-006`, `ACT-FNI-001`, `ACT-FNI-002`, `ACT-FNI-004`, `ACT-FNI-005`, `ACT-ACC-004` |

**15. Does any enabled rule lack physical evidence?** **No.** *Test:*
`test_every_enabled_rule_has_a_row_that_matches_its_condition` requires each enabled rule to match a
real exported row.

**16. Was any threshold chosen merely to manufacture actions?** **No.** Each was fixed on a stated
rationale before the queue was counted and left unchanged afterwards — including where that produced
zero. `ACT-LED-001`'s threshold of three unanswered leads in a day produces **no** current action;
`ACT-SLS-002` produces **none**. Neither was loosened.

**17. Are current project defaults reused?** **Yes.** The aged threshold is read from each row's
`aged_threshold_days`; the minimum-sample floor resolves from
`arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS`, the same authority `fn_minimum_sample_floor` mirrors.
Neither is restated in YAML.

**18. Is the aged threshold correct?** **Yes — 60 days**, not the planning document's 90.
*Test:* `test_no_rule_restates_the_governed_aged_threshold` and
`test_the_aged_threshold_reaches_the_console_from_the_row`, plus a Vitest assertion that the console
renders `60` from the governed column.

---

## C. Thresholds

**19. Is every threshold visible?** **Yes**, on the action card, with its units.

**20. Is every new threshold labelled project default?** **Yes**, enforced at load time: the loader
refuses a rule-owned threshold whose label does not contain "project default", and the generator
refuses one in the published queue.

**21. Is any threshold called an industry standard?** **No.** *Test:*
`test_no_threshold_claims_to_be_an_industry_standard`, and an end-to-end assertion that no
affirmative sentence on the route claims one.

**22. Are severity boundaries exact?** **Yes.** Decimal comparison throughout; `>= 120` means 120
fires high.

**23. Do tests cover boundary equality?** **Yes.** `TestThresholdBoundaries` covers 119/120/121 days,
1.0499/1.0500/1.0501 ratio, floor−1/floor/floor+1 sample, and ±999.99/±1000.00 variance.

---

## D. Data-quality boundary

**24. Does any management rule duplicate an impossible hard DQ failure?** **No.** Seven identifiers
describe such conditions and all seven are disabled.

**25. Are such IDs retained disabled?** **Yes.**

**26. Is their earlier owning validation identified?** **Yes**, and asserted rather than narrated.
*Test:* `TestTheDataQualityBoundary` proves no deal breaks the gross identity, no financed deal lacks
a lender, no adjustment drives net product gross below zero, and every dataset declares a business key
the exporter asserts.

---

## E. Privacy

**27–31. Customer PII, lead message content, employee personnel data, compensation, protected data:**
**None.** *Test:* both a Python and a Vitest scan of the committed queue for twelve prohibited field
names.

**32. Is evidence allowlisted?** **Yes**, to the exported columns of the rule's own dataset, checked
in Python at load time and again in TypeScript against the published column contracts.

**33. Does prohibited evidence fail export?** **Yes, loudly.** *Test:*
`test_prohibited_evidence_fails_the_export_loudly` injects `customer_name` and requires
`ActionEngineError`. It is refused, never silently stripped — stripping would leave an action whose
evidence no longer explains why it fired.

**One control fired during development.** The exporter's secret guard rejected the first spelling of
the disclosed minimum-sample authority for naming a schema the console may not see. The string is now
public-safe.

---

## F. Statelessness

**34. Can a user mark an action done?** **No.** **35. Assign one?** **No.** **36. Is action state
stored?** **No.** **37. Is there a POST mutation?** **No.** **38. Does refresh reconstruct the same
queue?** **Yes.**

*Test:* the route carries no checkbox, no outcome-claiming button, no POST form; `localStorage` and
`sessionStorage` are empty after load; a reload produces identical text.

---

## G. Action identity

**39. Are IDs deterministic?** **Yes** — `{rule_id}:{entity_id}:{dataset_version}`, checked in both
languages rather than trusted.

**40. Is dedupe deterministic?** **Yes**, on `{rule_id}:{entity_id}`, version-independent so the same
condition is recognisable across versions without anything persisting.

**41. Can one rule/entity produce several severities?** **No.** Bands are validated most-severe-first
and the first match wins.

**42. Does a new dataset version produce the intended identity change?** **Yes.** *Test:* the action
ID sets for versions 17 and 18 are disjoint while the dedupe keys are identical.

---

## H. Language

**43. Are only review/investigation verbs used?** **Yes**, and required: review prose must contain one
of the six review verbs.

**44. Is there causal language?** **No.** Refused at load time and asserted over the committed queue
and the rendered page. The check has already rewritten prose rather than been relaxed.

**45. Is there an operational instruction?** **No.**

**46. Is "recommended review" clearly not a business recommendation?** **Yes.** The field keeps its
contract name; the console labels it **"Review next"** and the methodology states that an action is a
reason to look rather than a recommendation of business action.

---

## I. Inventory

**47. Are unit-grain rules actually unit-grain?** **Yes.** Both enabled inventory rules read
`inventory-units` at store × snapshot × vehicle grain.

**48. Is market estimate clearly synthetic?** **Yes**, in the rule's limitations, on the card, and in
the export's own limitations block.

**49. Is 60-day aged policy preserved?** **Yes.** See B.18.

**50. Are unsupported unit-lead rules disabled rather than fabricated?** **Yes.** *Test:* the export
contract for `inventory-units` carries no column containing "lead" or "appointment".

---

## J. Sales

**51. Are negative-gross actions signed correctly?** **Yes**; the signed gross is the evidence and the
sign is rendered.

**52. Does deal drill-through resolve?** **Yes** — and this is where the cross-language check earned
its place. `/dashboard/deals/{sale_id}` reached the generator unsubstituted, because Python filled
slots in query parameters but not in the route path. Python now fills path slots and refuses a null
there.

**53. Are PVR comparison rules based on governed comparison output?** **Yes** —
`gross-change-bridge.effect_amount`, computed by `vw_gross_change_bridge`.

**54. Is employee blame absent?** **Yes.** No action names an employee, and the limitations state that
a negative gross is a signed accounting outcome attributed to nobody.

---

## K. F&I

**55. Are eligibility rules preserved?** **Yes**; `ACT-FNI-002` is disabled precisely because
eligibility is enforced upstream.

**56. Is manager sample suppression preserved?** **Yes** — and it is why `ACT-FNI-007` is disabled:
every published F&I row reports `meets_minimum_sample = false`, so a penetration-change rule could
never fire without breaching the discipline.

**57. Are cash denominators preserved?** **Yes.** No rule treats cash mix as a failure.

**58. Are hard F&I DQ failures not normalized into routine actions?** **Yes** — four of the seven F&I
identifiers are disabled for exactly that reason.

---

## L. Leads

**59. Are duplicates excluded?** **Yes**; `ACT-LED-001` reads `lead-response`, whose denominator is
`valid_leads`.

**60. Are date bases correct?** **Yes** — lead-creation date for response, scheduled date for show
rate. Each action carries its `date_basis`.

**61. Are unresponded leads distinct from zero response?** **Yes.** `unresponded_leads` is a
first-class count and is never a zero-second response.

**62. Are rate denominators correct?** **Yes** — `eligible_appointments` for show rate.

**63. Is minimum sample applied per denominator?** **Yes**, on the metric's own denominator rather
than a generic row count.

**64. Is any response threshold clearly a review threshold, not a benchmark?** **Yes**, and the rule
file says outright that no industry response benchmark exists in this repository.

**65. Is individual customer information absent?** **Yes.** The entity is an aggregate store × source
× day row. *Test:* no enabled rule keys on a lead.

---

## M. Accounting

**66. Are missing sides preserved?** **Yes.** `ACT-ACC-002` carries the absent amount as null.

**67. Is GL sign not treated as good/bad?** **Yes.** Severity is symmetric about zero via `-@threshold`,
and the signed amount stays visible. *Test:* ±999.99 → medium, ±1000.00 → high.

**68. Does variance severity use an explicit policy?** **Yes**, one declared threshold read twice.

**69. Is posting lag disabled if no real dates exist?** **Yes.** *Test:* `posting_lag_days` equals
`days_in_stock` on every exported row.

---

## N. Driver engine

**70. Is `vw_gross_change_bridge` still the calculation authority?** **Yes.** `DASH.12` moved the
`DASH.3` implementation between modules and changed none of its arithmetic.

**71. Is decomposition order documented?** **Yes**, and validated against the dataset's own
`component_code` enumeration so a component SQL does not compute cannot be named.

**72. Does every bridge reconcile exactly?** **Yes.** *Test:* listed effects plus remainder equal the
period change exactly, on every store scope.

**73. Are small effects grouped, never dropped?** **Yes.** The remainder is derived by subtraction, so
it reconciles by construction. *Test:* a threshold above every effect forces the whole change into the
remainder and the total is unchanged.

**74. Is the materiality threshold explicit?** **Yes** — $500, configured in the rule file, carried in
the manifest, rendered as a project default. No TypeScript literal.

**75. Is narrative non-causal?** **Yes** — "the bridge attributes". Asserted in unit and E2E tests.

**76. Is incomparable state honest?** **Yes** — the reason is named, and the period change is shown
when its decomposition is not, rather than `$0`.

---

## O. UX

**77. Does `/dashboard/actions` exist?** **Yes.** **78. Is Actions in operating navigation?** **Yes**,
in last position: management attention follows business status.

**79. Does Executive show top actions?** **Yes** — five, a prefix of the queue's own order, with a
compact change-driver panel beside it, placed after the business regions.

**80. Are facets URL-driven?** **Yes** — domain, severity, store and review role, canonically
serialised, surviving reload, copy-paste, Back and Forward.

**81. Does no-JS work?** **Yes.** Queue, evidence, thresholds, review text, drill-throughs, change
drivers and methodology all render server-side; facets are anchors.

**82. Is mobile useful?** **Yes**; the card leads with severity, domain, store, review role and the
rule's own first evidence field, with the rest in a disclosure.

**83. Is axe clean?** Covered by the existing accessibility sweep, which now includes the route.

**84. Does it look like an analytical review queue rather than a task manager?** **Yes** — no
checkbox, no status, no assignee, no due date.

---

## P. Roadmap

**85. Is `DASH.12` complete?** **Yes**, all three items.

**86. Is `DASH.13` still Planned?** **Yes.**

**87. Were no `DASH.13` hardening items prematurely claimed complete?** **Correct** — none were.

**88. Were Power BI artifacts unchanged?** **Yes.** No TMDL, DAX, relationship or report-page change.

---

## Product gaps discovered

Four capabilities a management action queue would want and this project cannot honestly provide.
Recorded in [PRODUCT_GAPS.md](../product/PRODUCT_GAPS.md) rather than approximated:

1. **Unit-level lead activity** — no fact links a lead to a vehicle in stock.
2. **Unit-level appointment activity** — same, for appointments.
3. **A real posting timestamp** — the accounting model holds acquisition and schedule dates only.
4. **Period-level F&I and lead aggregates** — the published grain is daily per manager or per source,
   which never reaches the governed sample floor, so no rate rule can fire there.

---

Power BI real-engine validation remains externally pending; `DASH.12` does not modify the semantic
model.
