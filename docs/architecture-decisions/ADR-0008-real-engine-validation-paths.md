# ADR-0008: Real-Engine Validation Paths

## Status

**Accepted**

## Date

2026-07-29

## Deciders

Michael Palmer

## Context

[ADR-0007](ADR-0007-power-bi-project-format.md) fixed the storage format of the semantic model and, in the
same record, fixed how the model would be proved. Its section *"The Desktop validation requirement, and why
CI cannot satisfy it"* named exactly one acceptable way to close the gate: a person opens the PBIP project in
**Power BI Desktop**, refreshes it, evaluates the measures, and records the result. Everything else in the
repository — the static checker, the expectations file, the SQL baseline, the freshness hash — was built as
machinery pointing at that single act.

That was the right instinct and the wrong design. The instinct was that a semantic model is only proved by an
engine, which remains true and is not being revisited here. The design error was to name a **product** where
the requirement was a **capability**, and the product it named runs on one operating system.

Power BI Desktop is a Windows application. The repository owner has **no Windows machine, no Windows virtual
machine, and no access to Power BI Desktop**. The consequence is not that the gate is open and waiting: it is
that, as ADR-0007 wrote it, **Lifecycle Phase 5 could not be completed by the person who owns the project**.
A governance gate whose only key is held by nobody is not a strict gate, it is a stuck one, and the
difference matters because a stuck gate produces exactly the pressure that governance exists to resist —
the temptation to redefine "validated" downward until the existing evidence qualifies.

This is a defect in ADR-0007, not a defect in the owner's setup. Nothing in `ARCHITECTURE.md` requires
Windows. §19.1 requires Import mode, §22.3 requires the `arpi_reporter` identity, §25.4 lists what must be
validated, and §27 Lifecycle Phase 5 states three exit criteria — core totals reconcile to SQL, filter
behaviour is correct, no unresolved ambiguous relationships exist. Not one of those mentions a desktop
application. ADR-0007 coupled a governance requirement to an operating system and a client install by
naming the first tool that came to hand, and the coupling was invisible until someone without that tool had
to close the gate.

**How the gap surfaced.** PR #8 merged the semantic model with its real-engine validation recorded as
**pending**. That was the honest thing to do — the alternative was either to hold a complete, reviewable,
statically-validated model out of the repository indefinitely, or to describe static parsing as validation,
and the second of those is the specific dishonesty this project is written against. But a merge with pending
evidence puts the gate on the critical path in public view, and the first question asked of it was *who
runs it, and on what*. There was no answer. The gate had been specified without checking that anyone could
reach it.

The model itself is unchanged by any of this. It is still built, still statically validated, and still
unproven.

## Decision

**There are two accepted real-engine validation paths, of equal standing. Either one, completed in full,
closes `P2.1` and satisfies the Lifecycle Phase 5 exit criteria. Neither is preferred over the other, and
neither is a fallback for the other.**

### Path A — Power BI Desktop

**Unchanged from ADR-0007.** A person on Windows opens
`powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.pbip` with the PBIP, TMDL and PBIR
preview features enabled, sets the Server and Database parameters, authenticates as `arpi_reporter`,
refreshes against a populated PostgreSQL `reporting` schema, evaluates the governed DAX, walks the
`ARCHITECTURE.md` §25.4 list, and records the result. The procedure is
`docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md`; the Windows-side script is
`scripts/validate_powerbi_model.ps1`; the evidence file is `powerbi/validation/desktop_validation_results.json`.

This path is not deprecated, narrowed, or discouraged. For anyone who has Windows it remains the shortest
route to the same evidence, and it exercises the on-disk PBIP format in a way Path B does not — the "save
from Desktop and review the diff" step of `P2.1-09` has no equivalent in the Service.

### Path B — Microsoft Fabric Service

The committed TMDL definition is deployed to a **Fabric workspace** through the Fabric semantic-model
definition APIs, refreshed against a **cloud PostgreSQL** `reporting` schema, and queried through the
**Power BI Execute Queries REST API**. In outline:

1. **Deploy.** The `.SemanticModel/definition/` tree — the same TMDL files the repository commits, with no
   transformation and no second copy — is posted to a Fabric workspace as a semantic-model definition. The
   Service accepts it or rejects it, and a rejection is the engine's verdict on the model source. The stored
   definition is then **read back and compared with what was sent**, so that "the engine received the
   committed TMDL" is a recorded fact rather than an assumption: documented service normalisations are
   normalised away, and any other difference fails the deploy.
2. **Bind the source.** The Server and Database parameters are set to the cloud PostgreSQL instance and a
   workspace connection is bound to the `arpi_reporter` credential. The credential lives in the Fabric
   connection, never in the repository.
