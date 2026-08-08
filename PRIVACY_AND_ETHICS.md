# Privacy and Ethics — Automotive Retail Performance Intelligence (ARPI)

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-07-28
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [DATA_GENERATION.md](DATA_GENERATION.md) · [LIMITATIONS.md](LIMITATIONS.md) · `SECURITY.md`

---

## 1. Position statement

ARPI analyses a **fictional** three-store dealership group using **entirely synthetic** operational data.
It contains no real customer, no real employee, no real vehicle, no real transaction, and no real
dealership.

That is not a limitation the project apologises for. It is a design choice with a specific rationale:
dealership operational data is among the more sensitive categories of consumer data in the United States,
and a portfolio project has no business handling it. Working synthetically lets ARPI demonstrate the full
analytical stack — dimensional modelling, data quality, KPI governance, executive reporting — while
carrying **zero privacy risk to any real person**.

This document records what ARPI will not do, why, and how each commitment is actually enforced. Section 12
maps every policy to a concrete control and states honestly whether that control exists today.

---

## 2. Synthetic-only operational data policy

**Every operational record in ARPI is synthetic.** [ARCHITECTURE.md §22.1](ARCHITECTURE.md) classifies all
project data as one of exactly three things:

| Classification | Example |
|---|---|
| Synthetic public portfolio data | Every dimension and fact in the warehouse |
| Approved public reference data | NHTSA vPIC vehicle attributes (feature-flagged **off** today) |
| Non-sensitive documentation | This repository's Markdown files |

> **No real customer or employee data is permitted.** — [ARCHITECTURE.md §22.1](ARCHITECTURE.md)

Supporting commitments:

- **No real dealership data.** [ARCHITECTURE.md §6](ARCHITECTURE.md) lists real dealership data, real
  customer data, live lender integration, credit application processing, and payment calculations as
  explicit **non-goals**.
- **No real dealership exports without written authorization** — `docs/research.md` §10.2. ARPI has none
  and seeks none.
- **Every warehouse row carries `source_system = 'arpi_synthetic_generator'`**, so no query result,
  screenshot, or export can be mistaken for a real DMS extract.
- **Every committed sample dataset carries a synthetic-data notice** — `data/sample/README.md` is mandatory,
  and `generation_manifest.json` carries a `synthetic_data_notice` field.

Introducing real or restricted data would require an architecture decision record
([ARCHITECTURE.md §35](ARCHITECTURE.md)). There is no intention to write one.

---

## 3. Prohibited-field register

None of the following may be generated, stored, loaded, committed, logged, screenshotted, or published — in
any entity, any layer, any profile, or any environment.

| Field | Why prohibited | Enforcement |
|---|---|---|
| **Names** (customer or employee) | Directly identifying. A synthetic key serves every analytical purpose ARPI has. [ARCHITECTURE.md §11.2](ARCHITECTURE.md) prohibits customer names; ARPI extends this to employee names — §22.4 permits fictional names "if names are used at all", and ARPI's answer is that they are not, because fabricated names invite confusion with real staff and add nothing to any KPI. | No generator code path produces a name field. `DQ-DLR-004` schema check (Implemented for the Phase 0 dealership slice; extends to each new entity as it is built). Documented as `Prohibited` in [DATA_DICTIONARY.md §9.2](DATA_DICTIONARY.md) and §8.1. |
| **Street addresses** | Directly identifying, and combinable with other attributes to re-identify. `docs/research.md` §10.4 prescribes county or market area instead. | Geography stops at `city` for stores and `county` / `market_area` for customers. No address field exists in any declared schema. `DQ-DLR-004`. `DQ-GEN-001` schema-conformance check. |
| **Email addresses** | Directly identifying and a contact vector. Listed in [ARCHITECTURE.md §11.2](ARCHITECTURE.md) and `docs/research.md` §10.2. | No email field in any declared schema. `DQ-DLR-004`. |
| **Phone numbers** | Directly identifying and a contact vector. [ARCHITECTURE.md §11.2](ARCHITECTURE.md); `docs/research.md` §10.2. | No phone field in any declared schema. `DQ-DLR-004`. The three fictional stores deliberately have no phone numbers ([DATA_DICTIONARY.md §7.2](DATA_DICTIONARY.md)). |
| **Full birth dates** | A quasi-identifier: date of birth plus ZIP plus sex re-identifies a large share of a population. `age_band` answers every cohort question ARPI asks. | Only `age_band` is declared. Data minimization per `docs/research.md` §10.4. `DQ-GEN-001`. |
| **Social Security numbers** | Never appropriate in a portfolio dataset under any circumstance. `docs/research.md` §4.9 explicitly excludes SSNs from the F&I model. | No such field in any declared schema. Secret-scanning in CI (Planned). |
| **Driver's-license numbers** | Government identifier. `docs/research.md` §10.2. | No such field in any declared schema. |
| **Bank and card data** — account numbers, routing numbers, card numbers | Financial account data. `docs/research.md` §4.9 excludes bank-account details from the F&I model. | No such field in any declared schema. ARPI models `finance_amount` and `cash_down_payment` as amounts only — **no account, no instrument, no APR, no term, no payment**. |
| **Real VINs** | A VIN connected to a real owner, address, phone number, service record, or financing record can contribute to identifying a person (`docs/research.md` §10.3). | Only `synthetic_vin` is declared — fabricated, never decoded from a real vehicle. [ARCHITECTURE.md §16.2](ARCHITECTURE.md). Changing this requires an ADR. See section 4. |
| **Credit scores** and credit-application details | Sensitive financial data; `docs/research.md` §4.9 and §10.2 exclude real credit files, full credit applications, and personally identifiable financial data. | No credit field is declared anywhere. [ARCHITECTURE.md §22.4](ARCHITECTURE.md) permits a **broad synthetic customer tier** if a future F&I domain requires one; **`DASH.6` built the domain and deliberately did not exercise the permission**, because the domain turned out not to need it and a tier nobody needs is a tier somebody eventually reads as a credit grade. `dim_lender.program_tier` classifies the **lender's program**, never a person. `DQ-LND-007`, `DQ-FPS-016` and `DQ-FPA-013` fail the run on any credit column **even when it is empty**. |
| **Real employee compensation** | Listed in `docs/research.md` §10.2. Compensation is sensitive personnel data and adds nothing to any planned KPI. | No compensation, pay-plan, or commission field is declared in `dim_employee` ([DATA_DICTIONARY.md §8.1](DATA_DICTIONARY.md)). |
| **Insurance information**, actual deal jackets, real lender decision data | `docs/research.md` §10.2. | No such entity or field exists. **`DASH.6` models F&I products without any of them**: no insurance policy, no policyholder, no claim, no real administrator, and no lender application, approval, decline, stipulation or funding event. The `DASH.4` Deal Jacket is a governed **summary** of a synthetic transaction, not a document. |
| **Communication content** — message bodies, call recordings, transcripts, CRM notes | [ARCHITECTURE.md §22.4](ARCHITECTURE.md): *no communication content is stored*. `docs/research.md` §10.4: store response-time seconds rather than communication contents. | `fact_lead` declares `first_response_seconds` only. `fact_lead_activity` (Deferred) declares duration and delay seconds only. No text field for content exists in any declared schema. |
| **Protected characteristics** — race, ethnicity, religion, national origin, sex, gender identity, sexual orientation, disability, marital status, familial status | See section 6. Never generated, and never used for pricing, lending, or evaluation. | No such field is declared anywhere. See section 6 for the analytical prohibition, which is broader than the storage prohibition. |
| **Authentication secrets and database passwords** | `docs/research.md` §10.2. Secrets must never appear in notebooks, screenshots, or documentation ([ARCHITECTURE.md §22.2](ARCHITECTURE.md)). | Environment variables only; `.env` gitignored; `.env.example` committed with placeholder values; config redaction. See section 9. |

