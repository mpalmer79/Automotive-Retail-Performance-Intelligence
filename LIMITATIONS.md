# Limitations and Operational Readiness — Automotive Retail Performance Intelligence (ARPI)

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [KPI_CATALOG.md](KPI_CATALOG.md) · [DATA_GENERATION.md](DATA_GENERATION.md) · [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md)

<!-- ARPI:CAPABILITIES:BEGIN review-metadata -->
**Register version:** 2.0  
**Last reviewed:** 2026-08-01  
**Last verified at commit:** `32b52ce`

This header is generated from `config/project_capabilities.json`. A review date typed into a document is the first thing to go stale, and a limitations register with a stale header has already lost the argument.
<!-- ARPI:CAPABILITIES:END review-metadata -->

---

## 1. Executive limitation summary

Read this section and section 2. Everything after them is detail.

ARPI analyses a fictional three-store dealership group using entirely synthetic data generated from a fixed
random seed. **It contains no real dealership data, no real customers, no real employees and no real
transactions, and it therefore produces no finding about the automotive retail industry.** Every KPI
definition is ARPI's own, there is no industry benchmark anywhere in the project, and nothing here can tell
you whether a number is good.

The analytical warehouse is complete and the reporting layer above it is built. The Power BI semantic model
**exists as source** — a PBIP project with the model in TMDL, its measures written in DAX, statically checked
against its specification — and **no engine has ever loaded it, refreshed it or evaluated one of its
measures**. Static parsing is not execution. The report is a shell with zero pages, so **no dashboard
exists**, and **no analytical finding has been drawn**.

The portfolio website **is deployed**, and that is a smaller claim than it looks. It is a set of prerendered
routes with **no database connection at all**, so a reachable site is evidence that a static build is being
served and nothing whatever about PostgreSQL, which is still unprovisioned, or about the semantic model,
which no engine has run. Section 8 keeps those three apart deliberately, because collapsing them is the most
available way for this project to overstate itself.

What this repository legitimately demonstrates is **method** — dimensional modelling, KPI governance,
reproducible data generation, validation, reconciliation, and documentation that fails a build when it
drifts from its evidence — and nothing beyond that.

**The four classifications used throughout this document:**

| Classification | Meaning | Where |
|---|---|---|
| **Inherent** | Follows from what ARPI is. No amount of work removes it. | Section 3, section 6 |
| **Temporary delivery gap** | Work that is sequenced and not yet done. Has an exit condition. | Section 4 |
| **Operational maturity gap** | The capability exists but has never been operated, scheduled or proven under use. | Section 5 |
| **Resolved with residual limitation** | Fixed going forward, with a consequence that survives the fix. | Section 9 |

---

## 2. Current verified project state

Generated from the repository on every run. Nothing below is typed by hand, so no count here can drift from
the source it describes.

<!-- ARPI:CAPABILITIES:BEGIN current-state -->
| Item | State | Evidence |
|---|---|---|
| Warehouse dimensions | 8 | `sql/03_dimensions/` |
| Warehouse facts | 5 | `sql/04_facts/` |
| Reporting views | 28 | `sql/05_reporting/` |
| Governed KPIs | 29 | `powerbi/validation/model_expectations.json` |
| PBIP source | present | 2 project file(s) |
| TMDL files | 30 | `…SemanticModel/definition/` |
| Semantic tables | 26 | `…/definition/tables/` |
| Relationships | 42 | `…/definition/relationships.tmdl` |
| DAX measures | 49 | declared in TMDL, never evaluated |
| Static model validation | enforced in CI | `scripts/check_powerbi_model.py` |
| Desktop validation | pending | `validated_at` is null |
| Fabric validation | pending | `validated_at` is null |
| Report pages | 0 | PBIR shell |
| Report visuals | 0 | PBIR shell |
| Analytical findings | 0 | `docs/findings/` |
| Portfolio deployment | staging live at https://arpi.up.railway.app | health verification is recorded |
| PostgreSQL deployment | declared | independent of the website; a live site proves nothing here |
| Database provisioning | declared | job `arpi-database-setup`, last run UNVERIFIED |
| Gate 1 | OPEN | `docs/requirements/GATE_1_READINESS.md` |
| Gate 2 | CLOSED | the PBIR report defines zero pages; no engine has refreshed the model, so no Power BI total exists to reconcile |
| Case study | locked | gated behind Gate 2 |
| Lifecycle Phase 5 (semantic model) | in-progress | blocked on real-engine validation |
| Lifecycle Phase 8 (case study) | not-started | blocked on Gate 2 |

Every row is read from the repository or from a declared status the repository does not refute. `UNVERIFIED` means this project's own automation did not obtain the fact, which is not the same as the fact being false.
<!-- ARPI:CAPABILITIES:END current-state -->

**Three distinctions this table is built to preserve.** They are the ones that go wrong first:

1. **Source existing is not an engine having run.** The semantic model is committed and statically checked.
   No engine has executed it.
2. **A deployed website is not a deployed analytical platform.** They are separate services with separate
   evidence, and the website holds no database credential.
3. **A gate is a recorded verdict, not a derivation.** Nothing in this repository can open Gate 2 by
   computing something. Section 11 says what would have to be observed first.

---

## 3. Inherent limitations

These follow from what ARPI is. They have no exit condition, and a reviewer should not read them as work
outstanding.

### 3.1 The data is synthetic — every record, without exception

Every operational record is generated by ARPI's own code from a fixed seed. Nothing has been observed;
everything has been invented. `docs/research.md` §5.1 establishes that this is necessary — no public dataset
contains an integrated dealership record covering leads, appointments, salespeople, inventory history,
deal-level gross, F&I, marketing spend and service retention together — but necessity does not remove the
consequences.

- **Every relationship in the data was put there on purpose.** [ARCHITECTURE.md §15.3](ARCHITECTURE.md)
  lists sixteen relationships the generator must encode. Finding one of them in a dashboard confirms the
  generator works; it says nothing about real dealerships.
- **The absence of a relationship is equally uninformative.** ARPI does not model floor-plan interest,
  personnel expense, facility overhead or manufacturer incentives. Their absence is a scope decision.
- **Distributions are plausible, not validated.** Nothing in ARPI has been checked against a real dealership
  distribution, because no such data is available to this project.
- **Change the seed and every number changes.** A finding that survives only one seed is an artefact.

**For a reviewer.** Judge the modelling, the governance and the engineering. Do not treat any ARPI figure as
evidence about the automotive retail industry, and treat any narrative phrased as "in dealerships…" rather
than "in this synthetic dataset…" as an error worth flagging.

### 3.2 No real dealership benchmarks, and therefore no benchmark comparison

ARPI has no licensed, citable source of real dealership performance data. It therefore **states no industry
benchmark anywhere**, and **makes no comparison against one anywhere**. This is a hard rule, not a caveat.

[KPI_CATALOG.md](KPI_CATALOG.md) contains no benchmark values, no "good" ranges and no targets. Where a
numeric threshold appears, it is a **project default with a cited source**, and it is a parameter of the
calculation rather than a standard:

| Threshold | Value | Source | What it is |
|---|---|---|---|
| Aged-inventory age threshold | 60 days | [ARCHITECTURE.md §18.2](ARCHITECTURE.md) | A project default, exposed as a report parameter |
| Days-supply trailing window | 30 days | [ARCHITECTURE.md §18.2](ARCHITECTURE.md) | A project default, exposed as a report parameter |
| Selling-day ratio bounds | 0.80 – 1.00 | `config/*.yaml` `validation` block | A sanity bound on holiday arithmetic, not a business measure |
| Inventory age buckets | 0–15, 16–30, 31–45, 46–60, 61–90, 90+ days | `docs/research.md` §4.3 | Reporting buckets, not performance standards |

`docs/research.md` §5.4 notes that NADA aggregate reports may be used for **contextual plausibility checks
and industry framing only** — aggregate data at a different grain, which cannot support dealership-level
comparison. `fact_sales_target` values are **fictional operating goals for a fictional group**, never
industry benchmarks ([DATA_DICTIONARY.md §41](DATA_DICTIONARY.md)). The fact is Implemented as of
`DASH.5`, so this is no longer a statement about the future: the console renders those goals today, and
every surface that shows one carries the disclosure that it is synthetic and not a benchmark.

**For a reviewer.** A sentence of the form "X is above or below industry average" is a defect. Report it. The
comparisons ARPI supports are **store against store, period against period, source against source and model
against model** — all within the synthetic dataset.

### 3.3 No production DMS or CRM integration

ARPI connects to no dealership management system, no CRM, no inventory feed, no desking tool and no lender.
[ARCHITECTURE.md §6](ARCHITECTURE.md) lists production CRM functionality, production DMS integration and live
lender integration as explicit non-goals.

- Source data arrives as CSV from ARPI's own generator, not from a vendor extract. Real DMS and CRM extracts
  are messier, more inconsistently coded and more prone to structural surprises than anything ARPI produces.
- ARPI's staging layer handles the *shape* of source-system messiness it was designed for, not the shape a
  real vendor would deliver.
- No vendor-specific field semantics, no vendor API quirks and no real-world lead-source string chaos are
  represented — the very problem `dim_lead_source` exists to solve is simulated rather than encountered.

**For a reviewer.** The ingestion architecture is real and defensible, but it has never met an adversarial
source system. Treat the raw-and-staging design as a demonstration of the *pattern*, not as evidence that it
survives contact with a live DMS.

### 3.4 External-data licensing boundaries

ARPI treats third-party data licensing as a blocker, not a formality.

- **NHTSA vPIC** is the only approved vehicle-enrichment source ([ARCHITECTURE.md §16.1](ARCHITECTURE.md)),
  and `docs/research.md` §5.3 restricts it to enriching the vehicle dimension — it supplies no transaction
  data at all.
- **Kaggle hosting does not establish reuse rights** (`docs/research.md` §5.6). A missing or ambiguous
  licence is a blocker for redistribution. No Kaggle dataset is used.
- **Redistribution rights must be verified before committing raw data**
  ([ARCHITECTURE.md §16.2](ARCHITECTURE.md)).
- **External market context stays analytically separate** from dealership transactions, because aggregate
  market data and dealership-level synthetic data have different grains and different provenance
  ([ARCHITECTURE.md §16.3](ARCHITECTURE.md)).
- Both enrichment feature flags are **`false`** in every profile today. **ARPI performs no network access
  during generation, and `data/external/` is empty.**

**For a reviewer.** The vehicle attributes you will eventually see are invented, not decoded. Where public
enrichment is switched on later, expect a documented licence record alongside it — and if you do not find
one, that is a defect.

### 3.5 Determinism was bought, and realism paid for it

ARPI prioritises byte-level reproducibility, and that priority costs realism in specific, identifiable ways.

| Determinism choice | Realism cost |
|---|---|
| No external holiday library ([DATA_GENERATION.md §6](DATA_GENERATION.md)) | Only twelve holidays are recognised, with no observance shifting to adjacent weekdays. Real showroom closure calendars vary by store and by year. |
| Fixed English day and month names, locale-independent | The model cannot represent a non-English or non-US calendar presentation. |
| No wall-clock timestamp in `generation_manifest.json` | Generation time is not recorded with the data; it lives only in `audit.pipeline_run`. |
| Deterministic ordinal surrogate keys | Key assignment does not resemble a real warehouse's insertion-order surrogate sequence. |
| Fixed store reference data, never randomised | Store count and attributes cannot vary, so multi-store variance is limited to three fixed profiles. |
| Bounded, clamped random draws ([DATA_GENERATION.md §9.4](DATA_GENERATION.md)) | Genuinely extreme real-world outliers are suppressed. The data is slightly *too* well-behaved at the tails. |
| Correlations encoded as parameterised influences | The relationships are smoother and cleaner than real dealership relationships, which are noisier and more regime-dependent. |
| No `faker`, no `numpy` randomness | Fewer ready-made realistic distributions; every distribution is hand-specified and therefore reflects the author's assumptions. |

