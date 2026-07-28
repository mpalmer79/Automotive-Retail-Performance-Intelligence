"""Safe resolution of output directories.

Every write performed by ARPI goes through :func:`resolve_output_dir`, which refuses to
create or write anywhere outside the project root. That keeps a stray ``--output-dir``
or a hand-edited profile from scattering files across the filesystem.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from arpi.exceptions import ConfigurationError

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig


def project_root() -> Path:
    """Return the directory that bounds every write.

    Returns:
        The current working directory, resolved. ARPI is a repository-local tool: the
        directory it is invoked from is the boundary it will not write outside of.
    """
    return Path.cwd().resolve()


def resolve_output_dir(
    base: str | Path,
    config: ArpiConfig,
    *,
    root: Path | None = None,
    create: bool = True,
) -> Path:
    """Resolve an output directory, refusing anything that escapes the project root.

    Args:
        base: Requested directory. Relative paths are interpreted against ``root``;
            absolute paths are accepted only when they already sit inside ``root``.
        config: Resolved configuration; its ``profile`` is used only for the error
            message so operators can see which profile asked for the path.
        root: Boundary directory. Defaults to :func:`project_root`.
        create: When ``True`` (the default) the directory is created, parents included.

    Returns:
        The resolved, absolute output directory.

    Raises:
        ConfigurationError: If ``base`` contains a ``..`` component, escapes ``root``,
            or cannot be created.
    """
    boundary = (root or project_root()).resolve()
    candidate = Path(base)

    if ".." in candidate.parts:
        raise ConfigurationError(
            f"Output directory {base!r} contains a '..' path traversal component, which "
            f"is not permitted (profile {config.profile!r}).",
            config_path=candidate,
        )

    absolute = candidate if candidate.is_absolute() else boundary / candidate
    normalised = Path(os.path.normpath(absolute))

    if not _is_within(normalised, boundary):
        raise ConfigurationError(
            f"Output directory {normalised} is outside the project root {boundary}. "
            f"ARPI only writes inside the directory it is run from (profile "
            f"{config.profile!r}).",
            config_path=normalised,
        )

    if create:
        try:
            normalised.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise ConfigurationError(
                f"Could not create output directory {normalised}: {error}",
                config_path=normalised,
            ) from error
    return normalised


def _is_within(candidate: Path, boundary: Path) -> bool:
    """Report whether ``candidate`` is ``boundary`` itself or lives beneath it."""
    return candidate == boundary or boundary in candidate.parents
