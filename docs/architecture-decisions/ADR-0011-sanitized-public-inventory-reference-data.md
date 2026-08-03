# ADR-0011: Sanitized public inventory reference data

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Michael Palmer
- **Supersedes:** nothing
- **Superseded by:** nothing
- **Related:** [ADR-0005](ADR-0005-synthetic-vin-policy.md) (synthetic VIN policy),
  [ADR-0004](ADR-0004-validation-category-taxonomy.md) (validation categories),
  [ADR-0006](ADR-0006-scd-type-selection-phase-1.md) (history treatment),
  [ADR-0009](ADR-0009-portfolio-ui-foundation-before-gate-2.md) (what the portfolio may claim)

---

## 1. Context

ARPI has had exactly one data policy since Phase 0: **every row is machine generated**.
`PRIVACY_AND_ETHICS.md` states it, `data/sample/README.md` restates it, and
`arpi.validation.privacy` enforces the part of it that can be enforced by a machine. The
policy has been easy to keep because nothing has ever arrived from outside.

Two things now push against it.

**The platform cannot demonstrate ingestion it has never performed.** Every warehouse row
in ARPI was produced by a generator that ARPI also wrote. That is a legitimate way to
build a data platform and a weak way to demonstrate one: sanitization, source-contract
validation, rejection handling and lineage are the parts of the job a dealership actually
pays for, and a generator that emits clean rows by construction exercises none of them.

**A real listing snapshot is available and is not confidential.** Vehicle inventory
listings are published, deliberately, by every franchise dealership in the country. They
are marketing. They contain no customer, no employee, no transaction and no cost.

There is also a second controlled lane already in the repository that nobody has had to
name: `config/reference/vehicle_model_catalogue.yaml` is general public reference data
about vehicles, and it is not synthetic either. It has been treated as an unremarkable
constant because it is one. A dealership listing snapshot is not unremarkable, and
treating it as if it were is how a synthetic-only promise gets quietly abandoned.

## 2. Decision

**ARPI recognises three controlled data lanes.** They are named, they are separated by
directory, and each carries its own permissions and its own controls.

| # | Lane | Where it lives | Example | May it describe a real business? |
|---|---|---|---|---|
| 1 | **Fully synthetic operational data** | `data/sample/`, `data/raw/` | `sale_event.csv` | No. Nothing in it corresponds to anything real. |
| 2 | **Approved general public reference data** | `config/reference/` | vehicle model catalogue, NHTSA-style lookups | It describes products, never a business. |
| 3 | **Sanitized public dealership listing reference data** | `data/reference/` | `ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx` | Its **attributes** derive from a real public listing snapshot. Its **identity** does not: the source dealer is never named. |

Lane 3 is new and is what this ADR governs. It is narrow, explicit and machine checked.

### 2.1 What lane 3 permits

- Public dealership listing data, **only when it was publicly accessible** without
  authentication, payment or circumvention.
- Retention of the **listing attributes**: condition, model year, make, model, trim,
  advertised odometer, advertised price and pricing status.
- Use of that data to demonstrate **ingestion, sanitization, validation, warehouse
  modelling, reconciliation and reporting workflows**.

### 2.2 What lane 3 forbids

- **No authentication bypass, no scraping circumvention, no rate-limit evasion, and no
  restricted data.** If access required a credential, a paywall or a technical
  workaround, the source is out of scope. There is no version of this lane that involves
  getting around a control.
- **Original dealer identity is removed** from every committed artifact. The source
  dealership is not named, not abbreviated, not hinted at and not inferable from a URL, a
  stock number or an address.
- **Original VINs are removed.** They are replaced by deterministic ARPI-prefixed
  synthetic identifiers, and no reverse mapping is produced, committed or committable.
- **Row-level source URLs are removed** and replaced by a neutral feed label naming the
  lane rather than the origin.
- **No customer or employee data**, ever. Not de-identified, not aggregated, not banded.
- **No confidential DMS, CRM, F&I, service, lender or transaction data**, ever. Cost,
  gross, acquisition, floor plan and days in stock are not in this lane and cannot be
  put in it.
- **No street address.** Geography stops at store name and market region, which is the
  existing rule for every ARPI store.

### 2.3 What lane 3 requires

- Sanitized reference data **lives outside `data/sample`**, which remains reserved for
  fully machine-generated data. `scripts/check_reference_data.py` fails CI if a workbook
  appears there.
- Every artifact **carries explicit provenance and classification** on its own README
  sheet and on every data row. The only approved classification value is
  `Sanitized public reference data`. An artifact with no classification, or with a
  different one, is refused by the validator and by CI.