**This register only grows.** Adding an exception is not a permitted change
([DATA_GENERATION.md §16](DATA_GENERATION.md)).

---

## 3.1 How the register is enforced: the generalised tripwire

The register above is a policy. `src/arpi/validation/privacy.py` is the control that makes it
executable, and it applies to **every** entity rather than only to the one dimension that shipped in
Phase 0.

### 3.1.1 One rule, four call sites

The same rule is applied to a generator's declared column tuple, to a `pandas` frame before it is
written, to a CSV header row before the file is loaded, and to a list of PostgreSQL column names read
from `information_schema.columns`. All four are sequences of names, so all four go through
`assert_columns_are_privacy_safe`. A column that would be refused in pandas is refused in PostgreSQL,
because there is one implementation rather than four.

A column name is judged in six steps:

1. **Normalise** — lower-case, strip, fold `-`, `.` and spaces to `_`, collapse repeated `_`.
   `Customer-Email`, `customer.email` and `CUSTOMER__EMAIL` are all the same column to this rule; none
   of the three can slip past by changing its punctuation.
2. **Exact match** against the prohibited-field vocabulary.
3. **Substring match** against unambiguous tokens, so `customer_email`, `home_phone_number` and
   `exact_credit_score` are caught rather than only their bare forms. Exact-name matching alone was too
   weak to be a real tripwire: it accepted precisely the shapes a real DMS export uses.
4. **Whole-word match** against tokens that are unsafe as substrings but unambiguous as complete words
   — `race`, `sex`, `gender`, `note`, `notes`, `comment`, `transcript`, `recording`. Splitting on `_`
   gives reach without false positives, so `customer_notes` and `call_recording_url` fail while
   `body_style` and `county` pass.
5. **The `age` rule** — any column carrying `age` as a word is refused unless it is an explicitly banded
   spelling. `age_band` passes; `age`, `customer_age` and `age_years` do not. Banding is the
   minimisation ARPI publishes, and an exact age is a quasi-identifier.
6. **The `_name` suffix rule** — deny by default, described next.

**Coverage.** Personal names; full birth dates; street addresses; email addresses; telephone and fax
numbers; Social Security and other national identifiers; driver's licence numbers; bank account and
routing numbers; payment card data; exact credit scores and credit-report fields; compensation,
commission and pay-plan fields; protected characteristics (race, ethnicity, gender, religion, marital
status, national origin, disability, veteran status, sexual orientation, and age as an exact value); and
communication content (`message_body`, `transcript`, `recording`, `call_recording`, `note`, `notes`,
`comment`, `comments`). Sub-city geography — postal codes, latitude and longitude — is refused as well.

### 3.1.2 Deny by default, with a written justification to allow

A person's name is prohibited. A descriptive label is not. Only an explicit allowlist can tell
`salesperson_name` from `day_name`, so the rule denies every `*_name` column that is not on it. Denying
by default means a future generator that adds `customer_name` fails without anyone having to remember to
extend a blocklist first — which is the failure mode a blocklist always eventually has.

**Every allowlist entry carries a written justification, stored beside it as a string**, not as a
comment that can drift away from the value it explains:

```python
"store_name": (
    "Fictional dealership store name such as 'Granite Chevrolet of Nashua'. "
    "Names a business, never a person."
),
```

A test asserts that no entry is allowlisted without a justification. Adding one is therefore a
deliberate act that appears in a diff, with the reasoning attached to it, and a reviewer can judge the
reasoning rather than having to reconstruct it. The same structure governs the banded-age allowlist.

Currently allowlisted: `campaign_name`, `check_name`, `day_name`, `entity_name`, `holiday_name`,
`lead_source_name`, `model_name`, `month_name`, `pipeline_name`, `profile_name`, `quarter_name`,
`store_name`, `store_short_name`, `vendor_name` — every one of which names a period, a product, a
process, a business or a rule, and none of which names a person.

### 3.1.3 Fail closed

Every entry point **raises**. There is no warn-and-continue path and no bypass flag, because a privacy
control that can be overridden under time pressure is a privacy control that will be. The one function
that does not raise is the framework's recording variant, `DQ-DLR-004` and its per-entity successors,
which records a `critical` failure — the run fails, but auditably, with a row in
`audit.validation_result`.

### 3.1.4 Never persist a prohibited payload

Quarantining a bad row must not itself become the leak. `audit.rejected_record.record_payload` stores the
offending record as JSON so the defect can be reproduced, and every payload passes through
`redact_payload` first: prohibited keys keep their position, and their values become `***REDACTED***`.
The keys survive deliberately — dropping them would make two differently shaped rejections
indistinguishable, and the shape is the diagnostic.

### 3.1.5 What it does not do

**It inspects names, not values.** A column called `market_area` holding an email address passes. The
tripwire is a schema control, and the reason it is sufficient here is that ARPI's data is machine
generated from a declared contract: there is no external source that could smuggle a value in under an
innocent name. It would not be sufficient for a pipeline ingesting real data. Recorded in
[LIMITATIONS.md §7.1](LIMITATIONS.md).

### 3.1.6 Synthetic VIN policy

`dim_vehicle.synthetic_vin` is fabricated, never decoded from or matched against a real vehicle, and
carries an `ARPI` prefix that makes it structurally invalid as a real VIN. The full policy — including
why a VIN is treated as personal-data-adjacent rather than as an inert string — is section 4 below and
[ADR-0005](docs/architecture-decisions/ADR-0005-synthetic-vin-policy.md).

---

## 4. VIN policy

A VIN is a vehicle identifier rather than an inherently personal one — but `docs/research.md` §10.3 is
precise about why that distinction is not protective: *a VIN connected to a real owner, address, phone
number, service record, or financing record can contribute to identifying a person.* ARPI's vehicle
records sit alongside synthetic customers, sales, and service opportunities. Introducing a real VIN into
that structure would create exactly the linkage the prohibition exists to prevent.

**ARPI's policy:**

