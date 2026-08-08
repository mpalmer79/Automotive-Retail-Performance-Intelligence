# `DASH.8` staff-level review — inventory accounting and GL controls

**Status:** written after implementation, against the code and the measurements.
**Increment:** `DASH.8-01`, `DASH.8-02`, `DASH.8-03`.
**Parents:** [DASHBOARD_BACKLOG.md](../requirements/DASHBOARD_BACKLOG.md) ·
[STAKEHOLDER_QUESTIONS.md](../requirements/STAKEHOLDER_QUESTIONS.md) ·
[KPI_CATALOG.md](../../KPI_CATALOG.md) · [LIMITATIONS.md](../../LIMITATIONS.md) ·
[STM-022](../source-to-target/STM-022-fact-inventory-accounting-snapshot.md) ·
[STM-023](../source-to-target/STM-023-dim-gl-account.md) ·
[STM-024](../source-to-target/STM-024-fact-gl-control-balance.md)

Every answer below names its implementation and its test. Where an answer is qualified,
the qualification is stated first and is not softened. **Six answers are qualified**, and
**five record a defect this increment found and fixed** rather than a property it merely
maintained.

Measured on a fresh warehouse built by the canonical 172-step sequence and loaded by the
`development` profile: 1,501 schedule lines over 6 month-ends, 42 control balances, 43
comparison rows, 13 accounting reconciliations all passing, 226 data-quality checks with 0
critical failures.

---

## A. Scope boundary — is this a general ledger?

**A1. ARPI does not build a general ledger, and the boundary is enforced rather than
stated. Yes.**
There is no journal entry, journal line, debit or credit amount, posting batch, posting
timestamp, trial balance, aged trial balance, period-close state, suspense account,
adjusting entry, reversal, approval workflow or financial statement — not as a column, not
as a generation parameter, not as a derived value.
*Implementation:* `ck_dim_gl_account_category_domain` closes the catalogue to three
inventory categories; `sql/04_facts/10_fact_gl_control_balance.sql` carries `net_balance`
and nothing else.
*Test:* `DQ-GLA-002` and `DQ-GLB-002` hold both column contracts to exactly the declared
list, so a debit/credit or journal column cannot be added even empty;
`tests/unit/test_accounting_seeded_defects.py` defect 10 seeds an **empty** prohibited
column and proves it is refused.

**A2. The catalogue is a selected control set, not a chart of accounts. Yes.**
Three rows: one inventory asset control account per governed category. No Cash, Revenue,
Cost of Sales, Payroll, Parts, Service, Rent, Payable, Receivable, Equity, Retained
Earnings or Tax account.
*Implementation:* `GL_ACCOUNT_DEFINITIONS` in `src/arpi/generation/gl_control.py`.
*Test:* `DQ-GLA-009` scans account **names** for general-ledger vocabulary, so a row that
mislabelled itself past the category CHECK still fails a run; seeded defect 11 renames an
account to `Vehicle Cost of Sales Control` and proves the check fires.

**A3. Every account number and name is invented. Yes.**
The numbers sit in a conventional dealership inventory block so the shape is recognisable,
and no real dealer group's chart of accounts was consulted, copied or approximated.
*Implementation:* the three literals in `GL_ACCOUNT_DEFINITIONS`.
*Evidence:* recorded in STM-023 §1.2, on the table comment and on the column comment.

---

## B. The book-value identity

**B1. The identity holds exactly on every line, and a violation is unloadable. Yes.**
`current_book_value = acquisition_cost + capitalized_transportation +
capitalized_reconditioning + capitalized_accessories + other_capitalized_costs −
write_down_amount`, exact, no tolerance.
*Implementation:* `ck_fact_inventory_accounting_book_value_identity` — a CHECK rather than
a staging rule, because a violation must be **unloadable** rather than merely quarantined.
*Test:* `RECON-ACC-BOOK-IDENTITY` re-proves it per line over the loaded rows (1,501 of
1,501 conforming); seeded defect 1 adds one cent to one line and proves `DQ-IAS-011` fires
with exactly one offending row; the reconciliation's corruption case drops the CHECK first
and proves the **reconciliation** fires too, which is what tests a deployed database whose
constraints are no longer intact.