- Every artifact is **declared in `config/reference/inventory_listing_contract.yaml`**
  with its path, its row count and the SHA-256 of its bytes. An undeclared workbook and a
  silently replaced one both fail CI.
- Every future source **passes the same sanitization and review controls**. Adding a new
  source *type* -- something other than a vehicle listing snapshot -- requires review of
  this ADR and of `data/reference/README.md` before any artifact is committed.

### 2.4 What lane 3 may never be presented as

- **It cannot be presented as synthetic.** It is not. Saying so would be the single most
  damaging misstatement available about this project, because the synthetic-only promise
  is what makes every other claim credible.
- **It cannot be presented as current business performance.** A capture describes what was
  advertised at a moment that has already passed.
- **It cannot generate analytical findings about the real source dealer.** The source is
  unnamed by design; a finding about an unnamed party is either meaningless or a
  re-identification attempt.
- **It cannot be described as confidential dealer data, DMS inventory, completed sales,
  transaction data, or inventory ownership.** It is none of those.

### 2.5 Semantic boundaries that are enforced, not merely stated

These six statements are enforced in SQL comments, in view definitions, in the workbook
contract and in `scripts/check_reference_data.py`, which fails CI when documentation
contradicts one of them:

1. Advertised price is **not** transaction price.
2. Advertised price is **not** acquisition cost or inventory investment.
3. A listing that disappears was **removed from listing**, which is not *sold*.
4. Days observed online is **not** days in stock.
5. A listing does **not** prove the vehicle was physically present or owned.
6. A public reference snapshot does **not** establish current performance.

`reporting.vw_vehicle_listing_change` is the structural expression of rule 3: it emits six
labels and none of them is *Sold*, so a report built on it cannot claim a sale even by
accident.

### 2.6 Removal and retention

A removal request is honoured by **deleting the committed reference artifact** and its
declaration, and by removing the loaded rows from any deployed database through the
procedure in `data/reference/README.md` section 8. There is no negotiation step, no
review period and no requirement that the requester explain themselves. The artifact is a
demonstration asset; nothing in this project is worth keeping over an objection.

### 2.7 File naming

Canonical reference artifact filenames use the approved ARPI underscore convention:

```
ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx
```

Underscores separate filename words. Hyphens appear **only** inside the ISO date. The
canonical Granite Chevrolet artifact is:

```
data/reference/inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx
```

That spelling is final for that artifact. It is not renamed, not lowercased, not
hyphenated, and no duplicate, alias, symlink or copy of it exists anywhere in the
repository.

**A filename change requires an explicit migration, not an informal rename.** The name is
recorded in the contract, stamped onto every warehouse row as `source_file_name`, and
enforced by CI. Changing it means changing all three deliberately and saying why.

## 3. Alternatives considered

**Refuse the source entirely and stay synthetic-only.** The cleanest policy, and the one
this project would have kept if the demonstration cost were zero. It is not: the
sanitization, source-contract validation and rejection-handling work is exactly what a
synthetic generator cannot exercise, and a portfolio that never ingests anything it did
not create leaves the most valuable half of data engineering undemonstrated. Rejected,
but narrowly -- lane 3 is deliberately the smallest exception that buys that demonstration.

**Generate a synthetic listing snapshot instead.** Considered seriously. It would have
kept the policy intact and produced a workbook that looks identical. It was rejected
because a generator that produces its own input proves nothing about handling somebody
else's: every real defect this lane exists to demonstrate -- an unparseable price, a
missing trim, a duplicated identifier, a condition value nobody anticipated -- is a defect
the generator would have to be told to produce.

**Treat the workbook as ordinary public reference data and put it in
`config/reference/`.** Rejected. The vehicle model catalogue describes *products*; this
describes *a business's activity*. Filing them together would mean the controls that
matter for the second -- de-identification, removal on request, a classification on every
row -- would have to apply to the first or to neither.

**Load it into `warehouse.fact_vehicle_inventory_snapshot` and
`warehouse.dim_vehicle`.** Rejected, and this is the alternative most likely to be
proposed again. Both objects carry NOT NULL financial and acquisition attributes that a
listing cannot supply. Admitting listing rows would mean either relaxing those columns --
so an inventory-investment report silently includes vehicles nobody bought -- or
defaulting them, which is worse, because a default is a number and a number gets summed.
`warehouse.dim_observed_vehicle` and `warehouse.fact_vehicle_listing_snapshot` exist so
that the two sources cannot be confused by a query that forgot which one it was reading.

**Keep a VIN mapping so the sanitization is reversible.** Rejected without qualification.
A reversible de-identification is not a de-identification; it is a lock whose key is in
the same repository. The identity function is one-way by construction and there is no
code path in ARPI that could build the inverse.

## 4. Consequences

