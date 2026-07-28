# ARPI — Phase 0 Data Flow

The path a row actually takes in **Automotive Retail Performance Intelligence (ARPI)** today, from a
configuration profile to a reporting view — including what is written to the `audit` schema along the way
and what exit code the CLI returns.

Everything in this diagram is implemented, with one clearly marked optional branch: the PostgreSQL load,
which runs only when `database.enabled` is `true`.

---

## Main flow

```mermaid
flowchart TB
    START(["arpi generate --profile P<br/>or arpi run-foundation --profile P"])

    subgraph config["1 · Configuration"]
        YAML["config/P.yaml"]
        ENV["Environment overrides<br/>ARPI_ prefix, __ delimiter"]
        MODEL["Typed settings model<br/>pydantic-settings"]
        REDACT["Password from<br/>ARPI_DATABASE__PASSWORD only<br/>rendered as ***REDACTED***"]
    end

    subgraph generate["2 · Seeded generation"]
        SEED["random_seed from profile"]
        GDATE["Date generator<br/>reporting.start_date to end_date<br/>26 columns per calendar day"]
        GDLR["Dealership generator<br/>3 fictional stores, SCD Type 2 shape"]
    end

    subgraph validate["3 · In-memory validation"]
        VD["DQ-DATE-001 … DQ-DATE-005"]
        VL["DQ-DLR-001 … DQ-DLR-005"]
        VG["DQ-GEN-001 · DQ-GEN-002"]
        GATE{"Any critical<br/>check failed?"}
    end

    subgraph write["4 · Output"]
        RAWCSV["data/raw/P/<br/>dim_date.csv · dim_dealership.csv"]
        SAMPLE["data/sample/<br/>capped extract, committed"]
        MANIFEST["generation_manifest.json<br/>seed, dates, row and column counts,<br/>SHA-256 digest per entity"]
    end

    subgraph load["5 · Optional PostgreSQL load"]
        ENABLED{"database.enabled?"}
        RAWT["raw.calendar_date_load<br/>raw.dealership_load<br/>all text + load lineage"]
        STGV["staging.stg_calendar_date<br/>staging.stg_dealership<br/>typed views, latest batch"]
        DIM["warehouse.dim_date<br/>warehouse.dim_dealership"]
        RVIEW["reporting.vw_calendar<br/>reporting.vw_dealership<br/>reporting.vw_pipeline_run_summary<br/>reporting.vw_data_quality_summary"]
    end

    OK(["Exit 0 · succeeded"])
    FAIL(["Exit non-zero · failed"])
    SKIP["Load skipped<br/>files and manifest still written"]

    START --> YAML
    YAML --> MODEL
    ENV --> MODEL
    REDACT --> MODEL
    MODEL --> SEED
    SEED --> GDATE
    SEED --> GDLR
    GDATE --> VD
    GDLR --> VL
    GDATE --> VG
    GDLR --> VG
    VD --> GATE
    VL --> GATE
    VG --> GATE

    GATE -- "yes" --> FAIL
    GATE -- "no" --> RAWCSV
    RAWCSV --> MANIFEST
    RAWCSV --> SAMPLE
    MANIFEST --> ENABLED

    ENABLED -- "false" --> SKIP
    SKIP --> OK
    ENABLED -- "true" --> RAWT
    RAWT --> STGV
    STGV --> DIM
    DIM --> RVIEW
    RVIEW --> OK

    classDef step fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#0b1b3a
    classDef store fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#052e16
    classDef decision fill:#fef9c3,stroke:#a16207,stroke-width:2px,color:#3f2d04
    classDef good fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#052e16
    classDef bad fill:#fee2e2,stroke:#b91c1c,stroke-width:2px,color:#450a0a

    class YAML,ENV,MODEL,REDACT,SEED,GDATE,GDLR,VD,VL,VG,SKIP,START step
    class RAWCSV,SAMPLE,MANIFEST,RAWT,STGV,DIM,RVIEW store
    class GATE,ENABLED decision
    class OK good
    class FAIL bad
```

