"""Typed, layered configuration for the ARPI platform.

Resolution order (highest precedence first):

1. ``ARPI_*`` environment variables (nested with ``__``, e.g. ``ARPI_DATABASE__HOST``)
2. the profile YAML file, ``config/<profile>.yaml``
3. the model defaults declared in this module

The database password is deliberately **not** part of the YAML contract. It is read only
from ``ARPI_DATABASE__PASSWORD`` (falling back to ``PGPASSWORD``) and is redacted from
every ``repr``, ``str`` and log line.
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic import ValidationError as PydanticValidationError
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

from arpi.constants import (
    ALLOWED_LOG_FORMATS,
    ALLOWED_LOG_LEVELS,
    ALLOWED_SSL_MODES,
    DEFAULT_CONFIG_DIR_NAME,
    DEFAULT_PROFILE,
    ENV_NESTED_DELIMITER,
    ENV_PASSWORD_FALLBACK_VAR,
    ENV_PASSWORD_VAR,
    ENV_PREFIX,
    ENV_PROFILE_VAR,
    EXPECTED_STORE_COUNT,
    MAX_REPORTING_WINDOW_YEARS,
    REDACTED_PLACEHOLDER,
)
from arpi.exceptions import ConfigurationError, ProfileNotFoundError
from arpi.utilities.dates import add_years

ProfileName = Literal["development", "test", "portfolio"]
ScaleMode = Literal["development", "test", "portfolio"]
LogFormat = Literal["text", "json"]

#: Key that must never appear in a YAML profile file, at any nesting depth.
FORBIDDEN_YAML_KEY = "password"


class _StrictModel(BaseModel):
    """Base for every configuration sub-model: strict, immutable, no unknown keys."""

    model_config = ConfigDict(extra="forbid", frozen=True, validate_default=True)


class ReportingConfig(_StrictModel):
    """Inclusive reporting window covered by the generated calendar."""

    start_date: date = Field(default=date(2025, 7, 1), description="First reporting date.")
    end_date: date = Field(default=date(2025, 12, 31), description="Last reporting date.")

    @model_validator(mode="after")
    def _check_window(self) -> ReportingConfig:
        """Reject inverted and implausibly long reporting windows."""
        if self.end_date < self.start_date:
            raise ConfigurationError(
                "reporting.end_date must be on or after reporting.start_date "
                f"(start_date={self.start_date.isoformat()}, "
                f"end_date={self.end_date.isoformat()}).",
                keys=["reporting.start_date", "reporting.end_date"],
            )
        if self.end_date > add_years(self.start_date, MAX_REPORTING_WINDOW_YEARS):
            raise ConfigurationError(
                f"The reporting window must not exceed {MAX_REPORTING_WINDOW_YEARS} years "
                f"(start_date={self.start_date.isoformat()}, "
                f"end_date={self.end_date.isoformat()}). Narrow the window or raise "
                "MAX_REPORTING_WINDOW_YEARS deliberately.",
                keys=["reporting.start_date", "reporting.end_date"],
            )
        return self

    @property
    def date_count(self) -> int:
        """Number of calendar dates in the inclusive reporting window."""
        return (self.end_date - self.start_date).days + 1


class GenerationConfig(_StrictModel):
    """Synthetic-data generation settings."""

    store_count: int = Field(default=EXPECTED_STORE_COUNT, description="Number of stores.")
    scale_mode: ScaleMode = Field(default="development", description="Volume profile.")
    write_sample_outputs: bool = Field(
        default=True, description="Also write capped, committed sample CSVs."
    )
    sample_row_limit: int = Field(default=400, ge=1, description="Row cap for sample CSVs.")

    @field_validator("store_count")
    @classmethod
    def _check_store_count(cls, value: int) -> int:
        """Enforce the fixed three-store fictional dealer group."""
        if value != EXPECTED_STORE_COUNT:
            raise ConfigurationError(
                f"generation.store_count must be {EXPECTED_STORE_COUNT}: the fictional "
                f"Granite State Auto Group has exactly {EXPECTED_STORE_COUNT} stores "
                f"defined in the generator, got {value}.",
                keys=["generation.store_count"],
            )
        return value


class PathsConfig(_StrictModel):
    """Filesystem locations, all interpreted relative to the project root."""

    raw_output_dir: Path = Field(default=Path("data/raw"))
    sample_output_dir: Path = Field(default=Path("data/sample"))
    external_data_dir: Path = Field(default=Path("data/external"))
    log_dir: Path = Field(default=Path("logs"))


class LoggingConfig(_StrictModel):
    """Structured-logging settings."""

    level: str = Field(default="INFO", description="Standard library logging level name.")
    format: LogFormat = Field(default="text", description="Log rendering format.")

    @field_validator("level", mode="before")
    @classmethod
    def _normalise_level(cls, value: Any) -> str:
        """Uppercase the level name and reject anything the stdlib does not know."""
        text = str(value).strip().upper()
        if text not in ALLOWED_LOG_LEVELS:
            raise ConfigurationError(
                f"logging.level must be one of {', '.join(ALLOWED_LOG_LEVELS)}, got {value!r}.",
                keys=["logging.level"],
            )
        return text


class DatabaseConfig(_StrictModel):
    """Optional PostgreSQL connection settings.

    ``password`` is never sourced from YAML. Populate it with
    ``ARPI_DATABASE__PASSWORD`` (or ``PGPASSWORD``).
    """

    enabled: bool = Field(default=False)
    host: str | None = Field(default=None)
    port: int = Field(default=5432, ge=1, le=65535)
    name: str | None = Field(default=None)
    user: str | None = Field(default=None)
    password: SecretStr | None = Field(default=None, repr=False)
    sslmode: str = Field(default="prefer")
    connect_timeout_seconds: int = Field(default=10, ge=1, le=300)

    @field_validator("sslmode")
    @classmethod
    def _check_sslmode(cls, value: str) -> str:
        """Reject sslmode values PostgreSQL would not accept."""
        text = value.strip().lower()
        if text not in ALLOWED_SSL_MODES:
            raise ConfigurationError(
                f"database.sslmode must be one of {', '.join(ALLOWED_SSL_MODES)}, "
                f"got {value!r}.",
                keys=["database.sslmode"],
            )
        return text

    @model_validator(mode="after")
    def _check_connection_completeness(self) -> DatabaseConfig:
        """Require the full connection triple whenever the database is enabled."""
        if not self.enabled:
            return self
        missing = [
            f"database.{field}"
            for field in ("host", "name", "user")
            if not getattr(self, field)
        ]
        if missing:
            raise ConfigurationError(
                "database.enabled is true but required connection settings are missing: "
                f"{', '.join(missing)}. Set them in the profile YAML or via "
                f"{', '.join(_env_var_for(key) for key in missing)}.",
                keys=missing,
            )
        return self

    def is_password_set(self) -> bool:
        """Report whether a password was supplied, without revealing it."""
        return self.password is not None and bool(self.password.get_secret_value())


class FeatureFlags(_StrictModel):
    """Opt-in feature switches for work that is planned but not yet implemented."""

    enable_public_vehicle_enrichment: bool = Field(default=False)
    enable_external_market_context: bool = Field(default=False)


class ValidationConfig(_StrictModel):
    """Tolerances used by the data-quality and reconciliation framework."""

    numeric_absolute_tolerance: float = Field(default=0.01, ge=0.0)
    numeric_relative_tolerance: float = Field(default=0.001, ge=0.0)
    max_rejected_record_ratio: float = Field(default=0.0, ge=0.0, le=1.0)
    min_selling_day_ratio: float = Field(default=0.80, ge=0.0, le=1.0)
    max_selling_day_ratio: float = Field(default=1.00, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _check_ratio_bounds(self) -> ValidationConfig:
        """Reject an inverted selling-day tolerance band."""
        if self.min_selling_day_ratio > self.max_selling_day_ratio:
            raise ConfigurationError(
                "validation.min_selling_day_ratio must not exceed "
                f"validation.max_selling_day_ratio (min={self.min_selling_day_ratio}, "
                f"max={self.max_selling_day_ratio}).",
                keys=[
                    "validation.min_selling_day_ratio",
                    "validation.max_selling_day_ratio",
                ],
            )
        return self


class ArpiConfig(BaseSettings):
    """Fully resolved ARPI configuration.

    Instantiate through :func:`load_config` rather than directly, so that profile
    discovery, YAML loading and the password policy are applied consistently.
    """

    model_config = SettingsConfigDict(
        env_prefix=ENV_PREFIX,
        env_nested_delimiter=ENV_NESTED_DELIMITER,
        extra="forbid",
        frozen=True,
        case_sensitive=False,
        validate_default=True,
        env_file=None,
    )

    profile: ProfileName = Field(default=DEFAULT_PROFILE)
    random_seed: int = Field(default=20250701)
    reporting: ReportingConfig = Field(default_factory=ReportingConfig)
    generation: GenerationConfig = Field(default_factory=GenerationConfig)
    paths: PathsConfig = Field(default_factory=PathsConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    features: FeatureFlags = Field(default_factory=FeatureFlags)
    validation: ValidationConfig = Field(default_factory=ValidationConfig)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """Order sources so environment variables win over YAML, which wins over defaults.

        Args:
            settings_cls: The settings class being built.
            init_settings: Values passed to ``__init__`` -- this is where YAML lands.
            env_settings: Values read from ``ARPI_*`` environment variables.
            dotenv_settings: Unused; ``.env`` auto-loading is disabled on purpose so that
                configuration resolution stays hermetic and reproducible.
            file_secret_settings: Docker-style secret files.

        Returns:
            The settings sources, highest precedence first.
        """
        return (env_settings, init_settings, file_secret_settings)

    @field_validator("random_seed")
    @classmethod
    def _check_seed(cls, value: int) -> int:
        """Reject negative seeds; determinism helpers require a non-negative integer."""
        if value < 0:
            raise ConfigurationError(
                f"random_seed must be a non-negative integer, got {value}.",
                keys=["random_seed"],
            )
        return value

    @model_validator(mode="after")
    def _check_scale_mode(self) -> ArpiConfig:
        """Keep ``generation.scale_mode`` aligned with the active profile."""
        if self.generation.scale_mode != self.profile:
            raise ConfigurationError(
                f"generation.scale_mode ({self.generation.scale_mode!r}) must match the "
                f"active profile ({self.profile!r}). Edit config/{self.profile}.yaml or "
                "select a different profile.",
                keys=["profile", "generation.scale_mode"],
            )
        return self

    def redacted_dict(self) -> dict[str, Any]:
        """Return a JSON-serialisable copy of the configuration that is safe to log.

        Returns:
            A nested dictionary in which ``database.password`` is replaced by
            ``***REDACTED***`` when set, and ``None`` when it is not.
        """
        payload: dict[str, Any] = self.model_dump(mode="json")
        database = payload.get("database")
        if isinstance(database, dict):
            database["password"] = (
                REDACTED_PLACEHOLDER if self.database.is_password_set() else None
            )
        return payload

    def __repr__(self) -> str:
        return (
            f"ArpiConfig(profile={self.profile!r}, random_seed={self.random_seed}, "
            f"reporting={self.reporting!r}, generation={self.generation!r}, "
            f"database_enabled={self.database.enabled}, "
            f"database_password={'set' if self.database.is_password_set() else 'unset'})"
        )

    def __str__(self) -> str:
        return repr(self)


def available_profiles(config_dir: Path) -> list[str]:
    """List the profile names discoverable in a configuration directory.

    Args:
        config_dir: Directory expected to contain ``<profile>.yaml`` files.

    Returns:
        Sorted profile names, or an empty list when the directory does not exist.
    """
    if not config_dir.is_dir():
        return []
    return sorted(path.stem for path in config_dir.glob("*.yaml"))


def default_config_dirs() -> tuple[Path, ...]:
    """Return the directories searched for profile YAML when none is supplied.

    Returns:
        The current working directory's ``config/`` folder first, then the ``config/``
        folder alongside an editable source checkout of the package.
    """
    cwd_candidate = Path.cwd() / DEFAULT_CONFIG_DIR_NAME
    checkout_candidate = Path(__file__).resolve().parents[2] / DEFAULT_CONFIG_DIR_NAME
    if checkout_candidate == cwd_candidate:
        return (cwd_candidate,)
    return (cwd_candidate, checkout_candidate)


def load_config(
    profile: str | None = None,
    config_dir: Path | None = None,
    env: Mapping[str, str] | None = None,
) -> ArpiConfig:
    """Resolve, validate and return the effective configuration.

    Args:
        profile: Explicit profile name. When omitted, ``ARPI_PROFILE`` is used, and
            failing that the ``development`` profile.
        config_dir: Directory holding ``<profile>.yaml``. When omitted, the directories
            returned by :func:`default_config_dirs` are searched in order.
        env: Environment mapping to use instead of :data:`os.environ`. Primarily a
            testing seam; when supplied it fully replaces the process environment for
            the duration of the call.

    Returns:
        A validated :class:`ArpiConfig`.

    Raises:
        ConfigurationError: If no configuration directory exists, the YAML is malformed,
            it contains a forbidden ``password`` key, or validation fails.
        ProfileNotFoundError: If the requested profile has no YAML file.
    """
    source_env: Mapping[str, str] = os.environ if env is None else env
    resolved_profile = profile or source_env.get(ENV_PROFILE_VAR) or DEFAULT_PROFILE
    directory = _resolve_config_dir(config_dir)
    payload = _read_profile_yaml(directory, resolved_profile)

    overrides = {ENV_PROFILE_VAR: resolved_profile}
    password = source_env.get(ENV_PASSWORD_VAR) or source_env.get(ENV_PASSWORD_FALLBACK_VAR)
    if password:
        overrides[ENV_PASSWORD_VAR] = password

    with _environment(source_env, overrides):
        try:
            return ArpiConfig(**payload)
        except PydanticValidationError as error:
            raise ConfigurationError(
                "The resolved configuration is invalid:\n"
                + _format_pydantic_errors(error)
                + f"\nProfile {resolved_profile!r} was loaded from "
                f"{directory / f'{resolved_profile}.yaml'}.",
                config_path=directory / f"{resolved_profile}.yaml",
            ) from error


def _resolve_config_dir(config_dir: Path | None) -> Path:
    """Pick the configuration directory to read, or explain where we looked."""
    if config_dir is not None:
        directory = Path(config_dir)
        if not directory.is_dir():
            raise ConfigurationError(
                f"Configuration directory not found: {directory}. Create it, or pass "
                "--config-dir pointing at the repository's config/ folder.",
                config_path=directory,
            )
        return directory

    candidates = default_config_dirs()
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    rendered = ", ".join(str(candidate) for candidate in candidates)
    raise ConfigurationError(
        f"No configuration directory found. Looked in: {rendered}. Run ARPI from the "
        "repository root or pass --config-dir.",
        config_path=candidates[0],
    )


def _read_profile_yaml(directory: Path, profile: str) -> dict[str, Any]:
    """Read and sanity-check a single profile YAML file."""
    path = directory / f"{profile}.yaml"
    if not path.is_file():
        raise ProfileNotFoundError(profile, available_profiles(directory), directory)
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:
        raise ConfigurationError(
            f"Could not parse YAML configuration: {error}", config_path=path
        ) from error
    except OSError as error:
        raise ConfigurationError(
            f"Could not read configuration file: {error}", config_path=path
        ) from error

    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigurationError(
            f"Configuration file must contain a YAML mapping, found {type(raw).__name__}.",
            config_path=path,
        )
    _reject_secrets_in_yaml(raw, path)
    return raw


def _reject_secrets_in_yaml(payload: Mapping[str, Any], path: Path, prefix: str = "") -> None:
    """Refuse to load configuration that embeds a password at any nesting depth."""
    for key, value in payload.items():
        qualified = f"{prefix}{key}"
        if str(key).lower() == FORBIDDEN_YAML_KEY:
            raise ConfigurationError(
                f"Credentials must never be stored in YAML. Remove {qualified!r} from "
                f"{path} and export {ENV_PASSWORD_VAR} instead (or {ENV_PASSWORD_FALLBACK_VAR}).",
                config_path=path,
                keys=[qualified],
            )
        if isinstance(value, Mapping):
            _reject_secrets_in_yaml(value, path, prefix=f"{qualified}.")


@contextmanager
def _environment(base: Mapping[str, str], overrides: Mapping[str, str]) -> Iterator[None]:
    """Temporarily install ``base`` plus ``overrides`` as the process environment.

    pydantic-settings reads :data:`os.environ` directly, so this is how ``load_config``
    honours an injected ``env`` mapping and pins the resolved profile.
    """
    original = dict(os.environ)
    replacement = dict(base)
    replacement.update(overrides)
    try:
        os.environ.clear()
        os.environ.update(replacement)
        yield
    finally:
        os.environ.clear()
        os.environ.update(original)


def _format_pydantic_errors(error: PydanticValidationError) -> str:
    """Render pydantic's error list as an indented, human-readable block."""
    lines = []
    for item in error.errors():
        location = ".".join(str(part) for part in item["loc"]) or "<root>"
        lines.append(f"  - {location}: {item['msg']}")
    return "\n".join(lines)


def _env_var_for(dotted_key: str) -> str:
    """Translate a dotted configuration key into its environment-variable name."""
    return ENV_PREFIX + dotted_key.replace(".", ENV_NESTED_DELIMITER).upper()