There is also a deeper trade-off: **a dataset engineered to be reproducible is engineered by someone with a
model of how the business works.** ARPI's data is exactly as realistic as its author's domain knowledge, and
no more.

**For a reviewer.** Reproducibility here is a demonstrated engineering property you can verify yourself by
comparing SHA-256 digests ([DATA_GENERATION.md §10.4](DATA_GENERATION.md)). Realism is an assertion you
should discount. The two are in tension and ARPI resolved it toward reproducibility on purpose.

### 3.6 `docs/research.md` is a point-in-time market review

`docs/research.md` is the preserved research artefact from the project's definition phase. It records the
job-market analysis, KPI landscape, dataset survey and privacy considerations that shaped the architecture
**as they stood when it was written**.

- Its hiring-market observations, tool-popularity statements and employer-requirement summaries reflect a
  single point in time and are not maintained.
- Its dataset survey (§5) describes public data sources as they were then. Availability, licensing terms, API
  endpoints and field coverage change.
- Its regulatory note on the FTC Safeguards Rule (§10.1) is used in this project as a **reason for caution**,
  not as a compliance claim or as current legal guidance —
  [PRIVACY_AND_ETHICS.md §7.1](PRIVACY_AND_ETHICS.md) states the boundary precisely.
- It preserves the project's retired working title as historical evidence, spelled out verbatim. That is
  deliberate, and `docs/research.md` is one of only two places in the repository permitted to contain it —
  the other being `docs/architecture-decisions/ADR-0001-project-identity.md`, which records the naming
  decision. The project's identity is **Automotive Retail Performance Intelligence (ARPI)**.
- Its citations were not independently re-verified during Phase 0 documentation work. This gap is registered
  in [docs/requirements/DOCUMENTATION_BACKLOG.md](docs/requirements/DOCUMENTATION_BACKLOG.md).

Because it is a historical record, `docs/research.md` is **exempt from the drift checks** that govern the
rest of the repository. Its non-goal list still excludes Microsoft Fabric outright, which
[ADR-0008](docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) later narrowed (section
10.4). Rewriting it to track a later decision would destroy the only thing it is good for.

**For a reviewer.** Read `docs/research.md` as the *rationale* for the architecture, not as a current market
reference. Where this repository's other documents cite it, they cite it for a design decision, not for a
factual claim about today's market.

---

## 4. Temporary delivery gaps

Work that is sequenced and not yet done. Each carries an exit condition that names evidence rather than an
opinion; section 11 collects them and computes whether each is met.

**On "last verified".** Every limitation below was verified in one pass, at the commit named in this
document's generated header. Repeating that commit in fifteen places would create fifteen copies able to
disagree with each other, which is the drift this register exists to stop, so each contract names its
**evidence path** instead and the header names the commit. Section 12 states the rule.

### 4.1 The semantic model has never been executed by an engine

| Field | Value |
|---|---|
| **Classification** | Temporary delivery gap |
| **Current status** | Source complete and statically checked. Both real-engine paths pending. |
| **Impact** | No number the model would report has been demonstrated. Every measure is text that has never returned a value, so the DAX is unproven and the SQL-to-DAX reconciliation has only its SQL half. |
| **Current mitigation** | `scripts/check_powerbi_model.py` parses the TMDL as text and fails on any departure from `powerbi/model_documentation/` — an undocumented table, relationship, hidden column or measure, a bidirectional filter, a schema other than `reporting`, or a PII-bearing column. It is a real control and it is not execution. |
| **Evidence** | `powerbi/validation/desktop_validation_results.json`, `powerbi/validation/fabric_validation_results.json` — both record a null `validated_at` |
| **Exit condition** | Either evidence file carries a non-null `validated_at` **and** a `model_source_hash` matching the committed TMDL. A hash that no longer matches is reported as STALE, not as a pass. |
| **Owner** | `P2.1-14`, [PHASE_2_BACKLOG.md](docs/requirements/PHASE_2_BACKLOG.md); governed by [ADR-0008](docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) |

Two paths are accepted, of equal standing: **Power BI Desktop**, and the **Microsoft Fabric Service** through
the semantic-model definition APIs. ADR-0008 records why the second exists — ADR-0007 had named a Windows
product where the requirement was a capability, and the project owner has no Windows machine, so the gate as
originally written could not be cleared by the person who owns it. A gate whose only key is held by nobody is
not strict, it is stuck, and a stuck gate produces exactly the pressure governance exists to resist.

**This gap blocks four others**: Lifecycle Phase 5 completion, dashboard development, the SQL-to-DAX
reconciliation, and through those, Gate 2.

### 4.2 No dashboard, no report page, no screenshot

| Field | Value |
|---|---|
| **Classification** | Temporary delivery gap |
| **Current status** | The PBIR report is a shell: a `.platform` file and a `definition.pbir` pointing at the semantic model. Zero pages, zero visuals, zero bookmarks. |
| **Impact** | The single most visible thing a reviewer expects from a BI portfolio is absent. No document in this repository may imply otherwise. |
| **Current mitigation** | None, and none is appropriate. A mock-up would be worse than the gap. |
| **Evidence** | `powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.Report/definition/` contains no `page.json` and no `visual.json`; the counts in section 2 are read from that directory |
| **Exit condition** | Real-engine validation (4.1) recorded first. Report pages are not authored against a model that has never returned a number. |
| **Owner** | `P2.2`, [PHASE_2_BACKLOG.md](docs/requirements/PHASE_2_BACKLOG.md) |

### 4.3 No analytical finding, recommendation or case study

| Field | Value |
|---|---|
| **Classification** | Temporary delivery gap |
| **Current status** | `docs/findings/` is empty. Gate 2 is CLOSED with all three conditions unmet. The `/case-study` route renders the unmet conditions and the evidence for each, not a case study. |
| **Impact** | The platform can compute numbers; nobody has drawn a conclusion from one. And a conclusion drawn from synthetic data would say nothing about the automotive retail industry (section 3.1), so the eventual findings are a demonstration of analytical method, not of industry insight. |
| **Current mitigation** | The gate is enforced in five independent places, and the build flag among them is necessary and never sufficient ([ADR-0009](docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md)). |
| **Evidence** | `docs/findings/` holds no document; `docs/requirements/GATE_2_READINESS.md` does not exist |
| **Exit condition** | Gate 2 open — which requires report pages, a recorded SQL-to-DAX reconciliation, and a **written verdict** in `GATE_2_READINESS.md`. The third is a human judgement and no derivation may substitute for it. |
| **Owner** | `P2.3`, [PHASE_2_BACKLOG.md](docs/requirements/PHASE_2_BACKLOG.md) |

### 4.4 No Excel operating report

| Field | Value |
|---|---|
| **Classification** | Temporary delivery gap |
| **Current status** | Not started. `RECON-EXCEL-001` is Planned alongside it. |
| **Impact** | [ARCHITECTURE.md §7](ARCHITECTURE.md) names Excel as the supporting management report. Without it the project demonstrates the BI stack but not the operating-report habit that surrounds it in a real dealership group. |
| **Current mitigation** | None. It is sequenced post-MVP. |
| **Evidence** | `excel/` carries no workbook |
| **Exit condition** | A workbook committed, with `RECON-EXCEL-001` recording its totals against `reporting` |
| **Owner** | Post-MVP, [PHASE_2_BACKLOG.md](docs/requirements/PHASE_2_BACKLOG.md) |

### 4.5 Two deferred domains, and the two questions they block