**B2. There is no balancing plug. Yes — and this is one of the five defects the review
found.**
*Qualification stated first:* when the increment was first written there was **no check on
this at all**. `other_capitalized_costs` is the one book component with no external
meaning, so it is exactly where a residual would hide — and a plug makes an identity close
**by construction** rather than by being true, which means `DQ-IAS-011` could never have
caught one.
*Fix:* `DQ-IAS-019` constrains the column to the values the governed rules actually
produce (`0.00`, or the certification cost on a Certified unit).
*Test:* seeded defect 3 plants a residual of `137.42`, keeps the identity closed, and
proves `DQ-IAS-011` passes while `DQ-IAS-019` fires.

**B3. No component is nonsense. Yes.**
A negative capitalized cost is not a cost, a negative write-down is a write-**up** this
model does not represent, and a negative carrying value would subtract from a control
balance.
*Implementation:* `ck_fact_inventory_accounting_components_nonnegative`,
`ck_..._write_down_nonnegative`, `ck_..._book_value_nonnegative`.
*Test:* `RECON-ACC-BOOK-COMPONENTS` counts them over the whole table; seeded defects 4 and
5 keep the identity closed around a negative component and a negative write-down
respectively, so both prove the separate check is doing work the identity cannot.

---

## C. Pack, floorplan, and the concepts that must stay apart

**C1. `KPI-GRS-001` and the front-gross identity are unchanged. Yes.**
Pack is a front-gross deduction at the point of sale and is a capitalized inventory cost
nowhere. There is no pack column on the schedule.
*Implementation:* the fact's column list; nothing in `inventory_accounting.py` reads
`pack_amount`.
*Test:* `RECON-ACC-PACK-EXCLUDED` re-proves `front_end_gross = sale_price −
acquisition_cost − reconditioning_cost − pack_amount` on all 650 deals on every run, and
its corruption case drops the front-gross CHECK and moves pack by `100.00` to prove the
rule fires. `KPI-ACC-005` asks the same question as an exception and reports `0`.

**C2. Floorplan principal is never netted into book value. Yes — and this is the second
defect the review found.**
*Qualification stated first:* `DQ-IAS-014` as first written re-asked the book-value
identity restricted to floorplanned rows. That is **already covered** by `DQ-IAS-011`, so
the check added nothing — and a floorplan balance capitalized **into a component** closes
the identity just as neatly as a correct one and would have passed both.
*Fix:* the check now also asks whether any component **equals** the principal.
`acquisition_cost` is deliberately excluded, because a new unit is floorplanned at cost by
rule and equality there is the ordinary correct state.
*Test:* seeded defect 2 moves the principal into `capitalized_reconditioning`, keeps the
identity closed, and proves `DQ-IAS-011` passes while `DQ-IAS-014` fires.
*Additional evidence:* `RECON-ACC-FLOORPLAN-EXCLUDED` requires the identity to hold **while**
floorplan principal is materially non-zero — 1,080 of 1,501 lines on the measured run —
because an identity that closes proves nothing about exclusion if there is nothing to
exclude. Its corruption case zeroes every floorplan balance and the rule fires.

**C3. No net-inventory-position figure exists anywhere. Yes.**
Netting an asset against a liability produces a figure no controller would recognise.
*Test:* `tests/integration/test_kpi_verification.py::test_no_view_publishes_a_net_inventory_position`
scans `information_schema.columns` across `warehouse` and `reporting` for
`net_inventory_position`, `net_inventory_value`, `inventory_net_of_floorplan` and
`equity_in_inventory`.

**C4. `0.00` floorplan principal is a legitimate unfloored unit. Yes.**
Off-street purchases and customer trades are unfloored by rule.
*Implementation:* `floorplan_principal_for()` in `inventory_accounting.py`.
*Surface:* `reporting.vw_inventory_accounting.is_floorplanned` publishes the distinction so
a reader is not left to infer it from a zero.

---

## D. The reconciliation

**D1. The variance sign is `GL − subledger` and is never flipped or absorbed. Yes.**
Positive means the control account carries more than the schedule supports; negative means
the schedule carries more than the account. Different investigations, different causes.
*Implementation:* `reporting.vw_inventory_gl_reconciliation.variance_amount`.
*Test:* `test_kpi_acc_003_variance_is_gl_minus_subledger_on_every_comparable_row` asserts
the arithmetic on every row; `test_kpi_acc_003_publishes_both_signs` requires the dataset
to contain **both** signs, so the rule is exercised rather than assumed;
`test_the_absolute_variance_never_replaces_the_signed_one` requires at least one negative
variance to exist, otherwise publishing the absolute value alongside would prove nothing.

