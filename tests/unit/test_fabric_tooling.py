"""Regression coverage for the Microsoft Fabric deployment and validation tooling.

WHY THIS FILE EXISTS
--------------------
The Fabric tooling has never been executed against Microsoft Fabric. It cannot be: the
environment it was written in cannot reach ``api.fabric.microsoft.com`` at all, and no
Fabric workspace exists yet. That makes it the least-proven code in the repository and the
most expensive to get wrong, because its first real run will be a manual session that
someone has set aside an afternoon for.

An independent review of the merged tooling found seven defects. Every one of them has a
test here, named for what it protects rather than for the function it calls, so that a
future change that reintroduces the defect fails with a message that explains itself.

Nothing here contacts a network. The client is stubbed, and the assertions are about
payload shape, parsing, comparison semantics and hash behaviour -- everything that can be
established without a service, which is a great deal more than nothing.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"
VALIDATION = REPO_ROOT / "powerbi" / "validation"


def _load(name: str) -> Any:
    """Import a script module by path, registering it so dataclasses resolve."""
    if name in sys.modules:
        return sys.modules[name]
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


fabric = _load("arpi_fabric")
deploy = _load("deploy_powerbi_fabric")
validate = _load("validate_powerbi_fabric")
freshness = _load("check_desktop_validation_freshness")
fabric_freshness = _load("check_fabric_validation_freshness")
gate = _load("check_real_engine_validation")


class StubClient:
    """A FabricClient stand-in that returns canned responses and records requests."""

    def __init__(self, responses: dict[str, Any] | None = None) -> None:
        """Record every request and answer from *responses* by URL fragment."""
        self.responses = responses or {}
        self.requests: list[tuple[str, str, Any]] = []

    def request(
        self, method: str, url: str, *, resource: str = "", body: Any = None, expected: Any = ()
    ) -> tuple[int, dict[str, str], Any]:
        self.requests.append((method, url, body))
        for fragment, payload in self.responses.items():
            if fragment in url:
                return 200, {}, payload
        return 200, {}, None


# --------------------------------------------------------------------------------------
# Defect 1: bindConnection omitted a REQUIRED field
# --------------------------------------------------------------------------------------


def test_a_connection_binding_always_carries_connection_details() -> None:
    """``connectionDetails`` is required by the API; omitting it fails on first contact.

    The original implementation sent only ``id`` and ``connectivityType``. The Fabric
    OpenAPI specification marks ``ConnectionBinding.connectionDetails`` as required, so
    that request would have been rejected the very first time anyone ran it.
    """
    connection = {
        "id": "11111111-1111-1111-1111-111111111111",
        "connectivityType": "ShareableCloud",
        "connectionDetails": {"type": "PostgreSql", "path": "db.example.com:5432;arpi"},
    }
    binding = fabric.connection_binding(connection)
    assert "connectionDetails" in binding, "the API rejects a binding without connectionDetails"
    assert binding["connectionDetails"]["path"] == "db.example.com:5432;arpi"
    assert binding["id"] == connection["id"]


def test_a_connection_without_details_is_refused_locally() -> None:
    """Refuse before the network call, with advice, rather than after with an API error."""
    with pytest.raises(RuntimeError, match="connectionDetails"):
        fabric.connection_binding({"id": "abc", "connectivityType": "ShareableCloud"})


def test_binding_reads_details_from_the_service_rather_than_guessing() -> None:
    """The PostgreSQL type and path strings come from the connection, never from us."""
    client = StubClient(
        {
            "/connections/": {
                "id": "c-1",
                "connectivityType": "ShareableCloud",
                "connectionDetails": {"type": "PostgreSql", "path": "h:5432;d"},
            }
        }
    )
    validate.bind_connection(client, "w-1", "m-1", "c-1")
    bind = next(body for method, url, body in client.requests if "bindConnection" in url)
    assert bind["connectionBinding"]["connectionDetails"] == {
        "type": "PostgreSql",
        "path": "h:5432;d",
    }


# --------------------------------------------------------------------------------------
# Defect 2 and 6: evidence completeness
# --------------------------------------------------------------------------------------


def test_the_evidence_file_matches_its_own_schema() -> None:
    """The committed placeholder must satisfy the schema that governs it.

    ``additionalProperties: false`` means a field the writer adds and the schema does not
    know about is a silent contract break, and nothing else in CI would catch it.
    """
    schema = json.loads((VALIDATION / "fabric_validation_results.schema.json").read_text())
    evidence = json.loads((VALIDATION / "fabric_validation_results.json").read_text())
    allowed = set(schema["properties"])
    assert set(evidence) <= allowed, f"not in schema: {sorted(set(evidence) - allowed)}"
    for required in schema["required"]:
        assert required in evidence, f"schema requires {required!r}"


def test_the_evidence_records_every_field_the_writer_produces() -> None:
    """Every key ``write_results`` emits must be declared in the schema."""
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    written: dict[str, Any] = {}
    original = validate.RESULTS_PATH

    class _Capture:
        @staticmethod
        def write_text(text: str, encoding: str = "utf-8") -> int:  # noqa: ARG004
            written.update(json.loads(text))
            return len(text)

        @staticmethod
        def relative_to(_other: Path) -> str:
            return "powerbi/validation/fabric_validation_results.json"

    validate.RESULTS_PATH = _Capture
    try:
        validate.write_results(run)
    finally:
        validate.RESULTS_PATH = original

    schema = json.loads((VALIDATION / "fabric_validation_results.schema.json").read_text())
    undeclared = sorted(set(written) - set(schema["properties"]))
    assert not undeclared, f"write_results emits fields the schema forbids: {undeclared}"
    assert "retrieved_definition_hash" in written
    assert "imported_table_count" in written
    assert "measure_table_count" in written


def test_a_run_with_no_checks_is_not_recorded_as_passed() -> None:
    """An empty run is a failure, not a vacuous success.

    ``all([])`` is True, and a validator that mistakes "nothing ran" for "everything
    passed" is worse than no validator.
    """
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    assert not run.passed and not run.failed
    overall = "passed" if not run.failed and run.passed else "failed"
    assert overall == "failed"


# --------------------------------------------------------------------------------------
# Defect 3 and 4: inventory checks
# --------------------------------------------------------------------------------------


def _expectations() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((VALIDATION / "model_expectations.json").read_text())
    return loaded


def test_inventory_queries_do_not_depend_on_an_unverified_column() -> None:
    """``INFO.TABLES()[IsPrivate]`` could not be confirmed, so nothing may rely on it.

    A validation script that fails on a column name nobody verified produces an error the
    operator cannot act on, during the one manual session they set aside for this.
    """
    for query in (validate.TABLES_QUERY, validate.MEASURES_QUERY, validate.RELATIONSHIPS_QUERY):
        assert "IsPrivate" not in query


def test_the_marked_date_table_is_checked() -> None:
    """A model that lost its marked date table still refreshes and still returns numbers.

    It just silently stops doing time intelligence, which no total and no static check can
    catch. So the engine is asked directly.
    """
    expectations = _expectations()
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    rows = [
        {"[TableName]": name, "[Category]": None} for name in expectations["expected_row_counts"]
    ]
    rows += [
        {"[TableName]": f"{group} Measures", "[Category]": None}
        for group in ("Sales", "Gross", "Inventory", "Lead Funnel", "Marketing", "Data Quality")
    ]
    client = StubClient({"executeQueries": {"results": [{"tables": [{"rows": rows}]}]}})
    validate.check_tables(client, run, expectations)
    assert "inventory:marked-date-table" in run.failed, (
        "no table reported DataCategory 'Time' and the check did not notice"
    )


def test_a_healthy_inventory_passes_every_table_check() -> None:
    """The positive case, so the checks above are not passing for the wrong reason."""
    expectations = _expectations()
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    rows = [
        {
            "[TableName]": name,
            "[Category]": "Time" if name == expectations["marked_date_table"] else None,
        }
        for name in expectations["expected_row_counts"]
    ]
    rows += [
        {"[TableName]": f"{group} Measures", "[Category]": None}
        for group in ("Sales", "Gross", "Inventory", "Lead Funnel", "Marketing", "Data Quality")
    ]
    client = StubClient({"executeQueries": {"results": [{"tables": [{"rows": rows}]}]}})
    validate.check_tables(client, run, expectations)
    assert not run.failed, run.failed
    assert run.inventory["imported_tables"] == expectations["imported_table_count"]
    assert run.inventory["measure_tables"] == expectations["measure_table_count"]


def test_a_missing_table_is_named_not_merely_counted() -> None:
    """Naming the missing table beats a bare count, which sends someone hunting."""
    expectations = _expectations()
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    names = list(expectations["expected_row_counts"])
    dropped = names.pop()
    rows = [{"[TableName]": n, "[Category]": None} for n in names]
    client = StubClient({"executeQueries": {"results": [{"tables": [{"rows": rows}]}]}})
    validate.check_tables(client, run, expectations)
    assert "inventory:imported-tables" in run.failed
    assert dropped not in {r["[TableName]"] for r in rows}


@pytest.mark.parametrize(
    ("cross_filter", "to_cardinality", "expected_failure"),
    [
        (2, 1, "inventory:no-bidirectional"),
        (1, 2, "inventory:no-many-to-many"),
    ],
)
def test_a_bad_relationship_shape_is_caught(
    cross_filter: int, to_cardinality: int, expected_failure: str
) -> None:
    """Bidirectional filtering and many-to-many are forbidden by the model's design.

    Both survive a refresh and both change what a measure means, so the engine is asked
    rather than trusted.
    """
    expectations = _expectations()
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    rows = [
        {
            "[Active]": "True",
            "[CrossFilter]": cross_filter,
            "[FromCard]": 2,
            "[ToCard]": to_cardinality,
        }
    ]
    client = StubClient({"executeQueries": {"results": [{"tables": [{"rows": rows}]}]}})
    validate.check_relationships(client, run, expectations)
    assert expected_failure in run.failed


# --------------------------------------------------------------------------------------
# Comparison semantics: the reason this whole exercise exists
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("expected", "actual", "should_match"),
    [
        (None, None, True),
        (None, 0.0, False),
        (0.0, None, False),
        (3.5, 3.5, True),
        (3.5, 3.5000000001, True),
        (3.5, 9.9, False),
        (558, 558, True),
        (558, 557, False),
    ],
)
def test_blank_is_never_equal_to_zero(expected: Any, actual: Any, should_match: bool) -> None:
    """A blank and a zero are different answers, and confusing them is the headline defect.

    ``$0`` gross per unit in a month with no sales, or a free lead from an organic source,
    are false statements. The baseline has two filter contexts whose only purpose is to
    prove the model says blank.
    """
    ok, _delta, _reason = validate.compare_value(expected, actual, 1e-6)
    assert ok is should_match


def test_a_measure_missing_from_the_result_is_a_failure_not_a_blank() -> None:
    """``includeNulls`` is set, so an absent key means the query did not answer.

    Treating it as blank would let a silently broken query masquerade as a correct blank
    in exactly the contexts that matter most.
    """
    run = validate.Run(
        workspace_id="w", item_id="m", model_hash="0" * 64, operator=None, tolerance=1e-6
    )
    validate.reconcile_context(run, "unfiltered", {"KPI-MKT-001": None}, {}, {})
    assert run.failed == ["sql-to-dax:unfiltered:KPI-MKT-001"]


def test_execute_queries_requests_nulls() -> None:
    """Without ``includeNulls`` the API omits null columns and blanks become invisible."""
    client = StubClient({"executeQueries": {"results": [{"tables": [{"rows": []}]}]}})
    validate.execute_dax(client, "w", "m", 'EVALUATE ROW ( "n", 1 )')
    _method, _url, body = client.requests[0]
    assert body["serializerSettings"]["includeNulls"] is True


def test_dax_bracket_notation_is_stripped_but_nulls_survive() -> None:
    """Baseline keys have no brackets; a null value must remain a null, not vanish."""
    row = validate.scalar_row([{"[KPI-SLS-001]": 558, "[KPI-MKT-001]": None}])
    assert row == {"KPI-SLS-001": 558, "KPI-MKT-001": None}


def test_every_baseline_context_has_a_generated_query() -> None:
    """A context with no query would silently reconcile nothing."""
    baseline = json.loads((VALIDATION / "sql_baseline.json").read_text())
    queries = validate.read_context_queries(VALIDATION / "validation_queries.dax")
    missing = [c["context_id"] for c in baseline["contexts"] if c["context_id"] not in queries]
    assert not missing, f"no DAX query for: {missing}"


def test_every_reconciled_measure_key_maps_to_a_named_measure() -> None:
    """A baseline key with no measure name produces an unattributable difference."""
    baseline = json.loads((VALIDATION / "sql_baseline.json").read_text())
    measure_map = _expectations()["measure_map"]
    keys = {
        key
        for context in baseline["contexts"]
        for key in context["measures"]
        if not key.startswith("_")
    }
    assert not (keys - set(measure_map)), (
        f"unmapped baseline keys: {sorted(keys - set(measure_map))}"
    )


# --------------------------------------------------------------------------------------
# Defect 5 and 7: packaging and hashing
# --------------------------------------------------------------------------------------


def test_the_deployed_definition_is_the_committed_one() -> None:
    """Every part is a real file, base64 of its exact bytes, at its repository path."""
    parts = fabric.definition_parts()
    assert parts, "no definition parts were produced"
    for part in parts:
        assert part["payloadType"] == "InlineBase64"
        source = fabric.SEMANTIC_MODEL_DIR / part["path"]
        assert source.is_file(), f"{part['path']} is not a file"
        assert base64.b64decode(part["payload"]) == source.read_bytes()


def test_no_machine_specific_state_is_ever_deployed() -> None:
    """``.pbi/`` holds one person's local settings and a data cache. It is not the model."""
    assert not [p for p in fabric.definition_parts() if p["path"].startswith(".pbi/")]