3. **Refresh.** A full refresh is triggered and its outcome polled to completion. A partial refresh is a
   failure, recorded as one.
4. **Execute the governed DAX.** The queries in `powerbi/validation/validation_queries.dax` — the same file
   Path A runs by hand — are submitted through the Execute Queries REST API and their results compared
   against `powerbi/validation/sql_baseline.json`.
5. **Record.** The result is written to `powerbi/validation/fabric_validation_results.json` against
   `powerbi/validation/fabric_validation_results.schema.json`, carrying the same model-source hash the
   Desktop path records.

The reason this path exists at all is that every one of those five steps is an HTTPS request. It needs a
browser and a shell, not an operating system.

### The proof obligation, which is identical for both paths

**This is the heart of this record.** Two paths are only acceptable if they prove the same thing; otherwise
the project has one gate and one weaker thing that people will reach for when the gate is inconvenient. The
paths differ in tooling and in nothing else.

A validation run on **either** path completes `P2.1` only when it proves **all seven** of the following:

1. **A Microsoft semantic-model engine accepted the TMDL definition.** Not a parser, not a linter, not a
   schema validator — the engine that will evaluate the DAX loaded the model and did not reject it. This is
   also where the ambiguous-relationship question of ADR-0007's first specification correction is finally
   answered, because the static path argument is an argument and this is the verdict.
2. **All twenty imported tables refreshed.** Nineteen of twenty is a failure.
3. **Expected row counts are present**, compared against `powerbi/validation/sql_baseline.json` at
   **tolerance zero**. A single row difference is a defect, not noise.
4. **All forty-two relationships exist** in the loaded model, with the recorded active and inactive split.
5. **All forty-nine measures exist** in the loaded model.
6. **DAX results match the governed SQL baseline in every filter context, within tolerance.** Every context
   in `powerbi/validation/sql_baseline.json`, not a sample of them, and not the unfiltered total alone —
   a measure can have a correct grand total and be wrong under every filter that matters. The method is
   `powerbi/model_documentation/09-sql-to-dax-reconciliation.md`.
7. **The recorded evidence matches the current model-source hash.** Evidence about a model that has since
   been edited is evidence about a file that no longer exists, and is reported as **STALE** rather than as
   a weaker form of passed.

A run that proves six of the seven has not validated the model. There is no partial credit and no
provisional pass, on either path.

### Static parsing must never complete Lifecycle Phase 5 by itself

`scripts/check_powerbi_model.py` proves the model is **well-formed**. It does not prove the model is
**correct**, and no quantity of static assertions converts one into the other.

A model can satisfy every static assertion in this repository and still **fail to load** — the engine's
relationship-graph analysis is not the checker's; still **fail to refresh** — the checker never opens a
database connection; and still **return a wrong number under filter context** — the checker does not
evaluate DAX, because a partial DAX evaluator would produce confident wrong answers, which is worse than no
answer.

The distinction matters more here than it usually does, for a reason worth naming plainly. **The static
suite passes 9,452 assertions.** That number reads like thorough validation. It *is* thorough validation —
of the wrong thing. Nine thousand statements about the shape of some text are still nine thousand statements
about the shape of some text, and the gap between them and one refreshed measure returning the right number
is not a gap of degree. A reader who sees the assertion count and concludes the model is validated has been
misled by a true statement, which is the most durable kind of misleading there is. Every CI surface therefore
says *"static model checks passed"* and never *"the model is valid"*, and this record forbids any future
document from closing Lifecycle Phase 5 on the strength of the static suite alone.

### The credential boundary

Path B introduces authentication where Path A had a desktop prompt, so the boundary is restated rather than
assumed.

**No token, refresh token, client secret, database password, or credential-bearing connection string is ever
committed to this repository or printed by any script in it.** That includes debug output, error messages,
CI logs, and the recorded evidence files. Secrets are supplied through the environment at the moment of use
and held nowhere else; the Fabric workspace connection holds the database credential, and the repository
holds the *name* of the connection and nothing more. `scripts/check_secrets.py` runs over the whole
repository in CI, and the Server/Database parameterisation established by ADR-0007 is what makes the rule
checkable at all — with a hardcoded endpoint there would be a legitimate-looking hostname in source and no
way to tell it from a leak.

The `arpi_reporter` privilege boundary is unchanged: `SELECT` on `reporting`, nothing on `raw`, `staging`,
`warehouse` or `audit`, enforced by the database rather than by the client's good behaviour.

## Alternatives considered

**A Windows virtual machine, or a cloud Windows desktop.** The direct fix: rent Windows, install Desktop,
run the existing gate. Rejected on two counts. The first is cost — a recurring charge, indefinitely, for a
gate that runs a handful of times a year, on a portfolio project with no budget. The second is the one that
actually decides it: it re-couples the gate to one operating system. The next person to hit this wall hits
the same wall, and the record would say the answer is to go and buy Windows. That is not a governance
decision, it is a purchase order standing in for one.

