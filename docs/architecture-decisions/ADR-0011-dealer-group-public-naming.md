# ADR-0011: Dealer Group Public Naming

## Status

**Accepted**

## Date

2026-08-03

## Deciders

Michael Palmer

## Context

[ADR-0001](ADR-0001-project-identity.md) settled the project's identity and, in
passing, recorded the fictional dealer group's name in its naming-conventions
table as `Granite State Auto Group`, annotated **(NEVER rename)**. The same record
states the rule that annotation exists to protect:

> The fictional dealer group is part of the data model, not the project identity,
> and is never renamed alongside it.

That rule was written to stop the group's name being dragged along by a change to
the project's name. It was not a judgement that the group's own public name was
final, and nothing in ADR-0001 weighs the group's name as a piece of public
positioning, because at the time nothing public rendered it.

Something public renders it now. The portfolio website has grown a Granite Auto
Group experience: a home-page section, a group page, one page per store, and an
inventory explorer over the sanitized reference workbooks in
`data/reference/inventory/`. The group's name and its three store names are no
longer strings in a data dictionary. They are the first thing a visitor reads.

Two of those names were judged wrong for that job:

- **`Granite State Auto Group`.** "Granite State" is New Hampshire's nickname, so
  the name reads as *New Hampshire Auto Group*, which is a regional descriptor
  rather than a retail brand. Real groups are named for a family, a founder or a
  place they operate in, not for a state's motto.
- **`Granite Used Auto Center of Merrimack`**, short name `Granite Used Auto`. No
  dealership in the United States has called itself a "used auto center" in
  twenty years. The industry says *pre-owned*, the sign on the building says
  pre-owned, and a portfolio built to demonstrate automotive retail domain
  knowledge should not open with a term the industry retired.

A third consideration made this urgent rather than cosmetic. The site now
publishes the group's name in `<title>`, in Open Graph metadata, in JSON-LD, and
in a sitemap. A public name is much cheaper to change before it is indexed than
after.

## Decision

**The fictional dealer group's public name is `Granite Auto Group`.**

**GSA-003's public name is `Granite Pre-Owned Center of Merrimack`, short name
`Granite Pre-Owned`.**

The other two stores are unchanged: `Granite Chevrolet of Nashua` and
`Granite Subaru of Manchester` were already correct.

**The dealership identifiers do not change.** `GSA-001`, `GSA-002` and `GSA-003`
remain exactly as they are, in the warehouse dimension, in the SQL, in the
sanitized workbooks, and in the `data/reference/inventory/gsa-00n/` directory
structure. They are internal keys. The letters `GSA` no longer expand to anything
in particular, and that is the correct outcome: a surrogate business key that
still encodes a display name is a key that will need migrating again the next time
the display name moves.

`store_type` is likewise unchanged. `Independent Used` remains the warehouse
value; the website maps it to the public label *Independent pre-owned dealership*
at render time.

### What changed on disk

| Layer | Change |
| --- | --- |
| `src/arpi/generation/dealership.py` | `STORE_DEFINITIONS` store name and short name for GSA-003 |
| `src/arpi/constants.py` | `FICTIONAL_DEALER_GROUP` and the synthetic-data notice |
| `data/sample/dim_dealership.csv` | GSA-003's `store_name`, `store_short_name` and its recomputed `attribute_hash` |
| `data/sample/generation_manifest.json` | the file's recomputed `content_digest` and the notice |
| `sql/`, `powerbi/` | comments and TMDL descriptions only; no DDL, no column, no constraint |
| `data/reference/inventory/**` | the workbooks' own README and Summary sheets, rewritten in place |
| `portfolio/` | every public-facing string, plus the route map and navigation |
| documentation | every occurrence outside the two preserved historical records |

The `attribute_hash` change is worth naming. `dim_dealership` is SCD Type 2 and
its hash covers `store_name` and `store_short_name`, so a rename is a genuine
attribute change: the recomputed digest for GSA-003 is
`5f3748dad52d388c5d3605fa49d314111408911f18460f8688429274aa5e1be9`. Recomputing
the committed sample rather than leaving the old digest in place is what keeps
`data/sample/` a faithful record of what the generator produces.