**Positive.** The platform can demonstrate the whole ingestion path against material it
did not author. The listing lane's grain, immutability and reconciliation behaviour are
now exercised by something with real-world messiness in it. The three-lane vocabulary
makes future additions a decision rather than a drift.

**Negative.** The synthetic-only claim now needs a qualifier every time it is made, and
"every row in ARPI is machine generated" is no longer true without one. That is a real
cost to a project whose credibility rests on being precise, and it is why the exception is
narrow, directory-scoped, machine-checked and stated on the artifact itself rather than
only in this document.

**Neutral.** The reference lane does not participate in the pipeline's per-run
reconciliation set, the semantic model, Gate 2 or the case study. It runs on its own
cadence, records its own audit run, and is presented on the portfolio as implemented
capability rather than as a finding.

## 5. Compliance

| Control | Where |
|---|---|
| Only the approved classification is accepted | `staging.stg_inventory_listing_snapshot`, `arpi.inventory.validation` |
| No original VIN reaches a committed artifact | `arpi.inventory.sanitizer`, DQ-LST-005, `scripts/check_reference_data.py` |
| No source URL reaches a committed artifact | `arpi.inventory.sanitizer`, DQ-LST-006, `scripts/check_reference_data.py` |
| The store resolves against the ARPI registry | `arpi.inventory.spec.resolve_store`, DQ-LST-002, DQ-LST-011 |
| `data/sample` stays synthetic-only | `scripts/check_reference_data.py` |
| The canonical filename is preserved | DQ-LST-016, DQ-LST-017, `scripts/check_reference_data.py` |
| No duplicate or alias artifact exists | DQ-LST-017, `scripts/check_reference_data.py` |
| Documentation may not call the lane synthetic | `scripts/check_reference_data.py` |
| Documentation may not call a removal a sale | `scripts/check_reference_data.py` |
| Documentation may not call days observed days in stock | `scripts/check_reference_data.py` |
| Historical snapshots are immutable | `sql/04_facts/15_fact_vehicle_listing_snapshot_load.sql`, `arpi.inventory.importer` |
| A workbook is filed under its own store | `scripts/check_reference_data.py` rule `artifact-misfiled`, DQ-LST-011 |
| A partial capture declares that it is partial | `config/reference/inventory_listing_contract.yaml`, `tests/unit/test_inventory_reference_artifact.py` |

## 6. Amendments

The decision above is unchanged. The **contract** it governs has been amended once, and
the amendment is recorded here because the contract is where this decision is executable.

### 6.1 2026-08-02 — optional mileage, and a third pricing status

**What prompted it.** The Granite Subaru and Granite Used Auto Center captures arrived.
The Used Auto Center listing surface publishes **no price and no mileage** for 287 of its
318 listings. Under the original contract — mileage required, two pricing statuses — the
whole workbook was refused, 861 findings deep.

**What changed, and what did not.**

| | Before | After |
|---|---|---|
| `Odometer Miles` | Required | **Optional.** A blank cell is an absence; a present value that will not coerce is still refused |
| `pricing_status_values` | `Listed`, `Call for price` | `Listed`, `Call for price`, **`Price not exposed`** |
| `advertised_price` | NULL exactly when call-for-price | NULL under any status that forbids a price |
| `warehouse.fact_vehicle_listing_snapshot.odometer_miles` | `NOT NULL` | Nullable |

**Why the workbook was not refused instead.** Refusing it would have asserted that a
public listing surface must publish mileage and a price. ARPI is not in a position to
make that claim about somebody else's website, and a lane whose contract only admits
sources that resemble the first one it saw is not an ingestion capability.

**Why `Price not exposed` is a new status rather than an alias for `Call for price`.**
Call-for-price means the listing *displayed* a call-for-price treatment: a merchandising
choice was made and shown. Price-not-exposed means the listing surface published no price
field at all, and evidences no choice by anyone. Recording the second as the first would
attribute a decision to a dealership on no evidence, which is the exact class of claim
section 2 forbids. They are counted separately in every view, and `unpriced_units` — the
complement of `Listed` — is published for the case where one number is genuinely wanted.

**What this cost.** Granite Used Auto Center's `total_advertised_value` describes 31
vehicles rather than 318, and no average mileage exists for the other 287. Both are
reported as counts of what was not published rather than as zeros. That is the honest
answer and it is a worse-looking one, which is the point: a zero is a number, and a
number gets averaged.

**Where the change is enforced.** `pricing_rules` now states the rule twice — as a named
boolean per status, which section 5 of the specification requires, and as
`statuses_that_forbid_a_price`, which every consumer reads. `load_contract()` refuses a
contract where the two disagree, so neither statement can quietly become decorative.