**`pbi-tools`, Tabular Editor CLI, or a similar tool on Linux.** Both are excellent at what they do, and
what they do is manipulate model *metadata*. Tabular Editor CLI can validate a model definition and script
it; neither can evaluate DAX without connecting to a Microsoft tabular engine — Analysis Services, Power BI
Desktop, or the Service. They move the problem one step and leave it intact: the tool runs on Linux, and
then it needs an engine that does not. Where they are genuinely useful is inside Path B, as clients of the
Service, which is a tooling choice rather than an ADR-level one.

**Accept static validation as sufficient.** The cheapest option, available today, and the one the
circumstances quietly argue for: the model is built, 9,452 assertions pass, and the person who would run the
gate cannot. Rejected because it is the precise thing the section above forbids. A model that has never been
loaded may not load; a measure that has never been evaluated may not evaluate; a total that has never been
computed may be wrong. Redefining the gate to fit the available evidence is not a smaller version of
validation, it is the absence of validation with the vocabulary retained.

**An open-source Tabular or DAX reimplementation.** Attractive in principle: an engine that runs anywhere,
under test, in CI. Rejected because no such thing exists with the required fidelity. DAX's evaluation
semantics — filter context, context transition, `USERELATIONSHIP`, semi-additive behaviour under
`LASTNONBLANKVALUE`, blank propagation through `DIVIDE` — are exactly the parts this model depends on and
exactly the parts a reimplementation would approximate. And the failure mode is worse than having no test:
a reimplementation that **disagreed** with Power BI would produce an authoritative-looking difference report
in which nobody could tell which side was wrong, and a reimplementation that agreed would have proved
something about itself. The artefact under test is the model as Power BI runs it.

**Do the reconciliation only in SQL.** The SQL baseline already exists, generated from the database and
committed with its provenance; a second SQL implementation could be reconciled against the first entirely on
Linux. Rejected because it proves nothing about the DAX. The DAX is the artefact under test. Two SQL
computations agreeing tells you the reporting layer is self-consistent — which `P1.3`'s reconciliations
already establish — while the question this gate asks is whether *the semantic model* reproduces the
governed definitions. Answering an easier adjacent question and recording it under the harder question's
name is how a validation suite stops meaning anything.

## Consequences

### Positive

- **The gate is reachable by the person who owns the project.** Path B runs from a browser and a shell.
  It runs from a **Chromebook**, which was the point of this record and is stated in those terms because
  softening it would hide the constraint that produced the decision.
- **The requirement is now a capability, not a product.** "A Microsoft semantic-model engine accepted the
  definition and returned these numbers" is the thing that was always meant. A third path can be added later
  by showing it discharges the same seven obligations, without reopening what validation means.
- **The proof obligation got stronger, not weaker.** ADR-0007 described the Desktop gate in prose spread
  across a backlog item and a handoff document. This record enumerates seven conditions that both paths must
  meet, which is a more testable statement than the one it replaces.
- **The two paths cross-check each other.** If both are ever run against the same baseline, a disagreement
  between them is itself a finding — and one that neither path can produce alone.
- **The Desktop path is preserved intact.** A reviewer who has Windows loses nothing.

### Negative

- **CI now models two engines instead of one.** Each engine carries the five states of
  `powerbi/model_documentation/08-desktop-validation.md` — Static passed, PASSED, PENDING, STALE, FAILED,
  with MISSING distinguished from PENDING — so the reporting surface roughly doubles, and a reader has two
  status lines to read instead of one.
- **`main` requires at least one *current* PASSED result, and neither engine passing on its own may fail
  CI.** This is the rule the extra states exist to serve, and it is easy to get wrong in the obvious
  direction. **A project with a green Desktop result and no Fabric result is fully validated**, and a CI job
  that demanded both would have invented a stricter gate than this record sets — turning an alternative into
  an additional requirement, which is the failure mode of every "we support two ways" policy. The
  `main`-branch rule is also switched on **when the first passing result lands, and not before**: a gate
  enforced against a condition nobody can currently clear does not raise the standard, it teaches people to
  route around the check.
- **A cloud PostgreSQL database becomes a real dependency.** The Desktop path needed only a local instance
  on the operator's machine. The Fabric Service cannot reach `localhost`, so Path B requires the managed
  deployment that `ARCHITECTURE.md` §26.1 records as *deferred*, or a data gateway. That is a genuine new
  dependency with its own cost, its own credentials and its own failure modes, and Path B does not run
  without it.
