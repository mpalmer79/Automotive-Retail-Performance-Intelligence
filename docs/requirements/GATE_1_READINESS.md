# Gate 1 Readiness Review — ARPI

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Backlog item:** `P1.5-04`
**Review date:** 2026-07-29
**Profile evaluated:** `development` (2025-07-01 … 2025-12-31, three stores, seed 20250701), on a freshly created PostgreSQL 16 database
**Parent documents:** [ARCHITECTURE.md §28](../../ARCHITECTURE.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md) · [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) · [LIMITATIONS.md](../../LIMITATIONS.md)

---

## 1. What this document decides

[ARCHITECTURE.md §28](../../ARCHITECTURE.md) states Gate 1 in three clauses:

> No Power BI development begins until: fact grains are approved; dimensions are documented; KPI formulas
> are documented.

This document evaluates those three, together with the supporting conditions `P1.5-03` and `P1.5-04` add,
and records a verdict. It exists so that "Gate 1 is open" is a **documented decision with evidence behind
it**, rather than an assumption someone made on the way to opening Power BI.

Every condition below carries the query or test that proves it. Where a condition is met with a caveat, the
caveat is in the **Limitation** column rather than omitted; a review that records only what passed is not a
review.

### 1.1 What "approved" means

`P1.5-04` defines it, and this review holds to that definition: a fact grain is approved when it is
**built, enforced by a database constraint, and tested**. A grain declared in a document and unenforced in
the database is a claim, not a control.

### 1.2 The evidence base

All figures come from one evaluation performed on 2026-07-29:

1. A PostgreSQL 16 database created empty.
2. The complete ordered SQL sequence — 104 scripts — applied to it.
3. `arpi run-foundation --load-database` on the `development` profile.
4. The same command run a second time against the same database.
5. Every count, reconciliation and check result below read back from that database.

---

## 2. Condition register

### G1-C01 — Eight MVP dimensions exist and contain valid rows

| Field | Value |
|---|---|
| **Condition ID** | `G1-C01` |
| **Requirement** | All eight MVP dimensions are built and populated. |
| **Evidence** | `dim_date` 184 · `dim_dealership` 3 · `dim_vehicle_model` 120 · `dim_vehicle` 900 · `dim_employee` 34 (30 current) · `dim_customer` 2,500 · `dim_lead_source` 19 · `dim_marketing_campaign` 24. Every table non-empty. |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_every_mvp_dimension_exists_holds_rows_and_declares_its_grain` |
| **Result** | **Pass** |
| **Limitation** | Row counts are profile-dependent. `dim_dealership` has three rows by design, which is a small comparison set for any store-level analysis; `market_region` has a single value across all three, so "by market region" analysis is degenerate (`DOC-17`). |
| **Verdict** | **Met** |

### G1-C02 — Five MVP facts exist and contain valid rows

| Field | Value |
|---|---|
| **Condition ID** | `G1-C02` |
| **Requirement** | All five MVP facts are built and populated. |
| **Evidence** | `fact_vehicle_sale` 650 · `fact_vehicle_inventory_snapshot` 45,754 · `fact_lead` 6,000 · `fact_appointment` 2,111 · `fact_marketing_spend` 212. |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_every_mvp_fact_exists_and_holds_rows` |
| **Result** | **Pass** |
| **Limitation** | Every row is synthetic and generated from a fixed seed. Volumes at `development` scale are small enough that per-model-line statistics are small-sample; see [LIMITATIONS.md §3.1](../../LIMITATIONS.md). |
| **Verdict** | **Met** |

### G1-C03 — Every fact grain is enforced by a database constraint

