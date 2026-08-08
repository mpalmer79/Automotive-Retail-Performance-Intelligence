# CLAUDE.md — working agreements for automated sessions

Instructions for Claude Code and any other automated session working in this repository. It is a short
document on purpose: it covers the things a session gets wrong repeatedly, not the things it can read.

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for the engineering standards,
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the system, and
[`docs/index.md`](docs/index.md) for everything else.

---

## 1. Gate 2 and real-engine validation — the reporting rule

**The state of the world.** The Power BI semantic model has never been evaluated by a Microsoft
semantic-model engine. Power BI Desktop validation is **PENDING**, Microsoft Fabric validation is
**PENDING**, and Gate 2 real-engine validation is **PENDING** — the gate is CLOSED. That is true, it is
recorded in evidence files rather than in prose, and it is not going to change until a person runs one of
the two paths in
[ADR-0008](docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) on hardware this project
does not have.

**The rule.** Gate 2 is an **external manual validation dependency**, not a work item and not a blocker for
ordinary work. It does **not** block `DASH.9` through `DASH.13` unless the increment directly requires a
result only a real Microsoft engine can produce. The full decision, including what "directly requires" means,
is [ADR-0014](docs/architecture-decisions/ADR-0014-gate-2-external-manual-validation-dependency.md).

**Mention it in five situations and otherwise do not:**

1. the increment changes TMDL, DAX, semantic-model relationships, or a Power BI artifact;
2. a test detects a semantic-model-related regression;
3. the final increment or the release audit needs the status;
4. someone asks;
5. the document's subject *is* validation status.

**Otherwise, one line at the end of the report is the whole disclosure:**

> Power BI real-engine validation remains externally pending; this increment does not change that state.

Do not restate the pending status in design discussions, implementation logs, commit messages or progress
updates for increments that did not approach the gate. Do not open a summary with it. Do not pause work to
re-raise it.

**What this rule does not permit.** It is a rule about repetition, not about candour. Never write that the
model is validated, never imply an engine has run, never soften what the evidence files say, and never omit
the status where a reader would be misled without it. When it is genuinely unclear whether an increment
touches the gate, mention it — one extra sentence costs less than a missing one.

---

## 2. The simulated validation layer

There is a simulated semantic-model validation layer, and it is a development proxy:

```bash
python scripts/simulate_semantic_model.py --check   # the simulation, as CI runs it
python scripts/check_simulation_labels.py           # fails if anything calls it a real validation
```

It is documented in
[`powerbi/model_documentation/10-simulated-semantic-model-validation.md`](powerbi/model_documentation/10-simulated-semantic-model-validation.md).

**Label it `SIMULATED SEMANTIC-MODEL VALIDATION`.** Never *Power BI validated*, *Desktop validated*,
*Fabric validated*, or *Gate 2 passed*. A green run is sufficient to keep engineering; it closes nothing. If
a real engine ever disagrees with the simulation, the engine is right.

A measure added or changed without a matching entry in
[`scripts/simulated_sql_truth.py`](scripts/simulated_sql_truth.py) fails the run. That is intended: the
second implementation is the point.

---

## 3. Honesty rules that predate this document

These are not negotiable and are enforced by scripts in [`scripts/`](scripts/README.md):

- **Status words are literal.** Nothing is `Implemented` until code, SQL, loading, validation, reporting,
  documentation and tests exist together. `Planned`, `In progress` and `Deferred` mean what they say.
- **Claims are derived from evidence, never asserted.** `scripts/check_project_capabilities.py` compares
  declared and documented status against what the repository actually contains, in both directions.
- **Counts come from the repository.** Regenerate the marked capability blocks
  (`python scripts/generate_project_capabilities.py`) rather than editing a number by hand.
- **No credential, ever**, in any file, including examples. `scripts/check_secrets.py` is a safety net, not
  permission.
- **The data is synthetic and says so**, apart from the single sanitized reference lane governed by
  [ADR-0011](docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md).

---

## 4. Before pushing

Run what continuous integration runs, or the parts your change touches:

```bash
uv run pytest -m "not integration" -q      # the unit and contract suites
uv run ruff check . && uv run ruff format --check .
python scripts/check_naming.py
python scripts/check_docs_links.py
python scripts/check_secrets.py
python scripts/check_powerbi_model.py
python scripts/simulate_semantic_model.py --check
python scripts/check_simulation_labels.py
python scripts/check_project_capabilities.py
python scripts/generate_project_capabilities.py --check
```

Integration tests need a populated PostgreSQL database and are marked `integration`; they are not expected to
run in a sandbox without one.
