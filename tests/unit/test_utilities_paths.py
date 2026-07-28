"""Output-path containment."""

from __future__ import annotations

from pathlib import Path

import pytest

from arpi.config import ArpiConfig
from arpi.exceptions import ConfigurationError
from arpi.utilities.paths import project_root, resolve_output_dir


def test_relative_path_is_created_under_the_root(test_config: ArpiConfig, tmp_path: Path) -> None:
    resolved = resolve_output_dir("data/raw/test", test_config, root=tmp_path)
    assert resolved == tmp_path / "data" / "raw" / "test"
    assert resolved.is_dir()


def test_absolute_path_inside_the_root_is_accepted(test_config: ArpiConfig, tmp_path: Path) -> None:
    target = tmp_path / "inside"
    assert resolve_output_dir(target, test_config, root=tmp_path) == target


def test_parent_traversal_is_rejected(test_config: ArpiConfig, tmp_path: Path) -> None:
    with pytest.raises(ConfigurationError, match="path traversal"):
        resolve_output_dir("../escape", test_config, root=tmp_path)


def test_nested_parent_traversal_is_rejected(test_config: ArpiConfig, tmp_path: Path) -> None:
    with pytest.raises(ConfigurationError, match="path traversal"):
        resolve_output_dir("data/../../escape", test_config, root=tmp_path)


def test_absolute_path_outside_the_root_is_rejected(
    test_config: ArpiConfig, tmp_path: Path
) -> None:
    with pytest.raises(ConfigurationError, match="outside the project root"):
        resolve_output_dir(tmp_path.parent / "elsewhere", test_config, root=tmp_path)


def test_rejection_mentions_the_active_profile(test_config: ArpiConfig, tmp_path: Path) -> None:
    with pytest.raises(ConfigurationError, match="'test'"):
        resolve_output_dir("../escape", test_config, root=tmp_path)


def test_nothing_is_created_when_create_is_false(test_config: ArpiConfig, tmp_path: Path) -> None:
    resolved = resolve_output_dir("unwritten", test_config, root=tmp_path, create=False)
    assert not resolved.exists()


def test_a_file_in_the_way_is_reported(test_config: ArpiConfig, tmp_path: Path) -> None:
    (tmp_path / "occupied").write_text("not a directory", encoding="utf-8")
    with pytest.raises(ConfigurationError, match="Could not create output directory"):
        resolve_output_dir("occupied/child", test_config, root=tmp_path)


def test_the_root_itself_is_permitted(test_config: ArpiConfig, tmp_path: Path) -> None:
    assert resolve_output_dir(tmp_path, test_config, root=tmp_path) == tmp_path


def test_project_root_defaults_to_the_working_directory(working_dir: Path) -> None:
    assert project_root() == working_dir.resolve()


def test_default_root_is_the_working_directory(test_config: ArpiConfig, working_dir: Path) -> None:
    assert resolve_output_dir("out", test_config) == working_dir.resolve() / "out"