| Field | Value |
|---|---|
| **Condition ID** | `G1-C03` |
| **Requirement** | Gate 1 condition 1. Each declared grain is enforced by a `UNIQUE` or `PRIMARY KEY` constraint over exactly the grain columns, and the loaded data satisfies it. |
| **Evidence** | `uq_fact_vehicle_sale_sale_id (sale_id)` · `uq_fact_vehicle_inventory_snapshot_grain (snapshot_date_key, dealership_key, vehicle_key)` · `uq_fact_lead_lead_id (lead_id)` · `uq_fact_appointment_appointment_id (appointment_id)` · `uq_fact_marketing_spend_grain (month_date_key, dealership_key, campaign_key)`. Constraint columns read from `pg_constraint` and compared with the declared grain; distinct-key count compared with row count on the loaded data. |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_every_fact_grain_is_enforced_by_a_database_constraint` and `::test_the_loaded_data_actually_satisfies_the_declared_grain` |
| **Result** | **Pass** |
| **Limitation** | A `UNIQUE` constraint proves the grain is not violated. It does not prove the grain is the *right* grain for the business question; that judgement is recorded in [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) Part C and [ARCHITECTURE.md §12](../../ARCHITECTURE.md). |
| **Verdict** | **Met** |

### G1-C04 — Every source-to-target mapping exists

| Field | Value |
|---|---|
| **Condition ID** | `G1-C04` |
| **Requirement** | Gate 1 condition 2. Every MVP dimension and fact has a source-to-target mapping document. |
| **Evidence** | `STM-001` … `STM-014` under `docs/source-to-target/`, one per MVP entity plus `STM-003` for audit metadata. |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_every_dimension_has_a_source_to_target_mapping` and `::test_every_fact_has_a_source_to_target_mapping` |
| **Result** | **Pass** |
| **Limitation** | The test asserts a mapping **exists** for each entity; it does not verify that the mapping's content is current. Content currency is a review responsibility, and the Definition of Done requires an STM update in the same change as the target object. |
| **Verdict** | **Met** |

### G1-C05 — Every dimension contract is documented

