# ADR-0006: SCD Type Selection for Phase 1 Dimensions

## Status

**Accepted**

## Date

2026-07-28

## Deciders

Michael Palmer

## Context

`ARCHITECTURE.md` §14 states the principle: use Type 1 replacement when historical reporting does not need
the previous value, and Type 2 history when historical performance must stay attached to the correct
attribute version. It names Dealership and Employee as required Type 2, and Marketing campaign
classification and Lender category as *potential* Type 2.

That is a rule, not a decision. The six dimensions delivered across delivery increments `P1.1` through
`P1.5` — `dim_vehicle_model`, `dim_vehicle`, `dim_employee`, `dim_customer`, `dim_lead_source`,
`dim_marketing_campaign` — each needed the rule applied to it, and two of them sit close enough to the line
that a reviewer is entitled to ask why the answer went the way it did.

The choice is expensive to reverse. Converting a Type 1 dimension to Type 2 later requires history that was
never captured, so the conversion cannot recover the past — it can only start recording from the conversion
date, leaving a permanent discontinuity in every measure that joins through it. Converting Type 2 to Type 1
destroys history that facts already point at. Both directions are migrations of the fact tables, not just
the dimension.

`docs/requirements/README.md` §7.1 makes settling this a Definition of Ready condition: an item that creates
a dimension cannot start until its history policy is declared. This record declares all six at once, so no
increment has to make the call in isolation and reach a different answer than its neighbour.

## Decision

| Dimension | Type | Delivery increment |
|---|---|---|
| `warehouse.dim_dealership` | **Type 2** | `Phase 0` — unchanged by this record |
| `warehouse.dim_date` | Not applicable | `Phase 0` — a static calendar, no history concept |
| `warehouse.dim_vehicle_model` | **Type 1** | `P1.1-01`, `P1.2-02` |
| `warehouse.dim_vehicle` | **Type 1** | `P1.1-02`, `P1.2-02` |
| `warehouse.dim_employee` | **Type 2** | `P1.1-03`, `P1.2-03` |
| `warehouse.dim_customer` | **Type 1** | `P1.1-06`, `P1.2-06` |
| `warehouse.dim_lead_source` | **Type 1** | `P1.4-01` |
| `warehouse.dim_marketing_campaign` | **Type 1** | `P1.5-01` |

One Type 2 dimension is added in Phase 1: `dim_employee`. Everything else is Type 1.

### `dim_employee` — Type 2

**Grain:** one row per employee role-assignment version, with `effective_date`, `expiration_date`,
`is_current`, and an `attribute_hash` over the tracked attributes.

Employees change department, job role, and store, and every one of those changes invalidates history if it
overwrites. A salesperson promoted to desk manager in month seven did not manage deals in month three. Under
Type 1, month three's deals would be attributed to a desk manager, and a "gross per salesperson" measure
would silently lose a producer while a "manager involvement" measure would silently gain one. A store
transfer is worse: under Type 1 every historical deal that person closed would relocate to the new store, and
store-level sales history would change retroactively for reasons that have nothing to do with sales.

The employee dimension is also the one `ARCHITECTURE.md` §23 attaches ethical requirements to. An employee
scorecard must present tenure, store context, and lead mix alongside any performance figure. All three are
version-dependent attributes, so a fair scorecard is only computable if the version that was in force at the
time of each deal is recoverable. Type 1 makes the fairness requirement unimplementable, which settles the
question on its own.

There is a secondary benefit that is real but not the reason: `dim_dealership` is Type 2 and its
expire-and-insert branch has never run against generated data, because all three stores are on their initial
version (`DOC-11`). `P1.1-03` requires at least three employees with a genuine role or store change, so the
shared SCD2 pattern finally gets exercised by real generated data rather than only by unit-test fixtures.

**Tracked attributes:** `dealership_id`, `department`, `job_role`, `hire_date`, `termination_date`,
`is_active`, `is_manager`. A change to any of them expires the current row and inserts a new version.
`tenure_band` is derived and is not tracked, because it changes with the passage of time rather than with a
business event, and tracking it would generate a version per employee per band boundary — history noise with
no analytical content.

### `dim_vehicle_model` — Type 1

**Grain:** one row per model-year, make, model, trim combination.

The natural key *is* the descriptive content. A model-year 2024 Subaru Outback Limited is that combination;
there is no meaningful sense in which its make or model year changes. The remaining attributes — body style,
vehicle class, fuel type, drivetrain, transmission, doors, seating capacity — are physical facts of the
configuration and are equally static.

The changes that do occur are corrections and re-standardisations: a trim label spelled two ways, a body
style reclassified from Crossover to SUV, a franchise alignment corrected. `ARCHITECTURE.md` §14 names
"standardized model label" as a Type 1 example directly. Preserving the wrong spelling as a version would
split every model-level measure across two rows and make the catalogue worse, not more accurate.