1. **Every VIN-like identifier in ARPI is synthetic.** `dim_vehicle.synthetic_vin` is a 17-character,
   structurally VIN-like, fabricated string generated deterministically. It is not decoded from, derived
   from, or matched against any real vehicle.
2. **A real VIN is never linked to a synthetic customer.** [ARCHITECTURE.md §16.2](ARCHITECTURE.md) states
   this directly, and it is the reason NHTSA vPIC enrichment (section 8) may populate vehicle *attributes*
   but may never populate an *identifier*.
3. **Any VIN-like identifier published in the repository must be synthetic or masked**
   ([ARCHITECTURE.md §16.2](ARCHITECTURE.md)) — including in screenshots, sample CSVs, query results, and
   the case study.
4. **No real dealership inventory export is published without authorization** (`docs/research.md` §10.3).
   ARPI publishes none.
5. **Changing the synthetic VIN policy requires an architecture decision record.**
   [ARCHITECTURE.md §35](ARCHITECTURE.md) lists *"Changing the synthetic VIN policy"* among the decisions
   that require a formal ADR. It cannot be changed by a commit, a config flag, or a convenience decision
   during implementation.

The permitted pattern, if VIN decoding is ever genuinely needed: **decode during generation, store only a
masked synthetic identifier in published data** (`docs/research.md` §10.3).

---

## 5. Employee analytics and fairness

Employee performance reporting is the part of dealership analytics with the greatest capacity to be unfair,
because it is the part where a number attaches to a person and influences their income and employment.

### 5.1 The binding prohibition

[ARCHITECTURE.md §23](ARCHITECTURE.md): the project must not **rank employees without context** such as
lead quality, store assignment, tenure, and inventory mix. And:

> **Employee scorecards must include contextual metrics rather than only raw rankings.**

### 5.2 Required contextual metrics

Every employee scorecard, table, or ranking visual in ARPI must carry these alongside any performance
figure ([ARCHITECTURE.md §23](ARCHITECTURE.md)):

| Required context | Why it changes the interpretation |
|---|---|
| **Lead volume received** | An employee handed twice the leads should sell more units. Volume without lead volume is a measure of routing, not of skill. |
| **Lead-source mix** | Sources differ materially in conversion and gross ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)). An employee fed high-intent internal leads is not outperforming one fed third-party marketplace leads. |
| **Store traffic** | Store-level traffic differs by design in ARPI. Cross-store comparison without it is comparing markets, not people. |
| **Tenure** | A first-year salesperson and a ten-year veteran are not comparable on absolute output. `dim_employee.tenure_band` exists for this. |
| **New versus used mix** | Gross structure differs sharply between departments. A used-heavy mix produces different per-unit gross for reasons unrelated to skill. |
| **Inventory availability** | An employee cannot sell what the store does not stock. |
| **Manager involvement** | Desk-manager and finance-manager participation materially affects deal outcomes; the closer is not the only contributor. |

### 5.3 Reinforcement from research

`docs/research.md` §4.6 states the constraint as a design rule: **the dashboard must not use unit volume as
the only employee ranking metric.** A high-volume employee may simultaneously show weak gross retention,
low CRM compliance, poor follow-up, high discounting, weak F&I penetration, high cancellation rates,
favourable lead routing, better inventory access, and more experienced management support.

> *"Employee analysis should provide context rather than create simplistic rankings."*
> — `docs/research.md` §4.6

`docs/research.md` §10.5 adds shift assignment and product mix to the list of factors that make an
uncontextualised scorecard misleading.

### 5.4 Practical implications for the Employee Performance page

- A single-metric leaderboard is a **design defect** in this project, not a stylistic preference.
- Any ranking visual must show at least lead volume received, lead-source mix, and tenure band on the same
  view.
- `KPI-GRS-006` (total gross per retail unit) is the correct counterweight to unit volume — **and is still
  not sufficient alone**, because it penalizes whoever is handed the harder inventory
  ([KPI_CATALOG.md §14](KPI_CATALOG.md)).
- Because ARPI's employees are synthetic, no real person can be harmed by a ranking here. The controls
  exist because the *method* is the portfolio evidence: a reviewer should see that the author knows how to
  build a scorecard that would be fair if the people were real.

---

## 6. Protected characteristics

**ARPI generates no protected characteristics, and would not use them if it had them.**

Not generated, in any entity: race, ethnicity, religion, national origin, sex, gender identity, sexual
orientation, disability, marital status, familial status, or any proxy deliberately constructed to stand in
for one.

Not used, under any circumstance ([ARCHITECTURE.md §23](ARCHITECTURE.md)):

| Prohibited use | Statement |
|---|---|
| **Pricing** | No pricing, discount, or markdown logic in ARPI may consider or approximate a protected characteristic. |
| **Lending** | ARPI models no credit decisions at all (section 7). **The F&I domain is now built (`DASH.6`) and the prohibition held**: no protected characteristic, and no proxy for one, enters product eligibility, lender assignment, reserve, pricing or attachment. There is no such attribute anywhere in the inputs, which is the strongest form the guarantee can take. |
| **Employee evaluation** | No employee measure, ranking, or scorecard may consider a protected characteristic. |

[ARCHITECTURE.md §23](ARCHITECTURE.md) also prohibits **recommending discriminatory F&I practices**. Any
F&I analysis ARPI ever produces must be framed around product value and eligibility, never around who can
be persuaded to accept what.

**On proxies.** The prohibition covers proxy variables as well as direct ones. County and market area are
retained because they are genuinely necessary for market analysis and are the *coarsest* geography that
supports it — but they must never be used as a stand-in for demography in pricing, lending, or evaluation
logic. If a future analysis produces a geographic pricing recommendation, it must be reviewed against this
section before publication.

---

## 7. F&I and lending limitations

Dealership finance and insurance is the most regulated corner of the business and the one where a portfolio
project can most easily overstep. ARPI's boundaries:

