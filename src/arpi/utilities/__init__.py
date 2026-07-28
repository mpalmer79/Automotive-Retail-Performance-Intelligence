"""Small, dependency-light helpers shared across the ARPI platform.

Nothing in this subpackage may import from :mod:`arpi.generation`,
:mod:`arpi.validation` or :mod:`arpi.ingestion`, which keeps the dependency graph
acyclic and these helpers trivially unit-testable.
"""