### What was deliberately left alone

`docs/research.md` keeps `Granite State Auto Group` verbatim. It is the preserved
research evidence base, it is where the name was first proposed, and editing it
would falsify the record of what was actually decided in July. ADR-0001's
naming-conventions table likewise keeps its original entry, annotated as
superseded by this record, because [the ADR conventions](README.md) require that a
decision be replaced by a new record rather than edited in place.

## Alternatives considered

**Keep both names.** Rejected. "Granite State" reads as a state nickname and
"Used Auto Center" reads as a term from the 1990s, and the whole argument the
portfolio makes is that it was built by somebody who has worked the floor. A
reviewer who knows the industry notices the second name immediately.

**Rename the group but keep `Granite Used Auto Center of Merrimack`.** Rejected
for the same reason, and it would have left the group's most visible weakness in
place while spending the migration anyway.

**Rename the dealership identifiers to match.** Rejected. `GSA-001` through
`GSA-003` appear in the warehouse dimension, in fact-table foreign keys, in the
sanitized workbooks' every row, in the reference directory structure, and in the
source-to-target mappings. Changing them would be a real migration across every
layer, would invalidate the committed workbooks without a re-sanitization pass,
and would buy a reader nothing: nobody sees a surrogate key. The general principle
is the one ADR-0001 already states - the display name and the identity are
different things - and this is that principle applied in the other direction.

**Change `store_type` from `Independent Used` to `Independent Pre-Owned`.**
Rejected. It is a warehouse enumeration, it appears in a `dim_dealership` column
and in reporting views, and the website already maps enumerations to public labels
at render time. Changing a stored vocabulary to fix a rendered string is the wrong
layer.

**Do it later, after the site is indexed.** Rejected. A public name is cheap to
change before search engines and shared links carry it and expensive afterwards.
The site's deployments are currently `noindex` for exactly this class of reason,
so the window was open and is now closed.

## Consequences

**Positive.**

- The public copy now uses the vocabulary the industry uses, which is the specific
  credibility the portfolio is built to demonstrate.
- `scripts/check_naming.py` gained three rules - `retired-group-name`,
  `retired-store-name` and `never-used-group-name` - so a retired name cannot come
  back in any file, in any layer, without failing continuous integration. The
  allowlist grew from three paths to six: the three additions are the generator's
  own sanitization gate and the two test suites that assert the retired names
  never reach the generated data or a rendered page, each of which has to name a
  string in order to forbid it.
- The frontend has a matching gate. `generate-inventory-data.ts` refuses to write
  a generated artefact containing a retired name, and `tests/e2e/inventory.spec.ts`
  asserts no rendered page contains one.

**Negative, and accepted.**

- `GSA` is now an abbreviation of nothing. Anybody reading the identifiers for the
  first time will ask, and the answer is in this record rather than in the letters.
- The committed sample data's `dim_dealership` digest changed, so a reader
  comparing this repository against an older clone sees a digest difference in a
  file whose row count and column set did not change. The recomputation is
  recorded above.
- ADR-0001's naming table now carries an entry annotated **(NEVER rename)** that
  has, in fact, been renamed. The annotation is left in place on purpose: the rule
  it protects still holds, and striking it would hide that this record had to
  argue against it.
- Three sanitized workbooks were rewritten in place to correct their embedded
  group and store names. The rewrite touched only the XML string content of the
  package and preserved every other part, but the files' bytes changed, so a
  reviewer diffing them sees a binary change with no readable diff. The
  substitutions applied are listed in this record and the resulting values are
  asserted by `portfolio/tests/unit/inventory.test.ts`.

## Enforcement

- `scripts/check_naming.py`, in continuous integration, over the whole repository.
- `portfolio/scripts/generate-inventory-data.ts`, at build time, over every
  generated frontend artefact.
- `portfolio/tests/unit/inventory.test.ts`, over the generated data and the
  authored dealership copy.
- `portfolio/tests/e2e/inventory.spec.ts`, over the rendered pages.