| Boundary | Statement |
|---|---|
| **No real lender data** | Every lender in ARPI is fictional. No real lender name, rate sheet, buy rate, program, stipulation, or decision record appears. `docs/research.md` §10.2 lists *real lender decision data* as prohibited. **`dim_lender` was built by `DASH.6` and contains ten invented institutions only** — `DQ-LND-002` closes the name set, and `tests/unit/test_fi_privacy.py` asserts no committed name collides with a real institution a reader would recognise. |
| **No credit decisions** | ARPI does not model, simulate, or reproduce credit decisioning. [ARCHITECTURE.md §6](ARCHITECTURE.md) lists **credit application processing** as an explicit non-goal. `docs/research.md` §4.9 excludes real credit files and full credit applications. |
| **No payment or APR advice** | ARPI models **no** APR, buy rate, sell rate, rate spread, rate markup, money factor, term, payment or loan-to-value **at all** — not at a level that could be read as guidance, and not at any other level. [ARCHITECTURE.md §6](ARCHITECTURE.md) lists **payment calculations** as a non-goal. `fact_vehicle_sale` carries `amount_financed` and `cash_down` as amounts only, and `DASH.6` added `finance_reserve_gross` on the same footing: **reserve is an amount, never a rate**, never divided by anything financed, and no spread or markup is derivable from it. |
| **No desking or menu simulation** | [ARCHITECTURE.md §9](ARCHITECTURE.md): the project is not a desking platform. **`DASH.6` records what was SOLD and nothing about what was offered** — no menu, no presentation, no order of offer, no declined offer. Menu-to-close analysis is impossible by construction, deliberately: a declined offer is a customer interaction, and modelling it would be the first step toward modelling the customer. |
| **Back-end gross is a modelled outcome, not a recommendation** | `KPI-GRS-002` and `KPI-GRS-005` describe what a fictional finance office produced. ARPI publishes no benchmark for either ([KPI_CATALOG.md](KPI_CATALOG.md)). Since `DASH.5` the `Finance` department does carry a synthetic monthly back-end gross **goal** (`KPI-GRS-002` at Department scope in `fact_sales_target`) — an invented internal plan for a fictional store, still not a benchmark and still not a recommendation. |
| **No target is a personnel measure** | `warehouse.fact_sales_target` supports an `Employee` scope physically, and `DASH.5` **generates no employee-scope row**. Nothing in the product attaches a goal to a person, ranks people against goals, or attaches compensation to attainment. The employee-performance surface belongs to `DASH.11` and inherits §5's contextual-metric obligations before it may show anything. |
| **ARPI is not a lending model** (`DASH.6`) | The F&I domain approves nothing, declines nothing, tiers nobody, recommends no lender, optimizes no rate and prices nothing. There is no application, no approval, no decline, no counter-offer, no stipulation, no adverse-action reason and no funding event. A store cannot ask this model "which lender approves more of my paper?" — that is the boundary, not a gap. |
| **The tier classifies a program, never a person** (`DASH.6`) | `dim_lender.program_tier` (`Prime` / `Near-prime` / `Subprime`) describes the kind of paper an **invented institution's program** is built around. It is **not a credit grade**, is assigned to no person, and is constant across that lender's deals. The vocabulary is closed by a `CHECK` constraint so that no value which merely *reads* like a credit grade — `A+`, `Tier 3` — can ever enter it. |
| **Lender assignment reads the deal, never the person** (`DASH.6`) | The assignment's entire input set is the selling store, the derived finance structure and seeded randomness. **No customer attribute participates and none may**: a lender chosen from anything about a person would be a credit decision wearing an analytics costume. The one store-to-store difference is a **captive franchise affinity**, which is a property of the store. |
| **Eligibility is not sales propensity** (`DASH.6`) | `config/reference/fi_product_eligibility.yaml` answers whether a product **could** have been written on a deal. It never answers whether a customer **should** buy one, or is likely to. **No demographic, protected, credit, income, age or geographic attribute influences eligibility, pricing, lender assignment, reserve or attachment** — there is no such attribute in the inputs at all. County and market area are never used as a proxy for a consumer characteristic. |
| **No F&I recommendation, benchmark or verdict** (`DASH.6`) | The twenty-two `KPI-FNI-*` definitions describe synthetic outcomes. ARPI publishes **no** benchmark for any of them and no surface may describe a penetration, a product or a chargeback rate as good, bad, average, standard, acceptable or recommended. No product is recommended by customer vulnerability, and none is recommended at all. |
| **No F&I manager is labelled** (`DASH.6`) | `finance_manager_key` exists on both F&I facts, and **no leaderboard, ranking, label or best/worst/top/bottom designation exists anywhere in the model**. A chargeback rate is not a performance judgement. Every manager-grain read is governed by a **minimum-sample floor** (`warehouse.fn_minimum_sample_floor()`, project default 10 eligible deals) sourced from one constant rather than hard-coded per view — below the floor a figure is suppressed rather than shown small. |
| **The F&I contract carries no personal data at all** (`DASH.6`) | An F&I contract is the richest source of personal data in a real dealership. ARPI's carries **no customer reference of any kind and no free-text field** — no `note`, `comment`, `reason_text` or `description` — because free text is where somebody eventually writes something about a customer. Adjustments carry no refund amount, remittance, bank detail, communication record, repossession narrative or collection activity. |

### 7.1 The FTC Safeguards Rule — context, not a compliance claim

`docs/research.md` §10.1 records that **most automobile dealers that finance or lease vehicles are treated
as financial institutions under the FTC Safeguards Rule**, and draws the conclusion that matters here:

> *"This creates a strong reason not to use actual dealership CRM, DMS, credit, or finance records. The
> portfolio should treat dealership consumer data as sensitive even when the project itself uses only
> synthetic data."*

**How ARPI uses this fact:** as a **reason for caution** in choosing to work synthetically, and as an
explanation of *why* the prohibitions in section 3 are drawn where they are.

**How ARPI does not use this fact:**

- ARPI makes **no claim to be compliant** with the Safeguards Rule, or with any other regulation.
- ARPI is **not a financial institution** and is not subject to the rule; a synthetic portfolio project has
  no covered information.
- ARPI does **not** present its controls as a compliance framework, an audit, or a model of what a
  compliant dealership program looks like.
- Nothing in this repository is legal advice, and nothing here should be relied on for a compliance
  assessment.

The honest statement is: *the existence of the Safeguards Rule is one of several reasons this project uses
synthetic data.* Nothing stronger.

---

## 8. Public data and licensing boundaries

| Rule | Source |
|---|---|
| Raw public data is stored **separately** from synthetic dealership data — `data/external/` | [ARCHITECTURE.md §16.2](ARCHITECTURE.md) |
| **Source and license information must be documented** before use | [ARCHITECTURE.md §16.2](ARCHITECTURE.md) |
| **Redistribution rights must be verified before committing raw data** | [ARCHITECTURE.md §16.2](ARCHITECTURE.md) |
| A missing or ambiguous license is a **blocker for redistribution** | `docs/research.md` §5.6 |
| Kaggle hosting **does not** establish reuse rights | `docs/research.md` §5.6 |
| NHTSA vPIC may enrich vehicle **attributes** only, never supply the transaction dataset | `docs/research.md` §5.3; [ARCHITECTURE.md §16.1](ARCHITECTURE.md) |
| External market context stays **analytically separate** from dealership transactions — different grain, different provenance | [ARCHITECTURE.md §16.3](ARCHITECTURE.md) |

Both enrichment feature flags — `features.enable_public_vehicle_enrichment` and
`features.enable_external_market_context` — are **`false`** in every profile today. **ARPI performs no
network access during generation.**

---

## 9. Secret handling