- **The Fabric path introduces things that must exist outside this repository.** A **tenant**, a
  **workspace**, and a **connection**. None of them is source-controlled, none is reviewable in a pull
  request, and none can be recreated from the repository alone. A reader cloning this project does not
  thereby acquire the ability to run Path B, and the evidence file has to be trusted in a way a committed
  test result is not.
- **Two paths are two things to keep honest.** Two evidence files, two schemas, two freshness checks and two
  procedures, all of which can drift apart. The mitigation is that both are pinned to the same seven
  obligations and the same model-source hash; the cost is that the mitigation itself has to be maintained.
- **Neither path has been run.** Desktop is **pending**. Fabric is **pending**. This record makes the gate
  reachable; it does not close it, and nothing in it may be read as evidence that the model works.

## Rollback and conversion path

**Back to Desktop-only.** If the Fabric path proves unworkable — the tenant is lost, the licensing changes,
the definition APIs move, or the cloud database becomes untenable — the rollback is to retire Path B and
leave Path A standing. Concretely: mark this record `Superseded by ADR-NNNN`, restore the single-path
statement of ADR-0007, delete `powerbi/validation/fabric_validation_results.json` and its schema rather than
leaving a stale evidence file behind, and remove the Fabric branch from the CI status surface. Nothing in
the semantic model changes, because the TMDL Fabric consumes is the TMDL Desktop consumes. The project would
be back where this record found it — with a gate its owner cannot reach — and the superseding record would
have to say so.

**Adding a third path later.** Three things would have to be true. The path must run a **Microsoft
semantic-model engine** rather than an emulation of one; it must discharge **all seven** proof obligations
in the Decision above, recorded as structured data against a schema with `additionalProperties: false` and
carrying a model-source hash; and it must add no credential to source. A path meeting all three is an
amendment to this record. A path meeting two of three is a different, weaker gate wearing this gate's name,
and must be refused for the same reason static validation is refused here.

## Relationship to ADR-0007

**ADR-0007 stays `Accepted`.** It is not superseded. Its decisions about storage format — PBIP, TMDL, the
PBIR shell, Import mode, no committed `.pbix` during `P2.1`, the preview-feature risk, the credential
parameterisation, and the three specification corrections — are untouched by this record and remain the
Power BI storage decision of record.

**This record supersedes exactly one section of ADR-0007: *"The Desktop validation requirement, and why CI
cannot satisfy it"*.** That section is replaced by the Decision above wherever the two differ. Specifically:

- Where that section names Power BI Desktop as *the* real-engine path, read "either accepted path".
- Where it says the gate is inherently manual, read: **Path A is manual; Path B is scriptable but is still
  a gate**, because a script that reports its own success is not evidence unless its output is structured,
  hash-pinned and reviewable — which is why Path B records against a schema rather than printing a verdict.

Three claims in that section survive intact and are re-stated rather than replaced, because they are the
part of ADR-0007 that was right:

- **CI must never attempt to launch Power BI Desktop.** A hosted Windows runner changes the operating system
  without changing the answer.
- **Static evidence goes stale**, and the model-source hash is how that is detected.
- **No static check ever promotes to a passed real-engine result.**

## Relationship to other records

- **ADR-0002** deferred managed PostgreSQL hosting to the point where a Power BI model needed a shared
  endpoint. Path B is that point. The deferral is not being reversed by this record — it is being *invoked*,
  and the deployment itself is backlog work rather than an architecture change.
- **ADR-0004** fixes the validation-category vocabulary. Real-engine validation reports through the existing
  framework and introduces no new category; `reconciliation` is deliberately not a category there, and the
  SQL-to-DAX comparison follows the same rule on both paths.
- **ADR-0007** is extended, and one of its sections superseded, as set out above. Its "Forward to Fabric or
  the Power BI Service" rollback note anticipated this direction and correctly said that changing the
  deployment model requires its own ADR. This is that ADR.
- `ARCHITECTURE.md` §19 records that the semantic model is validated against a real engine by either path;
  §25.4 lists the validation surface both paths walk; §27 Lifecycle Phase 5 states the exit criteria this
  record makes reachable; §26.1 records the deferred managed database Path B depends on; §35.2 lists
  changing the deployment model among the decisions requiring a record.
- `docs/requirements/PHASE_2_BACKLOG.md` `P2.1-09` carries the shared proof obligation in delivery terms, and
  the Fabric items that follow it carry the database, workspace, tooling, execution and CI-policy work.
- `powerbi/model_documentation/08-desktop-validation.md` is the real-engine validation document for both
  paths — its filename is historical — and
  `powerbi/model_documentation/09-sql-to-dax-reconciliation.md` is the reconciliation method, which is
  engine-independent by construction.