**D2. A missing side is NULL and never zero. Yes.**
`COALESCE`-ing an absent control balance to `0.00` would report a variance equal to the
whole subledger and present a **missing balance** as a **zeroed account**.
*Implementation:* the view FULL JOINs and leaves both sides as they arrive;
`comparison_state` is a closed four-value vocabulary and `is_reconciled` is deliberately
three-valued.
*Test:* `test_kpi_acc_002_is_never_defaulted_to_zero_when_a_balance_is_absent` requires a
withheld balance to exist in the dataset and then asserts the row carries NULL in all three
places.

**D3. Comparability is matched-date, structurally. Yes.**
Both sides are month-end by construction, so comparing a month-end control balance with a
mid-month schedule is not available rather than merely discouraged.
*Implementation:* `month_end_dates()` bounds the accounting calendar; the reconciliation
joins on the date key.
*Test:* `DQ-IAS-006` and `DQ-GLB-006` assert the month-end rule on both sides; seeded
defect 15 moves one balance to the 15th of its month and proves `DQ-GLB-006` fires.

**D4. `RECON-ACC-GL-SUBLEDGER` is not an equality, and is still falsifiable. Yes,
qualified.**
*Qualification:* it is the second rule in the whole register registered non-critical. The
increment plants controlled variances so the surface can be seen working in both states,
and a rule that failed a run because one exists would make the exception surface unusable.
*What it does assert:* every comparison row is **well formed** — a comparable row carries a
variance and a non-null reconciled flag whose value agrees with whether that variance is
zero, and a row with a missing side carries neither.
*Test:* `test_the_gl_subledger_rule_is_informational_but_still_falsifiable` decouples the
state from the arithmetic behind it and proves the rule flips to `failed`;
`test_a_controlled_variance_alone_never_fails_the_rule` proves the other direction, which
matters just as much.
*Measured:* 43 comparison rows — 39 reconciled exactly, 2 variance (one of each sign), 1
missing GL balance, 1 missing subledger balance. All four states present.

**D5. An exact reconciliation proves the arithmetic, not that two independent systems
agree. Qualified — and this is the increment's most important limitation.**
The control balances are **generated from the same subledger they are reconciled against**,
plus a governed table of deliberate variances. There is only one source.
*Where it is recorded:* the table comment, both reporting views that publish a variance,
`RECON-ACC-GL-SUBLEDGER`'s own description, `KPI_CATALOG.md §41.1`, `LIMITATIONS.md §16.1`
and STM-024 §1.2. No surface may claim otherwise.

---

## E. The exception surface

**E1. A reconciliation variance and a data-quality exception are never totalled. Yes.**
A variance means two structurally **valid** balances disagreed. A data-quality exception
means a rule the model asserts about itself does not hold. `KPI-ACC-003` counts the first,
`KPI-ACC-012` the second, and no KPI adds them.
*Test:* `test_a_variance_is_never_counted_as_a_data_quality_exception` requires variances
to exist and then asserts the `ACC-DQ-FAILURE` count is zero.

**E2. One physical defect produces one exception row. Yes.**
`exception_id` is `exception_code:entity_name:entity_key` and is the declared grain; every
branch is scoped to one control question about one entity.
*Test:* `test_the_exception_identifier_is_unique_so_one_defect_is_counted_once` compares
row count to distinct identifier count on every run.

**E3. A missing-balance exception carries no amount. Yes.**
Reporting the side that **is** present would state a number nobody computed.
*Test:* `test_a_missing_balance_exception_carries_no_amount`.

**E4. Two exception branches are unreachable, and that is deliberate. Yes, qualified.**
*Qualification:* `ACC-ORPHAN-FI-PRODUCT` and `ACC-ORPHAN-FI-ADJUSTMENT` look for a child
row whose parent does not resolve, which the foreign keys make impossible. Both return zero
on every healthy run.
*Why they exist anyway:* a control surface that only asks questions the schema already
answers proves nothing about the schema it is **deployed** against. If either count is
nonzero, the constraint is not on the table.
*Test:* `test_the_foreign_keys_behind_kpi_acc_008_and_009_are_on_the_deployed_tables`
asserts the constraints are actually present — because a zero from a branch that cannot
fire is not evidence on its own.