| Control | Rule |
|---|---|
| **Environment variables only** | Database credentials are read from the environment, never from a file in the repository ([ARCHITECTURE.md §22.2](ARCHITECTURE.md)). On the Railway deployment this is stronger than a convention: every cross-service value is a Railway **reference variable** the platform resolves at deploy time rather than a copied value, and both role passwords are **generated server-side by Railway**, so they never exist in this repository, in a process argument, in a log, or in GitHub. The website is granted no database reference at all. See [`deployment/railway/README.md`](deployment/railway/README.md) section 5. |
| **`ARPI_DATABASE__PASSWORD` never appears in YAML** | `database.password` is absent from `config/development.yaml`, `config/test.yaml`, and `config/portfolio.yaml`. The value is read only from `ARPI_DATABASE__PASSWORD`, with `PGPASSWORD` as a fallback. |
| **`.env` is gitignored** | A local `.env` file may hold the password on a developer machine; it is never committed. |
| **`.env.example` is committed** | Placeholder values only, so a new contributor knows which variables exist without ever seeing a real one ([ARCHITECTURE.md §22.2](ARCHITECTURE.md)). |
| **Log redaction** | Configuration `__repr__`, `__str__`, and every log emission redact the password as `***REDACTED***`. A secret that reaches a log file has left the environment. |
| **No secrets in notebooks, screenshots, or documentation** | [ARCHITECTURE.md §22.2](ARCHITECTURE.md). Applies to the case study and walkthrough video as well as the repository. |
| **TLS for remote database connections** | [ARCHITECTURE.md §22.2](ARCHITECTURE.md). The `database.sslmode` setting is configurable; remote connections must not use `disable`. |
| **Least-privilege database roles** | `arpi_admin` owns objects and administers schema only; `arpi_loader` writes raw, staging, warehouse, and audit but cannot administer security; `arpi_reporter` is read-only on approved reporting views and is the role Power BI and Excel use ([ARCHITECTURE.md §22.3](ARCHITECTURE.md)). **Database schemas must prevent Power BI from accessing raw tables** (§22.2). |
| **Vulnerability reporting** | See `SECURITY.md` in the repository root for the security policy and disclosure process. |

Repository hygiene is also a privacy control: [ARCHITECTURE.md §27](ARCHITECTURE.md) Phase 8 exit criteria
require that **no secrets or real personal data are present**, and §33 Definition of Done item 12 requires
that the public repository contain **no secrets or real PII**.

---

## 10. Data minimization

ARPI stores only what an analysis actually needs. `docs/research.md` §10.4 gives the pattern, and ARPI
follows it exactly:

| Question ARPI needs to answer | What it stores | What it does **not** store |
|---|---|---|
| Which age cohorts buy which vehicles? | `age_band` | Full birth date |
| Which markets do customers come from? | `county`, `market_area` | Street address |
| Which customer is this? | `customer_id` | Name |
| How fast did we respond? | `first_response_seconds` | Message content, recordings, transcripts |
| Does the household repeat-purchase? | `household_key` — **only** because repeat-purchase analysis requires it | Household composition, relationships, dependants |
| What could this customer qualify for? | **Nothing, permanently.** The F&I domain was built by `DASH.6` and generated no customer tier: ARPI answers no qualification question about any person. | Credit score, credit file, application, tier, income, debt-to-income |
| Which product could have been written on this deal? | The governed `eligibility_rule_id`, plus the published numerator and denominator on every penetration row | Full lender stipulations; any customer attribute; anything about whether the customer *should* buy it |
| Where is this store? | `city`, `state_code`, `market_region` | Street address, phone, email |
| Who sold it? | `employee_id`, `job_role`, `tenure_band` | Name, compensation, pay plan, contact details |

The general rule: **if a coarser representation answers the question, the coarser representation is what
gets stored.** Every one of these choices is a schema decision, not a runtime filter, so the finer data is
never present to be leaked.

---

## 11. Ethical analytics commitments

### 11.1 Correlation is not causation

[ARCHITECTURE.md §23](ARCHITECTURE.md) prohibits claiming causal relationships based only on correlation.

This bites hardest in exactly the places ARPI is most interesting. Some worked examples:

| Observation the data will support | Causal claim ARPI must **not** make |
|---|---|
| Leads answered faster show higher contact rates | "Responding faster causes more sales." The generator encodes response time as an *influence* on contact probability ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)), and in the real world high-intent customers are also easier to reach — the direction is not identified. |
| Aged units carry lower front gross | "Aging causes gross loss." Units that age may have been mispriced or poorly selected at acquisition; the causality could run the other way (`docs/research.md` §4.3 asks whether aged vehicles were *priced incorrectly from day one*). |
| One salesperson shows higher gross per unit | "That person is better." Lead routing, inventory access, mix, and manager involvement all contribute — section 5. |
| A source shows strong lead-to-sale conversion | "Spending more there will produce proportionally more sales." Channel returns are rarely linear and attribution in ARPI is first-touch only. |

**And an additional constraint that is specific to synthetic data:** any relationship visible in ARPI's
output is there because the generator was told to put it there. A correlation in ARPI is evidence that the
generator works, not evidence about the automotive retail industry. Findings must be framed as *"in this
synthetic dataset…"*, never as *"in dealerships…"*.

### 11.2 Never present synthetic results as real performance

[ARCHITECTURE.md §23](ARCHITECTURE.md) prohibits presenting synthetic results as real dealership
performance. `docs/research.md` §5.2 item 5: **avoid representing synthetic results as real dealership
benchmarks.**

Concretely:

- No figure produced by ARPI is a dealership benchmark or an industry average.
- **ARPI does produce target figures, and they are not benchmarks.** Since `DASH.5`,
  `warehouse.fact_sales_target` carries monthly operating goals and the console renders them. Every one is
  a **synthetic internal operating goal for the fictional Granite Auto Group**: not an industry average,
  not a manufacturer objective, not a market standard, not any real dealership's plan, and never a
  recommendation. No surface may call a target value *good*, *average*, *standard* or *recommended*, and no
  ARPI figure may be described as above or below one as though that carried external meaning. Each
  target-bearing surface carries the disclosure in plain sight
  ([DATA_DICTIONARY.md §41](DATA_DICTIONARY.md), [LIMITATIONS.md §4.5.1](LIMITATIONS.md)).
- No ARPI figure may be compared to a real dealership's figure as though the comparison were meaningful.
- The Granite Auto Group is fictional and is **never renamed** to anything resembling a real group.
- Resume, LinkedIn, and case-study materials must describe the work accurately
  ([ARCHITECTURE.md §33](ARCHITECTURE.md) item 14) — as an analytics project on synthetic data.

### 11.3 Never conceal generation assumptions

[ARCHITECTURE.md §23](ARCHITECTURE.md) prohibits concealing data-generation assumptions.
[DATA_GENERATION.md](DATA_GENERATION.md) is the disclosure: seeds, profiles, date ranges, distributions,
required relationships, prohibited patterns, and reproducibility guarantees are all published, and the
generated distributions are logged at generation time ([ARCHITECTURE.md §15.1](ARCHITECTURE.md) rule 7).

A reviewer can regenerate the dataset and verify the digests themselves
([DATA_GENERATION.md §10.4](DATA_GENERATION.md)).