`is_current_model_line` is the one attribute that genuinely changes over time. It is deliberately treated as
a **current-state flag**, not as history: it answers "is this model line still sold today?", which is a
question about now. Analysis of what was sold *when* runs through `fact_vehicle_sale` and `dim_date`, which
is where time belongs in a star schema.

### `dim_vehicle` — Type 1

**Grain:** one row per unique physical vehicle.

A physical vehicle's identity — its synthetic VIN, its model, its condition at acquisition, its colours — is
fixed at acquisition. In this model a unit is acquired once, held, and disposed of once; it does not change
identity mid-life.

The attribute a reader might expect to be historical is `odometer_reading`, and the reason it is not is
structural. Odometer is captured **at acquisition** and is a property of the unit as acquired, not a running
measure. Mileage accumulated over time is not modelled at all — there is no service domain in the MVP and no
event that would move it. Making the dimension Type 2 for an attribute that never changes would add
`effective_date`, `expiration_date`, `is_current`, and `attribute_hash` to every row, plus a partial unique
index and an expire-and-insert path, in exchange for exactly one version per vehicle forever.

Time-varying facts about a vehicle already have a home: `fact_vehicle_inventory_snapshot` records asking
price, days in stock, age bucket, and markdown count per vehicle per day. That is where a vehicle's history
lives, at the grain that supports "as of any date" analysis. Duplicating part of it into the dimension would
create two answers to the same question.

### `dim_customer` — Type 1

**Grain:** one row per synthetic customer.

The attributes are `age_band`, `county`, `state_code`, `market_area`, `customer_type`,
`is_prior_customer`, `is_service_customer`, and `first_interaction_date`. Three of them can change in
principle — a customer ages into the next band, moves county, or becomes a prior customer after their first
purchase.

Type 1 is chosen for two reasons, one analytical and one ethical.

**Analytically**, the questions the MVP asks of this dimension are current-state questions: what is the
current geographic mix of the customer base, what share are repeat buyers, how does age band relate to
vehicle class. The historical variants — "which county did this customer live in at the time of their
purchase" — are not among the 29 specified KPIs, and none of the stakeholder questions in
`docs/research.md` §4 requires them. Building version history for questions nobody asked is the definition of
overengineering that `ARCHITECTURE.md` §28's scope gates exist to prevent.

**Ethically**, versioned customer attributes are a surveillance shape. A Type 2 customer dimension records
that a specific individual moved from one county to another on a specific date, and that they crossed an
age-band boundary. Even against a synthetic population, building the structure that would hold a real
person's movement history is the wrong instinct for a project whose privacy position is that customer data
is minimised to the coarsest useful resolution (`P1.1-06`: geography stops at county, age is banded, no date
of birth exists). Type 1 keeps the dimension a description of who the customer base *is*, not a dossier of
how each member changed.

`is_prior_customer` is therefore a current-state flag. Repeat-purchase analysis is done from
`fact_vehicle_sale` by counting sales per `customer_key`, which is more accurate than a flag anyway, because
it carries the count and the dates.

### `dim_lead_source` — Type 1

**Grain:** one row per normalised lead source.

This dimension exists to *stop* drift. Its whole purpose is to collapse ungoverned CRM source strings into a
governed set, which `P1.4-01` identifies as the single most common reason dealership funnel reporting cannot
be trusted. Its attributes — `source_category`, `is_paid`, `is_digital`, `is_third_party`, `is_internal` —
are classification decisions made once by the project, not observations that vary over time.

If a source were genuinely reclassified — say a channel moved from organic to paid — Type 2 would split the
funnel for that source across two rows at exactly the moment an analyst was trying to compare it against
itself. A reclassification is a restatement, and a restatement should apply to all history so the comparison
stays valid. The reclassification itself is documented in the change record, which is where the "why" belongs.

### `dim_marketing_campaign` — Type 1

**Grain:** one row per campaign.

This is the one where `ARCHITECTURE.md` §14 explicitly leaves the door open: it names "marketing campaign
classification" as a *potential* Type 2 dimension, and `P1.5-01` requires the Type 2 option to be documented
as requiring an ADR. This record is that documentation, and the answer is Type 1 for Phase 1.

A campaign is naturally time-bounded — it carries `start_date` and `end_date`, so its period is an attribute
rather than something version history must reconstruct. The attributes that could be reclassified are
`channel`, `target_department`, and `target_vehicle_category`. Reclassifying one of those mid-campaign is a
correction to how the campaign was always categorised, not a change in what the campaign did, and marketing
performance is measured at campaign × store × month through `fact_marketing_spend` regardless.

The case for Type 2 would be a long-running always-on campaign whose targeting genuinely changed
mid-flight — a real pattern, and the reason §14 flags it. It is out of scope for Phase 1: no such campaign is
generated, and `P1.5-01` models campaigns as discrete, dated efforts. **If a campaign is ever modelled with
genuinely changing targeting, this decision must be superseded**, and the superseding record must address
what happens to `fact_marketing_spend` rows already pointing at the collapsed version.

