# Repository control scripts

Small, standard-library-only checks that guard repository hygiene. They are
deliberately **not** part of the `arpi` package: CI runs them without installing
anything, which keeps the `repository-checks` job to a few seconds and means a
broken package cannot hide a broken repository.

Every script here:

- is Python 3.11+, fully type-hinted, and imports only the standard library;
- exits `0` when clean and `1` on any violation;
- supports `--quiet` (findings and the summary line only);
- supports `--paths PATH...` to narrow the scan;
- resolves the repository root from its own location, so it can be run from any
  working directory.

---

## The scripts

### `check_naming.py`

Fails the build when a retired project identifier is used as a **current**
identity.

ADR-0001 retired the project's earlier working title and fixed the current
identity: the display name *Automotive Retail Performance Intelligence*, the
short identifier *ARPI*, the Python package `arpi`, the `ARPI_` configuration
prefix, and the database roles `arpi_admin`, `arpi_loader`, and `arpi_reporter`.
A renaming that is only half-applied is worse than no renaming at all, so this
check makes the decision enforceable rather than aspirational.

- **Fails on:** the retired display name, the retired repository slug, the
  retired compact name, the retired role names, the retired package path, and a
  general catch-all for the retired identifier. All case-insensitive.
- **Fails on:** the retired package directory existing on disk.
- **Warns on (does not fail):** `PostgreSQL` misspelled in Markdown.
- **Allowlist:** exactly three paths, each with a comment explaining why —
  ADR-0001 (the decision of record must quote what it retired), `docs/research.md`
  (preserved historical evidence), and the script itself (it contains every
  forbidden string as a pattern literal).
- **Extra flag:** `--self-test` runs internal assertions on the rule set. Use it
  after editing a pattern.

```bash
python scripts/check_naming.py
python scripts/check_naming.py --self-test
python scripts/check_naming.py --paths docs src --quiet
```

### `check_docs_links.py`

Validates **relative** Markdown links, image paths, and heading anchors.
Documentation is a deliverable in this project, so a dead cross-reference is a
build failure.

- Parses `[text](target)`, `![alt](target)`, and `[label]: target` definitions.
- Skips fenced code blocks and inline code spans, which contain examples.
- A target that resolves to a directory is accepted when the directory exists.
- `file.md#anchor` must resolve **both** parts: the file must exist, and the
  anchor must match a GitHub-slugified heading in that file (lowercase, strip
  punctuation, spaces to hyphens, duplicate headings get `-1`, `-2`, …).
  HTML `id=` / `name=` attributes count as anchors too.
- `http://`, `https://`, `mailto:`, and protocol-relative links are **not**
  fetched — CI has no reason to be online — but their count is reported.

```bash
python scripts/check_docs_links.py
python scripts/check_docs_links.py --paths docs README.md
```

### `check_secrets.py`

A **safety net, not a real secret scanner.** It exists to catch the handful of
mistakes that actually happen: committing a `.env`, pasting a live connection
string into a document, leaving a private key in the tree.

- Fails if any `.env*` file other than `.env.example` is tracked by git.
- Fails on high-signal patterns: connection URIs with an inline password, AWS
  access key IDs, private key blocks, GitHub personal access tokens, `sk-`
  prefixed API keys, JSON Web Tokens, and quoted credential assignments.
- Obvious placeholders are allowlisted (`changeme`, `<password>`,
  `***REDACTED***`, `example`, `placeholder`, and a short list of whole-value
  words such as `secret` and `postgres` that documentation uses when showing a
  URI shape).
- Suspected values are **redacted** in the report, so a finding never leaks the
  credential into a public CI log.

It is not entropy-based, it does not scan git history, and it does not
understand context. It complements, and does not replace, `.gitignore`, the
`detect-private-key` pre-commit hook, and GitHub secret scanning. See
[SECURITY.md](../SECURITY.md) for the full policy, including what to do when a
credential is committed by accident.

```bash
python scripts/check_secrets.py
python scripts/check_secrets.py --paths config docs
```

---

## When CI runs them

All three run in the `repository-checks` job of
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), on every push to any
branch, on every pull request, and on manual dispatch. That job installs
nothing beyond a Python interpreter.

`check_naming.py` and `check_secrets.py` also run as `local` hooks in
[`.pre-commit-config.yaml`](../.pre-commit-config.yaml) on every commit;
`check_docs_links.py` runs there when a Markdown file changes. Pre-commit is
optional — CI is authoritative.

## Running them locally

From anywhere in the repository:

```bash
python scripts/check_naming.py
python scripts/check_docs_links.py
python scripts/check_secrets.py
```

Or all three, stopping at the first failure:

```bash
python scripts/check_naming.py \
  && python scripts/check_docs_links.py \
  && python scripts/check_secrets.py
```

They are also linted and formatted like the rest of the project, because CI runs
`ruff format --check .` and `ruff check .` over the whole tree:

```bash
ruff format --check scripts/
ruff check scripts/
```

## Adding a new check

1. **Justify it.** A new check must prevent a real, recurring mistake. If a
   human would not reasonably make the error, do not automate against it.
2. **Create `scripts/check_<thing>.py`.** Standard library only, fully
   type-hinted, module docstring stating what it enforces and *why*.
3. **Match the interface.** `--quiet`, `--paths PATH...`, exit `0` clean and `1`
   on findings, a report line of the form `path:line: message`, and a summary
   count. Reuse the `REPO_ROOT`, `SKIPPED_DIRECTORY_NAMES`, and binary-detection
   patterns from an existing script rather than inventing new ones.
4. **Give it an allowlist with reasons.** Any exception must be a module
   constant with a comment saying why that path is exempt. An unexplained
   allowlist entry is how a check quietly stops working.
5. **Make it self-checking.** Either add a `--self-test` flag with internal
   assertions (as `check_naming.py` does) or make the rule so simple that a
   reader can verify it by eye.
6. **Wire it up.** Add a step to the `repository-checks` job in
   `.github/workflows/ci.yml`, and a `local` hook in `.pre-commit-config.yaml`
   if it is fast enough to run at commit time.
7. **Document it here** and, if it changes contributor behaviour, in
   [CONTRIBUTING.md](../CONTRIBUTING.md).

A check that fails for a legitimate file is worse than no check, because people
learn to ignore it. Prefer a narrow rule with a documented allowlist over a
broad rule with a suppression comment.
