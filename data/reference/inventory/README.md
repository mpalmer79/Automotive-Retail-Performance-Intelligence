# Inventory reference data

Sanitized public inventory listing snapshots for the three fictional stores of
Granite Auto Group.

---

## 1. Read this before anything else

**This directory is the one place in the repository that does not hold synthetic
data.** Everything under `data/sample/` is machine-generated from a seed: no row
of it was ever observed anywhere. The workbooks here are different, and the
difference is the whole reason they live in their own tree with their own rules.

They are vehicle listing attributes captured from a **public** listing source,
de-identified, and reassigned to fictional stores. What was removed is recorded
in each workbook's own README sheet. What remains is a de-identified snapshot of
what the public source exposed.

Three consequences follow, and they are binding:

1. **Do not move a workbook to `data/sample/`.** That directory is reserved for
   fully machine-generated data, and mixing the two would make the repository's
   central privacy claim untrue by filing.
2. **Do not commit an unsanitized source workbook anywhere in this repository.**
   Keep the original outside git. `data/external/` is excluded from the Docker
   build context for this reason.
3. **Do not present a row as a dealership result.** A row proves that a listing
   was visible in the source at a capture date. It does not prove a sale, a
   delivery, physical on-ground status or dealer ownership.

---

## 2. Directory model

```
data/reference/inventory/
├── gsa-001/                             Granite Chevrolet of Nashua
│   └── 2026-08-02/                      one snapshot, named with an ISO date
│       └── ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx
├── gsa-002/                             Granite Subaru of Manchester
│   └── 2026-08-02/
│       └── ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-02.xlsx
└── gsa-003/                             Granite Pre-Owned Center of Merrimack
    └── 2026-08-02/
        └── ARPI_Granite_Pre_Owned_Center_Inventory_Sanitized_2026-08-02.xlsx
```

- The store directory is the **dealership id in lower case**. It must correspond
  to a current store in `data/sample/dim_dealership.csv`.
- The snapshot directory is an **ISO date**, `YYYY-MM-DD`. Anything else is a
  build failure, not a directory the generator skips.
- **Exactly one workbook per snapshot directory.** Two would make "the latest
  valid workbook" a guess.

The generator always reads the lexicographically greatest snapshot directory per
store, which for ISO dates is also the most recent.

---

## 3. Workbook schema

Each workbook carries four worksheets. Two are read.

### `README`

Label/value rows carrying the workbook's own metadata. The generator reads:

| Label             | Required | Used for                                                    |
| ----------------- | -------- | ----------------------------------------------------------- |
| `Dealership ID`   | yes      | Checked against the directory the workbook is filed under   |
| `Source type`     | yes      | Rendered verbatim in the store's coverage statement          |
| `Coverage status` | no       | Rendered verbatim where present; absent is rendered as absent |

A coverage limitation paragraph under a `Coverage limitation` or
`Coverage and pricing limitation` heading is read and rendered on the store page.

### `Inventory`

One row per listing. Row 1 is the header.

**Required columns.** The build fails without them.

| Column             | Type   | Notes                                                       |
| ------------------ | ------ | ----------------------------------------------------------- |
| `Source Record ID` | text   | Synthetic, unique within the snapshot and across the group   |
| `Dealership ID`    | text   | Must equal the directory's store on every row                |
| `Captured At`      | date   | One capture date per workbook                                |
| `Condition`        | text   | `New` or `Used`; normalised to `new` / `pre-owned`           |
| `Model Year`       | number | Required                                                     |
| `Make`             | text   | Required                                                     |
| `Model`            | text   | Required                                                     |
| `Trim`             | text   | May be empty                                                 |
| `Odometer Miles`   | number | May be empty; empty means the source exposed none            |
| `Advertised Price` | number | May be empty; empty means the source exposed none            |
| `Pricing Status`   | text   | The source's own status, carried through verbatim            |

**Required to exist, then dropped.** They are asserted present so that a change
to the workbook contract is a reviewed change rather than a silent one, and none
of them reaches the website:

