# ADR-0001: Project Identity and Naming Convention

## Status

**Accepted**

## Date

2026-07-28

## Deciders

Michael Palmer

## Context

The research phase (`docs/research.md`, §11.1) proposed a working title for this project and listed
several alternatives. That working title was carried into the first draft of `ARCHITECTURE.md` and into
the initial naming of database roles and the Python package.

Before any implementation work began, the identity needed to be settled permanently, because a project
name is not only a label. In this repository the name propagates into:

- the repository slug and therefore every public URL,
- the Python distribution name and the importable package path,
- the environment-variable prefix used by typed configuration,
- three PostgreSQL role names that appear in DDL, grants, and connection strings,
- the filenames of the eventual Power BI and Excel deliverables,
- and the title of every document a hiring manager reads first.

Changing any of these later is a breaking, repo-wide migration. It is cheap now and expensive after the
warehouse, the CI pipeline, and the semantic model exist.

Three properties were required of the final name:

1. **Descriptive without explanation.** A reviewer skimming a résumé or a repository list should
   understand the domain and the deliverable from the name alone.
2. **Not brand-shaped.** A product-style brand name implies a commercial product that does not exist and
   invites trademark and domain conflicts. This is a portfolio analytics project, and the name should say
   so.
3. **Mechanically clean.** It must produce a valid, unambiguous Python identifier, a short identifier
   suitable for prefixes and filenames, and role names that read correctly in SQL.

## Decision

The project is named **Automotive Retail Performance Intelligence**, abbreviated **ARPI**.

The name is descriptive rather than brand-shaped: it states the industry (automotive retail), the subject
(performance), and the deliverable class (intelligence). The short identifier `ARPI` is four characters,
unambiguous, and safe as a Python package name, an environment-variable prefix, a role-name prefix, and a
filename prefix.

All identifiers derive mechanically from this decision, with no variants permitted.

## Naming conventions

| Concept | Canonical value |
|---|---|
| Display name | `Automotive Retail Performance Intelligence` |
| Short identifier | `ARPI` |
| Repository slug | `Automotive-Retail-Performance-Intelligence` |
| GitHub owner | `mpalmer79` |
| Python package | `arpi` (src layout: `src/arpi/`) |
| Distribution name | `arpi` |
| Config env prefix | `ARPI_` (nested delimiter `__`) |
| DB roles | `arpi_admin`, `arpi_loader`, `arpi_reporter` |
| Power BI working title | `Automotive Retail Performance Intelligence` |
| Power BI file naming | `powerbi/ARPI_Performance_Intelligence.pbix` (NOT YET CREATED — reference only) |
| Excel file naming | `excel/ARPI_Operating_Report.xlsx` (NOT YET CREATED — reference only) |
| Fictional dealer group | `Granite State Auto Group` (NEVER rename) — **superseded, see ADR-0011** |
| Author | Michael Palmer |
| License | MIT, Copyright (c) 2026 Michael Palmer |
| Version | `0.1.0` |
| Retired name | `DealerPulse BI` — permitted ONLY inside `docs/architecture-decisions/ADR-0001-project-identity.md` and inside `docs/research.md` (historical research evidence, preserved verbatim) |

### Derived rules

- Prose uses the full display name on first mention in a section, then `ARPI`.
- Code, configuration keys, package paths, and role names use lowercase `arpi`.
- Environment variables use the uppercase prefix `ARPI_` with `__` as the nested delimiter, for example
  `ARPI_LOGGING__LEVEL` and `ARPI_DATABASE__PASSWORD`.
- Artifact filenames use the uppercase short identifier, for example `ARPI_Operating_Report.xlsx`.
- The fictional dealer group `Granite State Auto Group` is part of the data model, not the project
  identity, and is never renamed alongside it. **The group's public name was later changed to
  `Granite Auto Group` by [ADR-0011](ADR-0011-dealer-group-public-naming.md). The rule this line
  states still holds: the group's name is not the project's identity and did not change with it.**

## Alternatives considered

The candidates below are the working title and the alternative names recorded in `docs/research.md`,
§11.1 ("Working Concept" → "Recommended Working Title" and "Alternative Names").

| Alternative | Origin | Why it was rejected |
|---|---|---|
| **DealerPulse BI** | `docs/research.md` §11.1, recommended working title | Brand-shaped rather than descriptive. "Pulse" says nothing about what is measured, and "BI" narrows the project to a tool category rather than an analytical outcome. As a coined product name it also carries the trademark and domain-conflict risk that `docs/research.md` §11.1 itself warns about. Retained only as history. |
| **Dealer Performance Intelligence** | `docs/research.md` §11.1, alternative names | Closest runner-up and genuinely descriptive, but "Dealer" is ambiguous outside the automotive industry, and the abbreviation `DPI` collides with a very common display-resolution term, which would make the package name and env prefix hard to search for. |
| **RetailDrive BI** | `docs/research.md` §11.1, alternative names | Brand-shaped, same objection as the working title. "Drive" is a pun rather than a description, and the name does not identify the automotive domain unambiguously. |
| **AutoRetail Intelligence** | `docs/research.md` §11.1, alternative names | Accurate and reasonably descriptive, but "Auto" as a prefix is heavily overloaded in software contexts (automation, automatic), and the short form `ARI` is already widely used. It also omits the performance-measurement focus that is the actual subject of the warehouse. |
| **DealerOps Analytics** | `docs/research.md` §11.1, alternative names | Suggests an operations-tooling or DevOps-adjacent product rather than a dimensional analytics platform, and would misdirect reviewers evaluating the work against analyst role requirements. |
| **VelocityIQ** | `docs/research.md` §11.1, alternative names | Fully abstract. It communicates neither the industry nor the deliverable, and "IQ" branding is common enough to create conflicts. Rejected on the same descriptive-over-brand principle. |
| **Keep no formal name; use the repository slug only** | Considered during this decision | The repository slug alone would work mechanically but leaves no short identifier, forcing either a long package name or an ad-hoc abbreviation invented later per file. That is precisely the drift this ADR prevents. |

