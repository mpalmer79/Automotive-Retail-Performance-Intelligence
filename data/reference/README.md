# `data/reference/` — sanitized public reference data

This directory holds **lane 3** of the three controlled data lanes
[ADR-0011](../../docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md)
defines: de-identified public dealership listing snapshots.

> **This data is not synthetic.** The dealer and vehicle identifiers are synthetic. The
> listing attributes — condition, model year, make, model, trim, advertised odometer,
> advertised price and pricing status — are retained from a de-identified public reference
> snapshot. Its correct classification is **sanitized public reference data**, and calling
> it anything else is a governance failure, not a wording preference.

---

## 1. Where this sits among the three lanes

| Lane | Directory | What it is | Synthetic? |
|---|---|---|---|
| 1 | [`data/sample/`](../sample/README.md), `data/raw/` | Fully synthetic operational data from ARPI's own generators | Yes, entirely |
| 2 | [`config/reference/`](../../config/reference/) | Approved general public reference data about *products* | No, and it describes no business |
| 3 | **`data/reference/`** | **Sanitized public dealership listing snapshots** | **No. Identifiers are synthetic; attributes are de-identified public data** |

### Relationship to `data/sample/`

`data/sample/` is reserved for fully machine-generated data and stays that way. A
sanitized reference workbook placed there fails CI
(`scripts/check_reference_data.py`, rule `sample-is-synthetic-only`). The two directories
are not interchangeable and neither is a fallback for the other.

### Relationship to `data/raw/`

`data/raw/` holds generator output on its way into the warehouse. It is `.gitignore`d and
regenerable. Nothing here is regenerable: a capture describes a moment that has passed and
cannot be recomputed, which is why every artifact carries a digest and why historical
snapshots are immutable.

### Relationship to generated reports

`artifacts/inventory/` holds the Excel operating reports the exporter produces from the
**warehouse**. Those are outputs, not sources; they are reproducible from a loaded
database and are not committed as reference data. A report is named
`ARPI_<Store_Descriptor>_Inventory_Report_<yyyy-mm-dd>.xlsx`; a source artifact is named
`ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx`. The two are never confused
because the words differ, not because the directories do.

---

## 2. What may be stored here

- A **governed four-sheet sanitized workbook** produced by
  `scripts/sanitize_inventory_workbook.py`, and nothing else.
- Data that was **publicly accessible without authentication, payment or circumvention**.
- **Listing attributes only**: condition, model year, make, model, trim, advertised
  odometer, advertised price, pricing status.

## 3. What may never be stored here

- The **original unsanitized workbook**, in any form.
- **Original VINs**, or any value from which one could be recovered.
- A **VIN mapping file** or any reversible identity map. A reversible de-identification is
  not a de-identification.
- **Row-level source URLs**, or any URL at all, on any sheet.
- **Original dealership identity** — name, brand-plus-city, abbreviation, stock number
  scheme, or anything else that identifies the source.
- **Street address.** Geography stops at store name and market region.
- **Customer or employee data**, in any form, banded or otherwise.
- **Confidential DMS, CRM, F&I, service, lender or transaction data.**
- **Credentials, tokens, database URLs or `.env` files.**
- Logs or test output containing a source VIN or URL.

## 4. Required workbook metadata

Every artifact carries a `README` sheet with these fields. A missing or wrong
`Classification` is a refusal, not a warning.

| Field | Required value |
|---|---|
| Dealer group | `Granite State Auto Group` |
| Store | The store name exactly as `arpi.generation.dealership.STORE_DEFINITIONS` records it |
| Dealership ID | A registered identifier: `GSA-001`, `GSA-002` or `GSA-003` |
| Market | The store's market region |
| Snapshot date | The capture date, matching the directory and the file name |
| Source type | `Public inventory listing snapshot, de-identified for portfolio use` |
| Classification | `Sanitized public reference data` — the only accepted value |
| Sanitization version | The `contract_version` of `config/reference/inventory_listing_contract.yaml` |
| Recommended repository path | The artifact's own governed path |

## 5. Required sanitization controls

