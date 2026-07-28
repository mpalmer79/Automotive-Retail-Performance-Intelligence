"""Exception hierarchy for the ARPI platform.

Every exception raised deliberately by ``arpi`` derives from :class:`ArpiError`, so the
CLI can present a clean, actionable message instead of a traceback. Each subclass carries
structured attributes describing *what* failed, so callers (and the audit tables) can act
on the failure without parsing prose.

``ArpiError`` deliberately does **not** inherit from :class:`ValueError`; pydantic v2 wraps
``ValueError`` raised inside validators, which would hide the actionable message.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any


class ArpiError(Exception):
    """Base class for every deliberate ARPI failure.

    Attributes:
        message: Human-readable, actionable description of the failure.
        details: Structured key/value context safe to log (never contains credentials).
    """

    def __init__(self, message: str, **details: Any) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            **details: Structured context attached to the exception.
        """
        super().__init__(message)
        self.message = message
        self.details: dict[str, Any] = dict(details)

    def __str__(self) -> str:
        if not self.details:
            return self.message
        rendered = ", ".join(f"{key}={value!r}" for key, value in sorted(self.details.items()))
        return f"{self.message} ({rendered})"


class ConfigurationError(ArpiError):
    """Raised when configuration is missing, unreadable, or internally inconsistent."""

    def __init__(
        self,
        message: str,
        *,
        config_path: Path | None = None,
        keys: Sequence[str] | None = None,
        **details: Any,
    ) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            config_path: File or directory the loader inspected, when relevant.
            keys: Configuration keys implicated in the failure.
            **details: Additional structured context.
        """
        if config_path is not None:
            details["config_path"] = str(config_path)
        if keys:
            details["keys"] = list(keys)
        super().__init__(message, **details)
        self.config_path = config_path
        self.keys: tuple[str, ...] = tuple(keys or ())


class ProfileNotFoundError(ConfigurationError):
    """Raised when the requested configuration profile does not exist."""

    def __init__(self, profile: str, available: Iterable[str], config_dir: Path) -> None:
        """Initialise the error.

        Args:
            profile: Profile name that was requested.
            available: Profile names discovered in ``config_dir``.
            config_dir: Directory that was searched for profile YAML files.
        """
        options = sorted(available)
        rendered = ", ".join(options) if options else "<none found>"
        super().__init__(
            f"Unknown configuration profile {profile!r}. Available profiles: {rendered}. "
            f"Pass --profile with one of those names or set ARPI_PROFILE.",
            config_path=config_dir,
            profile=profile,
            available_profiles=options,
        )
        self.profile = profile
        self.available: tuple[str, ...] = tuple(options)


class ValidationError(ArpiError):
    """Raised when an argument or intermediate value violates a documented invariant."""

    def __init__(self, message: str, *, field: str | None = None, **details: Any) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            field: Name of the offending field or argument.
            **details: Additional structured context.
        """
        if field is not None:
            details["field"] = field
        super().__init__(message, **details)
        self.field = field


class DataQualityError(ArpiError):
    """Raised when one or more critical data-quality checks fail."""

    def __init__(self, message: str, *, failed_check_ids: Sequence[str] = ()) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            failed_check_ids: Identifiers of the critical checks that failed.
        """
        super().__init__(message, failed_check_ids=list(failed_check_ids))
        self.failed_check_ids: tuple[str, ...] = tuple(failed_check_ids)


class GenerationError(ArpiError):
    """Raised when synthetic data cannot be generated as specified."""

    def __init__(self, message: str, *, entity: str | None = None, **details: Any) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            entity: Entity being generated when the failure occurred.
            **details: Additional structured context.
        """
        if entity is not None:
            details["entity"] = entity
        super().__init__(message, **details)
        self.entity = entity


class DatabaseUnavailableError(ArpiError):
    """Raised when a database operation is requested but PostgreSQL cannot be used."""

    def __init__(self, message: str, *, reason: str, remediation: str | None = None) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            reason: Short machine-friendly reason code, e.g. ``"psycopg_missing"``.
            remediation: Concrete next step the operator can take.
        """
        details: dict[str, Any] = {"reason": reason}
        if remediation:
            details["remediation"] = remediation
        super().__init__(message, **details)
        self.reason = reason
        self.remediation = remediation


class DatabaseLoadError(ArpiError):
    """Raised when loading generated data into PostgreSQL fails."""

    def __init__(
        self,
        message: str,
        *,
        entity: str | None = None,
        missing_paths: Sequence[Path] = (),
        context: Mapping[str, Any] | None = None,
    ) -> None:
        """Initialise the error.

        Args:
            message: Human-readable, actionable description of the failure.
            entity: Entity being loaded when the failure occurred.
            missing_paths: SQL artefacts the loader expected but could not find.
            context: Additional structured context (never credentials).
        """
        details: dict[str, Any] = dict(context or {})
        if entity is not None:
            details["entity"] = entity
        if missing_paths:
            details["missing_paths"] = [str(path) for path in missing_paths]
        super().__init__(message, **details)
        self.entity = entity
        self.missing_paths: tuple[Path, ...] = tuple(missing_paths)