---

## F. The KPI family

**F1. `KPI-ACC-006` uses original product gross, not net. Yes — and this is the third
defect the review found.**
*Qualification stated first:* the increment plan specified **net** product gross. On this
dataset that definition reports a nonzero count on every run purely because adjustments
exist: a later cancellation is *supposed* to make retained gross differ from produced
gross, so the planned definition would have flagged every adjusted deal as an accounting
defect.
*Fix:* `finance_reserve_gross + SUM(original_product_gross) + other_fi_income`, which is
the identity `RECON-FI-001` already proves.
*Test:* `test_kpi_acc_006_uses_original_product_gross_and_not_net` asserts **both** that
the corrected definition yields zero **and** that the planned one would have fired on this
data. That is what makes it a decision rather than a coincidence.

**F2. `KPI-ACC-011` measures what it says and nothing more. Yes, qualified — and this is
the fourth defect the review found.**
*Qualification:* the plan implied a posting lag with an F&I half. ARPI holds **no separate
posting timestamp on either side**, so no journal-posting delay is computable and no F&I
posting-lag pair exists to compute. Fabricating one would have invented an operational fact
the synthetic data does not contain.
*What it is:* acquisition date to **first** month-end schedule appearance, averaged over
first appearances only.
*Test:* `test_kpi_acc_011_posting_lag_is_measured_on_first_appearance_only` re-derives it
from `warehouse`; `test_kpi_acc_011_differs_from_the_all_appearances_average` proves the
first-appearance restriction is not a no-op;
`test_no_column_claims_a_journal_posting_timestamp` scans both schemas for `posted_at`,
`posting_timestamp`, `journal_posted_date`, `gl_posted_date` and `posting_date_key`.
*Further limit, stated:* because the calendar is month-end only, the lag is bounded below
by how far into a month a unit arrived — it measures schedule cadence as much as
promptness.

**F3. Every KPI is re-derived independently. Yes.**
Each expectation in `tests/integration/test_kpi_verification.py` is written against
`warehouse` from the KPI's own definition, never by reading the view under test. A test
that computed both sides from `reporting.vw_accounting_exceptions` would prove that a UNION
is deterministic.

**F4. `KPI-ACC-004` and `KPI-ACC-010` are published side by side on purpose. Yes.**
`-004` counts stock the schedule disagrees with in **either** direction; `-010` is the
missing-book-row direction alone. The two have different causes and different remedies, and
a single combined figure would hide which occurred.

**F5. The three registers are never summed. Yes.**
29 MVP KPIs, 22 F&I, 10 target, 24 listing and 12 accounting are five separate registers.
*Test:* `test_the_accounting_family_is_held_apart_from_every_other_register` asserts the
sets are disjoint and that `KPI_IDS` is still 29.

---

## G. Data volume, generation, and leakage

**G1. No future-outcome leakage. Yes.**
The control category comes from the unit's condition, the write-down from days in stock at
the accounting date, the floorplan principal from the unit's own funding. None consults the
sale.
*Recorded:* the fact's header, STM-022 §1.5.
*Structural consequence:* there is no `Wholesale Inventory` category, because nothing
observable at a month-end distinguishes a unit held for wholesale and only the eventual
disposal would. Seeded defect 7 plants exactly that category and proves `DQ-IAS-008` fires.

**G2. The variance scenarios exercise every profile. Yes — and this is the fifth defect the
review found.**
*Qualification stated first:* the scenarios were written with **literal month-end dates**
in the development window. The `test` profile — the profile the integration suite runs on —
is two months long and reached none of them, so every reconciliation state the increment
exists to demonstrate was **absent from the profile that tests it**.
`test_kpi_acc_002_is_never_defaulted_to_zero_when_a_balance_is_absent` failed for exactly
that reason.
*Fix:* each scenario is a month-end **offset** back from the last month-end, taken modulo
the number of month-ends the profile produced. Every scenario lands in every profile, and
the offsets reproduce the original development dates exactly.

