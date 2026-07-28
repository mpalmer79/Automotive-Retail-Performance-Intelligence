# Summary

<!-- What changed and why, in two or three sentences. -->

## Type of change

- [ ] Documentation
- [ ] Data model / SQL
- [ ] Python (generator, validation, loader, CLI)
- [ ] Tests
- [ ] Tooling / CI
- [ ] Power BI / Excel
- [ ] Other:

## Scope

- Phase touched:
- Layer touched: <!-- source / raw / staging / warehouse / reporting / docs / tooling -->

## Data and privacy

- [ ] No real customer, employee, or dealership data.
- [ ] No PII of any kind (no names, addresses, phone numbers, emails, VINs of real vehicles).
- [ ] No secrets, credentials, connection strings, or `.env` files.
- [ ] Any sample data added is 100% synthetic and reproducible from the configured seed.

## Quality

- [ ] `ruff format --check .`
- [ ] `ruff check .`
- [ ] `mypy src tests`
- [ ] `pytest -m "not integration"`
- [ ] Data-quality tests pass, or N/A
- [ ] Integration tests run against local PostgreSQL, or N/A
- [ ] Coverage is not reduced
- [ ] `python scripts/check_naming.py` and `python scripts/check_docs_links.py` pass
- [ ] Documentation updated (data dictionary, KPI catalog, architecture, README as applicable)

## Architecture impact

- [ ] This change needs an ADR — link it here:
- [ ] This change does not need an ADR.

<!-- ARCHITECTURE.md §35.2 lists the decisions that require one. -->

## Verification

<!-- The exact commands or steps a reviewer should run to confirm this works. -->

1.
2.