| Control | What the sanitizer does |
|---|---|
| Original VINs | Replaced with deterministic, group-stable `ARPI`-prefixed synthetic VINs and `VEH-` vehicle identifiers. No reverse mapping is produced. |
| Source URLs | Removed and replaced with a neutral feed label naming the lane, never the origin. |
| External dealer identity | Removed. Rows are assigned to a fictional Granite State Auto Group store resolved from the ARPI registry. |
| Street address | Removed. |
| Record identity | Deterministic source record and batch identifiers, so an import is repeatable and a rerun is provably a no-op. |
| Classification | Stamped on the README sheet and on every data row. |

The identity function is:

```
digest = SHA256(UTF8("ARPI|GSA|" + upper(trim(original VIN)))).hex().upper()
synthetic_vehicle_id = "VEH-" + digest[:12]
synthetic_vin        = "ARPI" + digest[:13]
```

The `ARPI` prefix is load-bearing: `I` is not a permitted VIN character, so no ARPI
identifier can ever be a valid real VIN. The namespace carries the **group**, not the
store, so one physical vehicle observed at two stores resolves to one identity and a
cross-store appearance is *detectable*. Detectable is not explained — ARPI holds no
dealer-trade event and must never infer one.

## 6. Required directory structure

```
data/reference/inventory/<dealership-id lowercased>/<yyyy-mm-dd>/<approved-file-name>.xlsx
```

The store segment is lowercased because it is a path segment. The **file name is not**, and
the two rules are independent on purpose.

### 6.1 Every store has its own directory, and only its own

| Store | Directory | Artifact name |
|---|---|---|
| GSA-001 — Granite Chevrolet of Nashua | `data/reference/inventory/gsa-001/<yyyy-mm-dd>/` | `ARPI_Granite_Chevrolet_Inventory_Sanitized_<yyyy-mm-dd>.xlsx` |
| GSA-002 — Granite Subaru of Manchester | `data/reference/inventory/gsa-002/<yyyy-mm-dd>/` | `ARPI_Granite_Subaru_Inventory_Sanitized_<yyyy-mm-dd>.xlsx` |
| GSA-003 — Granite Used Auto Center of Merrimack | `data/reference/inventory/gsa-003/<yyyy-mm-dd>/` | `ARPI_Granite_Used_Auto_Center_Inventory_Sanitized_<yyyy-mm-dd>.xlsx` |

**A workbook filed under another store's directory is a governance failure, not a filing
preference.** It is refused by `scripts/check_reference_data.py` (rule `artifact-misfiled`)
and by DQ-LST-011, and it is refused *whether or not a second workbook is sitting beside
it*: a lone Subaru capture in the `gsa-001` directory passes every duplicate rule and is
still wrong. The directory is part of the artifact's identity.

The capture date in the file name and the capture date in the directory are the same fact
and must agree. That too is checked rather than assumed.

## 7. Naming conventions

The approved ARPI portfolio convention is:

```
ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx
```

**Underscores separate filename words. Hyphens appear only inside the ISO date.**

The canonical Granite Chevrolet artifact is:

```
ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx
```

at:

```
data/reference/inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx
```

That spelling is final. It is not renamed, not lowercased, not hyphenated, and no
duplicate, alias, symlink or second copy of it exists anywhere in the repository. There is
**no hyphenated alternative and this document does not offer one.**

The expected Granite Subaru convention, when that workbook is supplied, is:

```
data/reference/inventory/gsa-002/<yyyy-mm-dd>/ARPI_Granite_Subaru_Inventory_Sanitized_<yyyy-mm-dd>.xlsx
```

and Granite Used Auto Center:

```
data/reference/inventory/gsa-003/<yyyy-mm-dd>/ARPI_Granite_Used_Auto_Center_Inventory_Sanitized_<yyyy-mm-dd>.xlsx
```

A filename change requires an **explicit migration**, not an informal rename: the name is
declared in the contract, stamped onto every warehouse row as `source_file_name`, and
enforced by `scripts/check_reference_data.py`.

### 7.1 One declared, reviewed deviation

The committed Granite Chevrolet workbook was produced by hand **before** the naming
decision was made. Its `README` sheet's *Recommended repository path* cell still suggests
the lowercase hyphenated name that was under consideration at the time.

The committed **file** has always carried the approved underscore name at the approved
path, and every document, test, CI check and portfolio link uses that name. The cell is a
stale hint inside a data value; it is neither a repository path nor documentation.

