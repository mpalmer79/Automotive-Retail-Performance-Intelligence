# ADR-0007: Power BI Project Format

## Status

**Accepted**

## Date

2026-07-29

## Deciders

Michael Palmer

## Context

Gate 1 opened on 2026-07-29 (`docs/requirements/GATE_1_READINESS.md`), which permitted the first Power BI
artefact in the project's history. That artefact had to be stored somehow, and the storage choice is the kind
of decision `ARCHITECTURE.md` §35.2 requires a record for: it fixes how the model is reviewed, what a pull
request against it looks like, what continuous integration can assert about it, and what has to happen on a
machine this project does not own.

The default answer is a `.pbix` file. It is what Power BI Desktop saves, it is what `ARCHITECTURE.md` §26.2
names as primary portfolio distribution, and it is what §24 lists in the repository structure. It is also a
ZIP archive containing binary parts. A pull request that changes one measure and a pull request that
rewrites the entire model produce the same diff: `Binary files differ`. For a project whose stated position
is that contracts and implementations are never allowed to disagree, and whose documentation is checked
mechanically, a review surface that cannot be read is a real cost rather than an inconvenience.

Three further forces shaped the decision.

**The model is large and mostly mechanical.** Twenty imported tables, roughly forty relationships, six
measure tables. Most changes to it will be one measure, one relationship's active state, or one column's
visibility. Those are exactly the changes a line-oriented diff makes reviewable and a binary hides.

**The execution environment has no Power BI.** The semantic model was authored on Ubuntu 24.04. There is no
Windows layer, no Power BI Desktop, and no Analysis Services instance anywhere in it. Whatever format was
chosen had to be one that could be *written* without Desktop, because otherwise nothing could be written at
all. That constraint eliminates the binary immediately: a `.pbix` cannot be authored outside Desktop except
by libraries that construct it from the same textual metadata this record chooses directly.

**The project's own evidence discipline applies to itself.** `ARCHITECTURE.md` §33 and
`docs/requirements/PHASE_1_BACKLOG.md` §7.2 both end on the same rule: no document claims anything exists
that does not. A model authored without Desktop has not been opened by Desktop, and the format decision has
to carry that consequence explicitly rather than leave it to be discovered by whoever opens it first.

## Decision

**The Power BI artefact is a PBIP project. The semantic model is stored as TMDL. The report is a PBIR shell
with no hand-authored content. Storage mode is Import. No `.pbix` is committed during delivery increment
`P2.1`.**

### Why PBIP

The Power BI Project format (`.pbip`) stores what a `.pbix` stores, unpacked into a directory tree of text
files, with the semantic model and the report as sibling folders:

```text
powerbi/ARPI_Performance_Intelligence/
├── ARPI_Performance_Intelligence.pbip
├── ARPI_Performance_Intelligence.SemanticModel/
│   ├── .platform
│   ├── definition.pbism
│   └── definition/
│       ├── database.tmdl
│       ├── model.tmdl
│       ├── expressions.tmdl
│       ├── relationships.tmdl
│       └── tables/*.tmdl
└── ARPI_Performance_Intelligence.Report/
    ├── .platform
    └── definition.pbir
```

Power BI Desktop opens the `.pbip` directly and saves back into the same tree. Nothing is lost relative to a
`.pbix`; the parts are simply not zipped. The separation of model from report is the property that matters
most here — it lets a model change and a report change be different commits, reviewed by different criteria,
which a single binary makes impossible.

### Why TMDL

Tabular Model Definition Language is a line-oriented, indentation-structured text representation of a tabular
model, one file per table. The alternative textual representation, TMSL, is a single large JSON document.

The difference is visible in review. A TMDL change to one measure touches a handful of lines in one file
named after the table that owns it. The equivalent TMSL change is a hunk in a multi-thousand-line JSON file
whose surrounding context is meaningless, and any reordering by the writer produces spurious diff noise.
TMDL also expresses DAX as DAX rather than as an escaped JSON string, so a measure is readable — and
greppable — in the form it was written.

That readability is also why `powerbi/measures/` holds **no** `.dax` files. The directory was reserved, before
this decision, for a text mirror of every measure — necessary if the model were a binary `.pbix`, and
redundant once it is TMDL. A mirror would be a second copy of all forty-nine measures, and a second copy is a
second answer waiting to happen: it is the one a reviewer reads while the TMDL is the one the engine executes,
and nothing executable can test that the two still agree. One definition, in the file the engine reads.
`powerbi/measures/README.md` records the reasoning at the path a reader would look for it.

