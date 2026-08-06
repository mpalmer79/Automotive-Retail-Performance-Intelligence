# Dashboard Diagram 03 — Export and build pipeline

How data moves from a green pipeline run to a served dashboard route, and where each check can stop
it. Mirrors the existing manifest/inventory generator pattern (generate mode locally, `--check`
byte-comparison in `prebuild`, CI, and the Docker build).

```mermaid
flowchart TB
    RUN["arpi run-foundation --load-database<br/>audit: run, validations, 58+ reconciliations"] --> OK{"Run succeeded and<br/>reconciliations passed?"}
    OK -- no --> STOP1["Exporter refuses to run"]
    OK -- yes --> EXPORT["scripts/export_dashboard_dataset.py<br/>arpi_reporter · view allowlist"]
    EXPORT --> SCAN{"Prohibited-column scan,<br/>schema match, size ceilings"}
    SCAN -- fail --> STOP2["Export fails, nothing written"]
    SCAN -- pass --> ART["data/dashboard/*.json + manifest.json<br/>hashes · row counts · recon totals"]
    ART --> CHECK1["--check mode: byte comparison<br/>(CI + local)"]
    ART --> GEN["portfolio/scripts/generate-dashboard-data.ts"]
    GEN --> VAL{"Schema valid, not stale,<br/>no duplicate ids, totals match"}
    VAL -- fail --> STOP3["Build fails"]
    VAL -- pass --> OUT["portfolio/src/generated/dashboard/<br/>payloads · chunks · client manifest"]
    OUT --> CHECK2["dashboard:check in prebuild,<br/>CI, Dockerfile.railway"]
    OUT --> BUILD["next build (standalone)<br/>server components read payloads"]
    BUILD --> DEPLOY["Railway image<br/>only traced files, no tests/scripts"]
```

**Failure philosophy.** Every arrow into a diamond is a place the pipeline prefers stopping over
emitting a number it cannot back. A stale or hand-edited artifact cannot reach a deployment because
the byte-comparison runs inside the Docker build itself.
