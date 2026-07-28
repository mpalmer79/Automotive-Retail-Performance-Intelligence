#!/usr/bin/env python3
"""Validate relative Markdown links, image paths, and heading anchors.

Documentation is a first-class deliverable in this repository, so a broken
cross-reference is a build failure, not a cosmetic problem. This script walks
every Markdown file, extracts inline links, image references, and
reference-style definitions, and confirms that each *relative* target resolves.

What is checked
---------------
* `[text](target)` and `![alt](target)` inline links.
* `[label]: target` reference-style definitions.
* Targets that point at a file must exist.
* Targets that point at a directory are accepted when the directory exists.
* `file.md#anchor` must resolve both the file part and the anchor: headings in
  the target file are GitHub-slugified and the anchor must match one of them.
* `#anchor` on its own is resolved against the containing file.

What is not checked
-------------------
* Absolute `http://` / `https://` links, `mailto:` links, protocol-relative
  `//host/path` links, and other URI schemes. These would require network
  access, which CI deliberately does not have. Their count is reported.
* Links inside fenced code blocks or inline code spans, which are examples.

Standard library only, so CI can run it without installing the package.

Usage
-----
    python scripts/check_docs_links.py
    python scripts/check_docs_links.py --quiet
    python scripts/check_docs_links.py --paths docs README.md

Exit codes
----------
    0  every relative link resolves
    1  at least one broken link or unresolved anchor
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

REPO_ROOT: Path = Path(__file__).resolve().parent.parent

SKIPPED_DIRECTORY_NAMES: frozenset[str] = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "env",
        "ENV",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".hypothesis",
        "htmlcov",
        ".tox",
        ".nox",
        ".idea",
        ".vscode",
        ".ipynb_checkpoints",
        "build",
        "dist",
    }
)

# Schemes that are out of scope for an offline checker.
EXTERNAL_SCHEME_RE: re.Pattern[str] = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
PROTOCOL_RELATIVE_RE: re.Pattern[str] = re.compile(r"^//")

# Inline links and images. The optional trailing group swallows a link title.
INLINE_LINK_RE: re.Pattern[str] = re.compile(
    r"!?\[(?P<text>(?:[^\[\]\\]|\\.)*)\]\(\s*(?P<target><[^>]*>|[^\s)]*)"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)"
)

# Reference-style definitions: `[label]: target "optional title"`.
REFERENCE_DEF_RE: re.Pattern[str] = re.compile(
    r"^\s{0,3}\[(?P<label>[^\]]+)\]:\s*(?P<target><[^>]*>|\S+)"
)

FENCE_RE: re.Pattern[str] = re.compile(r"^\s{0,3}(?P<fence>`{3,}|~{3,})")
ATX_HEADING_RE: re.Pattern[str] = re.compile(
    r"^\s{0,3}(?P<hashes>#{1,6})\s+(?P<title>.*?)\s*#*\s*$"
)
INLINE_CODE_RE: re.Pattern[str] = re.compile(r"`[^`]*`")
HTML_ANCHOR_RE: re.Pattern[str] = re.compile(
    r"<a\s[^>]*(?:name|id)\s*=\s*[\"'](?P<anchor>[^\"']+)[\"']", re.IGNORECASE
)
# Any element carrying an explicit id, e.g. `<h2 id="custom">`.
HTML_ID_RE: re.Pattern[str] = re.compile(r"<[a-zA-Z][^>]*\sid\s*=\s*[\"'](?P<anchor>[^\"']+)[\"']")

# Markdown emphasis and link syntax stripped before slugifying a heading.
HEADING_LINK_RE: re.Pattern[str] = re.compile(r"\[([^\]]*)\]\([^)]*\)")
HEADING_EMPHASIS_RE: re.Pattern[str] = re.compile(r"[*_~]{1,3}")
SLUG_STRIP_RE: re.Pattern[str] = re.compile(r"[^\w\- ]", re.UNICODE)

# A single-character "scheme" is a Windows drive letter, not a URI scheme.
MIN_URI_SCHEME_LENGTH: int = 3
# Number of leading characters used to suggest a near-miss anchor.
ANCHOR_SUGGESTION_PREFIX: int = 8


@dataclass(frozen=True)
class LinkRef:
    """A single link occurrence in a Markdown file."""

    source: Path
    line_number: int
    target: str
    kind: str  # "inline" or "reference"


@dataclass(frozen=True)
class Broken:
    """A link that failed to resolve."""

    source: str
    line_number: int
    target: str
    reason: str

    def render(self) -> str:
        """Return the one-finding report block for this broken link."""
        return f"{self.source}:{self.line_number} -> {self.target}\n    {self.reason}"


def relative_posix(path: Path) -> str:
    """Return *path* as a repository-relative POSIX string."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def slugify_heading(title: str) -> str:
    """Convert a heading to a GitHub-style anchor slug."""
    text = INLINE_CODE_RE.sub(lambda m: m.group(0).strip("`"), title)
    text = HEADING_LINK_RE.sub(r"\1", text)
    text = HEADING_EMPHASIS_RE.sub("", text)
    text = text.strip().lower()
    text = SLUG_STRIP_RE.sub("", text)
    return text.replace(" ", "-")


