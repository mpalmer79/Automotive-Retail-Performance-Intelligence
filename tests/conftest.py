"""Shared pytest fixtures.

Tests never require PostgreSQL. Anything that would need a live database lives in
``tests/integration`` behind the ``integration`` marker.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import ENV_PASSWORD_FALLBACK_VAR, ENV_PREFIX
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset

REPO_ROOT = Path(__file__).resolve().parents[1]
REPO_CONFIG_DIR = REPO_ROOT / "config"


@pytest.fixture(autouse=True)
def _hermetic_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Strip stray ``ARPI_*``/``PGPASSWORD`` variables so tests never inherit state."""
    import os

    for name in list(os.environ):
        if name.startswith(ENV_PREFIX) or name == ENV_PASSWORD_FALLBACK_VAR:
            monkeypatch.delenv(name, raising=False)


@pytest.fixture
def repo_config_dir() -> Path:
    """The repository's real ``config/`` directory."""
    return REPO_CONFIG_DIR


@pytest.fixture
def tmp_config_dir(tmp_path: Path) -> Path:
    """A writable copy of the repository's profile YAML files."""
    destination = tmp_path / "config"
    destination.mkdir()
    for source in sorted(REPO_CONFIG_DIR.glob("*.yaml")):
        shutil.copy2(source, destination / source.name)
    return destination


@pytest.fixture
def test_config(repo_config_dir: Path) -> ArpiConfig:
    """The ``test`` profile: a tiny two-month window that writes no sample outputs."""
    return load_config(profile="test", config_dir=repo_config_dir)


@pytest.fixture
def development_config(repo_config_dir: Path) -> ArpiConfig:
    """The ``development`` profile: the one that produces ``data/sample``."""
    return load_config(profile="development", config_dir=repo_config_dir)


@pytest.fixture
def date_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_date`` dataset for the ``test`` profile."""
    return generate_date_dataset(test_config)


@pytest.fixture
def dealership_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_dealership`` dataset for the ``test`` profile."""
    return generate_dealership_dataset(test_config)


@pytest.fixture
def working_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Run the test inside an empty directory, so writes cannot touch the repository."""
    monkeypatch.chdir(tmp_path)
    yield tmp_path
