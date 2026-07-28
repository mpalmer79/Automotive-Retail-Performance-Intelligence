# ADR-0004: Validation Category Taxonomy

## Status

**Accepted**

## Date

2026-07-28

## Deciders

Michael Palmer

## Context

`audit.validation_result.check_category` groups every data-quality check result. It is the column
`reporting.vw_data_quality_summary` groups by, which makes it the field a reviewer reads when they ask
"what kind of checking does this project actually do?".

By the end of Phase 0 it had four mutually inconsistent vocabularies and no constrained domain. The
inconsistency was found during a documentation-accuracy review and registered as `DOC-24` in
`docs/requirements/DOCUMENTATION_BACKLOG.md`:

| Source | Vocabulary it used |
|---|---|
| `src/arpi/constants.py` | `structural`, `business_rule`, `privacy`, `reproducibility` |
| The SQL checks in `sql/08_validation/` | `schema`, `uniqueness`, `completeness`, `referential`, `business_rule` |
| `DATA_DICTIONARY.md` §21.1 | `structural`, `business_rule`, `privacy`, `determinism` |
| `COMMENT ON COLUMN` in `sql/00_database/03_audit_tables.sql` | `uniqueness`, `completeness`, `domain`, `referential`, `business_rule` |

Only `business_rule` was common to all four. `determinism` was documented but emitted by nothing. The
column carried **no `CHECK` constraint**, so nothing failed when a fifth spelling was introduced — which is
precisely how four of them arose.

The practical damage was that a "checks by category" breakdown mixed two incompatible taxonomies depending
on whether a given result came from Python or from SQL, and that a documented category would never appear in
any report. Phase 1 multiplies the check count several times over and adds SQL-side check families for
referential integrity, audit integrity, and the ingestion row-count chain. Fixing the vocabulary after that
expansion would mean rewriting far more emitters and far more historical rows.

## Decision

**Exactly seven categories exist. `src/arpi/constants.py` is the authority. The domain is enforced by a
database `CHECK` constraint, not by convention.**

```text
structural | completeness | uniqueness | referential | business_rule | privacy | reproducibility
```

| Category | What it covers |
|---|---|
| `structural` | The shape of the data: declared columns present, types correct, schema matches the contract |
| `completeness` | Required values are present — non-null, expected row counts, no missing periods |
| `uniqueness` | Primary keys, natural keys, and declared grains hold exactly once |
| `referential` | Foreign keys and cross-object references resolve |
| `business_rule` | Domain logic: value domains, derived-column identities, ordering rules, flag implication chains |
| `privacy` | Prohibited fields and prohibited values are absent. Separated from `structural` because a privacy failure is a different kind of event with a different escalation |
| `reproducibility` | Determinism: a fixed seed produces a byte-identical result and an unchanged `content_digest` |

Every emitter — Python and SQL alike — writes one of exactly these seven strings.
`audit.validation_result.check_category` carries a `CHECK` constraint over the set, so a new spelling fails
at the database boundary rather than appearing quietly in a report.

**Implementation ownership.** The constants, the SQL emitters, the DDL comment, and the migration are
implemented by another workstream in this same execution. This record documents the decision; it does not
claim the implementation. As of the date above, `src/arpi/constants.py` does define
`CHECK_CATEGORIES` as a seven-member `frozenset` with one `CHECK_CATEGORY_*` constant each, and
`RETIRED_CHECK_CATEGORIES` as the migration mapping below — that much has been verified on disk. The
`CHECK` constraint itself is verified by that workstream's own tests, not by this record.

## Why `reconciliation` is deliberately not a category

It is the most obvious candidate for an eighth category, and it is excluded on purpose.

A validation check answers a yes/no question about one object and records a pass, a fail, or a skip. A
reconciliation compares **two** independently produced figures and records something a boolean cannot carry:
the left value, the right value, the difference, and the tolerance the difference was judged against. That
is a different result structure, and ARPI already models it as one —
`audit.reconciliation_result` exists precisely because `RECON-GROSS-001` needs to record *by how much* the
figures disagreed, not merely that they did.

Admitting `reconciliation` as a check category would create two homes for the same evidence and force a
choice, per reconciliation, about which one to write to. Worse, a reconciliation recorded as a validation
result would necessarily discard its difference and its tolerance — the only two fields that make it useful
for diagnosis. The category list is therefore closed against it.

Consequently: **`audit.validation_result` never contains a reconciliation, and `audit.reconciliation_result`
never contains a check.** `reporting.vw_data_quality_summary` reports the two side by side without merging
them. Where a reconciliation's *outcome* must fail a pipeline run, it does so through
`audit.pipeline_run.critical_failure_count`, which both structures feed.

