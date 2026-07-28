"""Configuration loading, precedence, validation and the password policy."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from arpi.config import ArpiConfig, available_profiles, default_config_dirs, load_config
from arpi.constants import ALLOWED_LOG_FORMATS, REDACTED_PLACEHOLDER, SUPPORTED_PROFILES
from arpi.exceptions import ConfigurationError, ProfileNotFoundError

EXPECTED_PROFILE_VALUES = {
    "development": (20250701, date(2025, 7, 1), date(2025, 12, 31), "INFO", True),
    "test": (424242, date(2025, 1, 1), date(2025, 2, 28), "WARNING", False),
    "portfolio": (20240101, date(2024, 1, 1), date(2025, 12, 31), "INFO", False),
}


@pytest.mark.parametrize("profile", SUPPORTED_PROFILES)
def test_each_profile_matches_the_contract(profile: str, repo_config_dir: Path) -> None:
    seed, start, end, level, samples = EXPECTED_PROFILE_VALUES[profile]
    config = load_config(profile=profile, config_dir=repo_config_dir)

    assert config.profile == profile
    assert config.random_seed == seed
    assert config.reporting.start_date == start
    assert config.reporting.end_date == end
    assert config.logging.level == level
    assert config.logging.format in ALLOWED_LOG_FORMATS
    assert config.generation.write_sample_outputs is samples
    assert config.generation.scale_mode == profile
    assert config.generation.store_count == 3
    assert config.generation.sample_row_limit == 400
    assert config.database.enabled is False
    assert config.database.port == 5432
    assert config.database.sslmode == "prefer"
    assert config.validation.min_selling_day_ratio == pytest.approx(0.80)
    assert config.validation.max_selling_day_ratio == pytest.approx(1.00)
    assert config.paths.raw_output_dir == Path("data/raw")


def test_profile_defaults_to_development(repo_config_dir: Path) -> None:
    assert load_config(config_dir=repo_config_dir).profile == "development"


def test_profile_comes_from_the_environment(repo_config_dir: Path) -> None:
    config = load_config(config_dir=repo_config_dir, env={"ARPI_PROFILE": "portfolio"})
    assert config.profile == "portfolio"


def test_explicit_profile_beats_the_environment(repo_config_dir: Path) -> None:
    config = load_config(
        profile="test", config_dir=repo_config_dir, env={"ARPI_PROFILE": "portfolio"}
    )
    assert config.profile == "test"
    assert config.random_seed == 424242


def test_date_count_property(repo_config_dir: Path) -> None:
    config = load_config(profile="test", config_dir=repo_config_dir)
    assert config.reporting.date_count == 59


def test_environment_overrides_yaml(repo_config_dir: Path) -> None:
    config = load_config(
        profile="test",
        config_dir=repo_config_dir,
        env={"ARPI_RANDOM_SEED": "99", "ARPI_LOGGING__LEVEL": "debug"},
    )
    assert config.random_seed == 99
    assert config.logging.level == "DEBUG"


def test_nested_environment_override_and_type_coercion(repo_config_dir: Path) -> None:
    config = load_config(
        profile="test",
        config_dir=repo_config_dir,
        env={
            "ARPI_DATABASE__ENABLED": "true",
            "ARPI_DATABASE__HOST": "db.internal",
            "ARPI_DATABASE__PORT": "6543",
            "ARPI_DATABASE__NAME": "arpi",
            "ARPI_DATABASE__USER": "arpi_loader",
        },
    )
    assert config.database.enabled is True
    assert config.database.host == "db.internal"
    assert config.database.port == 6543
    assert isinstance(config.database.port, int)


def test_environment_does_not_leak_after_loading(repo_config_dir: Path) -> None:
    import os

    load_config(profile="test", config_dir=repo_config_dir, env={"ARPI_RANDOM_SEED": "7"})
    assert "ARPI_RANDOM_SEED" not in os.environ


def test_unknown_profile_lists_available_profiles(repo_config_dir: Path) -> None:
    with pytest.raises(ProfileNotFoundError) as excinfo:
        load_config(profile="staging", config_dir=repo_config_dir)
    error = excinfo.value
    assert error.profile == "staging"
    assert set(error.available) == set(SUPPORTED_PROFILES)
    assert "development" in str(error)


def test_missing_config_dir_names_the_path(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    with pytest.raises(ConfigurationError) as excinfo:
        load_config(profile="test", config_dir=missing)
    assert str(missing) in str(excinfo.value)


def test_missing_config_dir_without_argument(
    working_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("arpi.config.default_config_dirs", lambda: (working_dir / "config",))
    with pytest.raises(ConfigurationError, match="No configuration directory found"):
        load_config(profile="test")


def test_default_config_dirs_prefers_the_working_directory(working_dir: Path) -> None:
    assert default_config_dirs()[0] == working_dir / "config"


def test_available_profiles_of_a_missing_directory(tmp_path: Path) -> None:
    assert available_profiles(tmp_path / "absent") == []


def test_password_is_never_read_from_yaml(tmp_config_dir: Path) -> None:
    path = tmp_config_dir / "test.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "  sslmode: prefer", "  password: hunter2\n  sslmode: prefer"
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError) as excinfo:
        load_config(profile="test", config_dir=tmp_config_dir)
    message = str(excinfo.value)
    assert "ARPI_DATABASE__PASSWORD" in message
    assert "database.password" in message


def test_password_comes_from_the_arpi_variable(repo_config_dir: Path) -> None:
    config = load_config(
        profile="test", config_dir=repo_config_dir, env={"ARPI_DATABASE__PASSWORD": "s3cret"}
    )
    assert config.database.is_password_set()
    assert config.database.password is not None
    assert config.database.password.get_secret_value() == "s3cret"


def test_password_falls_back_to_pgpassword(repo_config_dir: Path) -> None:
    config = load_config(profile="test", config_dir=repo_config_dir, env={"PGPASSWORD": "from-pg"})
    assert config.database.password is not None
    assert config.database.password.get_secret_value() == "from-pg"


def test_redacted_dict_hides_the_password(repo_config_dir: Path) -> None:
    config = load_config(
        profile="test", config_dir=repo_config_dir, env={"ARPI_DATABASE__PASSWORD": "s3cret"}
    )
    payload = config.redacted_dict()
    assert payload["database"]["password"] == REDACTED_PLACEHOLDER
    assert "s3cret" not in repr(payload)


def test_redacted_dict_reports_an_unset_password(test_config: ArpiConfig) -> None:
    assert test_config.redacted_dict()["database"]["password"] is None
    assert test_config.database.is_password_set() is False


def test_repr_and_str_never_leak_the_password(repo_config_dir: Path) -> None:
    config = load_config(
        profile="test", config_dir=repo_config_dir, env={"ARPI_DATABASE__PASSWORD": "s3cret"}
    )
    assert "s3cret" not in repr(config)
    assert "s3cret" not in str(config)
    assert "s3cret" not in repr(config.database)


def test_inverted_reporting_window_is_rejected(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError, match="on or after"):
        load_config(
            profile="test",
            config_dir=repo_config_dir,
            env={"ARPI_REPORTING__END_DATE": "2024-12-31"},
        )


def test_reporting_window_longer_than_forty_years_is_rejected(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError, match="40 years"):
        load_config(
            profile="test",
            config_dir=repo_config_dir,
            env={"ARPI_REPORTING__END_DATE": "2099-12-31"},
        )


def test_store_count_must_be_three(tmp_config_dir: Path) -> None:
    path = tmp_config_dir / "test.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace("store_count: 3", "store_count: 4"),
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="store_count"):
        load_config(profile="test", config_dir=tmp_config_dir)


def test_scale_mode_must_match_the_profile(tmp_config_dir: Path) -> None:
    path = tmp_config_dir / "test.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace("scale_mode: test", "scale_mode: portfolio"),
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="scale_mode"):
        load_config(profile="test", config_dir=tmp_config_dir)


def test_negative_seed_is_rejected(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError, match="non-negative"):
        load_config(profile="test", config_dir=repo_config_dir, env={"ARPI_RANDOM_SEED": "-1"})


def test_non_integer_seed_is_reported_as_a_configuration_error(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError, match="random_seed"):
        load_config(profile="test", config_dir=repo_config_dir, env={"ARPI_RANDOM_SEED": "abc"})


def test_unknown_log_level_is_rejected(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError, match=r"logging\.level"):
        load_config(profile="test", config_dir=repo_config_dir, env={"ARPI_LOGGING__LEVEL": "LOUD"})


def test_unknown_sslmode_is_rejected(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError, match="sslmode"):
        load_config(
            profile="test",
            config_dir=repo_config_dir,
            env={"ARPI_DATABASE__SSLMODE": "maybe"},
        )


def test_enabled_database_requires_host_name_and_user(repo_config_dir: Path) -> None:
    with pytest.raises(ConfigurationError) as excinfo:
        load_config(
            profile="test",
            config_dir=repo_config_dir,
            env={"ARPI_DATABASE__ENABLED": "true", "ARPI_DATABASE__HOST": "localhost"},
        )
    message = str(excinfo.value)
    assert "database.name" in message
    assert "database.user" in message
    assert "ARPI_DATABASE__NAME" in message
    assert "database.host" not in message


def test_inverted_selling_day_band_is_rejected(tmp_config_dir: Path) -> None:
    path = tmp_config_dir / "test.yaml"
    path.write_text(
        path.read_text(encoding="utf-8")
        .replace("min_selling_day_ratio: 0.80", "min_selling_day_ratio: 0.99")
        .replace("max_selling_day_ratio: 1.00", "max_selling_day_ratio: 0.50"),
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="min_selling_day_ratio"):
        load_config(profile="test", config_dir=tmp_config_dir)


def test_unknown_yaml_key_is_rejected(tmp_config_dir: Path) -> None:
    path = tmp_config_dir / "test.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "\nmystery_key: 1\n", encoding="utf-8")
    with pytest.raises(ConfigurationError, match="mystery_key"):
        load_config(profile="test", config_dir=tmp_config_dir)


def test_malformed_yaml_is_reported(tmp_config_dir: Path) -> None:
    (tmp_config_dir / "test.yaml").write_text("profile: [unclosed\n", encoding="utf-8")
    with pytest.raises(ConfigurationError, match="parse YAML"):
        load_config(profile="test", config_dir=tmp_config_dir)


def test_non_mapping_yaml_is_reported(tmp_config_dir: Path) -> None:
    (tmp_config_dir / "test.yaml").write_text("- one\n- two\n", encoding="utf-8")
    with pytest.raises(ConfigurationError, match="YAML mapping"):
        load_config(profile="test", config_dir=tmp_config_dir)


def test_empty_yaml_falls_back_to_defaults(tmp_config_dir: Path) -> None:
    (tmp_config_dir / "development.yaml").write_text("", encoding="utf-8")
    config = load_config(profile="development", config_dir=tmp_config_dir)
    assert config.profile == "development"
    assert config.random_seed == 20250701


def test_config_is_immutable(test_config: ArpiConfig) -> None:
    with pytest.raises(Exception, match=r"frozen"):
        test_config.random_seed = 1