| Field | Value |
|---|---|
| **Condition ID** | `G1-C05` |
| **Requirement** | Gate 1 condition 2. Each dimension declares its grain and documents every column. |
| **Evidence** | Every one of the eight carries a `COMMENT ON TABLE` containing its grain, and a `COMMENT ON COLUMN` on every column — asserted against `pg_attribute`, so an undocumented column added later fails the build. [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) §§6–13 carry the attribute contracts, and every status in that document was corrected from `Planned` to `Implemented` in this change. |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_every_dimension_column_is_documented`; `tests/integration/test_schema_objects.py::test_every_dimension_column_is_documented` |
| **Result** | **Pass** |
| **Limitation** | [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) gives exact column contracts for `dim_date` and `dim_dealership` and **attribute-level** documentation with indicative types for the other six. The binding column contract for those six is the DDL under `sql/03_dimensions/`, which is where the database comments live and where the tests read from. That is a documentation-depth gap, not a correctness gap, and it is registered below in §4. |
| **Verdict** | **Met, with the limitation recorded** |

### G1-C06 — All 29 KPI formulas are documented

| Field | Value |
|---|---|
| **Condition ID** | `G1-C06` |
| **Requirement** | Gate 1 condition 3. |
| **Evidence** | [KPI_CATALOG.md](../../KPI_CATALOG.md) specifies 29 MVP KPIs, each with numerator, denominator, grain, date basis, filters, exclusions, null behaviour, SQL ownership, DAX ownership, reconciliation rule and interpretation caution. Four fields were **corrected** in this change and the corrections are recorded in [KPI_CATALOG.md §37.1](../../KPI_CATALOG.md). |
| **Test or SQL query** | `tests/integration/test_kpi_verification.py::test_the_catalogue_index_covers_exactly_twenty_nine_kpis` |
| **Result** | **Pass** |
| **Limitation** | Two of the four corrections changed a computed result: `KPI-SLS-002` and `KPI-SLS-003` previously filtered on `sale_type`, which stranded every lease outside both halves of `RECON-UNITS-001`. New units move from 153 to 202 and used from 351 to 356 on this profile. The corrections were made in place rather than under new identifiers because each brought a field into line with the definition already stated on the same row; the reasoning is recorded in full. |
| **Verdict** | **Met** |

### G1-C07 — All 29 KPIs are computable from the reporting layer

| Field | Value |
|---|---|
| **Condition ID** | `G1-C07` |
| **Requirement** | `P1.5-03`: every specified KPI resolves to at least one reporting view, verified by an automated test rather than by inspection. |
| **Evidence** | All 29 resolve. Each is additionally computed from `reporting` and compared against an independent derivation from `warehouse` written from the catalogue's numerator and denominator text. 87 assertions pass. |
| **Test or SQL query** | `tests/integration/test_kpi_verification.py` (87 tests) |
| **Result** | **Pass** |
| **Limitation** | "Computable" means the SQL side exists and is correct. **At the time this gate was assessed no DAX measure existed.** Forty-nine measures have since been written in TMDL, but no KPI has been computed inside a semantic model: static parsing is not execution, and both real-engine paths remain pending under ADR-0008. Two KPIs — `KPI-INV-008` and `KPI-INV-009` — are pre-computed in SQL because they combine two facts across two different date columns over one window; a semantic model imports those values rather than recomputing them. |
| **Verdict** | **Met** |

### G1-C08 — Every ratio returns NULL on a zero denominator

| Field | Value |
|---|---|
| **Condition ID** | `G1-C08` |
| **Requirement** | [KPI_CATALOG.md](../../KPI_CATALOG.md) requires `BLANK()` / NULL — never zero, never infinity, never a sentinel — for every ratio with an empty denominator. |
| **Evidence** | All twenty published ratio columns across the reporting layer asserted individually. At least one zero-denominator case genuinely occurs in the data (paid campaigns with no attributed sale, and organic source-months with no spend row), so the rule is exercised rather than vacuously true. |
| **Test or SQL query** | `tests/integration/test_kpi_verification.py::test_a_zero_denominator_returns_null` (20 cases) and `::test_at_least_one_zero_denominator_case_actually_occurs` |
| **Result** | **Pass** |
| **Limitation** | The DAX side is unwritten. `DIVIDE(numerator, denominator)` is specified in `powerbi/model_documentation/03-measure-groups.md`; nothing enforces it until measures exist. |
| **Verdict** | **Met** |

### G1-C09 — All required reporting views exist

| Field | Value |
|---|---|
| **Condition ID** | `G1-C09` |
| **Requirement** | `P1.5-03`: a view per MVP dimension, a view per MVP fact at a grain supporting a star schema, and a governed view per analytical domain. |
| **Evidence** | 28 views: 8 dimension, 5 fact, 13 analytical, 2 operational. The expected set is fixed in `arpi.constants.REPORTING_VIEWS`, and the schema is asserted to contain exactly those and nothing else. Every view declares its grain in `COMMENT ON VIEW` and documents every column. |
| **Test or SQL query** | `tests/integration/test_reporting_layer_completeness.py` (134 tests) |
| **Result** | **Pass** |
| **Limitation** | Three analytical views are intended for import into the semantic model rather than being pure SQL-side aggregates (`vw_inventory_turn`, `vw_days_supply`, `vw_marketing_performance`). Each combines two facts across two date columns, which is expressible in DAX but fragile; the trade-off is recorded in `powerbi/model_documentation/01-table-inventory.md` §3.1. |
| **Verdict** | **Met** |

### G1-C10 — Fact views preserve their fact's grain

| Field | Value |
|---|---|
| **Condition ID** | `G1-C10` |
| **Requirement** | A fact view must not lose or duplicate a row. Two of the five inner-join a dimension to derive a column, which is the standard way a view silently loses rows. |
| **Evidence** | View row count equals fact row count for all five, and total gross matches for the sale fact. Reconciled again on every pipeline run by `RECON-REPORT-*-ROWS`. |
| **Test or SQL query** | `tests/integration/test_reporting_layer_completeness.py::test_fact_views_preserve_the_fact_grain`; `audit.vw_recon_reporting` |
| **Result** | **Pass** |
| **Verdict** | **Met** |

### G1-C11 — A one-directional star schema is possible

| Field | Value |
|---|---|
| **Condition ID** | `G1-C11` |
| **Requirement** | `P1.5-03`: the fact views support a star-schema layout with one-directional relationships, and no view requires bidirectional filtering. |
| **Evidence** | 36 relationship columns asserted to resolve: every non-NULL key on every fact view finds its dimension row. All eight dimension keys asserted unique, so no relationship can be forced into many-to-many. The relationship register, with cardinality and filter direction for each, is `powerbi/model_documentation/02-relationship-plan.md`. |
| **Test or SQL query** | `tests/integration/test_reporting_layer_completeness.py::test_every_relationship_column_resolves` and `::test_dimension_keys_are_unique` |
| **Result** | **Pass** |
| **Limitation** | The four situations that normally force bidirectional filtering are argued to be absent in `02-relationship-plan.md` §7. That argument is reviewable but not machine-checkable: only building the model proves it, and building the model is what this gate controls. |
| **Verdict** | **Met** |

### G1-C12 — Role-playing dates are exposed explicitly

| Field | Value |
|---|---|
| **Condition ID** | `G1-C12` |
| **Requirement** | `P1.5-03`: role-playing date relationships are supported by distinct date-key columns, not by duplicating the calendar view. |
| **Evidence** | Eight date keys across five facts: sale and delivery; snapshot; lead creation; appointment created, scheduled and show; spend month. Exactly one calendar view exists. |
| **Test or SQL query** | `tests/integration/test_reporting_layer_completeness.py::test_role_playing_dates_are_exposed_as_distinct_columns` |
| **Result** | **Pass** |
| **Verdict** | **Met** |

### G1-C13 — Date coverage passes

| Field | Value |
|---|---|
| **Condition ID** | `G1-C13` |
| **Requirement** | `P1.5-03`: `reporting.vw_calendar` is suitable as the marked date table — contiguous, one row per date, covering the full span of every fact date key. |
| **Evidence** | 184 rows, 184 distinct keys, 184 distinct dates, spanning exactly 184 calendar days. Every one of the eight fact date keys resolves, and every fact's date range falls inside the calendar's. `month_date_key` on the spend fact is always a month start. |
| **Test or SQL query** | `tests/integration/test_date_table_coverage.py` (14 tests) |
| **Result** | **Pass** |
| **Limitation** | The calendar spans exactly the reporting window, with no margin. A generator change that emitted a date outside the window would fail this condition rather than silently dropping rows from time-based visuals — which is the intended behaviour, but means the calendar cannot absorb an out-of-window fact. |
| **Verdict** | **Met** |

### G1-C14 — `arpi_reporter` isolation passes

| Field | Value |
|---|---|
| **Condition ID** | `G1-C14` |
| **Requirement** | `P1.5-03`: `arpi_reporter` can satisfy every MVP query using `reporting` alone, and holds no grant on `raw`, `staging`, `warehouse` or `audit`. |
| **Evidence** | Twelve representative MVP queries — one per analytical domain, each joining a fact view to its dimensions as a semantic model would — executed **as the role** via `SET ROLE`, all returning rows. All 28 views readable. Twelve representative pipeline objects raise `InsufficientPrivilege`. The role holds no privilege on **any** object of the four pipeline schemas, asserted over the live catalogue rather than a hand-written list, and no `USAGE` on any of the four schemas. |
| **Test or SQL query** | `tests/integration/test_reporter_role_end_to_end.py` (56 tests) |
| **Result** | **Pass** |
| **Limitation** | Isolation is enforced by PostgreSQL privileges and by view ownership: a view executes with its owner's privileges, which is what lets a reporting view read a warehouse table the reporter cannot. That mechanism is correct and is also load-bearing — a reporting view created by the wrong owner would silently break it. `sql/07_security/01_grants.sql` normalises ownership on every run and asserts the invariant object by object. |
| **Verdict** | **Met** |

### G1-C15 — No prohibited or sensitive field appears in reporting

| Field | Value |
|---|---|
| **Condition ID** | `G1-C15` |
| **Requirement** | `ARCHITECTURE.md §22.4` and [PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md): no personal data reaches the reporting boundary. |
| **Evidence** | Every column of every reporting view passed through the project's own privacy tripwire — the same rules the generators are held to. No name, contact detail, precise age, precise geography, pay, credit or communication-content field appears. Customer age is a band; geography is county and market area; employee tenure is a band and no hire date, termination date or pay field is exposed. |
| **Test or SQL query** | `tests/integration/test_reporter_role_end_to_end.py::test_reporting_views_expose_no_prohibited_field` |
| **Result** | **Pass** |
| **Limitation** | **The tripwire inspects names, not values** ([LIMITATIONS.md §7.1](../../LIMITATIONS.md)). A prohibited value under an innocent name would pass. One documented exception is carried in the test with its justification: `vw_pipeline_run_summary.notes`, which is machine-written operational text about a load and describes no person. Inventory-age columns were previously flagged as personal age and are now handled by `arpi.constants.APPROVED_ASSET_AGE_COLUMNS`, an explicit allowlist with a written reason per entry. |
| **Verdict** | **Met** |

### G1-C16 — Critical reconciliations pass

| Field | Value |
|---|---|
| **Condition ID** | `G1-C16` |
| **Requirement** | Every reconciliation records a result on every applicable run, every critical one passes, and each can be shown to fail. |
| **Evidence** | 58 results recorded on this run: 30 from the Python loader and 28 from `audit.vw_recon_all`. **58 of 58 passing.** 57 are critical; the one non-critical rule is `RECON-FUNNEL-CHAIN`, and it also passes. Every critical rule was given a deliberately corrupted fixture — a deleted fact row, a broken gross identity, an orphaned dimension key, a missing middle snapshot date, a NULL dimension attribute, a substituted view expression — and observed reporting `failed`. Only two tolerance values exist anywhere: `0`, and `0.01` (`validation.numeric_absolute_tolerance`). |
| **Test or SQL query** | `tests/integration/test_reconciliations.py` (36 tests); `SELECT * FROM reporting.vw_reconciliation_status WHERE NOT is_passing` returns zero rows |
| **Result** | **Pass** |
| **Limitation** | `RECON-FUNNEL-CHAIN` is informational rather than critical, and this is the one place the review accepts a rule that is not a hard control. The chain multiplies two lead-grain rates by two appointment-grain rates; one lead can produce several appointments, so the product is an approximation that cannot be made an identity. It is compared against modelled-path conversion rather than total lead-to-sale conversion, which isolates the grain shift as the only source of difference, and the leads that convert without ever showing — 175 of 400 on this profile — are reconciled exactly by `RECON-FUNNEL-SOLD-PATH` instead. `RECON-FI-001` remains **Deferred** with the fact it reconciles. |
| **Verdict** | **Met** |

### G1-C17 — Gross identities reconcile to the cent

| Field | Value |
|---|---|
| **Condition ID** | `G1-C17` |
| **Requirement** | `RECON-GROSS-001`: `total_gross = front_end_gross + back_end_gross` on every row. |
| **Evidence** | 650 of 650 rows conform, checked **row by row** rather than in aggregate — two offsetting row-level errors sum to a correct total, so an aggregate comparison would pass a fact table that is wrong twice. The front-gross derivation is checked the same way. Reporting totals match warehouse totals: 1,936,571.59 retail total gross on both sides. |
| **Test or SQL query** | `audit.vw_recon_gross`; `tests/integration/test_reconciliations.py::test_a_corrupted_fixture_fails_the_reconciliation[RECON-GROSS-001]` |
| **Result** | **Pass** |
| **Verdict** | **Met** |

### G1-C18 — Employee fairness context is available

| Field | Value |
|---|---|
| **Condition ID** | `G1-C18` |
| **Requirement** | `P1.5-04` and [ARCHITECTURE.md §23](../../ARCHITECTURE.md): every contextual metric required beside an employee comparison is obtainable from the reporting layer **before** the Employee Performance page is designed. |
| **Evidence** | All eight asserted individually: lead volume received (`vw_lead_funnel.leads_received`), lead-source mix (`vw_leads.lead_source_key`), store traffic (`vw_appointment_funnel.shown_appointments`), tenure (`vw_employee.tenure_band`), new-versus-used mix (`vw_vehicle_sales.new_unit_count`), inventory availability (`vw_inventory_health.active_inventory_units`), manager involvement (`vw_vehicle_sales.desk_manager_key`), gross-per-unit context (`vw_vehicle_sales.retail_total_gross`). |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_the_employee_fairness_context_is_available_from_the_reporting_layer` (8 cases) |
| **Result** | **Pass** |
| **Limitation** | Availability is not use. The reporting layer makes the context obtainable; nothing forces a future report page to put it on the visual. That obligation is recorded in `powerbi/model_documentation/03-measure-groups.md` §5 and in the interpretation caution on `SQ-08` in [STAKEHOLDER_QUESTIONS.md](STAKEHOLDER_QUESTIONS.md), and it must be checked when the page is designed. |
| **Verdict** | **Met, with the obligation carried forward** |