### 11.4 Service-to-sales is decision support, not prediction

`docs/research.md` §4.13: service-to-sales opportunity logic must be presented as **decision support, not
as a guarantee of customer purchase intent.** The domain is Deferred; the constraint is recorded now so it
is not forgotten when the domain is built.

---

## 12. Public portfolio exposure

### 12.1 What a reader sees

- This repository: documentation, SQL, Python, configuration, tests, and CI.
- `data/sample/` — a capped sample of synthetic CSV output plus its manifest and synthetic-data notice.
- Eventually: Power BI screenshots, a model diagram, a DAX measure catalogue, a walkthrough video, an
  Excel operating report, and an executive findings memo — **all built on synthetic data, all labelled as
  such**.
- A static case study, if built ([ARCHITECTURE.md §26.3](ARCHITECTURE.md)), containing the business
  problem, architecture diagram, selected screenshots, key findings, technology stack, **data limitations**,
  and links.

### 12.2 What is never published

| Never published | Reason |
|---|---|
| Any real customer, employee, or dealership record | Section 2 |
| Any real VIN | Section 4 |
| Any credential, connection string, or secret | Section 9 |
| Any full generated portfolio dataset | `data/raw/` is gitignored; regeneration is by seed ([DATA_GENERATION.md §11.2](DATA_GENERATION.md)) |
| Any claim that a result is a real dealership benchmark | Section 11.2 |
| Any screenshot containing a secret or a real identifier | [ARCHITECTURE.md §22.2](ARCHITECTURE.md) |

[ARCHITECTURE.md §22.2](ARCHITECTURE.md) additionally requires that **public case-study pages expose only
aggregates and screenshots** — not live data access, and not a queryable interface.

### 12.3 What conclusions a reader may legitimately draw

They may conclude things about **the author's method**: dimensional modelling, KPI governance, data-quality
engineering, SQL, Python, reproducibility discipline, and executive communication.

They may **not** conclude anything about **the automotive retail industry**. Every number in ARPI describes
a fictional business built from a random seed. See [LIMITATIONS.md](LIMITATIONS.md).

### 12.4 The public website

A portfolio website exists under [`portfolio/`](portfolio/), governed by
[ADR-0009](docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md). It is a rendering
of this repository's own documentation, and it is bound by everything in §12.2. Four properties are worth
stating explicitly, because they are what make a public site safe to publish at all.

| Property | What it means |
|---|---|
| **No record-level data, and no KPI value** | The site displays no row from any table and no figure produced by any measure — not a real one, not an illustrative one, not a placeholder. It presents KPI **definitions** and says so. Every number it does show is a count of repository artefacts, resolved at build time from source-controlled files |
| **The synthetic-data statement is in the body of every primary route** | Not in the footer only. It appears above the fold and in each page header as well as in the footer, and an end-to-end test asserts its presence route by route. A reader who does not scroll still sees it |
| **No third-party request, no cookie, no analytics, no tracker** | The site sets no cookie, loads nothing from a third-party origin, and runs no analytics, telemetry, session-recording, advertising or fingerprinting script. There is nothing to consent to because nothing is collected |
| **Nothing is collected from a visitor** | There is no contact form, no newsletter capture, no comment field, no upload, and no account. The site has no API route, no database connection and no query interface, so a visitor cannot submit data to it even in principle |

The consequence is that the website processes **no personal data of any kind**, including the visitor's own.
That is a design choice, not an accident of the current build: the routes are statically rendered, and the
absence of a server surface is what §26.3 of the architecture means when it says the case study must not
become a second analytics application.

---

## 13. Enforcement in code

The controls below are stated honestly. Several are Planned, and saying so is the point: a privacy policy
whose enforcement status is overstated is worse than one with acknowledged gaps.

| # | Policy | Concrete control | Status |
|---:|---|---|---|
| 1 | No prohibited PII column in the dealership dimension | `DQ-DLR-004` — schema inspection, `critical` severity, fails the run | **Implemented** (Phase 0 slice) |
| 2 | Generated output matches its declared schema, so a column cannot appear unannounced | `DQ-GEN-001` — schema conformance, `critical` | **Implemented** |
| 3 | Output is reproducible and therefore auditable | `DQ-GEN-002` — determinism digest recorded, severity **`info`**: it publishes the digest for a reviewer to recompute, it does **not** gate the run. The enforcing controls are the seeded generators, the timestamp-free `generation_manifest.json` with its `content_digest` per entity, and the determinism tests | **Implemented** (as evidence, not as a gate) |
| 4 | Every validation outcome is recorded and publishable | `audit.validation_result` + `reporting.vw_data_quality_summary` | **Implemented** |
| 5 | Rejected records are quarantined, not silently dropped | `audit.rejected_record`; `validation.max_rejected_record_ratio = 0.0` | **Implemented** |
| 6 | Every run is traceable to a seed and profile | `audit.pipeline_run.random_seed`, `profile_name`, `arpi_version` | **Implemented** |
| 7 | No real data can enter through generation | No network access in the generator; both enrichment feature flags `false` in all three profiles | **Implemented** |
| 8 | Synthetic provenance is visible on every row | `source_system = 'arpi_synthetic_generator'` in `dim_dealership` | **Implemented** |
| 9 | Store data contains no contact details or street address | Reference data declares `city` / `state_code` / `market_region` only ([DATA_DICTIONARY.md §7.2](DATA_DICTIONARY.md)) | **Implemented** |
| 10 | Database password never in YAML | `database.password` key absent from all three config files; read only from `ARPI_DATABASE__PASSWORD` / `PGPASSWORD` | **Implemented** (configuration workstream) |
| 11 | Password never logged | Config `__repr__` / `__str__` / logging redact as `***REDACTED***` | **Implemented** (configuration workstream) |
| 12 | `.env` never committed; `.env.example` committed with placeholders | `.gitignore` ignores `.env` and `.env.*`, with an explicit `!.env.example` negation so the template stays tracked; `.pgpass`, `secrets.yaml`, and `secrets.yml` are also ignored | **Implemented** (repository-tooling workstream) |
| 13 | `data/raw/` and `data/external/` never committed; `data/sample/` deliberately is | `.gitignore` rules `data/raw/**` and `data/external/**` with `.gitkeep` negations; `data/sample/` is explicitly excluded from the ignore file by design | **Implemented** (repository-tooling workstream) |
| 14 | Power BI cannot read raw tables | Role grants: `arpi_reporter` has `SELECT` on `reporting` only | **Implemented** (database workstream) |
| 15 | Least-privilege separation between admin, loader, and reporter | `arpi_admin` / `arpi_loader` / `arpi_reporter` roles and grants | **Implemented** (database workstream) |
| 16 | Sample data is labelled synthetic | Mandatory `data/sample/README.md`; `synthetic_data_notice` in the manifest | **Implemented** |
| 17 | Documentation links stay valid, so policy references cannot silently rot | `python scripts/check_docs_links.py` in CI | **Implemented** (tooling workstream) |
| 18 | Naming conventions enforced, so a prohibited-looking column name is caught | `python scripts/check_naming.py` in CI | **Implemented** (tooling workstream) |
| 19 | `DQ-*` PII schema checks extended to **every** new entity as it is built | New per-entity checks in `src/arpi/validation/` and `sql/08_validation/` | **Planned** (Phase 1.1 onward) |
| 20 | Employee dimension carries no name or compensation field | Schema declaration + a per-entity prohibited-column check | **Planned** (Phase 1.1) |
| 21 | Customer dimension carries no prohibited field | Schema declaration + a per-entity prohibited-column check | **Planned** (Phase 1.2) |
| 22 | No real VIN can enter the vehicle dimension | Synthetic VIN generator + a format/provenance validation check | **Planned** (Phase 1.1) |
| 23 | Employee scorecards always carry the required contextual metrics | Reporting-view design + a Power BI model review checkpoint | **Planned** (Phase 1.5 Power BI readiness review) |
| 24 | Automated secret scanning in CI | `python scripts/check_secrets.py` runs in the CI workflow and inspects the git index for high-signal credential patterns. **The script describes itself as a safety net, not a replacement for a dedicated scanner** — that caveat is repeated here rather than glossed over. | **Implemented** (tooling workstream) |
| 25 | No protected characteristic can be introduced | `src/arpi/validation/privacy.py` refuses any column naming race, ethnicity, gender, sex, religion, marital status, national origin, disability, veteran status, sexual orientation, citizenship or an exact age. Parametrised tests assert each one. **A schema control, not a values control** — see 3.1.5 | **Implemented** |
| 26 | Enrichment stays within approved boundaries when the flags are turned on | License documentation requirement + a `data/external/` provenance record | **Planned** |
| 27 | The prohibited-field register is enforced against **any** schema, not only `dim_dealership` | `src/arpi/validation/privacy.py`: `assert_columns_are_privacy_safe` / `assert_frame_is_privacy_safe` / `assert_csv_header_is_privacy_safe`, deny-by-default `_name` rule with a justification-bearing allowlist, fail-closed. See section 3.1 | **Implemented** |
| 28 | A quarantined bad row cannot itself leak | `redact_payload` masks prohibited keys' values with `***REDACTED***` before anything reaches `audit.rejected_record.record_payload`. See 3.1.4 | **Implemented** (the redaction function; the rejected-record write path that calls it is **Planned**, Phase 1.2) |

