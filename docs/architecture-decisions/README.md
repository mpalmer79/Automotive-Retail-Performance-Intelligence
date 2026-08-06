# Architecture Decision Records

This directory holds the architecture decision records (ADRs) for **Automotive Retail Performance
Intelligence (ARPI)**.

An ADR captures one decision that was hard to make and would be expensive to reverse: the context that
forced the choice, the option taken, the options rejected and why, and what the project now has to live
with. It is written once, at the moment the decision is made, and then left alone. ADRs are not
documentation of how the system works — `ARCHITECTURE.md` and the guides in `docs/` do that — they are the
record of *why* it works that way.

An ADR is never edited to reflect a later change of mind. When a decision is replaced, a new ADR is
written that supersedes it, and the old record's status changes to `Superseded by ADR-NNNN`. The history
stays readable.

## When an ADR is required

`ARCHITECTURE.md` §35.2 lists the decisions that require a record. In summary, write an ADR when the
change would alter the project's identity, its data model's shape, its technology baseline, or its
security and privacy posture — for example replacing PostgreSQL, changing the Power BI connection mode,
adding a fact table or changing a fact grain, adding a second user interface, adding machine learning or
an API layer, using real or restricted data, changing the synthetic VIN policy, or changing the deployment
model.

Routine implementation work does not need an ADR. If a reasonable reviewer would ask "why is it like
this?" and the answer takes more than a code comment, it needs one.

## File naming

```text
ADR-NNNN-kebab-title.md
```

- `NNNN` is a zero-padded four-digit sequence number, assigned in order and never reused, even if a record
  is later superseded or rejected.
- The title is lowercase kebab-case, short, and describes the subject rather than the outcome — for
  example `project-identity`, not `we-chose-arpi`.
- One decision per file.

## Required sections

Every ADR contains at least the following, in this order:

| Section | Content |
|---|---|
| `# ADR-NNNN: Title` | Sentence-case title matching the filename |
| **Status** | `Proposed`, `Accepted`, `Rejected`, `Deprecated`, or `Superseded by ADR-NNNN` |
| **Date** | ISO-8601 date the status was last set |
| **Deciders** | Who made the call |
| **Context** | The forces in play — what made this a decision rather than a default |
| **Decision** | What was chosen, stated plainly and unambiguously |
| **Alternatives considered** | Each option that was genuinely weighed, and the specific reason it lost |
| **Consequences** | Both positive and negative, honestly. An ADR with no negative consequences has not been thought through |

Records may add sections when the subject warrants it. ADR-0001, for example, adds **Naming conventions**,
**Migration impact**, an **Explicit retirement statement**, and **Enforcement**, because a naming decision
is only real if it is mechanically enforced.

## Current ADRs