### G1-C19 — Pipeline idempotency passes

| Field | Value |
|---|---|
| **Condition ID** | `G1-C19` |
| **Requirement** | Definition of Done: a rerun with identical source produces no duplicate rows at any layer. |
| **Evidence** | Two consecutive `development` runs against the same database produced **byte-identical warehouse counts** across all thirteen tables. The audit trail holds one `pipeline_run` row, not two, because the run UUID is derived from the run parameters and a rerun restates the same logical run. Reconciliation results are replaced, not accumulated. |
| **Test or SQL query** | `diff` of the two count captures; `tests/integration/test_reconciliations.py::test_recording_is_idempotent_within_a_run`; `tests/integration/test_audit_rerun_idempotency.py`; `tests/integration/test_schema_objects.py::test_init_sequence_is_rerunnable` |
| **Result** | **Pass** |
| **Verdict** | **Met** |

### G1-C20 — Data quality passes with no critical failure

| Field | Value |
|---|---|
| **Condition ID** | `G1-C20` |
| **Requirement** | Definition of Done: zero critical validation failures on the `development` profile. |
| **Evidence** | 114 checks recorded across fourteen `DQ-*` families. **114 passed, 0 failed, 0 skipped.** Evaluation coverage 100%, so the pass rate is not inflated by unevaluated checks. |
| **Test or SQL query** | `SELECT sum(checks_passed), sum(checks_failed), sum(checks_skipped) FROM reporting.vw_data_quality_trend` |
| **Result** | **Pass** |
| **Limitation** | A skipped check is not a passing check, which is why coverage is reported beside the rate. Zero skipped here means every registered check found a populated target. |
| **Verdict** | **Met** |