## Old to new migration mapping

Three retired spellings map onto the canonical set:

| Retired spelling | Canonical category | Reasoning |
|---|---|---|
| `schema` | `structural` | Identical meaning; `structural` is the broader and more accurate word, and it is what the Python side already used |
| `domain` | `business_rule` | A value-domain constraint is a business rule about permitted values, not a distinct kind of evidence |
| `determinism` | `reproducibility` | Same property, and `reproducibility` is the word the rest of the project uses — `DATA_GENERATION.md`, the seeding contract, and `content_digest` all speak of reproducibility |

One documented exception applies: `DQ-DLR-004` spelt its category `schema`, but it is the prohibited-column
privacy tripwire. It migrates to `privacy`, not `structural`, because the mapping table describes the
general case and this check's purpose is privacy enforcement rather than shape verification.

The migration is applied **before** the `CHECK` constraint is added, rewriting pre-existing rows in place, so
an existing database moves to the constrained vocabulary without losing audit history. A migration that
added the constraint first would fail on the very rows it exists to protect, and a migration that deleted
non-conforming history would destroy the record of what the project used to check — both were rejected.

## Alternatives considered

**Leave the column unconstrained and fix only the documentation.** Cheapest, and it would have made the four
documents agree on the day it was written. Rejected because nothing would prevent the fifth vocabulary. The
constraint is the part of this decision that makes it stay fixed; without it, this ADR would be describing an
aspiration.

**Adopt the SQL vocabulary wholesale** (`schema`, `uniqueness`, `completeness`, `referential`,
`business_rule`). It had the most emitters behind it. Rejected because it has no `privacy` category — the
project's strongest ethical commitment would have been filed under `schema` — and no `reproducibility`
category, which is the property the whole synthetic-generation contract rests on.

**Adopt the Python vocabulary wholesale** (`structural`, `business_rule`, `privacy`, `reproducibility`).
Four categories, tidy. Rejected because it collapses `uniqueness`, `completeness`, and `referential` into
`structural`, and those are exactly the three distinctions a data-quality report most needs to draw. A grain
violation and a missing column are both "structural" under that scheme, and they are not the same problem.

**A two-level taxonomy — category plus subcategory.** More expressive, and it would have let every existing
spelling survive as a subcategory. Rejected as overengineering for the current check count: it adds a column,
a second domain to constrain, and a grouping decision to every report, in exchange for detail that
`check_id` and `check_name` already carry.

**Add `reconciliation` as an eighth category.** Rejected for the reasons in the section above: reconciliations
have their own result structure, and a reconciliation stored as a check loses its difference and its
tolerance.

## Consequences

### Positive

- One vocabulary across Python, SQL, the DDL comment, and the documentation. A "checks by category"
  breakdown means one thing regardless of which layer produced the row.
- The domain is enforced at the database boundary, so a new spelling fails on insert instead of appearing
  silently in a report. This is the difference between a rule and a description.
- `privacy` and `reproducibility` are first-class categories, which makes the two commitments the project
  most wants to demonstrate visible in its own quality reporting rather than buried under `structural`.
- Phase 1's new check families — `DQ-REF-*`, `DQ-AUD-*`, `DQ-ING-*`, and the per-entity families — inherit a
  settled vocabulary and need no per-family decision.
- Audit history survives the change, so trend analysis across the migration boundary stays possible.

### Negative

- Adding a genuinely new category is now a schema migration plus an ADR, not a string literal. That is the
  intended cost, but it is a real cost: a future category that deserves to exist will be slower to introduce.
- The `CHECK` constraint can fail a load for a reason unrelated to the data — a typo in an emitter now stops
  a pipeline run. That is preferable to silent drift, but it is a new failure mode.
- Three retired spellings are now permanently absent from new data while remaining meaningful in old commits
  and old documentation. Anyone reading a Phase 0 commit will see `schema` and must consult this record.
- Historical rows are rewritten in place by the migration. The original spelling of a migrated row is not
  preserved anywhere except in this table, which is a deliberate trade of fidelity for a single vocabulary.
- The separation between `audit.validation_result` and `audit.reconciliation_result` means a reviewer asking
  "did everything pass?" must look in two places. `reporting.vw_data_quality_summary` mitigates this; it does
  not remove it.

## Relationship to other records

- `ARCHITECTURE.md` §21.1 states the rule and points here.
- `DOC-24` in `docs/requirements/DOCUMENTATION_BACKLOG.md` is the gap this record closes.
- `DOC-21` in the same register — the SQL check families missing from the shared ID register — is a related
  but separate gap: it concerns which checks exist, not what their categories are called.
- `src/arpi/constants.py` is the authority this record designates.