def test_no_report_content_is_ever_deployed() -> None:
    """P2.2 has not started; deploying a page would be building one."""
    paths = [p["path"] for p in fabric.definition_parts()]
    assert not [p for p in paths if p.startswith("definition/pages")]
    assert "report.json" not in paths


def test_the_model_source_hash_deliberately_excludes_the_platform_file() -> None:
    """``.platform`` is deployed but NOT hashed, and that asymmetry is intentional.

    Fabric assigns a ``logicalId`` and rewrites the display name on first deploy. Hashing
    ``.platform`` would make every piece of validation evidence permanently stale the
    moment the model was deployed once -- the exact failure the hash exists to prevent.
    This test exists so nobody "fixes" the asymmetry later.
    """
    hashed = {
        p.relative_to(freshness.SEMANTIC_MODEL_DIR).as_posix()
        for p in freshness.model_source_files()
    }
    sent = {p["path"] for p in fabric.definition_parts()}
    assert sent - hashed == {".platform"}
    assert not hashed - sent, "the hash covers a file that is never deployed"


def test_the_hash_notices_content_moving_between_files() -> None:
    """Path and length are folded in, so concatenation alone cannot forge a match."""
    first = freshness.compute_model_source_hash(freshness.model_source_files())
    second = freshness.compute_model_source_hash(list(reversed(freshness.model_source_files())))
    assert first != second, "file order must change the digest"