### How PBIR is handled

The report is a **shell**: a `.platform` file and a `definition.pbir` that points at the sibling semantic
model. It contains no page, no visual, no bookmark, and no theme.

This is deliberate and is not a placeholder for something that should have been written. Report content is
Lifecycle Phase 6 work (`ARCHITECTURE.md` §27), delivered by `P2.2`, and it is *Desktop-generated*: pages and
visuals are authored by dragging fields onto a canvas, and the JSON that results is an output of that
process rather than a source anybody edits. Hand-writing PBIR page JSON would produce a file that Desktop
rewrites on first save, so the "source" would be whatever Desktop decided, discovered as a diff nobody
intended. The shell exists so the project opens, and so `P2.2` has somewhere to put its output.

### Import mode

Import, unchanged from `ARCHITECTURE.md` §19.1. The model reads twenty views from the PostgreSQL `reporting`
schema and nothing else. DirectQuery is excluded there on performance, deployment and portfolio-distribution
grounds, and nothing in this decision revisits that; it is recorded here only because a project-format
decision that left the storage mode implicit would be incomplete.

### Source control rationale

The whole model is UTF-8 text. A relationship's active state, a column's visibility, a measure's DAX, and a
partition's source expression are all readable in a diff, reviewable in a pull request, and searchable with
`grep`. Two consequences follow that a binary cannot offer: a static checker can assert structural claims
about the model without an engine (`scripts/check_powerbi_model.py`), and a reviewer with no Power BI licence
can assess the modelling work. Given that most reviewers of a portfolio repository have no Power BI licence,
that second property is close to the point of the exercise.

### Preview-feature risk

PBIP, TMDL and PBIR have shipped through Power BI Desktop's **preview features**, enabled per-installation
under Options. That has three practical consequences, stated plainly rather than assumed away:

1. **A reader must enable the preview features before the project will open.** The procedure is in
   `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md`. A reader who does not is met with a failure that looks like a
   corrupt project.
2. **The on-disk shape can change between Desktop releases.** A future release may reorder properties,
   rename a file, add a metadata field, or change the format version recorded in `definition.pbism`. The
   first save from such a release produces a diff the repository did not author.
3. **A format change is a finding, not an accident.** `P2.1-09` requires the reviewed diff after the first
   Desktop save. If the shape changed, the change is committed as its own commit with the Desktop version in
   the message, so the reason is recoverable later. If a future release moves the format incompatibly, the
   rollback path below applies.

The risk is accepted because the alternative — a binary — has a worse version-drift story, not a better one:
a `.pbix` also changes shape between releases, and the change is simply invisible.

### The Desktop validation requirement, and why CI cannot satisfy it

**Everything static analysis can prove about this model is structural.** A parser can confirm that a
relationship names columns that exist, that every measure lives on a measure table, that no bidirectional
filter is declared, that no two active paths connect the same pair of tables, and that no credential appears
in any file. It cannot confirm that the model loads, that a refresh succeeds, that a measure evaluates, that
a total is right, or that the engine agrees with the static path analysis.

Those require a tabular engine. Power BI Desktop is a Windows application; the environment this model was
authored in is Ubuntu 24.04 with no Windows layer, no Desktop, and no Analysis Services. Therefore:

- **Desktop open, refresh and save validation is a manual gate.** It is `P2.1-09` in
  `docs/requirements/PHASE_2_BACKLOG.md`, its result is recorded as structured data in
  `powerbi/validation/desktop_validation_results.json`, and its status at the time of this record is
  **PENDING**. It is never reported as passed on the strength of a static check.
- **CI must never attempt to launch Power BI Desktop.** A hosted Windows runner would change the operating
  system without changing the answer: it still has no Desktop installation and no licence. A job that
  claimed to validate a Power BI model without an engine would assert something it cannot observe, which is
  the specific failure this project's validation framework exists to prevent.
- **Static evidence goes stale.** A hash over the semantic-model definition files is recorded alongside each
  Desktop validation result. When the current hash differs from the recorded one, the evidence is reported
  as **STALE** and the manual gate must be run again. Evidence with no freshness rule is evidence about a
  file that no longer exists.

`scripts/validate_powerbi_model.ps1` exists for the Windows side of this and is not invoked by CI.

### Credential handling

- The Power Query layer declares exactly two parameters, **Server** and **Database**. Nothing else in the
  model identifies an environment.