**G3. The fact carries no `acquisition_date_key`, and that is a recorded decision. Yes,
qualified.**
*Qualification:* `dim_date` spans the governed 184-day window and roughly 28% of units
entered stock during the warm-up period before it opens. A `NOT NULL` key with a foreign
key into the calendar rejected **360 legitimate schedule lines** — a quarter of the
subledger balance — measured, not estimated.
*Alternatives rejected:* widening a calendar baseline measured against a specific run; or a
nullable key whose NULL means "before the calendar" rather than "unknown".
*Why neither was needed:* `days_in_stock` **is** `accounting_date − acquisition_date`, so
`KPI-ACC-011` is computable exactly as specified with no second key. The acquisition date is
still carried and validated in raw and staging.
*Test:* seeded defect 8 drifts `days_in_stock` by seven days and proves `DQ-IAS-016` fires —
which matters more now that the derived duration is the only record of the interval.

**G4. Monetary values are exact decimals. Yes.**
*Test:* `DQ-IAS-015` and `DQ-GLB-007`; seeded defect 9 plants a float that prints as a clean
amount and proves the check fires.

---

## H. Baselines, boundaries and governance

**H1. Every MVP baseline is unchanged. Yes.**
29 KPIs, 28 reporting views, 5 facts, 8 conformed dimensions.
*Implementation:* `ACCOUNTING_LANE_SQL_FILES` in `arpi.constants`, subtracted by
`scripts/project_capabilities.py` exactly as the listing and dashboard lanes are.
*Test:* `tests/unit/test_cloud_database_expectations.py` proves the four lane counts sum to
the whole schema and that no view is declared in two registers;
`tests/unit/test_inventory_kpis.py` proves `KPI_IDS` is still 29 and the registers are
disjoint.
*Why it is declared in `arpi.constants` and not in `arpi.dashboard.contract`:* `DASH.8`
adds no browser dataset and no console route, so the contract module is deliberately
untouched by it.

**H2. No browser dataset, no console route, no DASH.9 work. Yes.**
`src/arpi/dashboard/contract.py` is unchanged by this increment. No accounting view is
exported and no route reads one.

**H3. Gate 2 remains CLOSED and no TMDL was modified. Yes.**
No semantic-model table, relationship or measure exists for this domain, and no DAX has
ever computed one of the twelve `KPI-ACC-*` measures.

**H4. Gate 4 is satisfied within the increment. Yes.**
All four conditions, recorded rather than asserted, in
`STAKEHOLDER_QUESTIONS.md §6`: a registered stakeholder question requiring the domain
(`SQ-43`, registered and answered in the same change); declared grains enforced physically
by `uq_fact_inventory_accounting_snapshot_grain` and `uq_fact_gl_control_balance_grain`,
each over three NOT NULL columns; KPI ownership in `KPI_CATALOG.md §41`; and testing
requirements met by the three DQ families, the two reconciliation families with a seeded
corruption per critical rule, and an independent warehouse derivation per KPI.

**H5. Nothing in this increment describes a real dealership. Yes.**
Every account, balance, schedule line and variance is synthetic. The planted variances are
**demonstration conditions**, not discovered business findings, and both STM-024 §4.2 and
`LIMITATIONS.md §16.3` say so in those words.

---

## What this review found that the implementation had not

Five things, each fixed in the same change rather than recorded as a known gap.

1. **`other_capitalized_costs` had no plug guard.** The book-value identity cannot detect a
   balancing residual, because a plug makes an identity close by construction. `DQ-IAS-019`
   now constrains the column to the values the governed rules produce.

2. **`DQ-IAS-014` duplicated the identity check.** As first written it re-asked
   `DQ-IAS-011` on floorplanned rows and could not detect a floorplan balance capitalized
   *into* a component. It now asks whether any component equals the principal.

3. **The variance scenarios never fired in the `test` profile.** Literal month-end dates in
   the development window meant the integration suite — the only suite that runs the
   reconciliation end to end — exercised none of the four comparison states. Offsets fixed
   it, and the failing test is what surfaced it.

4. **Six pre-existing corruption cases broke on a new foreign key.** The accounting fact
   references `dim_vehicle`, and six reconciliation corruptions that delete a vehicle row
   began failing on the new constraint rather than on the rule they were written for. Each
   now releases the accounting reference too, so it still tests its own rule.

5. **The fact could not carry an acquisition date key.** The obvious column for a posting
   lag would have silently rejected 360 legitimate schedule lines — a quarter of the
   subledger balance — because a quarter of the fleet entered stock before the governed
   calendar opens. `days_in_stock` already carried the interval.