def collect_anchors(markdown_path: Path) -> set[str]:
    """Return every anchor GitHub would create for *markdown_path*."""
    anchors: set[str] = set()
    counts: dict[str, int] = {}
    try:
        lines = markdown_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return anchors

    in_fence = False
    fence_marker = ""
    for line in lines:
        fence_match = FENCE_RE.match(line)
        if fence_match:
            marker = fence_match.group("fence")
            if not in_fence:
                in_fence, fence_marker = True, marker[0]
                continue
            if marker[0] == fence_marker:
                in_fence, fence_marker = False, ""
                continue
        if in_fence:
            continue

        for pattern in (HTML_ANCHOR_RE, HTML_ID_RE):
            for match in pattern.finditer(line):
                anchors.add(match.group("anchor").lower())

        heading = ATX_HEADING_RE.match(line)
        if not heading:
            continue
        base = slugify_heading(heading.group("title"))
        if not base:
            continue
        seen = counts.get(base, 0)
        anchors.add(base if seen == 0 else f"{base}-{seen}")
        counts[base] = seen + 1
    return anchors


def strip_inline_code(line: str) -> str:
    """Blank out inline code spans so example links are not treated as links."""
    return INLINE_CODE_RE.sub(lambda m: " " * len(m.group(0)), line)


def extract_links(markdown_path: Path) -> list[LinkRef]:
    """Return every link and image reference found in *markdown_path*."""
    try:
        lines = markdown_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    refs: list[LinkRef] = []
    in_fence = False
    fence_marker = ""
    for line_number, raw_line in enumerate(lines, start=1):
        fence_match = FENCE_RE.match(raw_line)
        if fence_match:
            marker = fence_match.group("fence")
            if not in_fence:
                in_fence, fence_marker = True, marker[0]
                continue
            if marker[0] == fence_marker:
                in_fence, fence_marker = False, ""
                continue
        if in_fence:
            continue

        line = strip_inline_code(raw_line)

        definition = REFERENCE_DEF_RE.match(line)
        if definition:
            refs.append(
                LinkRef(
                    source=markdown_path,
                    line_number=line_number,
                    target=definition.group("target").strip("<>"),
                    kind="reference",
                )
            )
            continue

        for match in INLINE_LINK_RE.finditer(line):
            target = match.group("target").strip().strip("<>")
            if not target:
                continue
            refs.append(
                LinkRef(
                    source=markdown_path,
                    line_number=line_number,
                    target=target,
                    kind="inline",
                )
            )
    return refs


def is_external(target: str) -> bool:
    """Return True for links this offline checker deliberately ignores."""
    if PROTOCOL_RELATIVE_RE.match(target):
        return True
    match = EXTERNAL_SCHEME_RE.match(target)
    if not match:
        return False
    # A Windows-style drive letter is not a scheme, but nothing here uses one.
    return len(match.group(0)) >= MIN_URI_SCHEME_LENGTH


def _broken(ref: LinkRef, reason: str) -> Broken:
    """Build a Broken record for *ref* with the given *reason*."""
    return Broken(
        source=relative_posix(ref.source),
        line_number=ref.line_number,
        target=ref.target,
        reason=reason,
    )