### `dim_dealership` — Type 2, unchanged

Recorded here for completeness. It was decided in the `Phase 0` delivery increment and this record does not
revisit it. Store attributes — franchise brand, market region, operating status — must stay attached to the
performance of the period in which they were in force, for the same reason employee attributes must.

Its expire-and-insert branch has still never run against generated data (`DOC-11`). That is a testing gap,
not a modelling error, and `P1.1-03` addresses the shared pattern through `dim_employee`.

## Alternatives considered

**Make every Phase 1 dimension Type 2.** Uniform, and it forecloses the "we should have captured that"
regret. Rejected because five of the six have no attribute that changes in a way any specified KPI asks
about. It would add four columns, a partial unique index, and an expire-and-insert path to five dimensions to
produce exactly one version per row forever, and it would inflate `dim_vehicle` — one of the larger
dimensions — with version machinery that never fires. `ARCHITECTURE.md` §29 names "warehouse complexity grows
too quickly" as a live risk with "implement core facts first" as its mitigation.

**Make `dim_customer` Type 2.** The most defensible alternative on purely analytical grounds: geographic
mobility is a real dealership question, and county-at-time-of-sale is a real measure. Rejected for the
scope-gate reason (no specified KPI or stakeholder question needs it) and, more importantly, for the ethical
reason above. If a future increment needs county-at-time-of-sale, the correct fix is a degenerate attribute
on `fact_vehicle_sale` capturing the value at transaction time — which answers the question without building
a per-person movement history.

**Make `dim_vehicle_model` Type 2 for `is_current_model_line`.** Rejected: a current-state flag answering a
current-state question does not need history, and time-based model analysis runs through the sale fact and
`dim_date`.

**Make `dim_marketing_campaign` Type 2 now, pre-emptively.** Rejected as speculative. Phase 1 generates no
campaign whose targeting changes, so the versions would all be singletons, and the design would be shaped by
a case that does not exist. The trigger for revisiting is stated above so the deferral is a decision rather
than an oversight.

**Type 3 (previous-value columns) anywhere.** Rejected across the board. Type 3 answers "what was the
immediately previous value" and nothing else, which is neither the current-state question Type 1 answers nor
the point-in-time question Type 2 answers. It would add columns without answering either question properly.

## Consequences

### Positive

- Every Phase 1 dimension's history policy is settled before its increment starts, satisfying the Definition
  of Ready condition in `docs/requirements/README.md` §7.1, and no increment has to decide in isolation.
- Only one new Type 2 dimension exists, so the expire-and-insert path is implemented, tested, and reviewed in
  one place, using the pattern `STM-002` already documents for `dim_dealership`.
- `dim_employee` being Type 2 is what makes the §23 fairness requirements implementable at all — tenure,
  store context, and role at the time of each deal are recoverable.
- `dim_customer` being Type 1 keeps the project's privacy posture consistent: the model holds no per-person
  change history, which is the structure that would carry real risk if the data were ever real.
- The Type 1 dimensions stay narrow, which keeps `dim_vehicle` — one of the larger dimensions — free of
  version machinery that would never fire.

### Negative

- **The Type 1 choices are not free to reverse.** If a later increment needs point-in-time customer geography
  or campaign targeting, the history for the period before the conversion does not exist and cannot be
  reconstructed. Every such measure will carry a permanent discontinuity at the conversion date. This is the
  real cost of the decision and it is stated plainly.
- The project demonstrates SCD Type 2 on two dimensions out of eight. A reviewer looking for breadth of
  dimensional-modelling technique sees the pattern applied narrowly — deliberately, but narrowly.
- `dim_marketing_campaign` carries an explicit "revisit if targeting changes" condition, which is a known
  future decision rather than a settled one. Leaving it open is honest but it is not closure.
- `is_prior_customer` and `is_current_model_line` are current-state flags on Type 1 dimensions, which means a
  report filtered on them describes the population as it is now, not as it was. Any view exposing them must
  say so in its comments, or a reader will assume otherwise.
- Employee `tenure_band` is derived and untracked, so a historical query that groups by tenure band gets the
  band as of the version's tracked attributes, not as of the transaction date. This is a deliberate
  simplification and needs disclosure in `DATA_DICTIONARY.md`.

## Relationship to other records

- `ARCHITECTURE.md` §14 states the general rule and now points here for the per-dimension selection.
- **ADR-0002** established the Phase 0 baseline in which `dim_dealership` became Type 2.
- `docs/source-to-target/STM-002-dim-dealership.md` §4.3 documents the three-branch SCD2 MERGE behaviour that
  `dim_employee` reuses.
- `P1.1-03`, `P1.2-03`, and `P1.2-06` in `docs/requirements/PHASE_1_BACKLOG.md` carry the acceptance criteria
  that implement this record.
- `DOC-11` in `docs/requirements/DOCUMENTATION_BACKLOG.md` records the untested `dim_dealership` Type 2 path.
