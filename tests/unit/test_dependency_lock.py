"""The dependency lock agrees with the declaration it resolves.

`pyproject.toml` declares supported RANGES. `uv.lock` records the reviewed
RESOLUTION of those ranges and is what CI, a clean clone and the Railway
database-provisioning image install.

`uv lock --check` in CI is the authoritative freshness gate. These tests cover what
that command does not: that the lock is committed at all, that it covers the extras
the project actually uses, that every declared dependency appears in it, and that
each resolved version satisfies the bound declared for it. They need no network and
no `uv` binary, so they run wherever the suite runs.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PYPROJECT = REPO_ROOT / "pyproject.toml"
LOCK = REPO_ROOT / "uv.lock"

#: Distribution names normalise to lowercase with dashes; the lock uses that form.
_NORMALISE = re.compile(r"[-_.]+")


def _canonical(name: str) -> str:
    return _NORMALISE.sub("-", name).lower()


def _requirement_name(requirement: str) -> str:
    """The distribution name from a PEP 508 requirement string."""
    return _canonical(re.split(r"[<>=!~\[; ]", requirement, maxsplit=1)[0])


def _declared_lower_bound(requirement: str) -> str | None:
    match = re.search(r">=\s*([0-9][^,;\s\]]*)", requirement)
    return match.group(1) if match else None


def _version_tuple(version: str) -> tuple[int, ...]:
    """Numeric release segment only, which is all a `>=` floor comparison needs."""
    return tuple(int(part) for part in re.findall(r"\d+", version)[:4])


@pytest.fixture(scope="module")
def pyproject() -> dict[str, object]:
    return tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def locked_versions() -> dict[str, str]:
    text = LOCK.read_text(encoding="utf-8")
    return {
        _canonical(name): version
        for name, version in re.findall(
            r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', text
        )
    }


def _declared_requirements(pyproject: dict[str, object]) -> list[str]:
    project = pyproject["project"]
    assert isinstance(project, dict)
    requirements = list(project.get("dependencies", []))
    for extra in project.get("optional-dependencies", {}).values():
        requirements.extend(extra)
    return requirements


def test_the_lock_is_committed() -> None:
    """A lock that is not in the repository cannot be installed by CI or Railway."""
    assert LOCK.is_file(), (
        "uv.lock is missing. It is the reviewed resolution of pyproject.toml and "
        "must be committed alongside it."
    )


def test_the_lock_declares_the_projects_python_floor(pyproject: dict[str, object]) -> None:
    project = pyproject["project"]
    assert isinstance(project, dict)
    declared = str(project["requires-python"])
    text = LOCK.read_text(encoding="utf-8")
    assert f'requires-python = "{declared}"' in text, (
        f"uv.lock resolves for a different Python floor than pyproject declares "
        f"({declared}). Re-run `uv lock`."
    )


def test_every_declared_dependency_is_locked(
    pyproject: dict[str, object], locked_versions: dict[str, str]
) -> None:
    """Including the optional extras: `db` and `dev` are both installed by CI."""
    missing = sorted(
        _requirement_name(requirement)
        for requirement in _declared_requirements(pyproject)
        if _requirement_name(requirement) not in locked_versions
    )
    assert missing == [], (
        f"declared but absent from uv.lock: {missing}. Run `uv lock` and commit the result."
    )


def test_every_locked_version_satisfies_its_declared_lower_bound(
    pyproject: dict[str, object], locked_versions: dict[str, str]
) -> None:
    """A lock below its own declared floor would make the floor meaningless."""
    violations: list[str] = []
    for requirement in _declared_requirements(pyproject):
        bound = _declared_lower_bound(requirement)
        if bound is None:
            continue
        name = _requirement_name(requirement)
        locked = locked_versions.get(name)
        if locked is None:
            continue
        if _version_tuple(locked) < _version_tuple(bound):
            violations.append(f"{name}: locked {locked} < declared >={bound}")
    assert violations == [], violations


def test_the_database_extra_is_locked(locked_versions: dict[str, str]) -> None:
    """The Railway provisioning image installs `--extra db` from this lock."""
    assert "psycopg" in locked_versions


def test_the_development_extra_is_locked(locked_versions: dict[str, str]) -> None:
    """CI installs `--all-extras`; the tools have to be resolvable from the lock."""
    for tool in ("pytest", "ruff", "mypy"):
        assert tool in locked_versions, f"{tool} is not in uv.lock"


def test_no_declared_dependency_is_unbounded_below(pyproject: dict[str, object]) -> None:
    """An unbounded dependency makes the `floor` CI job resolve nonsense.

    Without a lower bound, `uv sync --resolution lowest-direct` selects the oldest
    release on the index. `types-PyYAML` resolved to 0.1.0, a 2016 placeholder that
    types nothing, and the floor job would have been testing a version the project
    cannot actually be used at.
    """
    unbounded = sorted(
        _requirement_name(requirement)
        for requirement in _declared_requirements(pyproject)
        if _declared_lower_bound(requirement) is None
    )
    assert unbounded == [], (
        f"no lower bound declared for: {unbounded}. A bound is a claim the floor job "
        "tests; absent one, it tests the oldest release ever published."
    )