def _resolve_file_part(
    ref: LinkRef, file_part: str, anchor: str
) -> tuple[Path | None, Broken | None]:
    """Resolve the path portion of a link.

    Returns a (path, failure) pair. A None path with a None failure means the
    link resolved to a directory and needs no further checking.
    """
    if not file_part:
        return ref.source, None
    resolved = (ref.source.parent / file_part).resolve()
    if not resolved.exists():
        return None, _broken(ref, f"path does not exist: {relative_posix(resolved)}")
    if resolved.is_dir():
        if anchor:
            return None, _broken(ref, "anchor given but the target is a directory")
        return None, None
    return resolved, None


def check_link(ref: LinkRef, anchor_cache: dict[Path, set[str]]) -> Broken | None:
    """Validate one relative link and return a Broken record, or None if it is fine."""
    target = ref.target.strip()
    if not target or is_external(target):
        return None

    file_part, _, anchor = target.partition("#")
    file_part = unquote(file_part)
    anchor = unquote(anchor).lower()

    resolved, failure = _resolve_file_part(ref, file_part, anchor)
    if failure is not None or resolved is None:
        return failure

    # Anchors into non-Markdown files cannot be verified; accept them.
    if not anchor or resolved.suffix.lower() != ".md":
        return None

    if resolved not in anchor_cache:
        anchor_cache[resolved] = collect_anchors(resolved)
    known = anchor_cache[resolved]
    if anchor in known:
        return None

    suggestion = ""
    prefix = anchor[:ANCHOR_SUGGESTION_PREFIX]
    close = sorted(a for a in known if prefix and a.startswith(prefix))
    if close:
        suggestion = f"; did you mean #{close[0]} ?"
    return _broken(
        ref,
        f"anchor '#{anchor}' not found in {relative_posix(resolved)} "
        f"({len(known)} heading anchors known){suggestion}",
    )


def iter_markdown_files(roots: Sequence[Path]) -> list[Path]:
    """Return every Markdown file beneath *roots*, sorted and de-duplicated."""
    found: set[Path] = set()
    for root in roots:
        if root.is_file():
            if root.suffix.lower() == ".md":
                found.add(root.resolve())
            continue
        for candidate in root.rglob("*.md"):
            if any(part in SKIPPED_DIRECTORY_NAMES for part in candidate.parts):
                continue
            if candidate.is_file() and not candidate.is_symlink():
                found.add(candidate.resolve())
    return sorted(found)


def resolve_roots(raw_paths: Sequence[str]) -> list[Path]:
    """Turn CLI path arguments into existing absolute paths."""
    if not raw_paths:
        return [REPO_ROOT]
    roots: list[Path] = []
    for raw in raw_paths:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = REPO_ROOT / candidate
        if candidate.exists():
            roots.append(candidate)
        else:
            print(f"warning: path does not exist, skipping: {raw}", file=sys.stderr)
    return roots


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser."""
    parser = argparse.ArgumentParser(
        description="Validate relative Markdown links, images, and heading anchors.",
    )
    parser.add_argument(
        "--paths",
        nargs="+",
        default=[],
        metavar="PATH",
        help="Limit the scan to these files or directories (default: the whole repository).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print only broken links and the final summary line.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the link check and return a process exit code."""
    args = build_parser().parse_args(argv)

    roots = resolve_roots(args.paths)
    if not roots:
        print("error: no valid paths to scan", file=sys.stderr)
        return 1

    markdown_files = iter_markdown_files(roots)
    anchor_cache: dict[Path, set[str]] = {}
    broken: list[Broken] = []
    relative_count = 0
    external_count = 0

    for markdown_path in markdown_files:
        for ref in extract_links(markdown_path):
            if is_external(ref.target):
                external_count += 1
                continue
            relative_count += 1
            failure = check_link(ref, anchor_cache)
            if failure is not None:
                broken.append(failure)

    if not args.quiet:
        print("ARPI documentation link check")
        print(f"  markdown files : {len(markdown_files)}")
        print(f"  relative links : {relative_count}")
        print(f"  external links : {external_count} (not checked; offline CI)")
        print()

    if broken:
        print(f"Broken links ({len(broken)}):")
        for failure in broken:
            print(f"  {failure.render()}")
        print()
        print(f"FAIL: {len(broken)} broken relative link(s).")
        return 1

    if not args.quiet:
        print("OK: every relative link and anchor resolves.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