- **No credential of any kind is stored in source** — no username, no password, no token, no connection
  string with embedded authentication, no cached credential file. Credentials are supplied at the Desktop
  prompt and held in the user's Power BI credential store.
- The connecting identity is **`arpi_reporter`**, which holds `SELECT` on `reporting` and no privilege on
  `raw`, `staging`, `warehouse`, or `audit`. That boundary is enforced by the database, not by the model's
  good behaviour, and is asserted independently by
  `tests/integration/test_reporter_role_end_to_end.py`.
- `scripts/check_secrets.py` runs over `powerbi/` in CI. The parameterisation is what makes this checkable at
  all: with a hardcoded connection there would be a legitimate-looking hostname in source, and the check
  could not distinguish it from a leak.

### The binary PBIX policy

**No `.pbix`, `.pbit`, or `.bim` file is committed during `P2.1`.** The test that formerly prohibited every
Power BI artefact is replaced — deliberately and visibly, per `G1-C23` — by one that permits `.pbip` and
`.tmdl` under the project directory and continues to prohibit the binary formats everywhere.

The reasons are cumulative. A binary cannot be reviewed. It cannot be authored in the environment that built
this model, so committing one would require a round trip through a machine outside the repository's control,
and the committed file would then be the authority rather than the text. It duplicates the model: a `.pbix`
alongside a PBIP is two sources of truth, and they diverge the first time someone saves the wrong one. And a
`.pbix` at this stage would contain a model that has never been refreshed — an empty binary, which looks like
a deliverable and is not.

`ARCHITECTURE.md` §26.2 names a PBIX as primary portfolio distribution "when practical". This record does not
retire that. It defers it: a distribution `.pbix` becomes practical once `P2.2` has pages and `P2.1-09` has
refreshed the model, and the decision to commit one then is a `P2.4` packaging decision with its own
acceptance criteria, not a storage decision.

### CI limitations, stated exactly

What CI does: parses the TMDL, asserts the declared table set, relationship register, measure inventory and
visibility rules from `powerbi/validation/model_expectations.json`, checks that no source query references a
non-`reporting` schema, checks that no credential appears, and checks that the `.dax` mirrors match the
model.

What CI does not do, and must not claim to: open the model, refresh it, evaluate a measure, verify a total,
detect an ambiguous path the way the engine would, render a visual, or validate anything about the report.
CI output says "static model checks passed", never "the model is valid".

## Alternatives considered

**Commit the `.pbix` binary.** The conventional choice, and the one `ARCHITECTURE.md` §26.2 and §24 both
anticipate. Rejected on four counts: it is unreviewable in a pull request; it cannot be authored in this
execution environment at all, so there would be nothing to commit; it makes static validation impossible, so
CI would have no purchase on the largest new artefact in the project; and a committed `.pbix` alongside a
text project is a second source of truth. The distribution use of a `.pbix` is deferred to `P2.4`, not
refused.

**Store the model as `.bim` / TMSL JSON.** Textual, diffable, and older and more stable than TMDL — a real
advantage given the preview-feature risk above. Rejected because a single monolithic JSON document defeats
most of the benefit: every change lands in one file, DAX is escaped into string literals so it is neither
readable nor greppable, and writer-side reordering produces diff noise unrelated to the change. TMSL also
describes only the model, so the report would need separate handling anyway, which is the coordination
problem PBIP already solves.

**Use the Tabular Editor project format (folder-per-object JSON).** Well established, diffable, and with
better tooling maturity than TMDL. Rejected because it introduces a dependency on a third-party tool for the
canonical representation of the project's central artefact, and because Power BI Desktop does not open it
natively — a reviewer would need Tabular Editor to see the model, which narrows the audience rather than
widening it. The comparison is close enough that it would be reasonable to revisit if TMDL's preview status
became a practical problem.

**DirectQuery instead of Import.** Would remove the refresh step, which is attractive given that refresh is
the part CI cannot perform. Rejected because it does not remove the need for Desktop — a DirectQuery model
still has to be opened, and every measure still has to be evaluated — so it trades `ARCHITECTURE.md` §19.1's
stated performance and distribution benefits for nothing. It would also make the report unusable without a
live database, which contradicts §26.2's requirement that the project stay reviewable.