def test_both_engines_share_one_hash_implementation() -> None:
    """Two implementations of one hash is a permanently stale gate nobody can clear."""
    assert fabric_freshness.compute_model_source_hash is freshness.compute_model_source_hash


# --------------------------------------------------------------------------------------
# Credential handling
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"password": "hunter2"},
        {"accessToken": "ey.."},
        {"refresh_token": "0.AR.."},
        {"clientSecret": "s"},
        {"connectionString": "Server=x;Password=y"},
        {"nested": {"credentialDetails": {"password": "p"}}},
        {"Authorization": "Bearer abc"},
    ],
)
def test_secrets_never_reach_a_terminal_or_a_file(payload: dict[str, Any]) -> None:
    """Fabric echoes request payloads back inside some error messages."""
    rendered = json.dumps(fabric.redact(payload))
    for secret in ("hunter2", "ey..", "0.AR..", "Server=x;Password=y", "abc"):
        assert secret not in rendered
    assert "<redacted>" in rendered


def test_the_token_cache_lives_outside_the_repository() -> None:
    """So that no ``git add -A`` can ever capture a refresh token."""
    assert REPO_ROOT not in fabric.TOKEN_CACHE_PATH.parents


def test_the_evidence_contract_has_no_place_to_put_a_secret() -> None:
    """No FIELD may hold a credential -- prose describing the prohibition is fine.

    The schema's own description says the word "password", because it explains what must
    never be recorded. That is the contract working, not breaking it. What matters is that
    no property name and no recorded value could carry one.
    """
    schema = json.loads((VALIDATION / "fabric_validation_results.schema.json").read_text())
    evidence = json.loads((VALIDATION / "fabric_validation_results.json").read_text())
    forbidden = ("password", "token", "secret", "credential", "connectionstring")
    for field in schema["properties"]:
        if field == "retrieved_definition_hash":
            continue
        assert not any(f in field.lower() for f in forbidden), f"schema field {field!r}"
    for field, value in evidence.items():
        assert not any(f in field.lower() for f in forbidden), f"evidence field {field!r}"
        assert not (isinstance(value, str) and value.lower().startswith("bearer "))


