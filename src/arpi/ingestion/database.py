"""PostgreSQL connectivity, with ``psycopg`` treated as strictly optional.

Importing :mod:`arpi` must succeed on a machine that has never heard of PostgreSQL, so
``psycopg`` is imported behind a guard and every entry point checks
:data:`PSYCOPG_AVAILABLE` before touching it.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

from arpi.exceptions import DatabaseUnavailableError
from arpi.logging_config import get_logger

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

try:
    import psycopg
except ImportError:  # pragma: no cover - exercised only where the db extra is absent
    psycopg = None  # type: ignore[assignment]
    PSYCOPG_AVAILABLE = False
else:
    PSYCOPG_AVAILABLE = True

_LOGGER = get_logger(__name__)

INSTALL_HINT = 'Install the optional database extra: pip install "arpi[db]".'


def connection_kwargs(config: ArpiConfig) -> dict[str, Any]:
    """Build the keyword arguments for :func:`psycopg.connect`.

    Args:
        config: Resolved configuration.

    Returns:
        A keyword-argument mapping. The password, when present, is the plain secret
        value: never log this mapping, log :meth:`ArpiConfig.redacted_dict` instead.
    """
    kwargs: dict[str, Any] = {
        "host": config.database.host,
        "port": config.database.port,
        "dbname": config.database.name,
        "user": config.database.user,
        "sslmode": config.database.sslmode,
        "connect_timeout": config.database.connect_timeout_seconds,
    }
    if config.database.password is not None:
        kwargs["password"] = config.database.password.get_secret_value()
    return kwargs


def describe_target(config: ArpiConfig) -> str:
    """Render the connection target for logs, without credentials.

    Args:
        config: Resolved configuration.

    Returns:
        A ``user@host:port/dbname`` style string containing no password.
    """
    database = config.database
    return f"{database.user}@{database.host}:{database.port}/{database.name}"


def require_psycopg() -> None:
    """Raise unless ``psycopg`` can be used.

    Raises:
        DatabaseUnavailableError: If ``psycopg`` is not importable.
    """
    if not PSYCOPG_AVAILABLE:
        raise DatabaseUnavailableError(
            f"psycopg is not installed, so ARPI cannot talk to PostgreSQL. {INSTALL_HINT}",
            reason="psycopg_missing",
            remediation=INSTALL_HINT,
        )


@contextmanager
def connect(config: ArpiConfig) -> Iterator[Any]:
    """Open a PostgreSQL connection for the duration of the ``with`` block.

    Args:
        config: Resolved configuration; ``database.enabled`` must be true.

    Yields:
        An open ``psycopg.Connection``.

    Raises:
        DatabaseUnavailableError: If the database is disabled, ``psycopg`` is missing,
            or the connection attempt fails.
    """
    if not config.database.enabled:
        raise DatabaseUnavailableError(
            "database.enabled is false, so no connection was attempted. Set "
            "ARPI_DATABASE__ENABLED=true together with host, name and user.",
            reason="database_disabled",
            remediation="Set ARPI_DATABASE__ENABLED=true and supply host, name and user.",
        )
    require_psycopg()

    try:
        connection = psycopg.connect(**connection_kwargs(config))
    except psycopg.Error as error:
        raise DatabaseUnavailableError(
            f"Could not connect to PostgreSQL at {describe_target(config)}: {error}",
            reason="connection_failed",
            remediation="Check the host, port, database name, user and network access.",
        ) from error

    try:
        yield connection
    finally:
        connection.close()


def database_available(config: ArpiConfig) -> bool:
    """Probe whether PostgreSQL can actually be used, without ever raising.

    Args:
        config: Resolved configuration.

    Returns:
        ``True`` only when the database is enabled, ``psycopg`` is importable and a
        short-timeout connection succeeds. Every negative outcome is logged at INFO with
        the reason; the password is never logged.
    """
    if not config.database.enabled:
        _LOGGER.info("Database step unavailable: database.enabled is false.")
        return False
    if not PSYCOPG_AVAILABLE:
        _LOGGER.info("Database step unavailable: psycopg is not installed. %s", INSTALL_HINT)
        return False

    try:
        with connect(config) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseUnavailableError as error:
        _LOGGER.info("Database step unavailable: %s", error.message)
        return False
    except psycopg.Error as error:
        _LOGGER.info(
            "Database step unavailable: probe query failed against %s (%s).",
            describe_target(config),
            error,
        )
        return False
    _LOGGER.info("Database reachable at %s.", describe_target(config))
    return True