**Hand-author PBIR report pages as JSON.** Tempting, because it would produce visible report progress in an
environment with no Desktop. Rejected because Desktop rewrites report JSON on save, so hand-authored pages
would be overwritten by a shape the repository never chose; because the schema is a preview surface with no
stability guarantee and no documentation intended for hand-authoring; and, decisively, because a page
authored blind cannot be seen. Committing a page nobody has rendered, in a project whose definition of done
is that no document claims anything that does not exist, would be the exact failure this repository is
written against.

## Consequences

### Positive

- The semantic model is reviewable. A measure change, a relationship's active state, and a column's
  visibility each appear as readable lines in a diff, in a file named after the object that owns it.
- Static validation is possible at all. `scripts/check_powerbi_model.py` and
  `tests/unit/test_powerbi_model_structure.py` assert structural claims on every push, against a binary's
  zero.
- A reviewer with no Power BI licence can assess the modelling work — which is most reviewers of a portfolio
  repository.
- The model and the report are separable, so `P2.1` and `P2.2` are genuinely different commits with
  different review criteria.
- The credential boundary is checkable. Parameterised Server and Database mean `check_secrets.py` has an
  unambiguous rule to enforce.
- No binary enters the repository, so `git` history stays small and every historical model state is
  readable.

### Negative

- **The model has never been opened by Power BI Desktop.** Every claim made about it is structural. It may
  fail to load, fail to refresh, or contain a measure that errors, and no check in this repository would
  currently know. This is the single largest caveat on delivery increment `P2.1` and it is not softened
  anywhere.
- **The critical path runs through a machine this project does not have.** `P2.1-09` requires a Windows
  installation with Power BI Desktop and network access to a populated PostgreSQL instance. Until someone
  performs it, `P2.2` cannot start and Lifecycle Phase 5 cannot be marked complete.
- **PBIP, TMDL and PBIR are preview surfaces.** A reader must enable preview features to open the project,
  and a future Desktop release may change the on-disk shape. The mitigation is a reviewed diff after the
  first save, which detects the change rather than preventing it.
- **`ARCHITECTURE.md` §26.2 and §24 now read against this record.** §26.2 names a PBIX as primary
  distribution and §24 lists `powerbi/ARPI_Performance_Intelligence.pbix` as planned at a path this decision
  does not use. Neither is edited by this record; §26.2's PBIX is deferred to `P2.4`, and §24's repository
  tree is stale in the same way it was already stale about `model_documentation/`.
- **A `.dax` mirror is a duplicate.** It is held true by a test rather than by construction, which is a
  weaker guarantee than having one representation.

### The three specification corrections this decision carries

Two contradictions in the approved specification, and one structural gap, were found while building the
model. All three are recorded here because each was resolved by a modelling decision rather than by a code
fix, and a reader comparing `powerbi/model_documentation/` against the TMDL would otherwise find an
unexplained difference.

**1. `vw_dealership` → `vw_employee` is created INACTIVE, not Active.**
`powerbi/model_documentation/02-relationship-plan.md` §3.2 marks this dimension-to-dimension relationship
**Active**. It cannot be. With the six employee role-playing relationships also active, an active
`vw_dealership` → `vw_employee` relationship creates **two active filter paths** from `vw_dealership` to
`vw_vehicle_sales`, and two from `vw_dealership` to `vw_appointments` — one direct, one through
`vw_employee`. The tabular engine rejects that as an ambiguous path and refuses to load the model. Nothing
analytical is lost: `reporting.vw_employee` already carries `dealership_code` and `store_short_name`
denormalised onto every row, so filtering or grouping employees by store needs no relationship at all. The
relationship is created **inactive**, so the intent stays visible and `USERELATIONSHIP` remains available for
a deliberate dimension-to-dimension filter. A static check now asserts that no two active paths connect the
same pair of tables, so the ambiguity cannot be reintroduced unnoticed. `ARCHITECTURE.md` §27 Lifecycle
Phase 5 lists "no unresolved ambiguous relationships exist" as an exit criterion; this is that criterion
being met rather than assumed.

**2. `vw_inventory_snapshots.age_bucket` gets its sort order from a hidden calculated column.**
`powerbi/model_documentation/01-table-inventory.md` §5 requires `age_bucket` to be sorted by
`age_bucket_sort_order`. That column does not exist on `reporting.vw_inventory_snapshots`; it exists only on
`reporting.vw_inventory_aging`, which §3 of the same document deliberately excludes from the model. Without a
sort column, the age buckets render alphabetically — `0-15`, `16-30`, `31-45`, `46-60`, `61-90`, `over 90`
sorts to put `over 90` in the middle — which makes every aging visual read wrong. A **hidden DAX calculated
column** on the imported table supplies the ordinal, and `age_bucket` is sorted by it. **The reporting SQL is
unchanged**: the reporting layer is governed, reconciled on every run, and has its own consumers, so a Power
BI presentation concern is not a reason to alter it. This is a documented departure from `ARCHITECTURE.md`
§19.2's "avoid calculated columns when Power Query or SQL is more appropriate" — SQL *would* be more
appropriate, and the cost of changing it is higher than the cost of one hidden column. It is the only
calculated column in the model.