`docs/research.md` §11.1 closes with the instruction that "a final public name should be checked for
repository, trademark, and domain conflicts before launch." Choosing a plainly descriptive phrase over a
coined brand satisfies that instruction directly: a descriptive noun phrase is not a mark to be conflicted
with.

## Consequences

### Positive

- The name is self-explanatory in a repository listing, a résumé line, and a document title, with no
  glossary required.
- Every derived identifier is mechanical. There is exactly one correct spelling of the package, the
  environment prefix, the roles, and the artifact filenames, so review does not have to adjudicate
  variants.
- Adopting a descriptive phrase instead of a coined brand removes trademark and domain-conflict exposure
  for a public portfolio repository.
- `ARPI` is short enough to prefix filenames and roles without producing unwieldy identifiers, and
  distinctive enough to grep for.
- Fixing the identity before implementation means the SQL DDL, the Python package, the CI workflows, and
  the documentation were all written against one name from the start.

### Negative

- The display name is long. Headings, badges, and narrow tables need the `ARPI` short form, which
  introduces a first-use/thereafter convention that authors must remember.
- The name is generic enough that it is not memorable as a brand. This is a deliberate trade, but it does
  mean the project is identified by its content rather than by a catchy label.
- The abbreviation `ARPI` has no independent recognition and must be introduced on first use in any
  externally facing document.
- One historical inconsistency is now permanent: `docs/research.md` recommends a name the project does not
  use. That document is preserved verbatim as research evidence, so the discrepancy is explained here
  rather than edited away.

## Migration impact

The following changes were made when this decision was adopted. This list is the complete set.

| Area | Before | After |
|---|---|---|
| `ARCHITECTURE.md` title | `# DealerPulse BI Architecture` | `# Automotive Retail Performance Intelligence — Architecture` |
| `ARCHITECTURE.md` prose | Retired product name in §1, §3, §4, §33, §36 | Full display name on first use per section, `ARPI` thereafter |
| `ARCHITECTURE.md` §2 | Architecture version 1.0 | Architecture version 1.1, last reviewed 2026-07-28, plus new §2.1 Naming History |
| `ARCHITECTURE.md` §22.3 | `dealerpulse_admin`, `dealerpulse_loader`, `dealerpulse_reporter` | `arpi_admin`, `arpi_loader`, `arpi_reporter` |
| Python package path | `src/dealerpulse/` | `src/arpi/` |
| Distribution name | not yet published | `arpi`, version `0.1.0` |
| Configuration prefix | not yet implemented | `ARPI_` with `__` nested delimiter |
| Repository tree (`ARCHITECTURE.md` §24) | Root `DealerPulse-BI/`, speculative contents, `requirements.txt`, two notebooks that never existed | Root `Automotive-Retail-Performance-Intelligence/`, every entry marked `[now]`, `[empty]`, or `[planned]`; `requirements.txt` removed in favour of `pyproject.toml` only |
| Power BI file | `powerbi/DealerPulseBI.pbix` | `powerbi/ARPI_Performance_Intelligence.pbix` (not yet created) |
| Excel file | `excel/DealerPulse_Operating_Report.xlsx` | `excel/ARPI_Operating_Report.xlsx` (not yet created) |
| `README.md` | Two lines, including the misspelling "PostgregSQL" | Full project entry point using the new identity and the correct spelling `PostgreSQL` |

No database objects, generated data files, or published artifacts existed under the retired name, so the
migration required no data migration, no role rename in a live database, and no redirect.

## Explicit retirement statement

**`DealerPulse BI` is retired. It is not the name of this project, and it must never appear anywhere in
this repository as a current identity.**

The name may appear in exactly two locations, and in both it is historical:

1. **This ADR** (`docs/architecture-decisions/ADR-0001-project-identity.md`), where it is discussed in the
   past tense as the rejected working title and as the source of the migration.
2. **`docs/research.md`**, which is preserved verbatim as the research evidence that produced this
   project. Section 11.1 of that document recommends the working title. It is a dated record of what was
   researched and recommended, not a statement of what the project is called, and it is deliberately not
   edited.

`ARCHITECTURE.md` §2.1 "Naming History" records that a retirement happened and points here for the detail.
It deliberately does not spell the retired title out, so that the two locations above remain the only two.

Anywhere else — in prose, in code, in SQL, in configuration keys, in filenames, in commit messages, in
diagrams, in Power BI artifacts, or in portfolio copy — the retired name and every derivative of it
(`dealerpulse`, `DealerPulse`, `dealerpulse_admin`, `dealerpulse_loader`, `dealerpulse_reporter`,
`DealerPulseBI`, `DealerPulse_Operating_Report`, `DealerPulse-BI`) is a defect and must be corrected, not
tolerated.

## Enforcement

Enforcement is automated rather than left to review discipline.

- `scripts/check_naming.py` scans the repository for retired identifiers and for known incorrect variants
  of the current identity. It exits non-zero when a violation is found, and it is wired into continuous
  integration, so a pull request that reintroduces the retired name fails before it can be merged.
- The check permits the two historical locations named in the retirement statement above and nothing else.
- `scripts/check_docs_links.py` complements it by verifying that the relative links between documents —
  including the links to this ADR — actually resolve.

Both checks run in CI as:

```
python scripts/check_naming.py
python scripts/check_docs_links.py
```

If the retirement policy is ever changed, this ADR must be superseded by a new ADR and
`scripts/check_naming.py` must be updated in the same change.
