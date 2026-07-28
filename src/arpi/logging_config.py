"""Structured logging with mandatory secret redaction.

The library never calls :func:`print`. Everything it has to say goes through the
``arpi`` logger hierarchy, is written to ``stderr`` so that generated data can be piped
on ``stdout``, and passes through :class:`SecretRedactingFilter` before it is emitted.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from collections.abc import Iterable
from typing import TYPE_CHECKING, Any, Final

from arpi.constants import REDACTED_PLACEHOLDER

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

#: Name of the root logger for every ARPI module.
ROOT_LOGGER_NAME: Final = "arpi"

#: Marker attribute used to recognise (and replace) the handler this module installs.
HANDLER_MARKER: Final = "_arpi_managed_handler"

_TEXT_FORMAT: Final = "%(asctime)s %(levelname)-8s %(name)s %(message)s"
_TIME_FORMAT: Final = "%Y-%m-%dT%H:%M:%S%z"

_URI_CREDENTIAL_PATTERN: Final = re.compile(
    r"(?i)\b(postgres(?:ql)?://[^:/@\s]+:)([^@\s]+)(@)"
)
_KEY_VALUE_PATTERN: Final = re.compile(
    r"(?i)\b([A-Z0-9_]*password[A-Z0-9_]*)(\s*[=:]\s*)([^\s,;'\"]+)"
)

_RESERVED_RECORD_KEYS: Final[frozenset[str]] = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"message", "asctime", "taskName"}


def redact(text: str, secrets: Iterable[str] = ()) -> str:
    """Remove credentials from a rendered log message.

    Three strategies are applied, in order:

    1. exact replacement of every registered secret string;
    2. ``postgresql://user:secret@host`` connection URIs;
    3. any ``*password*=value`` or ``*password*: value`` assignment, which covers
       ``ARPI_DATABASE__PASSWORD=...`` and ``PGPASSWORD=...``.

    Args:
        text: Rendered message.
        secrets: Literal secret values to blank out.

    Returns:
        ``text`` with every recognised credential replaced by ``***REDACTED***``.
    """
    result = text
    for secret in secrets:
        if secret:
            result = result.replace(secret, REDACTED_PLACEHOLDER)
    result = _URI_CREDENTIAL_PATTERN.sub(rf"\1{REDACTED_PLACEHOLDER}\3", result)
    return _KEY_VALUE_PATTERN.sub(rf"\1\2{REDACTED_PLACEHOLDER}", result)


class SecretRedactingFilter(logging.Filter):
    """Logging filter that rewrites every record so credentials cannot escape.

    The filter renders the record eagerly (``record.getMessage()``), redacts the result
    and stores it back on the record, clearing ``record.args``. That way the redaction
    also covers values supplied through lazy ``%``-style formatting arguments.
    """

    def __init__(self, secrets: Iterable[str] = ()) -> None:
        """Initialise the filter.

        Args:
            secrets: Literal secret values to blank out in addition to the patterns.
        """
        super().__init__()
        self._secrets: set[str] = {secret for secret in secrets if secret}

    def add_secret(self, secret: str | None) -> None:
        """Register an additional literal secret to redact.

        Args:
            secret: Secret value; ``None`` and empty strings are ignored.
        """
        if secret:
            self._secrets.add(secret)

    @property
    def secret_count(self) -> int:
        """Number of literal secrets registered with this filter."""
        return len(self._secrets)

    def filter(self, record: logging.LogRecord) -> bool:
        """Redact the record in place and always allow it through.

        Args:
            record: Record about to be emitted.

        Returns:
            Always ``True``; this filter censors rather than drops.
        """
        record.msg = redact(record.getMessage(), self._secrets)
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    """Render log records as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialise ``record`` to a compact JSON document.

        Args:
            record: Record to render.

        Returns:
            A single-line JSON string.
        """
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, _TIME_FORMAT),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED_RECORD_KEYS and not key.startswith("_")
        }
        if extras:
            payload["extra"] = {key: _jsonable(value) for key, value in extras.items()}
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def configure_logging(config: ArpiConfig) -> logging.Logger:
    """Install (or reinstall) the ARPI stderr log handler.

    Calling this twice is safe: the previously installed handler is removed first, so
    messages are never duplicated.

    Args:
        config: Resolved configuration supplying the level, the format and the database
            password to register with the redaction filter.

    Returns:
        The configured ``arpi`` logger.
    """
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    for handler in [h for h in logger.handlers if getattr(h, HANDLER_MARKER, False)]:
        logger.removeHandler(handler)
        handler.close()

    handler = logging.StreamHandler(stream=sys.stderr)
    setattr(handler, HANDLER_MARKER, True)
    handler.setFormatter(
        JsonFormatter() if config.logging.format == "json" else logging.Formatter(_TEXT_FORMAT)
    )
    secret_filter = SecretRedactingFilter()
    if config.database.password is not None:
        secret_filter.add_secret(config.database.password.get_secret_value())
    handler.addFilter(secret_filter)

    logger.addHandler(handler)
    logger.setLevel(config.logging.level)
    logger.propagate = False
    return logger


def get_logger(name: str) -> logging.Logger:
    """Return a logger inside the ``arpi`` hierarchy.

    Args:
        name: Module name, typically ``__name__``. Names already inside the ``arpi``
            hierarchy are returned unchanged.

    Returns:
        The requested :class:`logging.Logger`.
    """
    if name == ROOT_LOGGER_NAME or name.startswith(f"{ROOT_LOGGER_NAME}."):
        return logging.getLogger(name)
    return logging.getLogger(f"{ROOT_LOGGER_NAME}.{name}")


def installed_redaction_filter() -> SecretRedactingFilter | None:
    """Return the redaction filter on the installed handler, if logging is configured.

    Returns:
        The active :class:`SecretRedactingFilter`, or ``None`` when
        :func:`configure_logging` has not run.
    """
    for handler in logging.getLogger(ROOT_LOGGER_NAME).handlers:
        if not getattr(handler, HANDLER_MARKER, False):
            continue
        for log_filter in handler.filters:
            if isinstance(log_filter, SecretRedactingFilter):
                return log_filter
    return None


def _jsonable(value: Any) -> Any:
    """Coerce an arbitrary ``extra`` value into something ``json.dumps`` accepts."""
    if isinstance(value, str | int | float | bool | type(None)):
        return value
    return str(value)
