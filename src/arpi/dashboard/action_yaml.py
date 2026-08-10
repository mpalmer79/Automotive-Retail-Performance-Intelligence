"""A strict, standard-library reader for the subset of YAML the rule file uses.

WHY THIS EXISTS
---------------
``ci.yml``'s ``repository-checks`` job states its own contract: *"Every script here is
standard library only and is run WITHOUT installing the package, which keeps this job to a
few seconds."* It runs ``scripts/export_dashboard_dataset.py --check``, which is the gate
that proves the committed export — including `DASH.12`'s action queue — is still the export
the repository's inputs produce.

`DASH.12` put a YAML file on that path, and PyYAML is not on a bare interpreter. Three ways
out, and two of them are worse:

* **Install PyYAML in that job.** It would work, and it would spend a documented property to
  buy nothing: the job is fast and dependency-free on purpose, and "standard library only"
  stops being true the first time it is not.
* **Commit a generated JSON twin of the rule file.** A second copy of the rules, able to go
  stale, in a repository whose whole argument is that there is one authority per fact.
* **Read the subset with the standard library, and prove the two readers agree.** That is
  what this module does, and it is not a new idea here: ``config/reference/`` is already
  parsed by PyYAML in the application and by a hand-written scanner in CI, with
  ``test_the_two_parsers_agree_about_the_contract`` failing if they ever diverge. The same
  discipline applies to this module —
  ``tests/unit/test_action_yaml.py::test_both_readers_produce_the_same_document`` parses the
  committed rule file with both and requires an identical structure.

STRICT, NOT LENIENT
-------------------
A lenient parser is the dangerous kind: it would accept a construct it does not really
understand and hand back a document that differs from what PyYAML would produce, which is
precisely the divergence the equality test exists to catch — but only for the file that
exists today. So every construct outside the supported subset raises. Anchors, aliases, tags,
multiple documents, flow mappings, literal block scalars, tabs and quoted keys are all
refused rather than guessed at.

THE SUPPORTED SUBSET
--------------------
Exactly what ``config/dashboard/action_rules.yaml`` uses, and nothing else:

* block mappings with two-space indentation;
* block sequences, whose items are scalars or mappings;
* inline flow sequences of scalars (``[a, b]``) including the empty ``[]``;
* the empty flow mapping ``{}``, and no other flow mapping;
* folded block scalars (``>`` and ``>-``), which join their lines with single spaces and
  follow YAML's clip and strip chomping respectively;
* plain, single-quoted and double-quoted scalars;
* ``true`` / ``false``, integers, and everything else as a string;
* full-line and trailing comments, and blank lines.

Numbers are read as :class:`int` only when they are integral, matching PyYAML. Floats are
NOT recognised as floats -- they stay strings -- which is safe here because the schema loader
refuses a YAML float outright: an exact threshold must be an integer or a quoted decimal.
"""

from __future__ import annotations

import re
from typing import Any, Final

from arpi.exceptions import ArpiError

__all__ = ["ActionYamlError", "parse_document"]


class ActionYamlError(ArpiError):
    """The document used a construct this reader deliberately does not support."""


#: An integer scalar. Floats are deliberately absent; see the module docstring.
_INTEGER: Final[re.Pattern[str]] = re.compile(r"-?\d+\Z")

#: How far a sequence item's mapping members are indented past the dash.
_DASH_WIDTH: Final = 2

#: The shortest a quoted scalar can be: the two quote characters themselves.
_EMPTY_QUOTED: Final = 2

#: A mapping key at the start of a line's content.
_KEY: Final[re.Pattern[str]] = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s|\Z)")

#: Constructs that are refused rather than guessed at.
_REFUSED: Final[tuple[tuple[str, str], ...]] = (
    ("&", "an anchor"),
    ("*", "an alias"),
    ("!", "a tag"),
    ("{", "a flow mapping"),  # `{}` is admitted before this check; see `_value`
    ("|", "a literal block scalar"),
)


def _strip_comment(text: str) -> str:
    """Remove a trailing comment that is outside quotes."""
    quote: str | None = None
    for index, char in enumerate(text):
        if quote is not None:
            if char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char == "#" and (index == 0 or text[index - 1].isspace()):
            return text[:index]
    return text


#: Plain scalars that are not strings, and what they mean.
_KEYWORDS: Final[dict[str, Any]] = {
    "true": True,
    "True": True,
    "false": False,
    "False": False,
    "null": None,
    "~": None,
    "": None,
}


def _unquote(value: str, quote: str) -> str | None:
    """Return the contents of a quoted scalar, or ``None`` if it is not one."""
    if len(value) >= _EMPTY_QUOTED and value.startswith(quote) and value.endswith(quote):
        inner = value[1:-1]
        return inner.replace('\\"', '"') if quote == '"' else inner.replace("''", "'")
    return None


def _scalar(text: str) -> Any:
    """Convert a scalar's source text to a Python value."""
    value = text.strip()
    for quote in ('"', "'"):
        unquoted = _unquote(value, quote)
        if unquoted is not None:
            return unquoted
    if value in _KEYWORDS:
        return _KEYWORDS[value]
    return int(value) if _INTEGER.match(value) else value


def _flow_sequence(text: str) -> list[Any]:
    """Parse an inline ``[a, b]`` sequence of scalars."""
    inner = text.strip()[1:-1].strip()
    if inner == "":
        return []
    if "[" in inner or "]" in inner or "{" in inner:
        raise ActionYamlError(f"nested flow collections are not supported: {text!r}")
    return [_scalar(item) for item in inner.split(",")]


