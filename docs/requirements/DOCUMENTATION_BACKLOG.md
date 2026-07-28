# Documentation Backlog — ARPI

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-07-28
**Conventions:** [README.md](README.md)

---

## 1. Purpose

This is an honest register of documentation gaps, inconsistencies, and unverified claims identified while
writing the Phase 0 documentation set. It exists because the alternative — quietly leaving them
undocumented — would undermine the one property this repository most needs to demonstrate, which is that
its claims can be trusted.

Nothing here is a blocker for Phase 0 being complete. Several items are, however, blockers for the project
being *credible* to a careful reader, and those are marked **High**.

---

## 2. Priority definitions

| Priority | Meaning |
|---|---|
| **High** | Actively misleading, or a contradiction a careful reviewer will find. Resolve before the next public-facing milestone. |
| **Medium** | A genuine gap that weakens the documentation but misleads nobody. Resolve during Phase 1. |
| **Low** | Cosmetic, or a deliberate deferral that is recorded so it is not forgotten. |

---

## 3. Register

| ID | Gap | Impact | Proposed resolution | Priority |
|---|---|---|---|---|
| `DOC-01` | **`ARCHITECTURE.md` §24 (Repository Structure) still describes the retired identity.** The directory tree names the retired working title as the repository root, uses the retired package path in place of `src/arpi/`, and names Power BI and Excel deliverables under the retired product name instead of `powerbi/ARPI_Performance_Intelligence.pbix` and `excel/ARPI_Operating_Report.xlsx`. | A reader following §24 would look for the wrong package and the wrong files. It also contradicts `ADR-0001`, which §2.1 cites as the authority, and it means `scripts/check_naming.py` can only pass because `ARCHITECTURE.md` is not yet flagged. The retired identifier is permitted only in that ADR and in `docs/research.md`. | Rewrite §24's tree to the ARPI identity. Owned by the architecture workstream. | **High** |
| `DOC-02` | **`ARCHITECTURE.md` §33 and §36 use the retired working title in prose.** The opening sentences of "Definition of Done" and "Final Architecture Position" both name the retired product rather than ARPI. | Same as `DOC-01`: the retired identifier is permitted only in `ADR-0001` and `docs/research.md`. Two of the architecture's most quotable sentences carry the wrong product name. | Replace with "Automotive Retail Performance Intelligence" or "ARPI". Owned by the architecture workstream. | **High** |
| `DOC-03` | **`ARCHITECTURE.md` §24 lists `requirements.txt`**, but the project's tooling decision is a single `pyproject.toml` with **no** `requirements.txt`, `setup.cfg`, `.flake8`, `mypy.ini`, `pytest.ini`, or `.coveragerc`. | A contributor could create `requirements.txt` in good faith and introduce a second, drifting dependency source. | Remove `requirements.txt` from the §24 tree and state the single-config-file rule. Owned by the architecture workstream. | **High** |
| `DOC-04` | **`warehouse.dim_customer` has no dedicated backlog item.** [DATA_DICTIONARY.md §9](../../DATA_DICTIONARY.md) marks it Planned (Phase 1.2), but the Phase 1.2 item list is raw/staging ingestion, vehicle dimension, employee dimension, sale fact, and inventory snapshot fact. It is currently delivered as an acceptance criterion inside `P1.2-04`. | A dimension carrying the project's most privacy-sensitive schema is being delivered as a sub-clause of a fact-table item. Its prohibited-field controls deserve their own acceptance criteria and their own review. | Promote it to a first-class item `P1.2-06`, with the eight prohibited fields as explicit acceptance criteria and a dedicated privacy test. | **High** |
| `DOC-05` | **Two phase-numbering schemes coexist.** `ARCHITECTURE.md` §27 numbers eight lifecycle phases (1 = Product Definition … 8 = Portfolio Packaging). The delivery documents use Phase 0 and Phase 1.1–1.5. "Phase 1" therefore means two different things depending on which document you are reading. | Genuine ambiguity. `ARCHITECTURE.md` §27 "Phase 1: Product Definition" and `PHASE_1_BACKLOG.md` describe entirely different work. | [README.md §3.6](README.md) explains the mapping, but the architecture itself does not. Add a short cross-reference in `ARCHITECTURE.md` §27, or rename the delivery phases to something unambiguous such as "Increment 1.1". | **High** |
| `DOC-06` | **The generation CLI command surface is documented but not covered by any canonical-command list.** [DATA_GENERATION.md §15.1](../../DATA_GENERATION.md) documents `version`, `check-config`, `generate`, and `run-foundation` with their options. These were **verified against the implemented CLI on 2026-07-28 and are correct today**, but only the lint, type, test, and repository-script commands are pinned as canonical, so the generation commands can drift without anything failing. | A stale command in the data-generation guide is wrong in the one place a reviewer is most likely to copy and paste from, and nothing in CI would catch it. | Add a CI check that compares the documented command surface against `python -m arpi --help`, or add the generation commands to the canonical command list. Downgraded from High to Medium now that the current documentation is verified accurate. | **Medium** |
| `DOC-07` | **`docs/research.md` citations were not independently re-verified during Phase 0.** The research document cites the FTC Safeguards Rule guidance, NHTSA vPIC, NADA aggregate reports, and federal transportation and economic datasets. None was re-checked for current availability, current terms, or current field coverage while writing the Phase 0 documentation. | Where other documents cite research.md, they cite it for a **design rationale**, which is safe. But `docs/research.md` §5 makes factual claims about dataset field coverage that could have changed. [LIMITATIONS.md §11](../../LIMITATIONS.md) records the point-in-time caveat; the underlying citations remain unverified. | Re-verify each cited source before any public case study is published, and record the verification date alongside each citation. Note that `docs/research.md` content is not editable by the documentation workstream, so this needs the document's owner. | **Medium** |
| `DOC-08` | **Deferred entities are documented at paragraph level only.** The ten Deferred entities in [DATA_DICTIONARY.md §27](../../DATA_DICTIONARY.md) carry a grain and an unlock stage, but no column list, no business rules, and no history policy. | Acceptable for Deferred scope, but it means promoting any of them to Planned requires design work that is not yet visible as work. It also makes the effort of the strong portfolio release look smaller than it is. | Leave as-is until a Deferred entity is promoted. At promotion, require full attribute-level documentation as a Gate 4 condition. | **Low** |
| `DOC-09` | **No entity-relationship or dimensional-model diagram exists.** `docs/research.md` §8.4 lists an ERD, a dimensional model, and relationship cardinality among the artefacts an intentional data model should publish. `docs/diagrams/` is empty. | [ARCHITECTURE.md §13](../../ARCHITECTURE.md) has a fact-constellation Mermaid diagram, which partly covers this, but there is no cardinality-annotated model diagram and nothing that distinguishes Implemented from Planned entities visually. A reviewer skimming the repository has no single picture of the model. | Produce a Mermaid ER diagram under `docs/diagrams/` showing all entities with implementation status and relationship cardinality. Owned by the architecture workstream. | **Medium** |
| `DOC-10` | **`RECON-FI-001` status deviates from the architecture's framing.** [ARCHITECTURE.md §21.3](../../ARCHITECTURE.md) lists "F&I product totals reconcile to transaction-level back-end gross" as a required reconciliation, but its dependency `fact_finance_product_sale` is Deferred. [KPI_CATALOG.md §36](../../KPI_CATALOG.md) records the reconciliation as **Deferred** rather than Planned, with an explanatory note. | A reconciliation cannot honestly be Planned when the table it reconciles is not. The deviation is documented inline, but it is a place where two ARPI documents use different words for the same thing. | Confirm the status-consistency rule — *a reconciliation inherits the weakest status of its dependencies* — and state it once in `KPI_CATALOG.md` §37 so it is a rule rather than an exception. | **Medium** |
| `DOC-11` | **`dim_dealership`'s SCD Type 2 expire-and-insert path has never run against generated data.** All three stores are on their initial version, so only unit tests exercise the branch. | This is the largest untested code path in the Phase 0 slice, and it is the mechanism the whole Type 2 design rests on. It is recorded in [STM-002 §10](../source-to-target/STM-002-dim-dealership.md). | `P1.1-03` requires at least one employee to have more than one SCD2 version, which exercises the shared pattern with generated data. Consider adding a store attribute change to a future profile so the dealership path is exercised too. | **Medium** |
| `DOC-12` | **`DQ-*` check IDs are allocated only for the Phase 0 entities.** The register covers `DQ-DATE-*`, `DQ-DLR-*`, and `DQ-GEN-*`. Phase 1 entities have no allocated prefixes; the backlog refers to `DQ-VEH-*` and `DQ-VMD-*` informally. | Without a reserved prefix scheme, Phase 1 check IDs will be invented per entity and will collide or drift. Check IDs are shared between Python and SQL, so a collision is a real defect. | Allocate and publish the full prefix scheme now: `DQ-VEH-*`, `DQ-VMD-*`, `DQ-EMP-*`, `DQ-CUS-*`, `DQ-SLE-*`, `DQ-INV-*`, `DQ-LED-*`, `DQ-APT-*`, `DQ-MKT-*`. Add to [DATA_DICTIONARY.md §21.2](../../DATA_DICTIONARY.md). | **Medium** |
| `DOC-13` | **Two privacy controls are documentation-only.** [PRIVACY_AND_ETHICS.md §13](../../PRIVACY_AND_ETHICS.md) controls 25 (no protected characteristic can be introduced) and 26 (enrichment stays within approved boundaries) have **no automated enforcement**. Nothing in code would stop a contributor adding a protected-characteristic column to a new entity except review. | The prohibition is the strongest ethical commitment in the project, and it is the one with the weakest enforcement. The gap is disclosed honestly in §13, but disclosure is not mitigation. | `P1.2-01` generalizes `DQ-DLR-004` into a reusable per-entity prohibited-column check. Extend the prohibited-column list to include protected-characteristic names and common synonyms, and run it against every declared entity. | **Medium** |
| `DOC-14` | **Response-time bands are a project convention with no cited source.** [KPI_CATALOG.md §31](../../KPI_CATALOG.md) proposes bands of under 5 minutes, 5–15, 15–60, and over 60. `docs/research.md` §4.5 requires a "response-time band" dimension but specifies no boundaries. | The bands are presented as a reporting convention, not a benchmark, and no claim is made about what constitutes a good response time. Still, unlabelled boundaries can be read as implied standards. | Label the bands explicitly as a **project reporting convention with no benchmark meaning**, in the same sentence, wherever they appear. Consider deriving them from the generated distribution's quantiles instead, which would make them descriptive rather than prescriptive. | **Medium** |
| `DOC-15` | **No stakeholder-question traceability matrix exists.** `docs/research.md` §8.3 requires documented stakeholder questions, and §4 lists dozens of primary questions per domain. [KPI_CATALOG.md §37](../../KPI_CATALOG.md) requires every KPI to trace to at least one, but no document records the mapping. | Gate 4 requires that a stakeholder question justify each new data domain, and there is no artefact to check that against. It also means the personas named in `docs/research.md` §8.2 are cited but never formalized. | Add `docs/requirements/STAKEHOLDER_QUESTIONS.md`: a table of persona → question → KPI IDs → report page. Small effort, and it closes the Gate 4 evidence gap. | **Medium** |
| `DOC-16` | **Excel and Power BI file names are referenced but the files do not exist.** `powerbi/ARPI_Performance_Intelligence.pbix` and `excel/ARPI_Operating_Report.xlsx` are named across the documentation set. | The names are always accompanied by a status marker or a "not yet created" note, so nothing is currently misleading. The risk is that a future edit drops the marker and the reference reads as a claim. | Keep every reference marked. `P1.5-04` and the Definition of Done both require that no document claim anything exists that does not. | **Low** |
| `DOC-17` | **`market_region` has a single value across all three stores.** Documented in [STM-002 §10](../source-to-target/STM-002-dim-dealership.md). | The column has no analytical variance, so any "by market region" analysis is degenerate. Harmless while disclosed, but a reviewer could reasonably expect a market dimension to discriminate. | Leave as-is. Revisit if `dim_geography` is ever promoted from Deferred. | **Low** |
| `DOC-18` | **No cross-run data-quality trend view exists.** `audit.validation_result` records outcomes per run, and `reporting.vw_data_quality_summary` exposes them, but nothing trends quality across runs. | The Power BI Data Quality page ([ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) page 9) asks "did validation pass?" — answerable today — but not "is quality improving or degrading?", which is the more useful management question. | Add a trend view during Phase 1.3 when the check count grows enough to make trending meaningful. Recorded in [STM-003 §13](../source-to-target/STM-003-audit-metadata.md). | **Low** |
| `DOC-19` | **No audit-retention policy is defined.** Audit rows accumulate indefinitely, with no purge, archive, or partitioning strategy. | Irrelevant at Phase 0 volumes. At portfolio scale, with per-entity row counts and per-check results on every run, the audit schema will grow steadily. | Define a retention policy before the portfolio dataset is regenerated repeatedly. Low urgency, but cheaper to decide now than to retrofit. | **Low** |
| `DOC-20` | **The fiscal calendar is calendar-aligned, and three columns exist purely for future flexibility.** `fiscal_month`, `fiscal_quarter`, and `fiscal_year` are exact copies of their calendar counterparts. | A reviewer could read the presence of fiscal columns as evidence that a distinct fiscal calendar is modelled. It is not. Documented in [DATA_DICTIONARY.md §6.1](../../DATA_DICTIONARY.md) and [STM-001 §10](../source-to-target/STM-001-dim-date.md). | Keep the disclosure prominent. If a non-calendar fiscal year is ever introduced, it becomes a major version bump on `STM-001`. | **Low** |

---

## 4. Summary

| Priority | Count |
|---|---:|
| High | 5 |
| Medium | 9 |
| Low | 6 |
| **Total** | **20** |

**Five High items.** Four of them (`DOC-01`, `DOC-02`, `DOC-03`, `DOC-05`) are contradictions between
documents rather than missing content — the kind of defect a careful reviewer finds quickly and that costs
disproportionate credibility. The fifth (`DOC-04`) is a scope gap where the project's most
privacy-sensitive dimension lacks its own item.

`DOC-01` and `DOC-02` have a further consequence worth naming: `scripts/check_naming.py` fails the build on
any use of the retired identifier outside its two allowlisted files. `ARCHITECTURE.md` currently carries the
retired name in §24, §33, and §36 — so either the allowlist has been widened to accommodate it, or the
check has not yet been run against the current text. Either way, the two documents disagree about what the
project is called.

---

## 5. Maintenance

- This register is reviewed at the close of every delivery phase.
- Resolved items are struck through with the resolving change referenced, rather than deleted — the history
  of what was wrong is itself useful evidence.
- New gaps are added as they are found, including gaps found by reviewers.
- **An empty documentation backlog would be a warning sign, not an achievement.** A project of this size
  with no known documentation gaps is a project that has not looked.