> **Two of the four were resolved, in two increments.** `warehouse.fact_sales_target` was Deferred when this
> section was written; `DASH.5` implemented it, and **`SQ-31` target attainment is answered** — with its own
> limitations, in §4.5.1. `warehouse.fact_finance_product_sale`, `dim_finance_product` and `dim_lender` were
> Deferred too; **`DASH.6` implemented them and `SQ-21` F&I product penetration is answered** — with fifteen
> limitations, in **[§15](#15-what-the-governed-fi-model-cannot-support-adr-0013-dash6)**. The headings and
> counts moved with the facts, and neither set of limitations was dropped on the way.

`fact_service_visit` is Deferred, together with the dimensions that support it, and so is customer purchase
history beyond the generated window. The two stakeholder questions they block — `SQ-29` service-to-sales
opportunities and `SQ-32` customer retention — are **recorded** in
[`docs/requirements/STAKEHOLDER_QUESTIONS.md`](docs/requirements/STAKEHOLDER_QUESTIONS.md) §6 rather than
quietly dropped, which is the point: a question with no data behind it is a scope decision, and a scope
decision that leaves no trace is indistinguishable from an oversight. Adding either domain requires
Gate 4 ([ARCHITECTURE.md §28](ARCHITECTURE.md)), whose first condition — a stakeholder question that requires
it — is the one already satisfied.

The analytical consequences of their absence — no repeat-customer or service-to-sales measure — are in
section 6, at the KPIs where they bite. **Back-end gross is no longer among them:** `RECON-FI-001` proves
that every cent of it is explained by finance reserve plus original product gross, per deal and to the cent.

#### 4.5.1 What the implemented target domain still cannot tell you

`SQ-31` is answered, and these five limits travel with the answer:

1. **The targets are invented.** They are synthetic internal operating goals for a fictional group,
   generated from exogenous planning inputs. An attainment figure demonstrates that the calculation is
   correct; it says nothing about anyone's performance and nothing about any real dealership.
2. **"By department" reaches two departments.** `Sales` owns front-end gross and `Finance` owns back-end
   gross, because those two partition total gross exactly and `fact_vehicle_sale` enforces the identity.
   **BDC, Management and Service have no numerator in the warehouse**, so a target for them would be a
   denominator with nothing to compare against. Retail units are store-scope only, because a unit is
   delivered once.
3. **There is no target history.** The load is an idempotent upsert on the grain, so a revised plan
   replaces the previous value and leaves no record of what it used to be. A plan-revision history would
   need its own fact and its own grain, and no registered question requires one.
4. **The projection is linear.** A selling-day pace projection multiplies the current rate per selling day
   by the month's selling days. It ignores the within-month seasonality the sale generator deliberately
   encodes, so it is structurally less accurate early in a month than late in one. **It is arithmetic, not
   a forecast**, and nothing in the product calls it one.
5. **The selling-day calendar is shared.** All three stores use one governed `dim_date.is_selling_day`
   rule (ADR-0002). Real stores keep different hours and different holiday closures, and a per-store
   selling-day calendar would change every pace figure on the page.

---

## 5. Operational maturity gaps

The capability exists in source. It has never been operated, scheduled, or proven under use. These are the
gaps most easily mistaken for delivery gaps, and they matter more than delivery gaps do to anyone who would
run this.

### 5.1 The analytical platform has never been provisioned

| Field | Value |
|---|---|
| **Classification** | Operational maturity gap |
| **Current status** | PostgreSQL, the schema deployment, the data load, the role verification and the migration verification are all **declared** — described in source-controlled configuration, never created. |
| **Impact** | Every database-backed claim in this repository rests on a **local** PostgreSQL run, not a hosted one. The integration suite passes against a local cluster; no cloud instance exists to reconcile against, which is also why the Fabric validation path (4.1) has nothing to connect to. |
| **Current mitigation** | The provisioning job runs the repository's ordered SQL sequence, creates the login roles, loads the deterministic development profile and verifies the result. `scripts/verify_cloud_database.py` and `scripts/railway/verify_railway_configuration.ts` check the shape of it offline. |
| **Evidence** | `deployment/evidence/portfolio_deployment.json` → `analytical_platform` |
| **Exit condition** | `postgresql_instance`, `schema_deployment` and `data_load` all recorded as verified, with `verifier_last_run` set to a real run |
| **Owner** | `DOC-31`, [DOCUMENTATION_BACKLOG.md](docs/requirements/DOCUMENTATION_BACKLOG.md); `P2.1-11`, [PHASE_2_BACKLOG.md](docs/requirements/PHASE_2_BACKLOG.md) |

**The website being deployed does not move any of this.** Section 8 is the whole argument.

### 5.2 No backup, and therefore no proven restoration

| Field | Value |
|---|---|
| **Classification** | Operational maturity gap |
| **Current status** | Not implemented. No backup is taken, and no restoration has been attempted. |
| **Impact** | A warehouse with no demonstrated restore has an unmeasured recovery position. Because there is no provisioned database yet (5.1), nothing is currently at risk — but that is a coincidence of sequencing, not a control, and the gap becomes live the moment 5.1 closes. |
| **Current mitigation** | The data is deterministic: the same profile and seed reproduce byte-identical CSV, so the *contents* are regenerable from source. That covers the data and not the schema state, the roles, the audit history or the migration ledger. |
| **Evidence** | `deployment/evidence/portfolio_deployment.json` → `analytical_platform.backup_and_restore` |
| **Exit condition** | A recorded restoration into an empty database, with row counts compared against the source. A backup nobody has restored is not evidence. |
| **Owner** | `DOC-31`, [DOCUMENTATION_BACKLOG.md](docs/requirements/DOCUMENTATION_BACKLOG.md) |

### 5.3 Batch only, and nothing schedules the batch

| Field | Value |
|---|---|
| **Classification** | Operational maturity gap |
| **Current status** | [ARCHITECTURE.md §7](ARCHITECTURE.md) selects **batch refresh**; §6 lists real-time streaming as a non-goal; §17.2 defines the execution model as batch with full rebuild, incremental append, targeted dimension reload and validation-only modes. No scheduler runs any of it. |
| **Impact** | Data freshness is whatever the last manual run produced. There is no streaming, no event-driven ingestion, no change-data-capture and no message bus — and no orchestration scheduler, Airflow, Kafka and Databricks all being explicit non-goals ([ARCHITECTURE.md §6](ARCHITECTURE.md)). Power BI would be refreshed **manually** ([ARCHITECTURE.md §17.1](ARCHITECTURE.md) step 11). |
| **Current mitigation** | `audit.pipeline_run` and `reporting.vw_pipeline_run_summary` exist so that freshness is *visible* rather than assumed. A reader can always see when the data was last produced. |
| **Evidence** | `deployment/evidence/portfolio_deployment.json` → `analytical_platform.scheduled_execution` |
| **Exit condition** | A recorded scheduled execution with its `audit.pipeline_run` row. Deliberately not pursued: the reproducibility guarantee ([DATA_GENERATION.md §10.5](DATA_GENERATION.md)) is traded against freshness on purpose. |
| **Owner** | Out of scope for the MVP. Recorded here so the absence is a decision rather than a silence. |

**For a reviewer.** Do not expect a live dashboard or a scheduled pipeline. ARPI optimises for *anyone can
reproduce this exactly*, not for *this is current*.

### 5.4 Schema evolution is prototype-oriented

| Field | Value |
|---|---|
| **Classification** | Operational maturity gap |
| **Current status** | Two forward migrations exist, ordered, immutable once released and recorded in `audit.schema_migration`. There is no rollback path and no migration has been exercised against a database holding data anyone would miss. |
| **Impact** | A migration that damaged data would be discovered by its effects rather than prevented by a rehearsal. The blast radius today is nil, because the only databases are local and regenerable — which again is sequencing, not a control. |
| **Current mitigation** | Migrations are forward-only and append-only by policy, so a bad one is a new migration rather than an edited one. The ledger records what ran. |
| **Evidence** | `sql/09_migrations/`; `audit.schema_migration` |
| **Exit condition** | A migration rehearsed against a restored copy of a provisioned database, which depends on 5.1 and 5.2 |
| **Owner** | Finding 9, [`docs/reviews/ENGINEERING_HARDENING_PROGRAM.md`](docs/reviews/ENGINEERING_HARDENING_PROGRAM.md) |

### 5.5 The live deployment is verified point-in-time, not continuously

**This was an open gap and is now closed.** It stays in this section rather than moving to
section 9 because what replaced it is a weaker property than it looks, and the weaker property is
itself an operational maturity gap.

| Field | Value |
|---|---|
| **Classification** | Operational maturity gap |
| **Current status** | The deployment has been verified: homepage and `/status` answered `200`, and the remote suite passed 81 assertions with 0 failures against `https://arpi.up.railway.app`. **The verification is a snapshot.** Nothing re-runs it, so it describes one commit at one moment. |
| **Impact** | The recorded result ages silently. A deployment that regressed an hour after the run would still read as verified here, and no check would notice. Treat the evidence as "this was true at `verified_at`", never as "this is true". |
| **Current mitigation** | `verified_at` and the deployed `commit_sha` are both recorded, so a reader can see how old the result is and whether it describes the commit currently on `main`. The workflow is `workflow_dispatch`, so re-running it is one click. |
| **Evidence** | `deployment/evidence/portfolio_deployment.json` → `portfolio.verification` |
| **Exit condition** | A scheduled or post-deploy run of `.github/workflows/verify-deployment.yml`, so the evidence refreshes without a person remembering. Deliberately not added yet: a scheduled job that reaches a live host on a timer is a commitment to keeping it green, and nobody has taken that on. |
| **Owner** | `DOC-31`, [DOCUMENTATION_BACKLOG.md](docs/requirements/DOCUMENTATION_BACKLOG.md) |

**What closing it took, and what it found.** Neither CI nor the environments this project is
developed in may reach the deployment host, so the check runs from a GitHub-hosted runner via
`.github/workflows/verify-deployment.yml`, and `scripts/record_deployment_evidence.py` writes down
what came back. The first run failed — not on the deployment, but on two assertions in the remote
suite that contradicted the shipped design. One required the `<body>` background to be opaque after
the design had deliberately made it transparent; the other counted below-fold reveals that are
correctly still hidden. Both reproduced against a local build of the same commit. They had been
wrong for as long as the suite had existed, and nothing caught them because the suite had never run
against anything.

### 5.6 No Power BI Service dependency, and therefore no shareable report link

ARPI must remain fully reviewable **without** Power BI Service access ([ARCHITECTURE.md §26.2](ARCHITECTURE.md),
§33 item 13). Publication to the Service is optional and conditional on account, privacy and licensing
conditions.

- There is no shareable Service link, no workspace, no scheduled cloud refresh and no row-level security
  demonstration in the core release. RLS sits in the Optional Advanced Release
  ([ARCHITECTURE.md §32](ARCHITECTURE.md)).
- Distribution is by PBIX file where practical, plus screenshots, a model diagram, a DAX measure catalogue
  and a walkthrough video — none of which exist yet, because there is no report to capture (4.2).
- The chosen connection mode is **Import**, not DirectQuery ([ARCHITECTURE.md §19.1](ARCHITECTURE.md)), so a
  published report would carry a data snapshot rather than a live connection.

**This is not the same constraint as 4.1.** Reviewability without the Service is a design commitment.
Real-engine validation *through* the Fabric Service is an accepted path to closing a gate. A reviewer never
needs an account; the person clearing the validation gate does.

---

## 6. Analytical-method limitations

Boundaries that will shape every finding ARPI eventually produces. These are not gaps and they do not close;
they are the places where a plausible-looking number can be wrong or over-read.

### 6.1 No causal claim is supportable

ARPI is descriptive. It reports what happened in a synthetic dataset. It does not identify causes, and
[ARCHITECTURE.md §23](ARCHITECTURE.md) prohibits claiming causal relationships based only on correlation.
Two reasons compound:

1. **General.** The data is observational. Response time and conversion are correlated, but high-intent
   customers are also easier to reach; direction is not identified.
2. **Specific to synthetic data.** Any correlation is present because the generator was instructed to produce
   it. The correlation is evidence about the generator's configuration.

No experiment, no control group, no randomised assignment, no instrumental variable and no
difference-in-differences design exists anywhere in this project.

**For a reviewer.** Read every ARPI finding as *"in this synthetic dataset, A and B move together"*. Language
of the form "A drives B", "improving A will increase B" or "the cause of the gross decline is X" is out of
bounds, and [PRIVACY_AND_ETHICS.md §11.1](PRIVACY_AND_ETHICS.md) gives worked examples of the specific traps.

### 6.2 Measurement boundaries, at the KPI where each one bites

| Limitation | Consequence |
|---|---|
| **First-touch, single-source attribution** | A customer who arrived through three channels is credited to one. Multi-touch attribution is out of scope. Every marketing KPI inherits this. |
| **Monthly spend against daily leads** | `fact_marketing_spend` is monthly; `fact_lead` is daily. **Month is the finest valid grain for any cost-per measure** ([KPI_CATALOG.md §32](KPI_CATALOG.md)). |
| **Cohort immaturity** | Lead-based conversion measures anchor to the lead's creation date, so recent periods always look worse until the cohort matures. |
| **Survivorship bias in days to sale** | `KPI-INV-007` describes only units that sold. Units that never sell are invisible to it ([KPI_CATALOG.md §21](KPI_CATALOG.md)). |
| **Semi-additive inventory measures** | Inventory count and investment are point-in-time. Summing them across dates produces unit-days, not units. |
| **Median cannot be pre-aggregated** | `KPI-INV-004` and `KPI-FUN-008` require row-level values in the semantic model, which constrains the reporting-layer design. |
| **New-vehicle gross excludes manufacturer incentives** | [ARCHITECTURE.md §18.2](ARCHITECTURE.md) excludes them from the initial model, so new-vehicle profitability is systematically understated by design. |
| **Back-end gross has no product detail in the MVP** | It is a single generated number until the Deferred F&I fact exists (4.5); no product-mix narrative is supportable. |
| **No floor-plan, personnel, facility or overhead cost is modelled** | Gross-based measures are **contribution** measures, not profit measures. "What aged inventory costs us per day" is not answerable from this data. |
| **Vendor-reported leads will not match CRM leads** | That discrepancy is expected and is a finding to report, not a defect to hide ([KPI_CATALOG.md §24](KPI_CATALOG.md)). |

Each of these is documented at the KPI where it applies, and each is a deliberate, recorded boundary rather
than an oversight.

### 6.3 What the Deal Jacket can and cannot explain about one transaction

`/dashboard/deals/[saleId]` (`DASH.4`) makes the most specific claim in the project: that one
transaction is explained **to the cent**. That claim is exactly bounded, and the page states each
boundary on itself rather than only here.

| The jacket shows | It cannot show, and says so |
|---|---|
| Sale price less acquisition, reconditioning and pack — the ARPI front-end gross, recomputed on the page from the components displayed | Manufacturer holdback, dealer cash, stair-step money, floorplan credits and unposted accounting adjustments. None is modelled, so front-end gross is **understated by design** in the same way §6.2 records for new-vehicle gross |
| Trade allowance, actual cash value and their variance, published beside the front-gross formula | Trade payoff, equity, and the trade vehicle itself. No trade fact exists (§4.5) |
| Cash down, amount financed, the finance structure with the branch that produced it, and **since `DASH.7`** the fictional lender's code, name, category and program tier | APR, term, payment, buy rate, sell rate, rate spread. None exists anywhere in ARPI, by policy (`PRIVACY_AND_ETHICS.md` §7), not merely by omission. A lender appearing on the jacket is an **assignment**, and implies no application, decision, tier for a person, stipulation or adverse-action record — none of which exists |
| **Since `DASH.7`**: back-end gross decomposed into finance reserve and original product gross, plus one row per product contract with its category, provider, retail, cost, original gross, cumulative adjustment, retained gross and status | The adjustment EVENTS behind a contract's cumulative figure are not itemized on the jacket, and no offer, menu, presentation or declined product exists to show. The deal-date total is never rewritten by a later cancellation, so the retained figure beside it answers a different question and is labelled as one |
| Four staff roles as synthetic identifiers | Any name, any pay, any performance judgement. §5 of `PRIVACY_AND_ETHICS.md` governs employee presentation |
| The lead's stages and dates where one links | Any message, note, email or free text. None exists in the model |
| Days in inventory at sale | An acquisition date or a stock number. `dim_vehicle` records neither, so the page publishes the vehicle code as itself and never captions it a stock number |
| **Eight** integrity checks it can actually perform. `DASH.7` makes the three `DASH.4` named as absent real: back-gross reconciliation, product eligibility and product-adjustment validity | Nothing further is claimed. A check that cannot fail is not a check, and each of these three recomputes from the page's own components rather than reading a stored flag — the export deliberately publishes none |

**A verified jacket is a statement about internal consistency, not about reality.** "Verified to the
cent" means the exported components recompute the exported gross exactly. It does not mean the deal
happened — §3.1 applies without exception, and every jacket carries that disclosure in its body.

---

## 7. Privacy and security limitations

### 7.1 The privacy tripwire inspects schemas, not values

`src/arpi/validation/privacy.py` enforces the prohibited-field register
([PRIVACY_AND_ETHICS.md §3.1](PRIVACY_AND_ETHICS.md)) by examining **column names**. It does not look at a
single cell.

**What it does catch.** Any declared column, frame column, CSV header field or PostgreSQL column whose name
denotes personal data — including the qualified forms a real DMS or CRM export actually uses
(`customer_email`, `buyer_first_name`, `home_phone_number`, `exact_credit_score`), the punctuation variants
that would otherwise slip past a naive comparison (`Customer-Email`, `customer.email`, `CUSTOMER__EMAIL`),
protected characteristics, compensation and pay-plan fields, communication content, and any new `*_name`
column that has not been explicitly allowlisted with a written justification. It fails closed: a match
raises, or records a `critical` failure that fails the run. It is checked in Python and in SQL, and a test
asserts that both layers agree.

**What it does not catch:**

- **A prohibited value under an innocent name.** A column called `market_area` containing
  `someone@example.com` passes. Nothing scans cell contents for email, phone or identifier patterns.
- **Free text generally.** ARPI declares no free-text column, so there is nothing to scan; if one were ever
  introduced under an approved name, this control would not examine it.
- **Personal data encoded in an identifier.** A `customer_id` derived from a real person's details would
  pass. ARPI's identifiers are generated from a seeded counter, so this is theoretical here — but it is not
  something the tripwire could detect.
- **Re-identification by combination.** Refusing each prohibited field individually does not prove that the
  remaining fields cannot be combined to single out an individual. ARPI's answer is data minimisation —
  geography stops at county and market area, age is banded, no birth date exists — not a formal
  disclosure-risk calculation. No k-anonymity or differential-privacy claim is made anywhere.

**Why a schema control is sufficient here, and would not be elsewhere.** Every row ARPI holds is machine
generated from a declared column contract, with no network access in the generator and both enrichment flags
off in all three profiles. There is no external source from which a real value could arrive under an innocent
name. A pipeline ingesting real data would need value-level scanning as well, and this control should not be
cited as evidence that ARPI performs it.

### 7.2 The secret scanner is a safety net, not a scanner

`scripts/check_secrets.py` uses a handful of high-signal regular expressions. It is not entropy-based, it does
not scan git history and it does not understand context. It catches the mistakes that actually happen here —
a committed `.env`, a connection string pasted into a document, a private key left in the tree — and it will
miss anything else. `SECURITY.md` states what complements it.

The deployment evidence file added for section 8 is held to a second, narrower control:
`scripts/deployment_evidence.py` fails the build when any key in it names a token, password, credential,
database URL or private host, or when any value looks like a connection string. A public URL, a service name,
an environment and a commit SHA are identifiers, and identifiers are all that file may ever hold.

### 7.3 No security claim about the running deployment

No live security-header set has been inspected, because the deployment host is unreachable from CI and from
the environments this project is built in (5.5). Headers are configured in source and verified there. Nothing
in this repository is evidence about the headers a browser actually receives, and
`deployment/evidence/portfolio_deployment.json` records that field as `UNVERIFIED` rather than describing the
configuration as though it were an observation.

---

## 8. Deployment limitations

**ARPI has three deployments, not one.** They are independent, they have separate evidence, and the first one
existing is not evidence for either of the others. This section exists because collapsing them is the most
available way for this project to overstate itself: a live website invites the reading that the *platform* is
live, and it is not.

<!-- ARPI:CAPABILITIES:BEGIN deployment -->
**1. Portfolio presentation deployment.** A Next.js site of prerendered routes.

| Field | Value |
|---|---|
| Environment | staging |
| Service name | `arpi-portfolio` |
| Public URL | https://arpi.up.railway.app |
| Health route | `/status` |
| Deployment commit | b90e3244a9b0db2f9ee1ccfc9f6d85e93959e806 |
| Deployment timestamp | UNVERIFIED |
| Health verification | 2026-08-01T20:31:00+00:00 |
| Remote smoke test | 81 passed, 0 failed, 1 skipped, 0 flaky |
| Security headers | passed (1) |
| Database connection | none |
| Production environment | not-created |

**2. Analytical-platform deployment.** PostgreSQL and everything the warehouse needs in order to be running rather than defined. Nothing here follows from the website being live.

| Field | State |
|---|---|
| PostgreSQL instance | declared |
| Schema deployment | declared |
| Data load | declared |
| Role verification | declared |
| Migration verification | declared |
| Backup and restoration | not-implemented |
| Scheduled execution | not-implemented |
| Provisioning job last run | UNVERIFIED |
| Verifier last run | UNVERIFIED |

**3. Semantic-model deployment.** An engine that has loaded, refreshed and evaluated the model. Its evidence is the validation files, not this register.

| Field | State |
|---|---|
| Power BI Desktop | pending |
| Microsoft Fabric | pending |
| Refresh | never performed |
| DAX evaluation | never performed |
| SQL-to-DAX reconciliation | SQL side only |
| Evidence freshness | desktop `validated_at` null, fabric `validated_at` null |

**These are three statuses, not one.** A reader who takes the first table as evidence for the second or the third has been misled, and any document that invites that reading is a defect worth reporting.
<!-- ARPI:CAPABILITIES:END deployment -->

### 8.1 What the portfolio website is, and what it is not

A portfolio website exists under `portfolio/`
([ADR-0009](docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md)) and is deployed.
It presents the architecture, the data model, the governed KPI **definitions**, the governance position and a
project status derived from source-controlled evidence. It is a presentation layer over this documentation
set, and it is subject to every limitation in this document.

**What it does not show:**

- **No analytical finding.** Nothing has been analysed, and the site draws no conclusion.
- **No management recommendation.** None exists to publish.
- **No dashboard screenshot.** There is no report page to screenshot: no Power BI page, visual or bookmark
  exists, and real-engine validation of the semantic model is pending on both accepted paths.
- **No KPI value — real or illustrative.** There is no figure produced by any measure on any route. Not a
  sample, not a placeholder, not a mock-up. Every number the site displays is a count of repository
  artefacts, resolved at build time.
- **No live data, and no way to obtain any.** The site has no API route, no database connection, no query
  interface and no charting library. It computes no KPI and could not: the `reporting` schema is not
  reachable from it.

**The `/case-study` route is locked, and that is deliberate.** Gate 2
([ARCHITECTURE.md §28](ARCHITECTURE.md)) is **CLOSED** — its three conditions, complete report pages,
reconciled SQL-to-Power BI totals and drafted executive findings, are all unmet — so the public analytical
case study is gated. The route renders the unmet conditions and the evidence for each rather than a case
study.

### 8.2 Why a live site proves so little here

The website's isolation is a design commitment, not an accident, and it is what makes the deployment weak
evidence in the useful sense:

| The website has | The website does not have |
|---|---|
| Prerendered routes built from repository files | Any database connection or credential |
| A generated manifest, regenerated and diffed at build time | Any API route or query interface |
| A health route the platform probes | Any access to the `reporting` schema |

`deployment/railway/project.config.json` declares `services.portfolio.requiresDatabase = false` and lists
website database access under `deliberatelyAbsent`; `scripts/railway/verify_railway_configuration.ts` fails
if a `DATABASE_*`, `PG*` or password variable ever appears on the website service. The whole deployment —
what is automated, what deliberately is not, and the one credential handoff no automation removes — is
reviewable in [`deployment/railway/README.md`](deployment/railway/README.md).

So the site being up demonstrates that a static build is served correctly. It demonstrates nothing about
PostgreSQL and nothing about a semantic model, and any document that cites it as evidence for either is a
defect worth reporting.

### 8.3 How the deployment is verified, and what is still `UNVERIFIED`

Neither CI nor the environments this project is developed in may reach the deployment host: CI has no reason
to be online, and the agent environments answer `403` to `CONNECT` for that host, recorded in
[`docs/reviews/ENGINEERING_HARDENING_PROGRAM.md`](docs/reviews/ENGINEERING_HARDENING_PROGRAM.md) §1.1. The
verification therefore runs from a GitHub-hosted runner, through
[`.github/workflows/verify-deployment.yml`](.github/workflows/verify-deployment.yml), and
`scripts/record_deployment_evidence.py` writes down what came back.

**Verified, by that run:** the deployed commit, the health check, the remote smoke result and the security
headers, along with all twelve required checks. Each is bound to the specific assertion that proves it, so a
check whose test was skipped or failed reads `UNVERIFIED` rather than inheriting the suite's overall verdict.

**Still `UNVERIFIED`:** `deployed_at`, because Railway's deployment timestamp is not exposed on the site and
this repository holds no Railway credential to ask for it; and everything under `analytical_platform`, which
no website run can move.

`UNVERIFIED` means *this project's automation did not obtain the fact*. It does not mean the fact is false,
and it is never rendered as a pass. Filling one of those fields in because someone believes it would convert
a recorded gap into a fabricated observation, which is worse than the gap — and that holds no less now that
most of them are filled. **A recorded verification is also a snapshot** (5.5): it describes one commit at one
moment, and nothing re-runs it.

---

## 9. Resolved limitations with residual impact

Fixed going forward, with a consequence that survives the fix. These stay in the register because deleting
them would misrepresent the history of the data they describe.

### 9.1 The five-layer row-count chain is complete; earlier runs recorded three

**Resolved.** [ARCHITECTURE.md §21.4](ARCHITECTURE.md) requires every run to record a source row count, a
raw row count, a staging row count, a warehouse row count and a rejected row count. Phase 0 recorded three of
the five, so nothing could prove that rows were not lost between the raw tables and the views the warehouse
reads.

All five layers are now recorded for every entity, and the chain identity
`raw = staging accepted + rejected invalid + deduplicated` is measured term by term rather than derived:
`raw` counts the newest batch in the landing table, `staging` counts the accepted view, and both rejection
terms come from the rejected companion view. A staging count that were unconditionally equal to the raw count
would prove nothing, which is why each term is measured independently.

The staging-to-warehouse half was closed for the eight dimensions by the loader and for the five facts by
`audit.vw_recon_ingestion`, whose ingestion specs carry no warehouse target and therefore could not be
covered in Python. Before that, a fact load that silently dropped rows on an unresolved surrogate key would
have looked exactly like a correct one.

**Residual impact:** audit rows written before the correction record three layers, so a completeness analysis
across that boundary is comparing unlike runs.

### 9.2 Execution identity is per-attempt; rows written before ADR-0010 may hide collapsed attempts

**Corrected going forward; not recoverable backwards.** Until
[ADR-0010](docs/architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md),
`audit.pipeline_run.run_uuid` was derived deterministically from the run's parameters and the loader upserted
on it. Every execution with identical inputs therefore reused one row.

The consequences were real, not theoretical:

- `started_at` survived from the first attempt while `completed_at` was overwritten by the last, so the
  recorded duration spanned two executions and described neither;
- `arpi_version` and `run_mode` kept the first attempt's values, so a row could name a version that had not
  produced the state it described;
- a failed attempt followed by a successful retry left one `succeeded` row with the failure erased;
- child row counts, validation results and rejected records were deleted and reinserted, so they could not be
  attributed to the attempt that produced them.

Every execution now inserts its own row, and `logical_run_key` groups equivalent attempts without collapsing
them.

**Residual impact:** rows written *before* the correction may each stand for several attempts that were
overwritten. The migration backfills their `logical_run_key` correctly — it is the value those rows already
carried — but the overwritten attempts are gone. They were not reconstructed and no placeholder row was
invented for them, because there is no evidence from which to do either honestly. Any analysis of execution
history across that boundary should treat pre-correction rows as "at least one attempt", not "exactly one".

### 9.3 Implementation status drifted in prose; it is now derived and checked

**Resolved.** Implementation status was stated in prose, in several governing documents written at different
times, and prose does not fail a build when it goes stale. It went stale in ten places: documents denying that
the semantic model source existed beside thirty TMDL files, and denying that any DAX had been written beside
forty-nine measures.

Status is now split in two. **Declared** judgement — is a phase complete, is a gate open — lives in
`config/project_capabilities.json`. **Derived** fact — how many measures, how many report pages, what the
evidence file says — is read from the repository by `scripts/project_capabilities.py`. Counts live in exactly
one place. The two are compared, and a contradiction in either direction fails CI. The generated blocks in
this document are written by `scripts/generate_project_capabilities.py`, and a stale block fails the build.

**Residual impact, and it is not small.** A check can only catch a claim someone has written a rule for. This
register caught none of the contradictions corrected in the present revision — a document denying a
deployment that existed, a Planned entry for a model that was built, an out-of-scope listing for a validation
path that had become required — because no rule guarded them until now. Rules are added after a drift is
found, so the register is always one class of error behind. Section 12 states the obligation that follows.

---

## 10. Implemented, planned, deferred and out of scope

Status values are exactly four: **Implemented**, **Planned**, **Deferred**, **Out of scope**.

### 10.1 Implemented

The tables below are **generated from the repository** by `scripts/generate_project_capabilities.py` and
verified in continuous integration. Nothing in them is typed by hand, so no count here can drift from the
source it describes — which is precisely how the statements corrected in this document went stale.

<!-- ARPI:CAPABILITIES:BEGIN warehouse -->
| Layer | Count | Status |
|---|---:|---|
| Dimension merge scripts | 8 | Implemented and exercised by the integration suite. |
| Fact DDL scripts | 5 | Implemented. |
| Fact load scripts | 5 | Implemented. Facts are **not** merely planned. |
| Reporting views | 28 | The only surface the semantic model may read. |
| Audit row-count layers recorded | 5 of 5 | `source`, `raw`, `staging`, `warehouse`, `rejected`. |
| Forward migrations | 5 | Ordered, immutable once released, recorded in `audit.schema_migration`. |

Counted apart from every row above, because folding either lane in would move a baseline that was measured against a specific run:

| Lane, counted separately | Count | Status |
|---|---:|---|
| Sanitized public listing SQL files (ADR-0011) | 15 | Implemented, and outside the MVP warehouse the semantic model reads. |
| Sanitized public listing reporting views | 6 | Implemented. |
| Dashboard program SQL files (ADR-0013) | 33 | Implemented. |
| Dashboard program fact DDL scripts | 3 | Implemented. `DASH.5` added the first fact this lane owns; the MVP fact count above is unchanged. |
| Dashboard program reporting views | 9 | Implemented, and **not** part of the reporting-view baseline the semantic model binds to. |
| Dashboard program KPIs | 32 | Implemented in SQL and on the web console. The 29 governed KPIs above are unchanged: no DAX measure reads these, so the two numbers are reported side by side and never summed. |
| Inventory accounting and GL control SQL files (`DASH.8`) | 17 | Implemented. Database and reporting only: no browser dataset is exported and no console route reads them. |
| Inventory accounting fact DDL scripts | 2 | Implemented. The MVP fact count above is unchanged. |
| Inventory accounting dimension merge scripts | 1 | Implemented. The conformed dimension count above is unchanged: a selected control-account catalogue is not a conformed MVP dimension. |
| Inventory accounting reporting views | 3 | Implemented, and **not** part of the reporting-view baseline the semantic model binds to. |
| Inventory accounting KPIs | 12 | Implemented in SQL. No DAX measure reads them and no console route renders them, so this number is reported beside the two above and never summed with either. |
<!-- ARPI:CAPABILITIES:END warehouse -->

<!-- ARPI:CAPABILITIES:BEGIN semantic-model -->
| Artefact | Count | What it means |
|---|---:|---|
| PBIP project files | 2 | The project and its semantic-model definition exist in source control. |
| TMDL files | 30 | The model is stored as readable text, not a binary. |
| Semantic tables | 26 | Imported reporting views plus measure-only tables. |
| Relationships | 42 | Declared in TMDL and statically checked. |
| DAX measures | 49 | Written and statically checked. **Never evaluated by an engine.** |
| Report pages | 0 | The report is a PBIR shell. A dashboard does not exist. |

**Source exists; runtime is unproven.** Every figure above is read from the repository, and every one of them describes *source*. Static parsing is not execution.

| Real-engine path | Declared | Evidence |
|---|---|---|
| Power BI Desktop | pending | `validated_at` is null |
| Microsoft Fabric | pending | `validated_at` is null |

An engine has run: **No**. `ADR-0008-real-engine-validation-paths` accepts either path and requires one of them before Lifecycle Phase 5 can complete. (This block is generated into documents at several depths, so it names the record rather than linking to it: one relative link cannot resolve from all of them.)
<!-- ARPI:CAPABILITIES:END semantic-model -->

| Item | Kind |
|---|---|
| `dim_date`, `dim_dealership`, `dim_vehicle_model`, `dim_vehicle`, `dim_employee`, `dim_customer`, `dim_lead_source`, `dim_marketing_campaign` | Dimensions (all eight MVP dimensions; `dim_dealership` and `dim_employee` are SCD Type 2) |
| `fact_vehicle_sale`, `fact_vehicle_inventory_snapshot`, `fact_lead`, `fact_appointment`, `fact_marketing_spend` | Facts (all five MVP facts, each with its grain enforced by a UNIQUE constraint) |
| Fourteen `raw.*_load` tables | Raw landing tables |
| Fourteen `staging.stg_*` accepted views, twelve `_typed` and twelve `_rejected` companions | Staging views |
| `audit.pipeline_run`, `pipeline_run_row_count`, `validation_result`, `reconciliation_result`, `rejected_record` | Audit tables |
| `audit.vw_dq_*` (6), `audit.vw_recon_*` (7) | Audit check and reconciliation views |
| `reporting.vw_calendar`, `vw_dealership`, `vw_employee`, `vw_customer`, `vw_vehicle`, `vw_vehicle_model`, `vw_lead_source`, `vw_marketing_campaign` | Dimension views |
| `reporting.vw_vehicle_sales`, `vw_inventory_snapshots`, `vw_leads`, `vw_appointments`, `vw_marketing_spend` | Fact views, each preserving its fact's grain exactly |
| `reporting.vw_sales_summary`, `vw_gross_summary`, `vw_inventory_health`, `vw_inventory_aging`, `vw_days_to_sale`, `vw_inventory_turn`, `vw_days_supply`, `vw_lead_funnel`, `vw_appointment_funnel`, `vw_lead_response`, `vw_marketing_performance`, `vw_data_quality_trend`, `vw_reconciliation_status` | Governed analytical views |
| `reporting.vw_pipeline_run_summary`, `vw_data_quality_summary` | Operational reporting views |
| Fourteen generators, one per entity in `GENERATION_ORDER` | Generators |
| 114 data-quality checks across fourteen `DQ-*` families on a `development` run | Validation checks |
| 30 loader reconciliations and 28 SQL reconciliations, recorded on every database run | Reconciliations. **Every critical one has been observed failing against a deliberately corrupted fixture**, so the suite is known to detect the thing it exists to detect rather than merely passing |
| `KPI-SLS-001`…`003`, `KPI-GRS-001`…`006`, `KPI-INV-001`…`009`, `KPI-FUN-001`…`008`, `KPI-MKT-001`…`003` | All 29 MVP KPIs, computable from `reporting` and tested against an independent warehouse derivation |
| The PBIP project, its TMDL semantic model and its DAX measures | Semantic-model **source**, statically checked and never executed (4.1) |
| `powerbi/model_documentation/` | The semantic-model specification — documentation, not a model |
| The portfolio website and its Railway deployment configuration | Presentation layer, deployed to `staging` (section 8) |
| `docs/requirements/STAKEHOLDER_QUESTIONS.md`, `docs/requirements/GATE_1_READINESS.md` | Traceability matrix and Gate 1 verdict |

### 10.2 Planned

| Item | Kind | Unlock |
|---|---|---|
| Real-engine validation of the committed semantic model on either ADR-0008 path | Power BI | Now — it is the critical path (4.1) |
| The seven unblocked MVP report pages | Power BI | After real-engine validation |
| `RECON-UNITS-001` and `RECON-GROSS-002` Power BI sides | Reconciliations | After real-engine validation — the SQL sides are Implemented |
| `RECON-EXCEL-001` | Reconciliation | Post-MVP, with the Excel workbook |
| Excel operating report | Deliverable | Post-MVP |
| Executive findings memo, static case-study page, walkthrough video | Deliverables | After Gate 2 |
| Provisioned PostgreSQL, with backup and restoration evidence | Operations | Section 5.1, 5.2 |

**What changed here, and why it matters.** Previous revisions listed the semantic model and its measure
groups as Planned. The model source has been committed since PR #8; only its execution was ever outstanding.
`scripts/check_project_capabilities.py` now fails any document that describes the model as planned while its
TMDL is in the repository.

### 10.3 Deferred

`dim_finance_product`, `dim_lender`, `dim_sale_type`, `dim_inventory_source`, `dim_geography`,
`fact_lead_activity`, `fact_inventory_price_history`, `fact_finance_product_sale`, `fact_service_visit`;
F&I penetration, products per retail unit, repeat-customer rate and service-to-sales
conversion KPIs; `RECON-FI-001`; the static case-study page and walkthrough video.

`fact_sales_target` and the target-attainment KPIs were on this list until `DASH.5` implemented them
(§4.5.1). They are **not** in §10.1's MVP baseline either: they are a dashboard-program lane, counted
separately, so promoting them moved no measured baseline.

### 10.4 Out of scope

Production CRM and DMS functionality, real dealership data, live lender integration, credit application
processing, payment calculations, ecommerce features, real-time streaming, mobile applications, multi-tenant
SaaS, AI chatbots, decorative machine learning, microservices, Kubernetes, Kafka, Airflow, Databricks, a
second complete dashboard in Tableau, and a second complete dashboard in React or Next.js
([ARCHITECTURE.md §6](ARCHITECTURE.md)). Multi-touch attribution is also out of scope.

**Microsoft Fabric is split, and the split is load-bearing.**

| Fabric as… | Status | Why |
|---|---|---|
| A **data platform** — lakehouse, warehouse item, dataflow, or any replacement for the PostgreSQL warehouse | **Out of scope** | ARPI's warehouse is PostgreSQL and stays PostgreSQL. No analytical storage or transformation moves into Fabric. |
| The **Fabric Service** as a real-engine validation path for the semantic model | **In scope, and required** | [ADR-0008](docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) accepts it as one of two equal paths, and it is the one this project can reach without Windows. |

An unqualified "Microsoft Fabric is out of scope" now fails `scripts/check_project_capabilities.py`, because
this document and [ARCHITECTURE.md §6](ARCHITECTURE.md) both carried it after ADR-0008 had made the Service a
required path, and nothing noticed.

**For a reviewer.** The Implemented list is long and it is still accurate: every row is an object you can
query or a test you can run. If you find any claim in this repository that an item outside 10.1 exists — a
dashboard, a finding, an F&I product analysis, a provisioned database — treat it as a documentation defect
and report it.

---

## 11. Exit criteria

Every condition below names a file, a count or a recorded result. None is satisfied by an opinion.

<!-- ARPI:CAPABILITIES:BEGIN exit-criteria -->
| Exit criterion | Evidence required | Met |
|---|---|:--:|
| Real-engine validation | `desktop_validation_results.json` or `fabric_validation_results.json` carries a non-null `validated_at` and a `model_source_hash` matching the committed TMDL | no |
| Lifecycle Phase 5 complete | real-engine validation above, plus `sql_to_dax_differences` empty in the same file | no |
| Dashboard development may begin | real-engine validation above. Report pages are not authored before the model that feeds them has returned a number | no |
| SQL-to-DAX reconciliation | every measure in `powerbi/validation/sql_baseline.json` matched by an engine-evaluated value, with the differences recorded | no |
| Gate 2 open | report pages greater than zero, SQL-to-DAX reconciliation recorded, and a written verdict in `docs/requirements/GATE_2_READINESS.md` | no |
| Case study unlocked | Gate 2 open, `analytical_findings` greater than zero, and the build flag set | no |
| PostgreSQL production readiness | `postgresql_instance`, `schema_deployment` and `data_load` all recorded as verified in the deployment evidence, with `verifier_last_run` set | no |
| Backup-and-restore evidence | a recorded restoration into an empty database, with the row counts compared against the source | no |
| Production-source integration | a vendor extract landed through `raw` with its licence recorded. No such source is in scope, so this is stated to be denied rather than pursued | no |
| Benchmark comparison eligibility | a licensed, citable source of real dealership performance data at dealership grain. None exists for this project, so no comparison is admissible | no |

`Met` is computed, not asserted. A row reads `yes` only when the evidence named beside it exists in the repository.
<!-- ARPI:CAPABILITIES:END exit-criteria -->

**Two of those rows can never become `yes` by doing work.** Production-source integration and benchmark
comparison both require access this project does not have and has decided not to pursue (3.2, 3.3). They are
listed so that their absence is a recorded decision rather than an oversight.

**One row cannot be closed by a derivation.** Gate 2's third condition is a written verdict in
`docs/requirements/GATE_2_READINESS.md`. A computation may report that the other two conditions are met; it
may not conclude that the gate is open. Nothing in this repository can move a gate.

---

## 12. Maintenance and evidence rules

1. **A limitation is removed only when it genuinely no longer applies**, never because it has become
   inconvenient. A limitation that has been fixed but left a consequence moves to section 9 and keeps its
   residual-impact note.
2. **Counts and statuses are generated, not typed.** Everything between `ARPI:CAPABILITIES` markers is
   written by `scripts/generate_project_capabilities.py`. Editing a generated block by hand fails CI, and so
   does leaving one stale after the evidence moves.
3. **The review header is generated too.** `config/project_capabilities.json` → `review` is the single place
   a human sets the review date, the verified commit and the register version. A review date typed into a
   document is the first thing to go stale, and a limitations register with a stale header has already lost
   the argument.
4. **"Last verified" means the header's commit**, for every limitation in sections 4 and 5. Each contract
   names its evidence path; the header names the commit that path was read at. Repeating the commit per
   limitation would create copies able to disagree with each other, which is the drift this register exists
   to stop.
5. **`UNVERIFIED` is not `false`.** It means this project's automation did not obtain the fact. It is never
   rendered as a pass, and filling it in from belief rather than a run is a defect of the worst kind here: it
   converts a recorded gap into a fabricated observation.
6. **A deployment status needs its own evidence.** The website, the analytical platform and the semantic
   model are checked separately, and none may inherit another's status.
7. **A new drift class gets a new rule.** Section 9.3 records why: the register only catches what somebody
   has written a rule for, so it is always one class of error behind. When a contradiction is found by a
   human, the correction is not finished until a check exists that would have caught it. Every rule must be
   guarded by the evidence that makes the claim false, so that it retires itself if the claim becomes true
   again — a banned-phrase list would forbid the truth as readily as the error.
8. **Section 10 must match** [DATA_DICTIONARY.md §4](DATA_DICTIONARY.md) and
   [KPI_CATALOG.md §4](KPI_CATALOG.md) exactly. A disagreement between them is a defect in this document.
9. [ARCHITECTURE.md §33](ARCHITECTURE.md) item 11 makes explicit privacy and ethical limitations a condition
   of the project being complete, and §27 Phase 7 requires that **every recommendation acknowledges
   limitations**.

### 12.1 Where the old section numbers went

This document was restructured from a fourteen-section narrative into the register above. Older documents and
review notes cite the previous numbering:

| Was | Is now |
|---|---|
| §1 Summary | §1 Executive limitation summary |
| §2 Synthetic data | §3.1 |
| §3 No benchmarks | §3.2 |
| §4 No DMS or CRM integration | §3.3 |
| §5 No causal claims | §6.1 |
| §6 No real-time refresh | §5.3 |
| §7 No Power BI Service dependency | §5.6 |
| §8 External-data licensing | §3.4 |
| §9 Determinism versus realism | §3.5 |
| §10 Scope — built and not built | §4 |
| §10.1 Five-layer row-count chain | §9.1 |
| §10.1a Collapsed execution attempts | §9.2 |
| §10.2 Privacy tripwire | §7.1 |
| §10.3 Portfolio website | §8.1 |
| §11 `docs/research.md` | §3.6 |
| §12 Analytical method | §6.2 |
| §13 Planned versus Implemented | §10 |
| §14 Maintenance | §12 |

---

## 14. What the governed dashboard export lane cannot support (ADR-0013, `DASH.1`)

The export lane exists; the console does not. `DASH.1` built the data path, its manifest and its
controls, and stopped there deliberately. What follows is what the lane genuinely cannot do today, so
that nobody reads its existence as more than it is.

### 14.1 There is no dashboard

No `/dashboard` route, no dashboard component, no chart, no filter, no navigation entry. The
artifacts under `data/dashboard/` and `portfolio/src/generated/dashboard/` are consumed by nothing,
and a test asserts that. Anyone visiting the site sees exactly what they saw before.

### 14.2 The export covers the 29 implemented KPIs and nothing else

No targets, no itemized F&I products, no finance reserve, no product penetration, no chargebacks or
cancellations, no inventory accounting, no GL control balances, no management actions, no employee
performance, no deal-level detail. Those need warehouse entities that do not exist yet
([DATA_DICTIONARY.md Part G](DATA_DICTIONARY.md); increments `DASH.5` through `DASH.12`). No dataset
here stands in for one, and no placeholder file was created — a fabricated empty dataset would look
like implementation without being it.

### 14.3 Group figures exist only where the measure is additive

The manifest publishes group totals for units, gross, leads, appointments, spend and attributed
gross, and numerator/denominator pairs for the ratios built from them. It publishes **nothing** for
median inventory age, median or percentile days-to-sale, response-time medians, days supply, or
inventory turn — because a group median is not the average of store medians and a group turn is not
the average of monthly turns. Those figures are valid at the grain the reporting view computed them
at, and a period-level figure needs the view evaluated over that period. The evidence for them is
row-level equality with the source view, not a total.

### 14.4 The export describes one pipeline run, and byte-stability is relative to it

Determinism means: same database state plus same contract produces identical bytes. A rebuilt
warehouse is a different execution with a different `run_uuid`, so `--check --against-database`
against a rebuilt warehouse reports a different run rather than a byte defect. `--check` offline is
unaffected and is what CI runs.

### 14.5 `logical_run_key` is unavailable to the export

[ADR-0010](docs/architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md)'s logical
run key — which groups equivalent reruns — is recorded in the audit layer. The reporting layer does
not publish it and the exporter may not read that schema, so the manifest carries `null`. Grouping
equivalent reruns in the console is therefore not possible until some increment adds it to a
reporting view.

### 14.6 The privacy tripwire inspects names, not values

Unchanged from §7 and stated again because this lane is public: a column called `market_region`
holding an email address would pass the header check. The compensating controls in this lane are the
allowlist (a field reaches an export only by being declared), the output-byte scan in both stages
(email, URL, VIN-shaped token, connection detail, internal object path), and the fact that no dataset
is at customer grain at all. The tripwire also deliberately permits `vin` as a name, because ARPI's
VINs are synthetic by policy (ADR-0005); the dashboard lane's protection there is structural — no
dataset declares a vehicle identifier of any spelling.

### 14.7 Front gross remains understated by construction

Manufacturer incentives, holdback and floorplan credits are excluded from front gross. Every gross
figure the export carries inherits that, and the manifest says so in its own limitations block. It is
a modelling boundary, not a finding.

### 14.8 The export proves nothing about Power BI

Rendering a number in JSON says nothing about a DAX measure. Both
[ADR-0008](docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) real-engine
validation paths remain pending, **Gate 2 remains CLOSED**, and no artifact from this lane may be
cited as evidence toward either. The client-safe manifest carries no Power BI field at all, so the
lane cannot become a second place a "validated" claim is written.

### 14.9 Sizes are measured for one profile only

The recorded figures — 7,660,811 B of export, 2,387,403 B of generated tree — are the `development`
profile. The `portfolio` profile's 24-month window has never been exported, and its sizes are
unknown. Regenerating at that tier requires re-measuring against
[`docs/dashboard/DATA_CONTRACT.md` §10](docs/dashboard/DATA_CONTRACT.md) before the result is
committed.

---

## 13. What the sanitized public listing lane cannot support (ADR-0011)

This lane exists to demonstrate ingestion, sanitization, validation, warehouse modelling
and reporting against material ARPI did not author. Every limitation below is inherent to
the source, not a gap somebody will close later.

### 13.1 The six statements that bound every listing number

1. **Advertised price is not transaction price.** It is what the listing displayed.
2. **Advertised price is not acquisition cost or inventory investment.** This lane holds
   no cost of any kind, so nothing here says anything about margin.
3. **A listing that disappears was removed from listing, not sold.** It can equally be a
   trade, a wholesale, a feed suppression or an error, and this data cannot distinguish
   them. `reporting.vw_vehicle_listing_change` emits six labels and none is *Sold*.
4. **Days observed online is not days in stock.** Days in stock runs from acquisition and
   is recorded by the DMS. This lane never sees an acquisition. The span is additionally
   bounded below by the capture cadence — a vehicle seen once has a span of zero, meaning
   *seen once*, not *listed for no time* — and above by when observation began.
5. **A listing does not prove physical presence or ownership.** It proves a listing was
   visible.
6. **A public reference snapshot does not establish current business performance.**

### 13.2 Measures this lane will never define

No sold units, inventory turn, days in stock, front/back/total gross, inventory
investment, acquisition cost, reconditioning cost, carrying cost, return on investment or
marketing attribution. Each needs data a listing snapshot does not carry.
`arpi.constants.PROHIBITED_LISTING_MEASURES` records the list and
`tests/unit/test_inventory_kpis.py` fails the build if one is defined as a KPI.

### 13.3 Limitations of the controls themselves

- **The real-VIN detector inspects shape, not provenance.** It flags any seventeen-character
  string drawn from the ISO 3779 alphabet. It cannot tell a real VIN from a
  seventeen-character coincidence, and it deliberately errs toward refusing.
- **The prohibited-claim check reads text, not meaning.** It catches the specific
  affirmative phrasings it knows. A novel way of saying "removed means sold" would pass it.
- **Sanitization is verified on the output, not on the input.** ARPI can prove no original
  VIN or URL reached a committed artifact. It cannot prove the private input was what the
  operator said it was.
- **The real-VIN detector was, at one point, too eager.** It reported a float rendered at
  full precision as a real VIN, because a word boundary sits at a decimal point and
  offered seventeen digits. It now requires a letter and refuses to match inside a longer
  token. The lesson is recorded here because it is the more dangerous failure of the two:
  a privacy check that cries wolf teaches people to override it, and the override is what
  gets reached for on the day the finding is real.
- **One capture date cannot exercise the change or observation-span views.** They are
  built, constrained and tested against fabricated repeat captures; all three committed
  artifacts are single snapshots on the same date, so every span is zero and every row is
  New Listing.
- **The lane's reconciliations are technical load evidence.** "The total advertised value
  reconciles" means the number that reached the warehouse is the number the workbook
  carried. It is not a valuation and not a finding.

### 13.4 What is committed, and the two things about it that are easiest to misread

Three captures are committed, all dated 2026-08-02: Granite Chevrolet (199 rows), Granite
Subaru (24) and Granite Pre-Owned Center (318). All three are governed identically. Two
carry limitations that a reader who only saw the row counts would get wrong.

**The Granite Subaru capture is partial.** The public source did not expose every listing
through a reliably extractable path, so the artifact holds 24 visible indexed records out
of a larger reported inventory. **Twenty-four is a count of what was visible to the
capture. It is not that store's inventory**, and beside two stores holding 199 and 318 it
reads as a small store unless the limitation travels with it. It is declared as
`coverage: partial` in the workbook contract, repeated on the portfolio page, and asserted
by `tests/unit/test_inventory_reference_artifact.py`.

**The Granite Pre-Owned Center capture publishes no price and no mileage for 287 of its
318 listings.** Their pricing status is `Price not exposed`. The consequences are
concrete: that store's `total_advertised_value` describes 31 vehicles, not 318, and no
average mileage can be computed for the other 287. The lane reports both as **counts of
what was not published** rather than as zeros, because a zero is a number and a number
gets averaged — a zero-mile row in a used-car report reads as a new car.

**`Price not exposed` is not `Call for price`, and the two are never added together
silently.** Call-for-price means the listing displayed a call-for-price treatment: a
merchandising choice was made and shown. Price-not-exposed means the listing surface
published no price field at all, and evidences no choice by anyone. Reporting the second
as the first would attribute a decision to a dealership on no evidence. Where a single
number is genuinely wanted, `unpriced_units` is published and is defined as the complement
of `Listed`, so it stays exhaustive however many statuses exist.

---

## 15. What the governed F&I model cannot support (ADR-0013, `DASH.6`)

`SQ-21` — *what is our F&I performance, by product and by store?* — is answered. Twenty-two `KPI-FNI-*`
definitions are verified, `RECON-FI-001` proves the back-gross identity per deal to the cent, and four
governed reporting views publish the domain.

**Fifteen limitations travel with that answer.** They are not caveats added afterwards; each one is a
consequence of a decision recorded in [STM-017](docs/source-to-target/STM-017-dim-finance-product.md)
… [STM-020](docs/source-to-target/STM-020-fact-finance-product-adjustment.md) and
[DATA_DICTIONARY.md §42–§45](DATA_DICTIONARY.md), and each is enforced or asserted somewhere rather than
merely stated here.

### 15.1 Every product, provider and lender is invented, so no product or lender comparison means anything outside this dataset

Nineteen products, four administrators and ten lenders, all fictional. The catalogue attaches invented
economics, invented cancellation behaviour and an invented lender mix to every row. **No figure computed over
them may be compared to a real product, a real administrator, a real institution or a published market
figure**, and no surface may describe a product as standard or a lender as preferred.

`DQ-FPD-004` and `DQ-LND-002` close both name sets. `tests/unit/test_fi_privacy.py` asserts no committed name
collides with a real institution or administrator a reader would recognise — a **synthetic-catalogue contract
test**, deliberately not a claim to detect every real company in the world.

### 15.2 The eligibility rules are synthetic, so no penetration figure is a benchmark

`config/reference/fi_product_eligibility.yaml` states, for a fictional group, which categories *could* be
written on which deal structures and vehicle conditions. It is **not an industry standard, not a regulator's
definition, not any real dealership's menu and not a statement about what a store should offer**.

A penetration figure is only meaningful beside the population it was computed over, which is why
`reporting.vw_fi_product_penetration` publishes the numerator, the denominator and the governing `ELIG-*`
rule on **every row** and leaves the ratio to the consumer. **No surface may describe a penetration as good,
bad, average, standard or recommended.**

### 15.3 Eligibility is not sales propensity, and the model has nothing to say about who buys

Eligibility answers whether a product *could* have been written. It never answers whether a customer
*should* buy one, or is *likely* to.

**No customer, demographic, protected, credit, income, age or geographic attribute influences eligibility,
pricing, lender assignment, reserve or attachment anywhere in the model** — there is no such attribute in the
inputs at all, which is the strongest form the guarantee can take. The consequence is a real analytical
limit: ARPI cannot segment F&I performance by anything about a buyer, and will not acquire the ability.

### 15.4 The reserve and product amounts are decompositions, not independent draws

DASH.6 chose the **decomposition-preserving** strategy over a component-first rebase
([STM-019 §1.2](docs/source-to-target/STM-019-fact-finance-product-sale.md)). `back_end_gross` was drawn
first and is explained afterwards, so every pre-existing generated value is unchanged — a diff of the
committed `sale_event.csv` reports two added columns, no removed columns and **zero changed values**.

**The cost is stated rather than hidden.** Reserve and product gross on a deal are *shares of a total drawn
first*. Every component still obeys its own generation rule and no component is a plug, but a study of
"does reserve co-vary with product gross?" over this dataset would be measuring the allocation, not a
dealership.

### 15.5 There is no fourth back-end component, and `other_fi_income` is exactly zero

The identity is `reserve + product gross + other_fi_income`, and the third term is `0.00` by construction.
**It is not a column anywhere.** A dealer group with a genuine fourth component — a documentation fee treated
as F&I income, say — has nothing here to map it to. Adding one would be a new modelled component, not a
balancing plug: the allocation reaches the cent by largest remainder across real product lines precisely so
that no residual bucket is needed.

### 15.6 ARPI is not a lending model, and no lender question is answerable

**No APR, buy rate, sell rate, rate spread, money factor, payment, loan term, loan-to-value, approval,
decline, counter-offer, stipulation, adverse-action reason, credit score, credit file, credit application,
income or debt-to-income figure exists anywhere.** ARPI approves nothing, declines nothing, tiers nobody,
recommends no lender, optimizes no rate and prices nothing.

A store cannot ask this model "which lender approves more of my paper?", "what rate should we sell?" or
"which customers should we send where?". Those are not gaps to fill — they are the boundary.

`DQ-LND-007`, `DQ-FPS-016` and `DQ-FPA-013` inspect the **schema** and fail the run even when the offending
column is empty, because the defect is claiming to model a mechanic the platform does not have.

**`program_tier` classifies the LENDER'S PROGRAM, never a customer.** It is not a credit grade, it is
assigned to no person, and because it is an attribute of the lender it is constant across that lender's
deals — so a "tier mix" is a lender mix by another name and may not be read as a portfolio credit profile.

### 15.7 Reserve is an amount and can never become a rate

`finance_reserve_gross` is currency. It is never divided by anything financed, and **no rate, spread or
markup is derivable from it** because the model contains no rate to compare it against.

### 15.8 A lease earns no reserve, so a lease-heavy store shows a lower reserve PVR for reasons unrelated to its F&I office

ARPI models no money factor and no lease rate mechanic, so there is no mechanism a lease reserve could be
attributed to; inventing one would assume retail-finance mechanics apply to a lease. Cash deals earn none for
the simpler reason that nothing was financed.

**`KPI-FNI-001` and `KPI-FNI-002` are therefore structurally zero on Lease and Cash volume.** A store with a
heavier lease mix shows a lower reserve PVR as a property of the model, and no surface may read that as a
finding about the store. The decision is recorded in
[STM-019 §6](docs/source-to-target/STM-019-fact-finance-product-sale.md).

### 15.9 Three date bases are not interchangeable, and three KPIs are period proxies rather than loss rates

**Deal-date** gross is what the F&I office produced. **As-of** net gross is what the store retained through a
stated date. **Adjustment-period** figures group events by their own business date. An August chargeback on a
June contract belongs to August, and the June contract keeps June's gross forever.

`KPI-FNI-014`, `-015` and `-018` divide an adjustment-period numerator by a sale-date denominator. **They are
period proxies and explicitly not contract-cohort loss rates**, because the contracts charged back in a month
are mostly not the ones written in it. The disclosure is published *as data* on the view — not left to a
sentence somebody remembered — and `tests/integration/test_fi_reporting_views.py` asserts it.

### 15.10 The reporting window truncates the adjustment distribution, so adjustment volume is not comparable across months

An event dated past the window's end has no `dim_date` row and is not emitted. **The most recent months of
sales therefore carry structurally fewer adjustments than the earliest ones** — as a real store's most recent
cohort does, because those contracts have not had time to fail.

Any comparison of adjustment volume between an early month and a late one is reading that truncation. On the
`development` profile the whole domain holds 57 adjustment events over 1,012 contracts, which is small enough
that a single event moves a category rate materially.

### 15.11 Net gross is capped, so a genuine over-recovery could not be represented

Cumulative net reduction stays inside `[0, original_product_gross]` after **every** event in a contract's
sequence. Retained gross can never go negative and never exceed the original.

That is the right default and it is the **only** behaviour this generator produces — which means a real
situation where a store ends up worse off than the contract's original gross has no representation here.
`DQ-FPA-007` and `RECON-FI-ADJUSTMENT-CAP` enforce the cap; lifting it would be a modelling decision, not a
bug fix.

### 15.12 No menu, offer or decline is modelled, so no closing-rate analysis is possible

ARPI records what was **sold**. It records nothing about what was offered and declined, in what order, at
what price, or by whom. Menu-to-close analysis is impossible by construction.

That is deliberate rather than incidental: a declined offer is a customer interaction, and modelling it would
be the first step toward modelling the customer.

### 15.13 No adjustment carries money, a narrative, or anything about a person

An adjustment records its effect on the store's retained gross and nothing else. **There is no refund amount,
no remittance, no settlement, no bank detail, no communication record, no repossession narrative, no
collection activity, no customer reference and no free-text field** — because free text is where somebody
eventually writes something about a customer.

Reason categories are a closed vocabulary describing what happened to a **contract**. Data minimization
applies: a field is not created merely because it could exist in a real DMS.

### 15.14 Manager-grain F&I figures are governed, not evaluative, and small denominators are suppressed

`finance_manager_key` exists on both F&I facts. **No leaderboard, ranking, label, or best/worst/top/bottom
designation exists anywhere in the model**, and none may be built on it. A chargeback rate is not a
performance judgement.

Every manager-grain read is governed by a **minimum-sample floor** — `warehouse.fn_minimum_sample_floor()`,
project default **10** eligible deals, sourced from one place (`arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS`)
rather than hard-coded per view. Below the floor a figure is suppressed rather than shown small, because a
one-deal penetration of 100% is a number that will be repeated and cannot be defended.

The floor is a real limitation as well as a control: on a short window, a store with a thin F&I desk may
produce **no** publishable manager-grain figure at all.

### 15.15 The presentation surface exists since `DASH.7`; the semantic model still binds none of it

DASH.6 delivered SQL, generation, validation and reporting views and no surface at all. **`DASH.7`
builds the surface**: `/dashboard/fi`, the itemized Deal Jacket, and all four F&I views promoted into
the governed browser export. `tests/integration/test_fi_reporting_views.py` is re-aimed rather than
deleted — it now asserts the exported set is exactly those four, in both directions, so a fifth F&I
view exported without an increment still fails a test.

The Power BI semantic model binds **none** of the four views and **none** of the twenty-two `KPI-FNI-*`
definitions, and `DASH.7` changed no TMDL file. The F&I gap recorded in `powerbi/model_documentation/`
is therefore **"the SQL, reporting and browser surfaces are implemented; the semantic model is not
bound to any of them"**, and Gate 2 stays CLOSED regardless.

### 15.16 What `/dashboard/fi` will not tell you, stated on the page as well as here

The console page carries these as rendered text rather than only in this file, because a limitation a
reader has to go looking for is a limitation most readers never see.

**There is no benchmark and no target.** ARPI publishes no industry F&I figures, so nothing on the page
is good, bad, healthy, weak or standard. A penetration of 40.7% is stated as 40.7%.

**There is no recommendation.** Nothing suggests a product to sell, a price to charge, a customer to
approach or a lender to use. ARPI approves nothing, declines nothing and tiers nobody.

**There is no menu and no offer history**, so no closing rate is computable from this model at all.
The warehouse records what was sold, never what was offered and declined — §7 of
`PRIVACY_AND_ETHICS.md` records why that is deliberate rather than a gap.

**Manager rows are comparisons, not evaluations.** They carry no ranking and no label, they are ordered
by store and synthetic identifier, and below the governed floor a ratio is withheld rather than shown
small. A finance manager's figures inherit the store's vehicle mix, its finance-structure mix and its
product-eligibility mix, so a difference between two rows is not a difference in skill.

**The period proxy rates are not loss rates**, and the page says so beside every one of them. A
chargeback rate on the page divides an amount posted in the selected period by the original gross of
contracts *sold* in that period — two different populations, since the contracts charged back in a
month are mostly not the ones written in it. A true cohort rate needs the full life of each cohort,
and the reporting window truncates the tail of the adjustment lag distribution, which is also why the
most recent sale months carry structurally fewer adjustments than the earliest ones.

**The structure filter is partial, and the page states it rather than applying it silently.** The
exported F&I datasets carry the structure MIX as counts, not a per-structure split of reserve, product
gross and penetration. Filtering the page by structure would produce figures that looked scoped and
were not, so the filter is shown in the structure section and its limit is written beside it.

---

## 16. What the inventory accounting and GL control model cannot support (ADR-0013, `DASH.8`)

`DASH.8` promotes `warehouse.dim_gl_account`, `warehouse.fact_inventory_accounting_snapshot` and
`warehouse.fact_gl_control_balance`, and publishes three reporting views and twelve `KPI-ACC-*`
identifiers. Every limitation below is a property of the model, not a gap in the implementation, and
each one is repeated on the surface that could be misread without it.

### 16.1 The GL side is generated from the subledger it is reconciled against

**This is the single most important limitation of the increment.**

`warehouse.fact_gl_control_balance` is not an independently ingested second accounting system. Its
balances are computed from `SUM(current_book_value)` over the stock schedule, plus a governed table of
deliberate variances, so the reconciliation surface can be seen working in both its states.

An exact reconciliation therefore proves the reconciliation **arithmetic** is correct. **It does not
prove that two independent sources agree, because there is only one source.** No figure in this domain
is evidence that a real ledger and a real schedule would tie out, and no surface may claim it is.

The statement appears on the table comment, on both reporting views that publish a variance, in
`RECON-ACC-GL-SUBLEDGER`'s own description, in `KPI_CATALOG.md §41.1` and here.

### 16.2 ARPI is not building a general ledger

There is no journal entry, journal line, debit amount, credit amount, posting batch, posting timestamp,
trial balance, aged trial balance, period-close state, suspense account, adjusting entry, reversal,
approval or sign-off workflow, remediation status, or financial statement of any kind — not as a
column, not as a generation parameter, and not as a derived value.

`KPI-ACC-002` is a **control-account balance**, not a trial-balance figure. The catalogue is three
inventory control accounts and is **not a chart of accounts**: there is no Cash, Revenue, Cost of
Sales, Payroll, Parts, Service, Rent, Payable, Receivable, Equity, Retained Earnings or Tax account.
`DQ-GLA-009` scans account names for general-ledger vocabulary so the boundary fails a run rather than
a review.

**Nothing in this domain is accounting advice, an audit opinion, or evidence about a real close.**

### 16.3 A variance is a demonstration, not a finding

The dataset carries planted variances **on purpose**, and they are synthetic demonstration conditions.
They are not discovered business findings and no document may describe them as such. Nothing here says
anything about a real dealership, a real ledger or a real month.

`RECON-ACC-GL-SUBLEDGER` is registered non-critical for exactly this reason: failing a pipeline run
because a controlled accounting variance exists would make the exception surface unusable and would
teach a reader that a variance means broken data. **It is the status that is not critical** — the
variance is still calculated, recorded and rendered.

### 16.4 `KPI-ACC-011` is not a journal posting delay

The measure is **acquisition date to first month-end schedule appearance**, and nothing more. ARPI
holds no separate posting timestamp, and manufacturing one would invent an operational fact the
synthetic data does not contain.

Two consequences follow. Because the accounting calendar is month-end only, the lag is bounded below by
how far into a month a unit arrived, so it measures schedule **cadence** as much as promptness. And
there is deliberately **no F&I equivalent**: the F&I domain carries no separate posting date, so no
second posting-lag pair is supportable and none was fabricated.

`tests/integration/test_kpi_verification.py` asserts that no column named for a posting timestamp
exists anywhere in `warehouse` or `reporting`, so the narrowing cannot quietly be undone.

### 16.5 Floorplan principal is context, and there is no floorplan cost analysis

`floorplan_principal` is a **liability** carried on an asset schedule. It is never added to, subtracted
from or netted against book value, and **ARPI publishes no net-inventory-position figure anywhere** —
that number would net an asset against a liability and mean nothing a controller would recognise.

No rate, interest, curtailment schedule, maturity or lender term is modelled, so **no carrying-cost,
flooring-expense or interest-burden measure can be derived from this column**. Principal does not
amortise in this model, and an amortisation curve would be an invented operational fact.

`floorplan_principal = 0.00` is a **legitimate unfloored unit**, never missing data. After a write-down
a unit may legitimately owe more than it is carried at, which is precisely why the two are never
netted.

### 16.6 There is no `Wholesale Inventory` control category

Three categories, not four. Nothing observable **at a month-end** distinguishes a unit held for
wholesale from one held for retail; only how the unit was eventually disposed of would, and reading
that would be future-outcome leakage. A category assignable only by consulting the future is a label
applied in hindsight, and a schedule built on one would be wrong in a way no reconciliation could
detect.

If a later increment introduces an observable held-for-wholesale signal — a disposition intent recorded
at the time, not inferred afterwards — the category can be added.

### 16.7 There is no Floorplan Liability control account

`KPI-ACC-001` is an inventory **asset** subledger measure. Putting a liability into the same
reconciliation invites netting the two, and no registered stakeholder question requires liability
reconciliation. `account_type` permits `Liability` so a later increment can add one without a domain
migration, but such an account must reconcile against `SUM(floorplan_principal)`, never against
`current_book_value`, and must never enter `KPI-ACC-001`.

### 16.8 The schedule is month-end only

`fact_vehicle_inventory_snapshot` is daily; the accounting schedule is six month-ends. That narrowing
is deliberate — a control account is reconciled at a period end — but it means **no intra-month
inventory-value series is available**, and no question about how carrying value moved within a month is
answerable from this domain.

It is also what makes matched-date comparability structural: both sides of every reconciliation are
month-end by construction, so comparing a month-end control balance with a mid-month schedule is not
available rather than merely discouraged.

### 16.9 A missing balance and a zero balance are different, and only one is ever reported

`reporting.vw_inventory_gl_reconciliation` FULL JOINs the two sides. A store-account-date present on
only one side produces a row with a **NULL** variance and a `Missing GL balance` or `Missing subledger
balance` state — never a variance equal to the whole of the side that is present.

A consumer that coalesced those NULLs to zero would report a missing balance as a **zeroed account**,
which is a different fact about the world. No ARPI surface does, and `RECON-ACC-GL-SUBLEDGER` proves
the coupling between the state, the variance and the reconciled flag on every row.

### 16.10 There is no accounting surface, and the semantic model binds none of this

`DASH.8` exports **no** browser dataset, adds **no** console route and leaves
`src/arpi/dashboard/contract.py` unchanged. No TMDL was written for this domain, no relationship to
either new fact exists, and **no DAX has ever computed one of the twelve `KPI-ACC-*` measures**.

The three accounting views are counted apart from the twenty-eight-view MVP baseline for the same
reason the listing and dashboard-program lanes are: that number is what the SQL baseline and the
semantic model were measured against, and folding new views into it would restate a historical
baseline rather than record a new capability.

### 16.11 Three counts are zero on every healthy run, and two of them are unreachable

`KPI-ACC-008` and `KPI-ACC-009` look for a child row whose parent does not resolve. The foreign keys
make that impossible in a database whose constraints are intact, so both are `0` on every healthy run.

They are written anyway, so that a constraint dropped from a **deployed** database fails a run rather
than passing one — and `tests/integration/test_kpi_verification.py` asserts the constraints are
actually present, because a zero from a branch that cannot fire is not evidence on its own.

`KPI-ACC-012` counts failing data-quality checks and is `0` on a healthy run by construction. Unlike
every other measure in this domain it names no store and no date: a failing check is a property of a
pipeline run, not of a dealership.
