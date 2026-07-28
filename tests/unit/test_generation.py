"""Generators, the CSV dialect and the manifest."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import (
    DIM_DATE_COLUMNS,
    DIM_DEALERSHIP_COLUMNS,
    MANIFEST_FILENAME,
    MANIFEST_TIMESTAMP_POLICY,
    SENTINEL_EXPIRATION_DATE,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.dealership import (
    STORE_DEFINITIONS,
    DealershipGenerator,
    dealership_attribute_hash,
)
from arpi.generation.writer import (
    build_manifest,
    dataframe_to_csv_bytes,
    format_value,
    write_dataset,
    write_manifest,
    write_outputs,
)


class _BrokenGenerator(BaseGenerator):
    entity_name = "broken"
    declared_columns = ("a", "b")
    namespace = "broken"

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        return pd.DataFrame({"a": [1]})


def test_generated_dataset_properties(date_dataset: GeneratedDataset) -> None:
    assert date_dataset.entity_name == "dim_date"
    assert date_dataset.column_count == 26
    assert date_dataset.row_count == 59
    assert date_dataset.actual_columns == DIM_DATE_COLUMNS
    assert date_dataset.schema_matches()


def test_a_generator_that_breaks_its_contract_fails(test_config: ArpiConfig) -> None:
    with pytest.raises(GenerationError, match="declares"):
        _BrokenGenerator().generate(test_config)


def test_dealership_generator_requires_three_stores(
    repo_config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = load_config(profile="test", config_dir=repo_config_dir)
    monkeypatch.setattr("arpi.generation.dealership.STORE_DEFINITIONS", STORE_DEFINITIONS[:2])
    with pytest.raises(GenerationError, match="store_count"):
        DealershipGenerator().generate(config)


def test_dealership_rows_follow_the_contract(dealership_dataset: GeneratedDataset) -> None:
    frame = dealership_dataset.frame
    assert tuple(frame.columns) == DIM_DEALERSHIP_COLUMNS
    assert list(frame["dealership_key"]) == [1, 2, 3]
    assert list(frame["dealership_id"]) == ["GSA-001", "GSA-002", "GSA-003"]
    assert (frame["effective_date"] == frame["opened_date"]).all()
    assert (frame["expiration_date"] == pd.Timestamp(SENTINEL_EXPIRATION_DATE)).all()
    assert frame["is_current"].all()
    assert (frame["source_system"] == SOURCE_SYSTEM).all()


def test_attribute_hash_is_stable_and_documented() -> None:
    from arpi.utilities.hashing import hash_attributes

    independent = STORE_DEFINITIONS[2]
    expected = hash_attributes(
        [
            "Granite Used Auto Center of Merrimack",
            "Granite Used Auto",
            "Independent Used",
            None,
            "Merrimack",
            "NH",
            "Southern New Hampshire",
            date(2017, 3, 13),
            True,
        ]
    )
    assert dealership_attribute_hash(independent) == expected
    assert len(expected) == 64


def test_attribute_hash_differs_between_stores() -> None:
    digests = {dealership_attribute_hash(store) for store in STORE_DEFINITIONS}
    assert len(digests) == len(STORE_DEFINITIONS)


def test_attribute_hash_in_the_frame_matches_the_helper(
    dealership_dataset: GeneratedDataset,
) -> None:
    by_id = {store.dealership_id: store for store in STORE_DEFINITIONS}
    for row in dealership_dataset.frame.to_dict(orient="records"):
        expected = dealership_attribute_hash(by_id[str(row["dealership_id"])])
        assert row["attribute_hash"] == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, ""),
        (pd.NA, ""),
        (pd.NaT, ""),
        (True, "true"),
        (False, "false"),
        (pd.Timestamp("2025-07-04"), "2025-07-04"),
        (date(2025, 7, 4), "2025-07-04"),
        ("Nashua", "Nashua"),
        (7, "7"),
    ],
)
def test_format_value(value: object, expected: str) -> None:
    assert format_value(value) == expected


def test_csv_dialect(dealership_dataset: GeneratedDataset) -> None:
    payload = dataframe_to_csv_bytes(dealership_dataset.frame)
    text = payload.decode("utf-8")
    assert "\r" not in text
    assert text.endswith("\n")
    lines = text.split("\n")[:-1]
    assert lines[0] == ",".join(DIM_DEALERSHIP_COLUMNS)
    assert len(lines) == 4
    assert ",true," in lines[1]
    assert "9999-12-31" in lines[1]


def test_csv_quotes_fields_containing_the_delimiter() -> None:
    frame = pd.DataFrame({"a": ["x,y"], "b": ['say "hi"']})
    text = dataframe_to_csv_bytes(frame).decode("utf-8")
    assert '"x,y"' in text
    assert '"say ""hi"""' in text