> **Honest gap note.** Control 26 is currently **documentation-only**.
>
> Controls 25, 27 and 28 became code during Phase 1: the tripwire that was specific to `dim_dealership`
> is now a general, entity-agnostic control any layer can call, and it covers protected characteristics
> and communication content, which nothing checked before. Two limits are worth stating plainly rather
> than leaving a reader to infer them. First, it inspects **column names, not values** (3.1.5). Second,
> control 19 — a per-entity `DQ-*` check registered for each new entity — is still **Planned**: the
> mechanism exists and is tested, but each Phase 1 entity must call it, and until an entity does, its
> schema is covered only by whichever caller runs. Both are recorded in
> [docs/requirements/PHASE_1_BACKLOG.md](docs/requirements/PHASE_1_BACKLOG.md) and
> [docs/requirements/DOCUMENTATION_BACKLOG.md](docs/requirements/DOCUMENTATION_BACKLOG.md).

---

## 14. Limits of conclusions drawn from synthetic data

This section exists because it is the most likely thing for a reader to get wrong.

1. **ARPI's numbers describe a random draw, not an industry.** Change the seed and every figure changes.
   A finding that does not survive a seed change is an artefact.
2. **Relationships are in the data because they were put there.** [ARCHITECTURE.md §15.3](ARCHITECTURE.md)
   lists sixteen relationships the generator must encode. Discovering one of them in the dashboard
   validates the generator, not the industry.
3. **The absence of a relationship means nothing.** ARPI did not model floor-plan cost, personnel expense,
   manufacturer incentives, or facility overhead. Their absence is a scope decision, not evidence.
4. **No benchmark comparison is possible anywhere in this project.** ARPI has no real dealership
   performance data, so it cannot say whether any figure is good. The 60-day aged-inventory threshold and
   the 30-day days-supply window are **project defaults from [ARCHITECTURE.md §18.2](ARCHITECTURE.md)**,
   not standards.
5. **Distributions are plausible, not validated.** Nothing in ARPI has been checked against a real
   dealership distribution, because no such data is available to the project. `docs/research.md` §5.4
   suggests NADA aggregates for *contextual plausibility checks and industry framing* only — and even that
   is aggregate data at a different grain.
6. **Data-quality results prove the pipeline, not the world.** A clean validation run means the generator
   and loader agree. It says nothing about whether the modelled business is realistic.
7. **`docs/research.md` is a point-in-time market review**, not a live source. See
   [LIMITATIONS.md](LIMITATIONS.md).

The one thing ARPI's output *does* legitimately demonstrate is **method**: that the author can define a
grain, govern a KPI, build a reproducible pipeline, validate it, reconcile it, and explain its limits.
That is what a reviewer should take from it.

---

## 15. Change control

- Adding a field to the prohibited register: allowed at any time.
- **Removing** a field from the prohibited register: **not permitted.**
- Changing the synthetic VIN policy: **requires an ADR** ([ARCHITECTURE.md §35](ARCHITECTURE.md)).
- Using real or restricted data: **requires an ADR** ([ARCHITECTURE.md §35](ARCHITECTURE.md)).
- Enabling `enable_public_vehicle_enrichment` or `enable_external_market_context`: requires the license and
  provenance documentation in section 8 to be completed first.
- Any change to this document must keep section 13's status column honest. Marking a Planned control as
  Implemented without the control existing is the single worst failure mode available to this document.

---

## 17. The governed dashboard export lane (ADR-0013)

A second public data lane, and the first one whose source is the warehouse. Its privacy posture is
built from two controls in a deliberate order, and one honest gap.

### 17.1 The allowlist is the primary control

A field reaches `data/dashboard/` only by being declared in
[`src/arpi/dashboard/contract.py`](src/arpi/dashboard/contract.py), with a type, a nullability, a
unit and a privacy classification. `non-personal` is the only class eligible for export, and a column
declared anything else aborts the export. There is no discovery step and no `SELECT *`: a column
nobody reviewed cannot appear.

### 17.2 The prohibited-name tripwire is the second

`arpi.validation.privacy` — the same rule §3.1 describes, with the same vocabulary — runs over every
exported header. It is the belt and braces behind the allowlist, and it is what catches an allowlist
somebody extended carelessly. Twenty-one prohibited spellings are asserted refused, covering name,
address, email, phone, birth date, age, SSN, driver's licence, bank and payment-card details, credit
score, free-form notes and communication content.