### G1-C21 — Every KPI traces to a stakeholder question

| Field | Value |
|---|---|
| **Condition ID** | `G1-C21` |
| **Requirement** | [KPI_CATALOG.md §37](../../KPI_CATALOG.md): a KPI with no business question behind it fails Gate 4. |
| **Evidence** | [STAKEHOLDER_QUESTIONS.md](STAKEHOLDER_QUESTIONS.md) records 35 questions across all twelve personas in `docs/research.md` §11.3. All 29 KPIs are cited; all 28 reporting views support at least one question; no unattributed KPI and no orphan view. Four questions the MVP **cannot** answer are recorded with the Deferred fact blocking each. |
| **Test or SQL query** | `tests/integration/test_stakeholder_question_traceability.py` (23 tests) |
| **Result** | **Pass** |
| **Verdict** | **Met** |

### G1-C22 — Documentation matches implementation

| Field | Value |
|---|---|
| **Condition ID** | `G1-C22` |
| **Requirement** | Definition of Done: no document claims anything exists that does not, and no document understates what does. |
| **Evidence** | Statuses corrected in this change across [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) (eleven entities and twelve check families moved from `Planned` to `Implemented`; the Part C banner rewritten), [KPI_CATALOG.md](../../KPI_CATALOG.md) (all 29 KPI statuses, the section 3 banner, the SQL-ownership fields and the whole reconciliation register), [LIMITATIONS.md](../../LIMITATIONS.md) (§1, §4, §9.1 and §10), [README.md](../../README.md) (status line, implementation table, roadmap) and [PHASE_1_BACKLOG.md](PHASE_1_BACKLOG.md). `scripts/check_docs_links.py` passes with 819 relative links resolved. |
| **Test or SQL query** | `python scripts/check_docs_links.py`; `python scripts/check_naming.py`; `python scripts/check_secrets.py` |
| **Result** | **Pass** |
| **Limitation** | Status accuracy is checked by review and by link resolution, not by a test that compares every document sentence with the database. `tests/integration/test_schema_objects.py` and `tests/integration/test_reporting_layer_completeness.py` pin the object inventory to `arpi.constants`, which is the strongest automated guard the project has; prose remains reviewable rather than testable. |
| **Verdict** | **Met** |