def test_csv_row_limit(date_dataset: GeneratedDataset) -> None:
    text = dataframe_to_csv_bytes(date_dataset.frame, row_limit=5).decode("utf-8")
    assert len(text.strip().split("\n")) == 6


def test_csv_is_byte_identical_across_calls(date_dataset: GeneratedDataset) -> None:
    assert dataframe_to_csv_bytes(date_dataset.frame) == dataframe_to_csv_bytes(date_dataset.frame)


def test_write_dataset_records_the_digest(
    dealership_dataset: GeneratedDataset, tmp_path: Path
) -> None:
    from arpi.utilities.hashing import content_digest

    written = write_dataset(dealership_dataset, tmp_path)
    assert written.path == tmp_path / "dim_dealership.csv"
    assert written.row_count == 3
    assert written.column_count == 16
    assert written.truncated is False
    assert written.content_digest == content_digest(written.path.read_bytes())


def test_write_dataset_marks_truncation(date_dataset: GeneratedDataset, tmp_path: Path) -> None:
    written = write_dataset(date_dataset, tmp_path, row_limit=10)
    assert written.row_count == 10
    assert written.truncated is True


def test_manifest_field_contract(
    test_config: ArpiConfig, date_dataset: GeneratedDataset, tmp_path: Path
) -> None:
    written = write_dataset(date_dataset, tmp_path)
    manifest = build_manifest(test_config, [written])
    assert set(manifest) == {
        "project",
        "short_name",
        "arpi_version",
        "profile",
        "random_seed",
        "reporting_start_date",
        "reporting_end_date",
        "generated_entities",
        "synthetic_data_notice",
        "generator_module",
        "timestamp_policy",
    }
    assert manifest["timestamp_policy"] == MANIFEST_TIMESTAMP_POLICY
    assert manifest["profile"] == "test"
    assert manifest["random_seed"] == 424242
    assert manifest["reporting_start_date"] == "2025-01-01"
    assert "SYNTHETIC" in manifest["synthetic_data_notice"]
    entry = manifest["generated_entities"][0]
    assert set(entry) == {"entity", "row_count", "column_count", "content_digest"}


def test_write_manifest_round_trips(
    test_config: ArpiConfig, date_dataset: GeneratedDataset, tmp_path: Path
) -> None:
    written = write_dataset(date_dataset, tmp_path)
    path = write_manifest(test_config, [written], tmp_path)
    assert path.name == MANIFEST_FILENAME
    assert json.loads(path.read_text(encoding="utf-8"))["short_name"] == "ARPI"
    assert b"\r" not in path.read_bytes()


def test_write_outputs_never_truncates_dealership_rows(
    test_config: ArpiConfig,
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    tmp_path: Path,
) -> None:
    written, manifest = write_outputs(
        test_config, (date_dataset, dealership_dataset), tmp_path, row_limit=5
    )
    by_entity = {entity.entity: entity for entity in written}
    assert by_entity["dim_date"].row_count == 5
    assert by_entity["dim_dealership"].row_count == 3
    assert manifest.exists()


def test_regeneration_is_byte_identical(repo_config_dir: Path, tmp_path: Path) -> None:
    from arpi.generation.calendar import generate_date_dataset
    from arpi.generation.dealership import generate_dealership_dataset

    digests = []
    for run in ("first", "second"):
        config = load_config(profile="development", config_dir=repo_config_dir)
        target = tmp_path / run
        target.mkdir()
        datasets = (generate_date_dataset(config), generate_dealership_dataset(config))
        written, manifest = write_outputs(config, datasets, target)
        digests.append(
            (
                tuple(entity.content_digest for entity in written),
                manifest.read_bytes(),
            )
        )
    assert digests[0] == digests[1]
    assert (tmp_path / "first" / "dim_date.csv").read_bytes() == (
        tmp_path / "second" / "dim_date.csv"
    ).read_bytes()
