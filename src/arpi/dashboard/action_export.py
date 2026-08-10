"""The `DASH.12` export stage: the action queue as a governed artifact.

WHERE THIS SITS
---------------
After the exporter has read every contracted dataset and before anything is written. The
stage takes the records the export is ABOUT TO PUBLISH, evaluates the rule file against
them, and produces one more file plus one more manifest block.

That ordering is the whole architecture. The engine sees exactly what a reader of the
published export sees -- no more, and never the warehouse behind it -- so any action can be
recomputed by hand from files that are in the repository. It also means the stage needs no
database, which is why ``--check`` can re-derive the queue offline and compare it byte for
byte with what is committed.

WHY A RULE-FILE CHANGE MUST STALE THE EXPORT
--------------------------------------------
``config/dashboard/action_rules.yaml`` is an INPUT to the published data, exactly as the
warehouse is. Edit a review threshold and the queue changes even though no business fact
moved. If the check only compared dataset bytes, a developer could change a rule, leave the
old queue committed, and the repository would keep asserting a queue no rule now produces.
So the offline check re-runs the engine from the current rule file and fails on any
difference, and the manifest records the rule file's hash so the committed queue can always
be traced to the ruleset that made it.

The hashes do not chain circularly: the rule file's hash and the action file's hash are both
recorded IN the manifest, and neither is computed OVER the manifest.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from arpi.dashboard import contract as spec
from arpi.dashboard.action_rules import Ruleset, load_ruleset
from arpi.dashboard.actions import (
    ACTIONS_FILE_NAME,
    ACTIONS_SCHEMA,
    Action,
    ActionEngineError,
    SuppressionReason,
    evaluate_ruleset,
    queue_counts,
    render_actions,
)
from arpi.dashboard.serialization import content_sha256, render_dataset_bytes

__all__ = [
    "ACTIONS_MANIFEST_KEY",
    "ActionStage",
    "build_action_stage",
    "check_action_stage",
    "load_exported_datasets",
]

#: The manifest key carrying everything about the action queue.
ACTIONS_MANIFEST_KEY: Final = "management_actions"

#: The dataset whose component enumeration the change-driver policy is validated against.
_BRIDGE_DATASET: Final = "gross-change-bridge"


@dataclass(frozen=True, slots=True)
class ActionStage:
    """The stage's output.

    Attributes:
        payload: The action file's exact bytes.
        manifest_block: The manifest entry describing the queue and its ruleset.
        actions: The queue, in published order.
        suppressed: Every candidate that matched a condition but was vetoed.
        ruleset: The ruleset that produced it.
    """

    payload: bytes
    manifest_block: dict[str, Any]
    actions: tuple[Action, ...]
    suppressed: tuple[SuppressionReason, ...]
    ruleset: Ruleset


def load_exported_datasets(
    output_dir: Path, names: Sequence[str]
) -> dict[str, list[dict[str, Any]]]:
    """Read named datasets back from a committed export directory.

    Chunking is a portfolio-transformer concern; the root export writes one file per
    dataset, so this is a plain read. It exists so the offline check can feed the engine
    the same rows the generator fed it.

    Args:
        output_dir: The export directory.
        names: Dataset names to read.

    Returns:
        Dataset name to its records.

    Raises:
        ActionEngineError: If a required dataset file is missing or unreadable, which
            means the queue cannot be re-derived and the check must not pass.
    """
    datasets: dict[str, list[dict[str, Any]]] = {}
    for name in names:
        path = output_dir / f"{name}.json"
        try:
            payload = json.loads(path.read_bytes().decode("utf-8"))
        except (OSError, ValueError) as error:
            raise ActionEngineError(
                f"cannot read {path} to re-derive the management-action queue: {error}"
            ) from error
        if not isinstance(payload, list):
            raise ActionEngineError(f"{path} does not contain a JSON array")
        datasets[name] = [row for row in payload if isinstance(row, dict)]
    return datasets


def _assert_bridge_is_present(datasets: Mapping[str, Sequence[Mapping[str, Any]]]) -> None:
    """Refuse a change-driver policy whose components the export does not carry."""
    rows = datasets.get(_BRIDGE_DATASET)
    if rows is None:
        raise ActionEngineError(
            f"{_BRIDGE_DATASET} was not supplied; the change-driver policy is validated "
            "against the components the export actually publishes"
        )


def build_action_stage(
    datasets: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    as_of_date: str,
    dataset_version: int,
    repo_root: Path,
    ruleset: Ruleset | None = None,
) -> ActionStage:
    """Evaluate the rule file and assemble the queue artifact and its manifest block.

    Args:
        datasets: Exported dataset name to its records. Must include every dataset an
            enabled rule reads, plus the gross-change bridge.
        as_of_date: The export's as-of date.
        dataset_version: The export's dataset version.
        repo_root: Repository root, for locating the rule file.
        ruleset: A pre-loaded ruleset, supplied by tests. Production loads from disk.

    Returns:
        The stage output.

    Raises:
        ActionEngineError: If the engine cannot honestly produce a queue.
        RuleError: If the rule file is invalid.
    """
    rules = ruleset if ruleset is not None else load_ruleset(repo_root=repo_root)
    _assert_bridge_is_present(datasets)
    actions, suppressed = evaluate_ruleset(
        rules,
        datasets,
        as_of_date=as_of_date,
        dataset_version=dataset_version,
    )
    payload = render_dataset_bytes(render_actions(actions))
    materiality = rules.change_drivers.materiality
    block: dict[str, Any] = {
        "schema": ACTIONS_SCHEMA,
        "file": ACTIONS_FILE_NAME,
        "file_sha256": content_sha256(payload),
        "file_bytes": len(payload),
        "row_count": len(actions),
        "as_of_date": as_of_date,
        "ruleset": {
            "schema": rules.schema,
            "ruleset_version": rules.ruleset_version,
            "file": rules.path,
            "file_sha256": rules.file_sha256,
            "expiry": rules.expiry,
            "rule_count": len(rules.rules),
            "enabled_rule_ids": [rule.rule_id for rule in rules.enabled],
            "disabled_rule_ids": [rule.rule_id for rule in rules.disabled],
        },
        "source_datasets": list(rules.source_datasets),
        "counts": queue_counts(actions),
        "change_drivers": {
            "authority": rules.change_drivers.authority,
            "dataset": rules.change_drivers.dataset,
            "decomposition_order": list(rules.change_drivers.decomposition_order),
            "materiality": {
                "value": format(materiality.value, "f"),
                "units": materiality.units,
                "label": materiality.label,
                "rationale": materiality.rationale,
            },
        },
        "boundaries": [
            "Actions are review prompts produced by a deterministic rule file, not "
            "findings, recommendations of business action, or evidence of real-world "
            "conditions.",
            "The queue is stateless. It is regenerated with every dataset version, holds "
            "no history, and carries no acknowledgement, assignment or completion.",
            "No language model, learned model or scoring heuristic takes any part in producing it.",
            "Every threshold the rule file owns is a project default for a fictional "
            "dealer group, never an industry benchmark, an OEM standard or a compliance "
            "requirement.",
        ],
    }
    return ActionStage(
        payload=payload,
        manifest_block=block,
        actions=tuple(actions),
        suppressed=tuple(suppressed),
        ruleset=rules,
    )


def _check_ruleset_block(
    block: Mapping[str, Any], stage: ActionStage, ruleset: Ruleset
) -> list[str]:
    """Compare the manifest's recorded ruleset identity with the rule file in the tree."""
    committed = block.get("ruleset")
    if not isinstance(committed, Mapping):
        return [f"the manifest's {ACTIONS_MANIFEST_KEY} block carries no ruleset."]
    problems: list[str] = []
    if committed.get("file_sha256") != ruleset.file_sha256:
        problems.append(
            f"the manifest records ruleset hash {committed.get('file_sha256')!r}; "
            f"{ruleset.path} now hashes to {ruleset.file_sha256!r}. The committed queue "
            "was produced by a different ruleset than the one in the tree."
        )
    for field_name in ("enabled_rule_ids", "disabled_rule_ids"):
        expected = stage.manifest_block["ruleset"][field_name]
        if list(committed.get(field_name) or []) != expected:
            problems.append(
                f"the manifest's {ACTIONS_MANIFEST_KEY}.ruleset.{field_name} disagrees "
                "with the current rule file."
            )
    return problems