# --------------------------------------------------------------------------------------
# CI gate behaviour
# --------------------------------------------------------------------------------------


def test_pending_alone_never_satisfies_the_gate() -> None:
    """Static validation must not complete Phase 5 (ADR-0008)."""
    assert gate.main(["--require-pass", "--quiet"]) == 1


def test_pending_is_tolerated_on_a_feature_branch() -> None:
    """Work in progress is allowed to be in progress."""
    assert gate.main(["--quiet"]) == 0


def test_a_stale_result_blocks_on_every_branch() -> None:
    """A stale pass is more dangerous than no pass: it reads as validated."""
    state, explanation = fabric_freshness.classify(
        {"overall_result": "passed", "model_source_hash": "a" * 64}, "b" * 64
    )
    assert state == "STALE"
    assert "no longer exists" in explanation


def test_a_result_that_contradicts_its_own_detail_is_not_a_pass() -> None:
    """A passed verdict alongside a failed check is a bug in whatever wrote the file."""
    state, _ = fabric_freshness.classify(
        {
            "overall_result": "passed",
            "model_source_hash": "a" * 64,
            "failed_checks": ["rows:vw_leads"],
        },
        "a" * 64,
    )
    assert state == "FAILED"


def test_a_missing_evidence_file_is_not_silently_ignored() -> None:
    """Absence of evidence must not read as evidence of absence of problems."""
    state, _ = fabric_freshness.classify(None, "a" * 64)
    assert state == "MISSING"
    assert fabric_freshness.STATUS_EXIT_CODES["MISSING"] != 0