| ADR | Title | Status | Date | Summary |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-project-identity.md) | Project Identity and Naming Convention | Accepted | 2026-07-28 | Fixes the display name *Automotive Retail Performance Intelligence*, the short identifier *ARPI*, the `arpi` package, the `ARPI_` configuration prefix, and the `arpi_admin` / `arpi_loader` / `arpi_reporter` database roles. Retires the earlier working title and defines how that retirement is enforced. |
| [ADR-0002](ADR-0002-phase-0-technology-baseline.md) | Phase 0 Technology Baseline | Accepted | 2026-07-28 | Records the non-obvious Phase 0 engineering choices: Python 3.11+, `src/` layout, Ruff as the single lint and format tool, mypy, pytest with an `integration` marker, pydantic-settings, stdlib `argparse`, local PostgreSQL with Supabase deferred, a calendar-aligned fiscal year, and the deterministic holiday rule. |
| [ADR-0003](ADR-0003-delivery-increment-terminology.md) | Delivery Increment Terminology | Accepted | 2026-07-28 | Separates the eight **lifecycle phases** of `ARCHITECTURE.md` §27 from the **delivery increments** `Phase 0` and `P1.1`–`P1.5`. Records why the existing `P1.x-NN` identifiers were disambiguated rather than renumbered, makes `ARCHITECTURE.md` §27.1 the authoritative mapping, and states that enforcement is review discipline rather than automation. |
| [ADR-0004](ADR-0004-validation-category-taxonomy.md) | Validation Category Taxonomy | Accepted | 2026-07-28 | Fixes exactly seven `check_category` values — `structural`, `completeness`, `uniqueness`, `referential`, `business_rule`, `privacy`, `reproducibility` — with `src/arpi/constants.py` as the authority and a database `CHECK` constraint as the enforcement. Records why `reconciliation` is deliberately not a category, and the `schema`→`structural`, `domain`→`business_rule`, `determinism`→`reproducibility` migration. |
| [ADR-0005](ADR-0005-synthetic-vin-policy.md) | Synthetic VIN Policy | Accepted | 2026-07-28 | Fixes the 17-character `ARPI`-prefixed synthetic vehicle identifier, deliberately not a structurally valid real VIN, derived from no real VIN data, with no decoding and no owner relationship. Required by `ARCHITECTURE.md` §35.2, which lists changing this policy among the decisions needing a record. |
| [ADR-0006](ADR-0006-scd-type-selection-phase-1.md) | SCD Type Selection for Phase 1 Dimensions | Accepted | 2026-07-28 | Declares the history policy of every Phase 1 dimension: `dim_employee` is Type 2; `dim_vehicle_model`, `dim_vehicle`, `dim_customer`, `dim_lead_source`, and `dim_marketing_campaign` are Type 1; `dim_dealership` remains Type 2 from Phase 0. Justifies each, and records the condition under which the campaign decision must be superseded. |
| [ADR-0007](ADR-0007-power-bi-project-format.md) | Power BI Project Format | Accepted | 2026-07-29 | Fixes the first Power BI artefact as a **PBIP** project with the semantic model stored as **TMDL** and the report as a **PBIR shell** with no hand-authored content, in Import mode against the `reporting` schema as `arpi_reporter`, with Server and Database as parameters and no credential in source. Records why no `.pbix` is committed during `P2.1`, why Power BI Desktop validation is a manual gate that continuous integration cannot satisfy, the preview-feature risk, the rollback and Fabric conversion paths, and the three corrections the approved specification required. Its *Desktop validation requirement* section is superseded by ADR-0008. |
| [ADR-0008](ADR-0008-real-engine-validation-paths.md) | Real-Engine Validation Paths | Accepted | 2026-07-29 | Replaces ADR-0007's single Windows-only validation path with **two accepted real-engine paths of equal standing** — Power BI Desktop, and the Microsoft Fabric Service via the semantic-model definition APIs and the Power BI Execute Queries REST API — carrying an identical seven-part proof obligation: an engine accepted the TMDL, twenty tables refreshed, row counts present, forty-two relationships, forty-nine measures, DAX matching the governed SQL baseline in every filter context, and evidence pinned to the current model-source hash. States that static parsing may never complete Lifecycle Phase 5 by itself, and records the cloud database, tenant, workspace and connection the Fabric path depends on. Both paths are **pending**. |
| [ADR-0009](ADR-0009-portfolio-ui-foundation-before-gate-2.md) | Portfolio UI Foundation Before Gate 2 | Accepted | 2026-07-30 | Records why the portfolio website's user-interface foundation is built before Gate 2 opens, and the constraints that keeps it under: repository-backed counts only, the case study stays locked, no fabricated finding, and no database access from the frontend. |
| [ADR-0010](ADR-0010-execution-identity-and-logical-run-key.md) | Execution Identity and Logical-Run Key | Accepted | 2026-08-01 | Splits the single deterministic `run_uuid` into **execution identity** (`run_uuid`, a random UUIDv4 per attempt) and **logical-run identity** (`logical_run_key`, the UUIDv5 fingerprint of the run's inputs). Corrects an audit layer that collapsed repeated executions onto one row, overwriting the earlier attempt's completion time, hiding failed attempts behind a later success, leaving `arpi_version` stale and destroying child-row lineage. Records why `run_uuid` is retained rather than renamed, why application version is excluded from the logical key, that warehouse idempotency never depended on audit-row reuse, and that pre-existing collapsed attempts cannot be recovered. |
| [ADR-0011](ADR-0011-sanitized-public-inventory-reference-data.md) | Sanitized Public Inventory Reference Data | Accepted | 2026-08-02 | Creates a **third controlled data lane** for de-identified public dealership listing snapshots under `data/reference/`, alongside fully synthetic operational data and approved general public reference data. Records that the lane is admissible only for publicly accessible data obtained without authentication bypass or scraping circumvention; that original VINs, source URLs, dealer identity and street address are removed one-way with no reversible mapping; that no customer, employee or confidential DMS/CRM/F&I/lender/transaction data is ever permitted; that the lane may never be presented as synthetic or as current business performance; that a removal request is honoured by deletion without a review period; and that the canonical artifact filename uses the approved ARPI underscore convention, changeable only by explicit migration. Explains why the listing data gets its own `dim_observed_vehicle` and `fact_vehicle_listing_snapshot` rather than being forced into the owned-inventory objects, whose NOT NULL cost columns it cannot supply. |
| [ADR-0012](ADR-0012-dealer-group-public-naming.md) | Dealer Group Public Naming | Accepted | 2026-08-03 | Renames the fictional dealer group to **Granite Auto Group** and GSA-003 to **Granite Pre-Owned Center of Merrimack**, superseding ADR-0001's naming-conventions entry for the group. Records why the dealership identifiers `GSA-001`–`GSA-003` and the `Independent Used` store type are deliberately NOT migrated, why `docs/research.md` keeps the original name verbatim, the recomputed SCD Type 2 attribute hash, and the four layers that now enforce the new names. |
| [ADR-0013](ADR-0013-governed-web-operating-console.md) | Governed Web Operating Console | Accepted | 2026-08-06 | Authorizes the **ARPI Dealer Operations Command Center** — an interactive public operating console under `/dashboard` — as a governed exception to the §6 "second complete dashboard" exclusion, under fifteen binding conditions: SQL-validated versioned exports only, no independent KPI formulas, no non-`reporting` schema access, no browser database connection, pervasive synthetic disclosure, and the existing design system. Keeps Power BI the canonical analytical product, supersedes ADR-0009's no-KPI-value control **for the dashboard route family only**, leaves the case-study lock and Gate 2 untouched (Gate 2 remains CLOSED), and records nine rejected alternatives including runtime PostgreSQL access, a public warehouse API, and recreating the DAX in TypeScript. Scheduled by [`../requirements/DASHBOARD_BACKLOG.md`](../requirements/DASHBOARD_BACKLOG.md). |

## Enforcement

`scripts/check_naming.py` enforces ADR-0001 and ADR-0012 in continuous integration by failing the build
when a retired identifier appears outside the seven locations those records permit.
`scripts/check_reference_data.py` enforces ADR-0011 over every artifact committed under `data/reference/`.
`scripts/check_docs_links.py` verifies that the relative links in and to these records resolve.

## Related documents

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — the architecture these decisions constrain
- [`../index.md`](../index.md) — documentation hub
- [`../research.md`](../research.md) — the preserved research evidence base that ADR-0001 cites
