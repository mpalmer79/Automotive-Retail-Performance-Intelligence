# Automotive Retail Performance Intelligence (ARPI)

A governed, reproducible analytics platform for a fictional three-store automotive dealer group — synthetic operational data, a PostgreSQL dimensional warehouse, and one consistent set of KPI definitions that a dealership manager could actually act on.

![Status](https://img.shields.io/badge/status-Phase%200%20foundation-blue)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**Status (plain text):** Analytical warehouse and reporting layer complete; Power BI not started. Python 3.11 or newer. PostgreSQL 16. MIT licensed. All eight MVP dimensions, all five MVP facts, twenty-eight reporting views, and all 29 KPIs in [`KPI_CATALOG.md`](KPI_CATALOG.md) are implemented, computable and tested. **No Power BI report, no semantic model, no dashboard, and no analytical findings exist** — Gate 1 gates that work and its verdict is recorded in [`docs/requirements/GATE_1_READINESS.md`](docs/requirements/GATE_1_READINESS.md). See [Current implementation status](#current-implementation-status).

---

> ### ⚠️ This repository contains no real data
>
> **Every record in this project is synthetic.** There is no real dealership, customer, employee, vehicle-owner, lender, or lending data anywhere in this repository, and none will ever be added.
>
> **Granite State Auto Group is fictional.** The group, its three stores, its staff, and its customers do not exist. They were invented to give the data model a coherent business context.
>
> All figures are generated from documented rules and a fixed random seed. Nothing here should be read as, compared against, or cited as the performance of any real automotive retailer. See [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md) and [LIMITATIONS.md](LIMITATIONS.md).

---

## Contents

- [Purpose](#purpose)
- [The business problem](#the-business-problem)
- [Who this is for](#who-this-is-for)
- [Core analytical domains](#core-analytical-domains)
- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Current implementation status](#current-implementation-status)
- [Roadmap](#roadmap)
- [Local development](#local-development)
- [Testing and quality](#testing-and-quality)
- [Synthetic data and privacy](#synthetic-data-and-privacy)
- [Documentation](#documentation)
- [License](#license)
- [Author](#author)

---

## Purpose

ARPI is a portfolio project built to demonstrate, on real artifacts rather than assertions, the work an analyst actually does: turning operating questions into measurable definitions, modelling the data those definitions need, generating it reproducibly, proving it is correct, and reporting it in a form a manager can act on.

It is deliberately not a production system. It is not a DMS, a CRM, a desking tool, a retail website, or an AI assistant. `ARCHITECTURE.md` §6 lists what is excluded and why, and the scope gates in §28 exist to keep it that way.

The project is opinionated about honesty. Every status label in this repository is literal: if something says **Planned**, it does not exist yet.

---

## The business problem

Dealership data is fragmented across DMS, CRM, inventory, marketing, F&I, and service systems. Each system reports its own version of the truth, on its own schedule, using its own definitions. A general manager asking a straightforward question often cannot get a straightforward answer.

The questions that go unanswered are the expensive ones:

| Question | Why it is hard today |
|---|---|
| Why did sales or gross change this month? | Volume, mix, discounting, and inventory effects live in different systems |
| Which inventory is becoming financially risky? | Age, market position, and markdown history are rarely on one screen |
| Where are leads being lost? | CRM funnel stages do not reconcile to closed deals |
| Does this marketing source generate profitable business? | Spend and attributed gross are never in the same report |
| Which employees produce balanced results? | Rankings ignore lead quality, store traffic, tenure, and mix |
| Which service customers are credible replacement opportunities? | Fixed operations and sales data do not connect |

ARPI answers these from one governed analytical model with consistent KPI definitions and traceable business logic — every number tied to a documented formula, a declared grain, and a validated source. Condensed from [`ARCHITECTURE.md` §4](ARCHITECTURE.md).

---

## Who this is for

| Persona | What they need from the platform |
|---|---|
| **Dealer principal** | Group-level performance, target attainment, and where to direct attention |
| **General manager** | Store-level variance explanation across sales, gross, inventory, and conversion |
| **General sales manager** | Volume, gross, and closing performance by team, source, and vehicle mix |
| **Used-car manager** | Inventory age, price-to-market position, markdown effectiveness, days supply |
| **Internet / BDC director** | Funnel conversion, response time, appointment show rates by source and rep |
| **Finance director** | F&I penetration, product mix, and the effect of cancellations and chargebacks |
| **Marketing manager** | Cost per lead, cost per sale, and gross return by campaign and channel |
| **Data / BI analyst** | Documented grains, lineage, KPI definitions, and reproducible data quality evidence |

Secondary audiences include regional operations, fixed-operations, and new-car managers. The full persona set is recorded in [`docs/research.md`](docs/research.md) §11.3.

---

## Core analytical domains

| Domain | Central questions |
|---|---|
| **Vehicle sales and gross** | Units, front-end and back-end gross, discounting, new versus used |
| **Inventory health** | Aging, days supply, turn, capital at risk, price-to-market |
| **Lead funnel and BDC** | Contact rate, appointment set and show rates, lead-to-sale conversion, response time |
| **Employee performance** | Balanced volume, conversion, gross, and process compliance — always with context |
| **Marketing performance** | Cost per lead, cost per sale, gross return on advertising spend |
| **F&I performance** | Product penetration, products per retail unit, cancellations and chargebacks |
| **Customer retention** | Repeat purchase behaviour and cohort return rates |
| **Service-to-sales** | Qualified vehicle-replacement opportunities from the service lane |
| **Data quality** | Validation outcomes, reconciliation status, and pipeline run history |

Definitions, formulas, grains, inclusion and exclusion rules, and known limitations for each KPI live in [KPI_CATALOG.md](KPI_CATALOG.md). No KPI exists in this project as an unexplained dashboard measure.

---

## Technology stack

### In use now

| Technology | Role |
|---|---|
| **Python 3.11+** | Synthetic data generation, validation, orchestration, CLI |
| **pandas** | Tabular shaping and CSV output |
| **pydantic** / **pydantic-settings** | Typed, validated, environment-overridable configuration |
| **PostgreSQL 16** | Raw, staging, warehouse, reporting, and audit schemas (optional for generation) |
| **psycopg 3** | Database driver, installed via the `db` extra |
| **SQL** | Schema definition, dimension loads, reporting views, roles, data-quality checks |
| **pytest** / **pytest-cov** | Unit, data-quality, and integration tests |
| **Ruff** | Linting and formatting — the single tool for both |
| **mypy** | Static type checking of `src` and `tests` |
| **GitHub Actions** | Continuous integration |
| **Markdown** / **Mermaid** | Documentation and source-controlled diagrams |

### Planned

| Technology | Role | Phase |
|---|---|---|
| **Power BI Desktop**, Power Query, DAX | Semantic model and the primary analytical deliverable | Later |
| **Excel** | One supporting management operating report | Later |
| **NHTSA vPIC** | Approved public vehicle-attribute enrichment | Phase 1.1 |
| **Supabase** or equivalent managed PostgreSQL | Shared endpoint once a semantic model needs one | Deferred |

Rationale for the non-obvious choices — Ruff over black-plus-isort-plus-flake8, stdlib `argparse` over click or typer, local PostgreSQL over hosted, and the deterministic holiday rule — is recorded in [ADR-0002](docs/architecture-decisions/ADR-0002-phase-0-technology-baseline.md).

---

## Architecture

ARPI is a layered batch pipeline. Synthetic source data is generated deterministically from a seeded configuration profile, validated in memory, written to CSV with a content-digest manifest, and optionally loaded into PostgreSQL, where it passes through `raw` → `staging` → `warehouse` → `reporting`. Every run records its outcome in the `audit` schema.

```mermaid
flowchart LR
    CFG["Config profile<br/>development / test / portfolio"]
    GEN["Python generator<br/>seeded and deterministic"]
    VAL["Validation framework"]
    CSV["CSV + generation manifest"]
    PG[("PostgreSQL<br/>raw / staging / warehouse / reporting")]
    AUD[("Audit schema")]
    PUB["Approved public vehicle data<br/>NHTSA vPIC (planned)"]
    PBI["Power BI semantic model (planned)"]
    RPT["Power BI reports (planned)"]
    XLS["Excel operating report (planned)"]
    CASE["Static portfolio case study (planned)"]

    CFG --> GEN
    PUB -.-> GEN
    GEN --> VAL
    VAL --> CSV
    CSV --> PG
    VAL --> AUD
    PG --> AUD
    PG -.-> PBI
    PBI -.-> RPT
    PG -.-> XLS
    RPT -.-> CASE
    XLS -.-> CASE

    classDef now fill:#dbeafe,stroke:#1d4ed8,color:#0b1b3a
    classDef planned fill:#f4f4f5,stroke:#a1a1aa,color:#3f3f46,stroke-dasharray: 5 3
    class CFG,GEN,VAL,CSV,PG,AUD now
    class PUB,PBI,RPT,XLS,CASE planned
```

Solid borders and solid arrows are implemented today. Dashed grey nodes and dashed arrows are planned. A larger version with a full legend is in [`docs/diagrams/01-system-context.md`](docs/diagrams/01-system-context.md); the detailed Phase 0 flow, the dimensional model, and a component map are alongside it in [`docs/diagrams/`](docs/diagrams/).

**Layer responsibilities**

| Schema | Purpose |
|---|---|
| `raw` | Unmodified imported source records, all columns as text, with load lineage |
| `staging` | Typed and deduplicated views over raw, exposing the most recent load batch |
| `warehouse` | Conformed dimensions and facts at explicitly declared grain |
| `reporting` | Stable documented views — the only surface Power BI and Excel may read |
| `audit` | Pipeline runs, row counts, validation results, reconciliations, rejected records |

Full detail is in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Repository structure

```text
Automotive-Retail-Performance-Intelligence/
├── src/arpi/          Python package: config, logging, generators,
│                      validation, writers, database load, audit, CLI
├── sql/               Ordered, re-runnable build scripts (00_database … 08_validation)
├── config/            development.yaml, test.yaml, portfolio.yaml
├── tests/             unit/, data_quality/ (no database) · integration/ (needs PostgreSQL)
├── data/              raw/ (gitignored) · sample/ (committed) · external/
├── docs/              index.md, research.md, database-setup.md,
│                      architecture-decisions/, diagrams/, requirements/, source-to-target/
├── scripts/           Repository governance checks
├── .github/workflows/ Continuous integration
├── notebooks/         Empty — no notebooks exist yet
├── powerbi/           Model documentation only — no PBIX, PBIP, TMDL or BIM file exists
├── excel/             Empty — no workbook exists yet
└── portfolio/         Empty — case study and launch material not written yet
```

The annotated tree, with an explicit `[now]` / `[empty]` / `[planned]` marker on every entry, is in [`ARCHITECTURE.md` §24](ARCHITECTURE.md).

---

## Current implementation status

Labels are used strictly. **Implemented** means it exists and runs today.

| Area | Status | Notes |
|---|---|---|
| Typed configuration (`development`, `test`, `portfolio` profiles) | Implemented | pydantic-settings, `ARPI_` environment overrides, password never in YAML |
| Logging | Implemented | Text or JSON, level set per profile, credentials redacted |
| Date dimension generator | Implemented | `warehouse.dim_date`, 26 columns, deterministic holiday and selling-day rules |
| Dealership dimension generator | Implemented | `warehouse.dim_dealership`, SCD Type 2 structure, three fictional stores |
| Twelve further generators | Implemented | Vehicle model, vehicle, employee, customer, lead source, campaign, acquisition, sale, inventory snapshot, lead, appointment, marketing spend |
| Validation framework | Implemented | 114 checks across fourteen `DQ-*` families on a `development` run, with severities, run in memory before any load |
| CSV and manifest writer | Implemented | Deterministic CSV plus `generation_manifest.json` with SHA-256 content digests |
| PostgreSQL load of every dimension and fact | Implemented | Optional; `database.enabled` defaults to `false`. A rerun produces identical warehouse counts. |
| Audit recording | Implemented | Pipeline runs, row counts, validation results, reconciliations, rejected records |
| Command-line interface | Implemented | `arpi version`, `arpi check-config`, `arpi generate`, `arpi run-foundation` |
| SQL: schemas, roles, raw, staging, dimensions, facts, audit, reporting, validation | Implemented | Ordered and re-runnable; `arpi_admin` / `arpi_loader` / `arpi_reporter`, with the reporter provably unable to read any pipeline layer |
| Test suite | Implemented | Unit, data-quality, and integration tests; coverage gate at 85% |
| Continuous integration | Implemented | Lint, format check, types, tests, naming check, documentation-link check |
| Documentation set | Implemented | Architecture, data dictionary, KPI catalog, generation, privacy, limitations, ADRs, diagrams |
| Committed sample dataset | Implemented | Small synthetic extract under `data/sample/` |
| `dim_vehicle_model`, `dim_vehicle`, `dim_employee`, `dim_customer`, `dim_lead_source`, `dim_marketing_campaign` | Implemented | All eight MVP dimensions are built, populated and documented |
| `fact_vehicle_sale`, `fact_vehicle_inventory_snapshot`, `fact_lead`, `fact_appointment`, `fact_marketing_spend` | Implemented | All five MVP facts, each with its grain enforced by a UNIQUE constraint and tested |
| `fact_lead_activity`, `fact_inventory_price_history`, `fact_finance_product_sale` | Deferred | Beyond the MVP — [`DATA_DICTIONARY.md` §27](DATA_DICTIONARY.md) |
| `dim_finance_product`, `dim_lender`, `dim_sale_type`, `dim_inventory_source`, `dim_geography` | Deferred | Beyond the MVP — [`DATA_DICTIONARY.md` §27](DATA_DICTIONARY.md) |
| MVP reporting layer | Implemented | Twenty-eight views: eight dimension, five grain-preserving fact, thirteen governed analytical |
| All 29 MVP KPIs | Implemented | Computable from `reporting`, each tested against an independent derivation from `warehouse` |
| Reconciliation suite | Implemented | Fifty-eight results recorded on every database run; every critical rule proven to fail against a corrupted fixture |
| Power BI model documentation | Implemented | `powerbi/model_documentation/` — the specification Gate 1 produces, not a model |
| Stakeholder-question traceability matrix | Implemented | [`docs/requirements/STAKEHOLDER_QUESTIONS.md`](docs/requirements/STAKEHOLDER_QUESTIONS.md) |
| Gate 1 readiness review | Implemented | [`docs/requirements/GATE_1_READINESS.md`](docs/requirements/GATE_1_READINESS.md) |
| NHTSA vPIC public enrichment | Planned | Phase 1.1 |
| Power BI semantic model and reports | Planned | After Gate 1 opens. Nothing has been built; `tests/integration/test_gate1_readiness.py` fails if a `.pbix`, `.pbip`, `.tmdl` or `.bim` file appears. |
| Excel operating report | Planned | Post-MVP |
| Executive findings and recommendations | Planned | Blocked by Gate 2. Nothing has been analysed, and no conclusion drawn from synthetic data would say anything about the industry. |
| Jupyter notebooks | Planned | Directory exists and is empty |
| Managed hosting on Supabase | Deferred | Local PostgreSQL is sufficient until a shared endpoint is needed — [ADR-0002](docs/architecture-decisions/ADR-0002-phase-0-technology-baseline.md) |
| Portfolio case study, walkthrough video, launch material | Deferred | Packaging work, after the analytical system is complete |
| Real dealership, customer, or lending data | Out of scope | Permanently excluded |
| Production DMS or CRM integration, live lender integration | Out of scope | [`ARCHITECTURE.md` §6](ARCHITECTURE.md) |
| Real-time streaming, Kafka, Airflow, Kubernetes, microservices | Out of scope | Batch refresh is sufficient for the objective |
| Machine learning added for presentation value | Out of scope | Gated behind a documented business question — [`ARCHITECTURE.md` §28](ARCHITECTURE.md) |
| A second dashboard in Tableau, React, or Next.js | Out of scope | Would duplicate the Power BI deliverable |

---

## Roadmap

**Phase 0 — Foundation · complete**
Repository, typed configuration, logging, the date and dealership dimensions end to end, validation, audit, CLI, SQL build scripts, tests, CI, and the governing documentation set.

**Phase 1 — Analytical warehouse and reporting layer · complete**
All eight MVP dimensions, all five MVP facts, twenty-eight reporting views, all 29 KPIs computable and
tested, fifty-eight reconciliations recorded on every run, and a formal Gate 1 review.

| Increment | Focus | Delivered |
|---|---|---|
| **1.1** | Source generation | Vehicle model contract and catalogue, vehicle generator, employee generator, customer generator, inventory acquisition events, sales source events |
| **1.2** | Ingestion, dimensions, and the first two facts | Raw and staging ingestion; `dim_vehicle`, `dim_employee` and `dim_customer`; `fact_vehicle_sale`; `fact_vehicle_inventory_snapshot` |
| **1.3** | Validation, reconciliation, and KPI logic | Sales and inventory validation, gross reconciliation, inventory-age logic, days-to-sale logic, the sales and inventory reporting views |
| **1.4** | Lead funnel | `dim_lead_source`; lead and appointment generators; `fact_lead` and `fact_appointment`; funnel reconciliation |
| **1.5** | Marketing, profitability, and MVP readiness | `dim_marketing_campaign` and `fact_marketing_spend`, source-level profitability, the MVP reporting layer, the stakeholder-question matrix, the Gate 1 readiness review |

**Later phases**, aligned to [`ARCHITECTURE.md` §27](ARCHITECTURE.md): the Power BI semantic model, the seven unblocked report pages, executive findings and recommendations, the Excel operating report, and portfolio packaging. Gate 1 controls the first of those, and the verdict with its evidence is recorded in [`docs/requirements/GATE_1_READINESS.md`](docs/requirements/GATE_1_READINESS.md).

The task-level breakdown for Phase 1 is in [`docs/requirements/PHASE_1_BACKLOG.md`](docs/requirements/PHASE_1_BACKLOG.md).

---

## Local development

Requires Python 3.11 or newer. Nothing below needs a database.

```
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,db]"
arpi check-config --profile development
arpi generate --profile development
arpi run-foundation --profile development
```

| Command | What it does |
|---|---|
| `arpi version` | Prints the project name and version and exits |
| `arpi check-config --profile development` | Loads, validates, and prints the resolved configuration with secrets redacted |
| `arpi generate --profile development` | Generates the date and dealership dimensions, validates them, and writes CSV plus the manifest |
| `arpi run-foundation --profile development` | Runs the full foundation pipeline, including the PostgreSQL load when `database.enabled` is `true` |

Commands exit `0` on success and non-zero when a critical validation check fails, so they compose in scripts and CI.

**No Supabase account and no database credentials are required** to generate data, run validation, or run the test suite. The database is entirely optional at this stage: `database.enabled` is `false` by default, and `database.password` is never read from a configuration file — only from `ARPI_DATABASE__PASSWORD` or a `PGPASSWORD` fallback.

To exercise the SQL layer and the integration tests, set up PostgreSQL locally by following [`docs/database-setup.md`](docs/database-setup.md).

Configuration is overridable per key from the environment using the `ARPI_` prefix and `__` as the nested delimiter, for example `ARPI_LOGGING__LEVEL=DEBUG` or `ARPI_DATABASE__HOST=localhost`. See [`.env.example`](.env.example).

---

## Testing and quality

```
ruff format --check .
ruff check .
mypy src tests
pytest -m "not integration" --cov=arpi --cov-report=term-missing --cov-report=xml
pytest -m "integration"        # only in the optional postgres job
python scripts/check_naming.py
python scripts/check_docs_links.py
python scripts/check_secrets.py
```

These are exactly the commands continuous integration runs.

- **Unit and data-quality tests need no database.** The default run excludes the `integration` marker explicitly, so a reviewer with a clean checkout gets a green suite without installing PostgreSQL.
- **Coverage** is measured on `src/arpi` with a floor of 85%.
- **`check_naming.py`** fails the build if a retired identifier reappears — the enforcement mechanism behind [ADR-0001](docs/architecture-decisions/ADR-0001-project-identity.md).
- **`check_docs_links.py`** fails the build if a relative documentation link stops resolving.
- **`check_secrets.py`** fails the build if a tracked file looks like it contains a credential — a committed `.env`, a live connection string, or a private key. It is a high-signal safety net, not a full secret scanner.

Contribution workflow and quality expectations are in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Synthetic data and privacy

Every record is generated by the code in this repository from documented statistical rules and a fixed random seed. No real data of any kind was used, obtained, scraped, or approximated from a real source.

- **No PII is generated.** The data model prohibits names, street addresses, email addresses, phone numbers, full birth dates, government identifiers, and bank information. Age is stored as a band; geography stops at county or market area.
- **No real VIN is linked to a synthetic customer.** Any VIN-like identifier is synthetic or masked.
- **No credentials are committed.** Only `.env.example` is tracked, and it contains no secret values.
- **The only external data is public and approved.** NHTSA vPIC vehicle attributes are planned enrichment; public reference data is stored separately from synthetic dealership data, with its source and license documented.
- **Results are never presented as real performance.** Findings, when they exist, will be labelled as observations about a synthetic dataset.

The generator is deterministic: the same profile and seed reproduce byte-identical output, and each entity's manifest entry carries a SHA-256 digest of its CSV bytes.

Full detail in [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md), [DATA_GENERATION.md](DATA_GENERATION.md), and [LIMITATIONS.md](LIMITATIONS.md). Security policy is in [SECURITY.md](SECURITY.md).

---

## Documentation

Start at the [documentation hub](docs/index.md), which explains the hierarchy and offers reading paths by audience.

### Governing

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The binding technical architecture, scope, non-goals, and phase plan |
| [docs/architecture-decisions/ADR-0001-project-identity.md](docs/architecture-decisions/ADR-0001-project-identity.md) | Project identity and naming convention |
| [docs/architecture-decisions/ADR-0002-phase-0-technology-baseline.md](docs/architecture-decisions/ADR-0002-phase-0-technology-baseline.md) | Phase 0 technology choices and their trade-offs |
| [docs/architecture-decisions/](docs/architecture-decisions/) | ADR index, format, and conventions |

### Contracts

| Document | Purpose |
|---|---|
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Every table and column, with types, nullability, and meaning |
| [KPI_CATALOG.md](KPI_CATALOG.md) | Governed KPI definitions, formulas, grains, and limitations |
| [docs/source-to-target/](docs/source-to-target/) | Source-to-target mappings and transformation lineage |

### Implementation guides

| Document | Purpose |
|---|---|
| [DATA_GENERATION.md](DATA_GENERATION.md) | How the synthetic data is produced and why it behaves as it does |
| [docs/database-setup.md](docs/database-setup.md) | Optional local PostgreSQL setup and the SQL build order |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow, standards, and quality gates |
| [SECURITY.md](SECURITY.md) | Secret handling and vulnerability reporting |

### Evidence and constraints

| Document | Purpose |
|---|---|
| [LIMITATIONS.md](LIMITATIONS.md) | What this data and analysis genuinely cannot support |
| [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md) | Privacy design and ethical analytics commitments |
| [docs/research.md](docs/research.md) | The preserved research evidence base behind the architecture |
| [docs/diagrams/](docs/diagrams/) | Source-controlled Mermaid diagrams |

### Planning

| Document | Purpose |
|---|---|
| [docs/requirements/PHASE_1_BACKLOG.md](docs/requirements/PHASE_1_BACKLOG.md) | Task-level breakdown of Phase 1.1 through 1.5 |
| [docs/index.md](docs/index.md) | Documentation hub and reading paths |

---

## License

Released under the MIT License. Copyright © 2026 Michael Palmer. See [LICENSE](LICENSE).

The license covers the code and documentation in this repository. The synthetic data it produces is likewise free to use, with the obvious caveat that it describes nothing real.

---

## Author

**Michael Palmer**

Built on more than 25 years in automotive retail, combined with SQL, PostgreSQL, Python, and business intelligence work. The domain judgement in this project — what a gross number actually means, why an employee ranking without context is misleading, which service customers are genuinely replacement opportunities — comes from having worked the floor, not from reading about it.

Questions, corrections, and critique are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