**3. The Executive measure group is a curation register, not a measure table.**
`powerbi/model_documentation/03-measure-groups.md` §7 states that the Executive Overview reuses measures from
other groups and defines none of its own, while `ARCHITECTURE.md` §19.3 lists "Executive measures" among the
eleven measure groups. Creating an Executive measure table would therefore require either duplicating eight
measures under new names — vanity measures, which the model prohibits because two names for one number is how
a report starts disagreeing with itself — or shipping an empty table, which a reviewer reads as unfinished
work. Neither is acceptable. Six measure tables own the measures (Sales, Gross, Inventory, Lead Funnel,
Marketing, Data Quality), and the Executive group is implemented as a governed **curation register**: an
`ARPI_ExecutiveCard` annotation on **exactly the eight measures** §7 names, plus documentation. A static check
asserts the annotation count is eight; nine is a defect, because the point of a curated selection is that it
is curated. `P2.2-02` builds the Executive Overview from the register rather than from a page author's
memory.

The four Deferred measure groups — F&I, Customer Retention, Service to Sales, Target Attainment — are created
as **nothing at all**: no table, no empty table, no placeholder measure, no hidden stub. They exist only in
`03-measure-groups.md` §9, which names what each is blocked by and what would unlock it. A static check
asserts no table for them exists, so a future edit cannot add an empty one.

## Rollback and conversion path

**Back to a `.pbix`.** Open the `.pbip` in Power BI Desktop with the preview features enabled, refresh, and
*Save As* a `.pbix`. Desktop reads the PBIP as its native project format, so the conversion is a save, not a
migration, and nothing about the model is lost. This is the path `P2.4` uses if a distribution `.pbix`
becomes worthwhile, and it is also the rollback if a future Desktop release breaks PBIP compatibility: the
model survives as a binary, and this record is superseded by one that explains why.

**Forward to Fabric or the Power BI Service.** A PBIP is closer to a Service deployment than a `.pbix` is,
not further. The `.SemanticModel` folder is the same shape a Fabric Git-integrated workspace expects, so the
route is: publish the semantic model to a workspace, connect that workspace to this repository through Fabric
Git integration, and let the workspace track the folder. Two things must be settled first, and neither is in
scope for `P2.1`: the database must be reachable from the Service, which means the Supabase deployment
`ARCHITECTURE.md` §26.1 defers, or an on-premises data gateway; and the `arpi_reporter` credential must be
registered against the workspace data source. `ARCHITECTURE.md` §26.2 keeps Service publication optional and
requires the project to remain reviewable without it, so this is a path rather than a plan. **Changing the
deployment model requires its own ADR** (§35.2).

## Relationship to other records

- **ADR-0002** established the technology baseline, including local PostgreSQL with managed hosting
  deferred, which is why the Desktop refresh in `P2.1-09` targets a local instance.
- **ADR-0004** fixes the validation-category vocabulary. The Power BI static checks report through the
  existing framework and do not introduce a new category; `reconciliation` is deliberately not a category
  there, and the SQL-to-Power-BI comparison follows the same rule.
- `ARCHITECTURE.md` §19.1 fixes Import mode; §19.2 fixes the semantic-model design rules this model
  implements; §19.3 lists the eleven measure groups that consequence 3 above reconciles against; §25.4 lists
  the Power BI validation surface that `P2.1-09` walks; §26.2 names the PBIX distribution this record defers;
  §35.2 lists changing the Power BI connection mode and the deployment model among the decisions requiring an
  ADR.
- `docs/requirements/GATE_1_READINESS.md` `G1-C23` is the condition whose prohibition test `P2.1-08`
  replaces.
- `docs/requirements/PHASE_2_BACKLOG.md` `P2.1` carries the acceptance criteria that implement this record,
  and §1.3 states the Desktop validation gate in delivery terms.
- `powerbi/model_documentation/` is the specification this model was built from, and the place the three
  corrections above are also recorded.