`Store Name`, `Source Batch ID`, `Source Feed`, `Vehicle Display`,
`Synthetic Vehicle ID`, `Synthetic VIN`, `Inventory Unit Count`,
`Data Classification`.

`Summary` and `Model Summary` are for a human reading the workbook. The generator
derives its own totals from the `Inventory` rows and never reads a precomputed
one, so a stale summary sheet cannot reach the site.

---

## 4. Sanitization rules

Applied **before** a workbook is committed, and recorded in its README sheet:

| Control                     | Treatment                                                        |
| --------------------------- | ---------------------------------------------------------------- |
| Original VINs               | Replaced with deterministic synthetic identifiers, or absent      |
| Source URLs                 | Removed, replaced with a neutral source-feed label                |
| Source listing keys         | Hashed; the original is not retained                              |
| External dealer identity    | Removed; rows reassigned to a fictional store                     |
| External locations          | Consolidated to one fictional store                               |
| Street addresses            | Removed; geography stops at store name and market region          |
| Record identity             | Synthetic source record ids, generated for repeatable ingestion   |

Enforced **again** at build time by
`portfolio/scripts/generate-inventory-data.ts`, which refuses to write a frontend
artefact whose serialised output matches a URL, a hostname, an email address, a
telephone number, a VIN-shaped token, a domain name or a retired public name.
The generated record type has no VIN field and no source-URL field at all.

---

## 5. Coverage limitations

The three workbooks do not have equal coverage, and the website says so per store
rather than averaging the difference away.

| Store   | Rows | Coverage as the workbook states it       | Priced rows |
| ------- | ---- | ---------------------------------------- | ----------- |
| GSA-001 | 199  | not stated                               | 197         |
| GSA-002 | 24   | Partial public reference sample          | 24          |
| GSA-003 | 318  | Complete indexed public listing snapshot | 31          |

- GSA-002 is a **partial sample**. The public source did not expose every listing
  through a reliably extractable path. It must not be described as that store's
  complete inventory.
- GSA-003 exposed a price and an odometer reading for 31 of 318 rows. The other
  287 carry `Price not exposed`, which is a **source-availability status**, not a
  dealer call-for-price strategy. Every price statistic for that store is
  computed over the 31 and states so.
- GSA-001 states no coverage classification. The site renders that absence as an
  absence rather than assuming completeness.

---

## 6. Adding a snapshot

1. Sanitize the source workbook **outside this repository**, following section 4.
   Record the controls applied in its README sheet.
2. Create `data/reference/inventory/<dealership-id-lowercase>/<YYYY-MM-DD>/` and
   put exactly one `.xlsx` in it.
3. Confirm the workbook's README sheet declares the matching `Dealership ID`, and
   that every `Inventory` row carries it.
4. From `portfolio/`, run `npm run inventory`.
5. Read the diff in `portfolio/src/generated/`. It is telling you what changed on
   the website.
6. Commit the workbook and the regenerated artefacts together.

The generator fails with a named reason for: a directory that is not a current
store, a snapshot folder that is not an ISO date, a folder holding two workbooks,
a missing required column, a row assigned to the wrong store, a capture date that
disagrees with the folder, a repeated record id, and a workbook that produces a
frontend artefact still containing identifying data.

---

## 7. Where this data appears

| Route                              | What it shows                                      |
| ---------------------------------- | -------------------------------------------------- |
| `/`                                | The group snapshot in the Granite Auto Group section |
| `/dealerships`                     | Group totals, store comparison, two charts          |
| `/dealerships/granite-chevrolet`   | GSA-001's profile and full listing table            |
| `/dealerships/granite-subaru`      | GSA-002's profile and full listing table            |
| `/dealerships/granite-pre-owned`   | GSA-003's profile and full listing table            |
| `/inventory`                       | The filterable explorer over all three              |

The full content contract is in
[`portfolio/docs/CONTENT_MODEL.md`](../../../portfolio/docs/CONTENT_MODEL.md)
section 11.