### G1-C23 — No Power BI work has started prematurely

| Field | Value |
|---|---|
| **Condition ID** | `G1-C23` |
| **Requirement** | Gate 1 gates Power BI **development**. Building the model before evaluating the gate would invalidate the review regardless of its verdict. |
| **Evidence** | No `.pbix`, `.pbip`, `.pbit`, `.tmdl` or `.bim` file exists anywhere under `powerbi/`. `powerbi/measures/` is empty. `powerbi/model_documentation/` holds four Markdown documents, which are the **specification the gate produces**, not an implementation of it. |
| **Test or SQL query** | `tests/integration/test_gate1_readiness.py::test_no_power_bi_artefact_has_been_built` (renamed after the gate opened — see the post-gate note below) |
| **Result** | **Pass** |
| **Limitation** | None. The test fails the build if any such file appears, so this condition stays enforced after the gate opens as well — at which point the test is the thing to update, deliberately and visibly. |
| **Verdict** | **Met** |
| **Post-gate note (added 2026-07-29, after the verdict)** | The gate opened, and the test was updated exactly as the Limitation above anticipated. It is now `tests/integration/test_gate1_readiness.py::test_only_approved_power_bi_artefacts_exist`, and the policy it enforces changed from "no Power BI artefact may exist" to "only approved Power BI artefacts may exist": the PBIP project and its TMDL are permitted under `powerbi/ARPI_Performance_Intelligence/`, while `.pbix`, `.pbit` and `.bim` stay prohibited everywhere, report visual content stays prohibited until `P2.2`, and local Power BI machine state stays untracked. The new test also asserts that the verdict recorded below is still a single **OPEN**, so the authorisation cannot be assumed after the fact. The row above is left as it was written, because the evidence as at the review date is what the verdict rested on; this note records what changed afterwards rather than rewriting the record. Delivery increment `P2.1-08`; [ADR-0007](../architecture-decisions/ADR-0007-power-bi-project-format.md). |