---

## Audit capture

The `audit` schema is written alongside the main flow, not at the end of it. If a run fails, the audit
record of why it failed already exists.

```mermaid
flowchart LR
    RUNSTART["Pipeline run opens"]
    CHECKS["Each validation check completes"]
    LAYERS["Each layer load completes"]
    REJECTS["A record is rejected"]
    RECON["A reconciliation is evaluated"]
    RUNEND["Pipeline run closes"]

    PR[("audit.pipeline_run<br/>run_uuid, profile, seed,<br/>arpi_version, status, counts")]
    RC[("audit.pipeline_run_row_count<br/>entity × layer × row_count")]
    VR[("audit.validation_result<br/>check_id, severity, status,<br/>observed vs expected")]
    RR[("audit.reconciliation_result<br/>left vs right, tolerance, status")]
    XR[("audit.rejected_record<br/>code, reason, payload")]

    RUNSTART --> PR
    RUNEND --> PR
    CHECKS --> VR
    LAYERS --> RC
    REJECTS --> XR
    RECON --> RR

    PR --> SUMMARY["reporting.vw_pipeline_run_summary"]
    VR --> DQ["reporting.vw_data_quality_summary"]

    classDef step fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#0b1b3a
    classDef store fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#052e16
    class RUNSTART,CHECKS,LAYERS,REJECTS,RECON,RUNEND step
    class PR,RC,VR,RR,XR,SUMMARY,DQ store
```

A run is opened with `status = 'running'` before any generation happens, and closed as `succeeded`,
`failed`, or `aborted`. The `run_uuid` ties every child row back to its run, so a failed run is fully
inspectable in SQL after the fact.

---

## CLI exit-code behaviour

| Situation | Exit code | What is written |
|---|---:|---|
| All checks pass, database disabled | `0` | CSV, sample extract, manifest. Audit rows only if a database is configured for audit capture |
| All checks pass, database enabled, load succeeds | `0` | Everything above, plus `raw`, `staging`, `warehouse`, `reporting`, and a `succeeded` run |
| A **critical** validation check fails | non-zero | Manifest and CSV are not written for the failed entity; the run is recorded as `failed` with `critical_failure_count > 0` |
| Only **warning**-severity checks fail | `0` | Full output. The run is `succeeded` with `warning_count > 0`, and the warnings are queryable in `audit.validation_result` |
| Configuration is invalid or a profile is missing | non-zero | Nothing generated. The failure is reported as a named configuration error |
| Database enabled but unreachable | non-zero | CSV and manifest are already written; the run is recorded as `failed` |

Warnings never fail the pipeline and critical failures always do. That split is a property of each check's
declared severity, not of the caller, so the same command behaves identically in a terminal and in CI.

---

## Determinism

The same profile and the same seed produce byte-identical CSV output on any machine. This is deliberate
and load-bearing:

- The generation manifest carries a SHA-256 digest of each entity's CSV bytes, and `DQ-GEN-002` records
  that digest as evidence.
- The manifest contains **no wall-clock timestamp**. It records
  `"timestamp_policy": "omitted for deterministic output"` instead, because a timestamp would make every
  regeneration produce a diff.
- Holidays are computed in-process from closed-form rules, with no external holiday library whose release
  history could change last year's output. See
  [ADR-0002](../architecture-decisions/ADR-0002-phase-0-technology-baseline.md), decision 10.

Regenerating the committed sample data should therefore produce an empty `git diff`. If it does not,
something changed that deserves a look.

---

## Related

- [`01-system-context.md`](01-system-context.md) — the wider view including planned consumers
- [`03-initial-dimensional-model.md`](03-initial-dimensional-model.md) — the objects this flow populates
- [`../../DATA_GENERATION.md`](../../DATA_GENERATION.md) — generation methodology
- [`../database-setup.md`](../database-setup.md) — enabling the optional PostgreSQL branch

*All data is synthetic. Granite State Auto Group is fictional.*