It is declared as `legacy_path_hint` in `config/reference/inventory_listing_contract.yaml`
and keyed to that artifact's SHA-256, so the exception covers those exact bytes and
nothing else. **A new workbook carrying the same hint is refused** (DQ-LST-016), and the
sanitizer writes the approved path, so the next capture — Chevrolet or Subaru — carries the
correct hint with no exception at all. It was not corrected in place because rewriting the
artifact's bytes to fix one string would discard Excel parts `openpyxl` cannot round-trip
and would change the digest of committed evidence.

## 8. Review, retention, supersession and removal

### Review, before a workbook is committed

1. Confirm the source was publicly accessible without authentication or circumvention.
2. Run the sanitizer with `--dry-run` and read the reported counts.
3. Run the sanitizer for real and open the output.
4. Confirm the output file name follows the ARPI underscore convention.
5. Run `arpi validate-inventory --workbook <path>`; it must exit zero.
6. Run `python scripts/check_reference_data.py`; it must exit zero.
7. Add the artifact to `canonical_artifacts` in the contract with its path, row count and
   SHA-256.
8. Commit the workbook and the contract change together.

### Retention

An artifact is retained while it is declared in the contract. It is never edited in place:
a capture is a record of a moment, and editing one is not a correction.

### Supersession — a corrected workbook for a capture already loaded

The importer **refuses** a different workbook for a capture batch that has already been
loaded, because silently restating an observation is a rewrite rather than a correction.
There are exactly two supported paths:

- **Assign the corrected capture its own batch identifier** and import it as a new
  capture, leaving the original observation intact and both visible.
- **Remove the superseded batch deliberately**: delete its rows from
  `warehouse.fact_vehicle_listing_snapshot`, delete the superseded artifact, update the
  contract, and record in the pull request why the original observation was wrong.

### Removal on request

A removal request is honoured by deleting the committed artifact and its declaration, and
by deleting the loaded rows from any deployed database. There is no review period and no
requirement that the requester explain themselves.

```sql
-- Remove one capture batch. Run inside a transaction and check the counts first.
DELETE FROM warehouse.fact_vehicle_listing_snapshot WHERE source_batch_id = :batch;
DELETE FROM warehouse.dim_observed_vehicle AS d
 WHERE NOT EXISTS (SELECT 1 FROM warehouse.fact_vehicle_listing_snapshot AS f
                    WHERE f.observed_vehicle_key = d.observed_vehicle_key);
DELETE FROM raw.inventory_listing_snapshot_load WHERE source_batch_id = :batch;
```

## 9. Public-reference disclaimer

> This feature uses a de-identified public inventory reference snapshot. Dealer and
> vehicle identities are synthetic. Listing attributes are not confidential DMS data and
> do not establish sales or inventory ownership.

The following are true of every artifact here and are enforced rather than merely stated:

- Advertised price is **not** transaction price, acquisition cost, inventory investment,
  MSRP or gross.
- A listing that disappears was **removed from listing**. That is not the same as *sold*:
  it can reflect a sale, a trade, a wholesale, feed suppression or an error, and this data
  cannot tell them apart.
- **Days observed online** is not days in stock. Days in stock runs from acquisition and
  lives on `warehouse.fact_vehicle_inventory_snapshot`; this lane never sees it.
- A listing does **not** prove the vehicle was physically present or that the dealership
  owned it.
- A public reference snapshot does **not** establish current business performance.

## 10. Current contents

| Store | Capture | Artifact | Rows |
|---|---|---|---|
| GSA-001 — Granite Chevrolet of Nashua | 2026-08-02 | [`ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx`](inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx) | 199 |

Of those 199 rows: 195 New and 4 Used; 197 with a listed price and 2 call-for-price. Those
are **counts of what the artifact contains**, not findings about any dealership.

**Only GSA-001 is committed.** Neither the Granite Subaru nor the Granite Used Auto
Center workbook is in this repository, in any commit, on any branch. Their directories do
not exist and no placeholder for them exists: ADR-0011 admits an artifact only once a real
capture has been sanitized and reviewed, so generating one in advance would create a file
that has been through none of the controls this policy describes.

The convention in section 6.1 is what their artifacts must satisfy when they are supplied.
The sanitizer already derives both names correctly today —

```
arpi sanitize-inventory --input /private/path/subaru.xlsx \
  --dealership-id GSA-002 --captured-at 2026-08-02 --dry-run
```

— and reports the governed path it would write to, so the placement is checkable before a
single byte is committed.