class _Line:
    """One significant line: its indentation and its content."""

    __slots__ = ("content", "indent", "number")

    def __init__(self, number: int, raw: str) -> None:
        """Split a raw line into indentation and comment-free content."""
        if "\t" in raw:
            raise ActionYamlError(f"line {number} contains a tab; YAML indentation is spaces")
        stripped = _strip_comment(raw).rstrip()
        self.number = number
        self.indent = len(stripped) - len(stripped.lstrip(" "))
        self.content = stripped.strip()


class _Reader:
    """Recursive-descent reader over the significant lines of a document."""

    def __init__(self, lines: list[_Line]) -> None:
        """Initialise with the document's significant lines."""
        self._lines = lines
        self._index = 0

    def _peek(self) -> _Line | None:
        return self._lines[self._index] if self._index < len(self._lines) else None

    def remaining(self) -> _Line | None:
        """The first line the reader did not consume, if any."""
        return self._peek()

    def parse_mapping(self, indent: int) -> dict[str, Any]:
        """Parse a block mapping at the given indentation."""
        result: dict[str, Any] = {}
        while True:
            line = self._peek()
            if line is None or line.indent < indent:
                return result
            if line.indent > indent:
                raise ActionYamlError(
                    f"line {line.number} is indented {line.indent} where {indent} was expected"
                )
            if line.content.startswith("- "):
                return result
            match = _KEY.match(line.content)
            if match is None:
                raise ActionYamlError(
                    f"line {line.number} is not a mapping entry: {line.content!r}"
                )
            key = match.group(1)
            if key in result:
                raise ActionYamlError(f"line {line.number} repeats the key {key!r}")
            rest = line.content[match.end() :].strip()
            self._index += 1
            result[key] = self._value(rest, indent, line.number)
        # unreachable

    def _value(self, rest: str, indent: int, number: int) -> Any:
        """Parse the value that follows a mapping key."""
        # The EMPTY flow mapping is admitted and nothing else is. `params: {}` is how a
        # drill-through says it carries no query parameters, and an empty collection has no
        # contents to misread — which is the whole reason general flow mappings are refused.
        if rest == "{}":
            return {}
        for token, what in _REFUSED:
            if rest.startswith(token):
                raise ActionYamlError(f"line {number} uses {what}, which is not supported")
        if rest.startswith("["):
            if not rest.endswith("]"):
                raise ActionYamlError(f"line {number} has an unterminated flow sequence")
            return _flow_sequence(rest)
        if rest == ">" or rest.startswith(">"):
            if rest not in {">", ">-"}:
                raise ActionYamlError(
                    f"line {number} uses a folded scalar indicator this reader does not "
                    f"support: {rest!r}"
                )
            return self._folded(indent, chomp=rest == ">-")
        if rest != "":
            return _scalar(rest)
        return self._nested(indent)

    def _nested(self, indent: int) -> Any:
        """Parse the block that follows a key with no inline value."""
        nested = self._peek()
        if nested is None or nested.indent <= indent:
            return None
        if nested.content.startswith("- "):
            return self.parse_sequence(nested.indent)
        return self.parse_mapping(nested.indent)

    def _folded(self, indent: int, *, chomp: bool) -> str:
        """Join a folded block scalar's lines with single spaces.

        A bare ``>`` uses YAML's default CLIP chomping, which keeps exactly one trailing
        newline; ``>-`` strips it. The distinction changes nothing downstream, since the
        schema loader strips every string it reads — but the equality test compares the two
        readers' documents outright, and "close enough" is not a property worth asserting.
        """
        parts: list[str] = []
        while True:
            line = self._peek()
            if line is None or line.indent <= indent:
                break
            parts.append(line.content)
            self._index += 1
        folded = " ".join(parts)
        return folded if chomp or folded == "" else f"{folded}\n"

    def parse_sequence(self, indent: int) -> list[Any]:
        """Parse a block sequence at the given indentation."""
        items: list[Any] = []
        while True:
            line = self._peek()
            if line is None or line.indent < indent or not line.content.startswith("- "):
                return items
            if line.indent > indent:
                raise ActionYamlError(
                    f"line {line.number} is indented {line.indent} where {indent} was expected"
                )
            rest = line.content[_DASH_WIDTH:].strip()
            # A sequence item that begins with `key:` opens a mapping whose first entry is on
            # this line. Its members are indented two past the dash, which is where the rest
            # of the mapping continues.
            if _KEY.match(rest):
                self._lines[self._index] = _Line(line.number, " " * (indent + _DASH_WIDTH) + rest)
                items.append(self.parse_mapping(indent + _DASH_WIDTH))
                continue
            self._index += 1
            items.append(_scalar(rest))


def parse_document(text: str) -> Any:
    """Parse a YAML document restricted to the supported subset.

    Args:
        text: The document's decoded text.

    Returns:
        The parsed structure: nested dictionaries, lists and scalars.

    Raises:
        ActionYamlError: On any construct outside the subset, on inconsistent indentation,
            on a repeated key, or on a document that declares more than one document.
    """
    lines: list[_Line] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        if raw.strip().startswith("---") or raw.strip().startswith("..."):
            raise ActionYamlError(f"line {number} starts a document marker; one document only")
        line = _Line(number, raw)
        if line.content != "":
            lines.append(line)
    if not lines:
        return None
    reader = _Reader(lines)
    first = lines[0]
    document = (
        reader.parse_sequence(first.indent)
        if first.content.startswith("- ")
        else reader.parse_mapping(first.indent)
    )
    remaining = reader.remaining()
    if remaining is not None:
        raise ActionYamlError(f"line {remaining.number} was not consumed: {remaining.content!r}")
    return document