It found something real: `vw_pipeline_run_summary.notes` is a free-text column, and the tripwire
refuses it. It is excluded from the export rather than exempted, because a free-form field in a
public artifact is where an unreviewed sentence eventually appears.

### 17.3 No dataset is at customer grain

There is no customer dataset, banded or otherwise. Customers appear only as pre-aggregated counts
inside the funnel views — `leads_received`, `contacted_leads`, `sold_leads`. `reporting.vw_customer`
is not in the allowlist and a test asserts no exported column name contains "customer".

Employees do not appear at all in this increment: no `DASH.1` dataset needs them, so none is
exported. `vw_employee` becomes exportable at `DASH.11`, limited to synthetic id, role, store and
active window, subject to the §5 minimum-sample rule.

### 17.4 The gap, stated: names not values

§10 already records that the tripwire inspects names rather than values. Because this lane is public,
three further controls sit behind it:

1. **Both stages scan their own produced bytes** for an email address, a URL, a VIN-shaped
   seventeen-character token, connection detail and any reference to `raw`, `staging`, `warehouse` or
   `audit`, and refuse to write on a hit. That control is not decorative — it is what found the three
   columns of `vw_reconciliation_status` that embed internal object paths in their text, now
   excluded.
2. **No dataset declares a vehicle identifier of any spelling.** The tripwire deliberately permits
   `vin` as a name, because ARPI's VINs are synthetic by §4's policy and legitimate on the ADR-0011
   listing lane. Here the protection is structural instead: there is no field for one to arrive in.
3. **No free-text column is exported anywhere in the lane** (§17.2).

### 17.5 No credential, no host, no connection

The exporter runs as `arpi_reporter` and records that fact; it records nothing about the machine it
ran on. No credential, hostname, port, database name, username, connection string, internal Railway
service detail or absolute local path appears in any artifact, asserted over the produced bytes in
both stages and again over the committed files by the portfolio boundary suite. The portfolio package
declares no database dependency at all, so a runtime connection is impossible rather than merely
absent.

### 17.5a Deal grain, and why it does not change the posture (`DASH.3`, `DASH.4`)

`DASH.3` and `DASH.4` added the project's first **deal-grain** exports: one row per finalized
transaction, 650 of them, and the Deal Jacket renders more of a single transaction than anything
else in the project. That is the moment a privacy posture is worth re-examining rather than
restating, so it was.

**Nothing changed, and the reason it did not is structural.** A deal row is a row about a
TRANSACTION, not about a person. The two datasets carry the vehicle, the money, the dates, the staff
roles as synthetic identifiers and the lead's paper trail as flags — and no customer key, no customer
attribute, and no join to `vw_customer`, which is not in the allowlist and never has been. There is
no field for a person to arrive in.

Four things were tightened because deal grain makes them testable in a way aggregate grain did not:

1. **Column names are asserted against a prohibited register at the view.** The integration suites
   check both deal views for forty-odd spellings — customer, name, email, phone, address, birth date,
   SSN, credit score, bank and card details, lender, APR, rate, term, payment, notes, message — and
   for the surrogate `sale_key`, which would leak load order.
2. **Only two `*_name` columns are permitted,** `model_name` and `lead_source_name`, and both name a
   THING rather than a person. The allowlist is asserted, so a third has to be argued for.
3. **Every staff code is asserted to match the synthetic `EMP-` shape, on values rather than on
   column names.** A human name reaching a public lane through a differently-named column is exactly
   the failure a name scan cannot see.
4. **The console runs a value-level scan of its own.** Every string in all 650 rendered jackets is
   checked against the shapes of an email address, a telephone number, an SSN, a payment card and a
   street address. §10's stated gap — that the tripwire inspects names rather than values — is
   narrower on this lane than anywhere else in the project as a result.

**The Deal Jacket publishes no rate mechanics of any kind.** §7 places lender, APR, term, payment,
buy rate, sell rate and rate spread outside what this project publishes, and the page names each as
not modelled rather than omitting it silently, so a reader can see the boundary rather than assume
an oversight. `finance_structure` is derived from `sale_type` and `amount_financed` alone, and the
derivation is published beside the label.

**The odometer stays banded and the VIN stays synthetic** on the one page that shows a specific
vehicle in detail, both asserted at the view and again at the page.

### 17.6 The lane makes no claim it cannot support

Every artifact states in its own manifest that the data is synthetic, that the dealer group is
fictional, and what the export cannot support — including that Power BI real-engine validation
remains pending and that nothing here may be cited toward Gate 2. The client-safe manifest carries no
Power BI field at all, so there is exactly one place in the repository a "validated" claim could ever
be written, and it is the evidence files.

---

## 16. Sanitized public reference data (ADR-0011)

This section is the exception to section 2, and it is written to be read alongside it
rather than instead of it.

**ARPI's standing policy is that every row is machine generated.** One lane is not:
`data/reference/` holds de-identified public dealership listing snapshots. Its correct
classification is **sanitized public reference data**. The dealer and vehicle identifiers
are synthetic; the listing attributes — condition, model year, make, model, trim,
advertised odometer, advertised price, pricing status — are retained from a public source.

Calling this lane "fully synthetic" is a governance failure, not a wording preference, and
`scripts/check_reference_data.py` fails CI if a document does.

### 16.1 What is removed, and why removal is one-way

| Removed | Replaced with |
|---|---|
| Original VIN | A deterministic, group-stable `ARPI`-prefixed synthetic VIN and vehicle identifier |
| Row-level source URL | A neutral feed label naming the lane, never the origin |
| External dealer identity | A fictional Granite Auto Group store, resolved from the ARPI registry |
| Street address | Nothing. Geography stops at store name and market region |

The identity function is a SHA-256 over a group namespace. **No reverse mapping is
produced, committed, or committable.** A reversible de-identification is not a
de-identification; it is a lock whose key is in the same repository. The cost is that a
committed row cannot be traced back to a source listing and therefore cannot be
re-verified against one. That cost is accepted deliberately.

### 16.2 What this lane may never contain

No customer or employee data, in any form, banded or otherwise. No confidential DMS, CRM,
F&I, service, lender or transaction data. No cost, gross, acquisition or floor-plan
figure. No street address. No credential. No data that required authentication, payment
or any technical circumvention to obtain — **if access required getting around a control,
the source is out of scope, and there is no version of this lane that involves doing so.**

### 16.3 What it may never be presented as

Not synthetic. Not current business performance. Not confidential dealer data, DMS
inventory, completed sales, transaction data or inventory ownership. It cannot generate
analytical findings about the real source dealer — the source is unnamed by design, and a
finding about an unnamed party is either meaningless or a re-identification attempt.

### 16.4 Removal on request

A removal request is honoured by deleting the committed artifact, its declaration, and the
loaded rows from any deployed database. There is no review period and no requirement that
the requester explain themselves. The procedure is in
[`data/reference/README.md`](data/reference/README.md) section 8. Nothing in this project
is worth keeping over an objection.