def check_action_stage(
    output_dir: Path,
    manifest: Mapping[str, Any],
    *,
    repo_root: Path,
) -> list[str]:
    """Re-derive the queue from the committed export and compare it with what is committed.

    This is the gate that makes the rule file a governed input. It reads the datasets the
    current rule file names, runs the engine, and requires the resulting bytes, hash, row
    count, ruleset hash and counts to match the committed artifact exactly.

    Args:
        output_dir: The export directory.
        manifest: The committed manifest.
        repo_root: Repository root, for locating the rule file.

    Returns:
        Problem messages. Empty exactly when the committed queue is the queue the current
        ruleset produces from the committed data.
    """
    problems: list[str] = []
    block = manifest.get(ACTIONS_MANIFEST_KEY)
    if not isinstance(block, Mapping):
        return [
            f"the manifest carries no {ACTIONS_MANIFEST_KEY!r} block. Run "
            "`python scripts/export_dashboard_dataset.py` against a loaded warehouse and "
            "commit the result."
        ]

    as_of_date = manifest.get("as_of_date")
    dataset_version = manifest.get("dataset_version")
    if not isinstance(as_of_date, str) or not isinstance(dataset_version, int):
        return ["the manifest's as_of_date or dataset_version is unusable"]

    try:
        ruleset = load_ruleset(repo_root=repo_root)
        needed = sorted({*ruleset.source_datasets, _BRIDGE_DATASET})
        datasets = load_exported_datasets(output_dir, needed)
        stage = build_action_stage(
            datasets,
            as_of_date=as_of_date,
            dataset_version=dataset_version,
            repo_root=repo_root,
            ruleset=ruleset,
        )
    except ActionEngineError as error:
        return [f"the management-action queue could not be re-derived: {error}"]

    committed_path = output_dir / ACTIONS_FILE_NAME
    try:
        committed = committed_path.read_bytes()
    except OSError as error:
        return [f"cannot read {committed_path}: {error}"]

    if committed != stage.payload:
        problems.append(
            f"{ACTIONS_FILE_NAME} is stale: the committed queue is not the queue "
            f"{ruleset.path} produces from the committed datasets. A rule change is a data "
            "change; regenerate the export and commit it."
        )
    for field_name in ("file_sha256", "file_bytes", "row_count"):
        if block.get(field_name) != stage.manifest_block[field_name]:
            problems.append(
                f"the manifest's {ACTIONS_MANIFEST_KEY}.{field_name} is "
                f"{block.get(field_name)!r}; the re-derived queue reports "
                f"{stage.manifest_block[field_name]!r}."
            )
    problems.extend(_check_ruleset_block(block, stage, ruleset))

    if block.get("counts") != stage.manifest_block["counts"]:
        problems.append(
            f"the manifest's {ACTIONS_MANIFEST_KEY}.counts disagree with the re-derived queue."
        )
    if block.get("change_drivers") != stage.manifest_block["change_drivers"]:
        problems.append(
            f"the manifest's {ACTIONS_MANIFEST_KEY}.change_drivers disagree with {ruleset.path}."
        )
    if block.get("schema") != ACTIONS_SCHEMA:
        problems.append(
            f"the manifest declares action schema {block.get('schema')!r}, expected "
            f"{ACTIONS_SCHEMA!r}."
        )
    declared_sources = list(block.get("source_datasets") or [])
    unknown = [name for name in declared_sources if name not in spec.DATASET_NAMES]
    if unknown:
        problems.append(
            f"the action queue declares source dataset(s) {unknown!r} that the export "
            "contract does not publish."
        )
    return problems