---

## 3. The three architecture conditions, summarised

| # | Gate 1 condition ([ARCHITECTURE.md §28](../../ARCHITECTURE.md)) | Supporting conditions | Status |
|---:|---|---|---|
| 1 | **Fact grains are approved** | `G1-C02`, `G1-C03`, `G1-C10` | ✅ **Met** — all five built, constrained over exactly the declared grain columns, and tested |
| 2 | **Dimensions are documented** | `G1-C01`, `G1-C04`, `G1-C05` | ✅ **Met** — all eight built, populated, grain-declared, fully column-commented, each with a source-to-target mapping |
| 3 | **KPI formulas are documented** | `G1-C06`, `G1-C07`, `G1-C08` | ✅ **Met** — all 29 specified, all 29 computable, each verified against an independent derivation |

Twenty-three conditions were evaluated. **Twenty-three are met.** None is unmet. Three are met with a
recorded limitation, and one carries an obligation forward into report design.

---

## 4. Limitations that survive this gate

These are not blockers. They are recorded so that opening Gate 1 does not read as a claim that nothing is
outstanding.

| # | Limitation | Consequence | Where it is tracked |
|---|---|---|---|
| 1 | [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) documents six dimensions at attribute level with indicative types; the binding column contract for those six is the DDL. | A reader wanting exact types for `dim_vehicle` must read `sql/03_dimensions/03_dim_vehicle.sql`. The database comments are complete either way. | `DOC-22` in [DOCUMENTATION_BACKLOG.md](DOCUMENTATION_BACKLOG.md) |
| 2 | `RECON-FUNNEL-CHAIN` is informational, not critical. | A funnel-chain breach does not fail a run. It is a finding to explain. | [KPI_CATALOG.md §36](../../KPI_CATALOG.md) |
| 3 | The privacy tripwire inspects column names, not values. | A prohibited value under an innocent name would not be caught. ARPI generates no such value, but the control does not prove that. | [LIMITATIONS.md §7.1](../../LIMITATIONS.md) |
| 4 | Employee fairness context is *available*, not *enforced on a visual*. | A future Employee Performance page could still rank on volume alone. | This document, `G1-C18`; `SQ-08` in [STAKEHOLDER_QUESTIONS.md](STAKEHOLDER_QUESTIONS.md) |
| 5 | Four Deferred facts block four stakeholder questions. | F&I product analysis, service-to-sales, target attainment and customer retention cannot be reported. Two of the nine planned report pages are blocked. | [STAKEHOLDER_QUESTIONS.md §6](STAKEHOLDER_QUESTIONS.md) |
| 6 | New-vehicle front gross excludes manufacturer incentives, holdback and floorplan credits. | ARPI new-vehicle gross is systematically understated relative to how a real store reports it. A modelling boundary, not a finding. | [KPI_CATALOG.md](../../KPI_CATALOG.md) `KPI-GRS-001` |
| 7 | Every figure is synthetic, and ARPI holds no benchmark for any measure. | Nothing here says whether a number is good. All comparison is internal — across stores, models and time. | [LIMITATIONS.md §1](../../LIMITATIONS.md) |

