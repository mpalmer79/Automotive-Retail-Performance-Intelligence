"""Determinism, privacy and manifest guarantees across every generated dataset."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import (
    ARPI_VERSION,
    MANIFEST_FILENAME,
    MANIFEST_TIMESTAMP_POLICY,
    PROHIBITED_PII_FIELD_NAMES,
    PROJECT_NAME,
    SHORT_NAME,
    SUPPORTED_PROFILES,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.writer import dataframe_to_csv_bytes, write_outputs
from arpi.pipeline import generate_all_datasets
from arpi.utilities.hashing import content_digest
from arpi.validation.datasets import validate_foundation_datasets

pytestmark = pytest.mark.data_quality

REPO_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


def _datasets(config: ArpiConfig) -> tuple[GeneratedDataset, GeneratedDataset]:
    return generate_date_dataset(config), generate_dealership_dataset(config)


@pytest.mark.parametrize("profile", SUPPORTED_PROFILES)
def test_every_profile_passes_every_check(profile: str) -> None:
    config = load_config(profile=profile, config_dir=REPO_CONFIG_DIR)
    date_dataset, dealership_dataset = _datasets(config)
    report = validate_foundation_datasets(date_dataset, dealership_dataset, config)
    assert not report.has_critical_failure, report.summary_table()
    assert not report.warnings, report.summary_table()
    assert len(report) == 13


@pytest.mark.parametrize("profile", SUPPORTED_PROFILES)
def test_no_generated_dataset_declares_personal_data(profile: str) -> None:
    config = load_config(profile=profile, config_dir=REPO_CONFIG_DIR)
    for dataset in _datasets(config):
        columns = {column.lower() for column in dataset.frame.columns}
        offending = columns & PROHIBITED_PII_FIELD_NAMES
        assert not offending, f"{dataset.entity_name} declares {sorted(offending)}"


@pytest.mark.parametrize("profile", SUPPORTED_PROFILES)
def test_regeneration_is_byte_identical(profile: str, tmp_path: Path) -> None:
    digests: list[tuple[str, ...]] = []
    payloads: list[tuple[bytes, ...]] = []
    for run in ("first", "second"):
        config = load_config(profile=profile, config_dir=REPO_CONFIG_DIR)
        target = tmp_path / profile / run
        target.mkdir(parents=True)
        written, manifest = write_outputs(config, _datasets(config), target)
        digests.append(tuple(entity.content_digest for entity in written))
        payloads.append((*(entity.path.read_bytes() for entity in written), manifest.read_bytes()))
    assert digests[0] == digests[1]
    assert payloads[0] == payloads[1]


def test_a_different_seed_leaves_the_calendar_unchanged() -> None:
    # The calendar dimension is a pure function of the reporting window: it is
    # deliberately not stochastic, so the seed must not perturb it.
    baseline = load_config(profile="test", config_dir=REPO_CONFIG_DIR)
    reseeded = load_config(
        profile="test", config_dir=REPO_CONFIG_DIR, env={"ARPI_RANDOM_SEED": "1"}
    )
    assert baseline.random_seed != reseeded.random_seed
    assert dataframe_to_csv_bytes(generate_date_dataset(baseline).frame) == (
        dataframe_to_csv_bytes(generate_date_dataset(reseeded).frame)
    )
    assert dataframe_to_csv_bytes(generate_dealership_dataset(baseline).frame) == (
        dataframe_to_csv_bytes(generate_dealership_dataset(reseeded).frame)
    )


def test_manifest_matches_the_written_bytes(tmp_path: Path) -> None:
    config = load_config(profile="development", config_dir=REPO_CONFIG_DIR)
    written, manifest_path = write_outputs(config, _datasets(config), tmp_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["project"] == PROJECT_NAME
    assert manifest["short_name"] == SHORT_NAME
    assert manifest["arpi_version"] == ARPI_VERSION
    assert manifest["profile"] == "development"
    assert manifest["random_seed"] == config.random_seed
    assert manifest["reporting_start_date"] == config.reporting.start_date.isoformat()
    assert manifest["reporting_end_date"] == config.reporting.end_date.isoformat()
    assert manifest["timestamp_policy"] == MANIFEST_TIMESTAMP_POLICY
    assert manifest["generator_module"] == "arpi.generation"
    assert "SYNTHETIC DATA" in manifest["synthetic_data_notice"]

    entries = {entry["entity"]: entry for entry in manifest["generated_entities"]}
    assert set(entries) == {"dim_date", "dim_dealership"}
    for entity in written:
        entry = entries[entity.entity]
        assert entry["row_count"] == entity.row_count
        assert entry["column_count"] == entity.column_count
        assert entry["content_digest"] == content_digest(entity.path.read_bytes())


def test_manifest_carries_no_wall_clock_timestamp(tmp_path: Path) -> None:
    config = load_config(profile="test", config_dir=REPO_CONFIG_DIR)
    _, manifest_path = write_outputs(config, _datasets(config), tmp_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert not {key for key in manifest if "time" in key.lower()} - {"timestamp_policy"}
    assert "generated_at" not in manifest


def test_sample_row_cap_is_honoured(tmp_path: Path) -> None:
    config = load_config(profile="development", config_dir=REPO_CONFIG_DIR)
    written, _ = write_outputs(
        config, _datasets(config), tmp_path, row_limit=config.generation.sample_row_limit
    )
    by_entity = {entity.entity: entity for entity in written}
    assert by_entity["dim_date"].row_count <= config.generation.sample_row_limit
    assert by_entity["dim_dealership"].row_count == 3


def test_committed_sample_files_are_current() -> None:
    sample_dir = Path(__file__).resolve().parents[2] / "data" / "sample"
    config = load_config(profile="development", config_dir=REPO_CONFIG_DIR)
    manifest = json.loads((sample_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    assert manifest["profile"] == "development"
    assert manifest["random_seed"] == config.random_seed

    # Regenerate in memory and compare against the committed bytes. Comparing the
    # committed CSV only against the committed manifest would merely prove the two
    # committed artifacts agree with each other: a generator change that made both stale
    # in step would still pass. The generator itself has to be the reference.
    # The committed sample covers everything the pipeline generates, not just the two
    # foundation dimensions the writer tests above use, so the reference has to be the
    # pipeline's own entity set.
    expected_frames = {dataset.entity_name: dataset for dataset in generate_all_datasets(config)}
    row_limit = config.generation.sample_row_limit

    entries = {entry["entity"]: entry for entry in manifest["generated_entities"]}
    assert set(entries) == set(expected_frames), (
        "the committed manifest does not describe the entities the generator produces"
    )

    for entity, entry in entries.items():
        payload = (sample_dir / f"{entity}.csv").read_bytes()
        assert entry["content_digest"] == content_digest(payload), (
            f"data/sample/{entity}.csv does not match the digest recorded beside it; "
            f"rerun `arpi generate --profile development`"
        )

        frame = expected_frames[entity].frame.head(row_limit)
        regenerated = dataframe_to_csv_bytes(frame)
        assert payload == regenerated, (
            f"data/sample/{entity}.csv is stale: the generator now produces different "
            f"bytes. Rerun `arpi generate --profile development` and commit the result."
        )