---

## 5. What opening Gate 1 does and does not authorise

**Authorised:** building the Power BI semantic model described in `powerbi/model_documentation/` — the
tables, the relationships, the marked date table, the role-playing relationships, the hidden keys, and the
measures in the Sales, Gross, Inventory, Lead-funnel, Marketing, Executive and Data-quality groups. Seven of
the nine report pages in [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) are unblocked.

**Not authorised by this gate:**

* The F&I Performance page and the Customer and Service Opportunities page. Both are blocked by Deferred
  facts, not by anything this review found.
* The target-attainment component of the Executive Overview, for the same reason.
* Any executive finding, recommendation, case study or walkthrough — those are behind **Gate 2**, which
  requires core report pages complete, SQL and Power BI totals reconciled, and findings drafted.
* Any statement about the automotive retail industry. The data is synthetic and the group is fictional.

---

## 6. Final verdict

Every one of the three Gate 1 conditions in [ARCHITECTURE.md §28](../../ARCHITECTURE.md) is met, and every
one of the twenty-three supporting conditions evaluated above is met. The fact grains are built,
constrained and tested; the dimensions are built, documented and mapped; all 29 KPI formulas are documented
and every one is computable from the reporting layer and verified against an independent derivation. The
reporter role is provably confined to `reporting`. Fifty-eight reconciliations pass on every run, and every
critical one has been observed failing against a deliberately corrupted fixture.

**Gate 1 verdict:**

**OPEN**

Power BI development may begin.

---

## 7. Review record

| Field | Value |
|---|---|
| **Reviewed by** | Michael Palmer |
| **Review date** | 2026-07-29 |
| **Backlog item** | `P1.5-04` |
| **Evidence profile** | `development`, seed 20250701, fresh PostgreSQL 16 database, 104 SQL scripts, two consecutive pipeline runs |
| **Automated evidence** | `tests/integration/test_gate1_readiness.py` and the seven suites it references |
| **Next gate** | **Gate 2** — no web case study begins until core Power BI pages are complete, SQL and Power BI totals reconcile, and executive findings are drafted |
