"""The F&I privacy boundary: what DASH.6 must never model, and never name.

Two separate promises are held here.

**ARPI is not a lending model.** No APR, buy rate, sell rate, rate spread, money factor,
payment, loan term, approval, decline, stipulation, adverse-action reason, credit score,
credit file, income or debt-to-income figure exists anywhere in the F&I lane -- not as a
generated column, not as a warehouse column, and not as a reporting column. The tripwire
inspects the SCHEMA, so an empty ``apr`` column fails: the defect is claiming to model a
mechanic the platform does not have, not that a value is wrong.

**Every lender and every product administrator is invented.** This is a
SYNTHETIC-CATALOGUE CONTRACT TEST and deliberately not a claim to detect every real
institution in the world -- no such check is possible and pretending otherwise would be
the dishonest version. What it does assert is that the committed catalogues do not collide
with a list of institutions a reader would recognise, and that a real name planted into
the catalogue is caught.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import (
    PROHIBITED_PII_FIELD_NAMES,
    PROHIBITED_PII_SUBSTRINGS,
    PROHIBITED_PII_WORD_TOKENS,
)
from arpi.generation.finance_product import FICTIONAL_PROVIDERS, generate_finance_product_dataset
from arpi.generation.finance_product_adjustment import (
    generate_finance_product_adjustment_dataset,
)
from arpi.generation.finance_product_sale import generate_finance_product_sale_dataset
from arpi.generation.lender import LENDER_DEFINITIONS, generate_lender_dataset
from arpi.generation.sale import generate_sale_dataset
from arpi.validation.privacy import check_no_prohibited_pii_columns

REPO_ROOT = Path(__file__).resolve().parents[2]
SQL_ROOT = REPO_ROOT / "sql"

#: Lending and credit mechanics ARPI deliberately does not model. Checked as a substring
#: of a normalised identifier, so ``lender_buy_rate`` fails as surely as ``buy_rate``.
PROHIBITED_LENDING_MECHANICS: tuple[str, ...] = (
    "adverse_action",
    "annual_percentage_rate",
    "buy_rate",
    "credit_application",
    "credit_score",
    "credit_tier",
    "debt_to_income",
    "fico",
    "loan_to_value",
    "money_factor",
    "monthly_payment",
    "rate_markup",
    "rate_spread",
    "sell_rate",
    "stipulation",
)

#: The F&I SQL files whose column definitions must carry none of the above.
FI_SQL_FILES: tuple[str, ...] = (
    "01_raw/16_raw_finance_product_load.sql",
    "01_raw/17_raw_lender_load.sql",
    "01_raw/18_raw_finance_product_sale_load.sql",
    "01_raw/19_raw_finance_product_adjustment_load.sql",
    "03_dimensions/19_dim_finance_product.sql",
    "03_dimensions/20_dim_lender.sql",
    "04_facts/07_fact_finance_product_sale.sql",
    "04_facts/08_fact_finance_product_adjustment.sql",
)

#: Real financial institutions, used only to prove the fictional catalogue does not
#: collide with names a reader would recognise. NOT a completeness claim: no list can be
#: complete, and this one is a contract test over a catalogue of ten invented names.
REAL_INSTITUTIONS: tuple[str, ...] = (
    "ally",
    "americredit",
    "bank of america",
    "capital one",
    "chase",
    "citizens",
    "exeter",
    "ford credit",
    "gm financial",
    "honda financial",
    "hyundai motor finance",
    "jpmorgan",
    "navy federal",
    "nissan motor acceptance",
    "santander",
    "td auto finance",
    "toyota financial",
    "us bank",
    "wells fargo",
    "westlake",
)

#: Real F&I administrators and product programs, for the same purpose.
REAL_ADMINISTRATORS: tuple[str, ...] = (
    "assurant",
    "endurance",
    "ethos",
    "jm&a",
    "protective",
    "resource automotive",
    "safe-guard",
    "zurich",
)


@pytest.fixture(scope="module")
def config() -> ArpiConfig:
    return load_config(profile="test", config_dir=REPO_ROOT / "config")


# --------------------------------------------------------------------------------------
# No lending mechanic exists, at any layer
# --------------------------------------------------------------------------------------


def test_no_generated_fi_entity_declares_a_lending_mechanic(config: ArpiConfig) -> None:
    frames = {
        "dim_finance_product": generate_finance_product_dataset(config).frame,
        "dim_lender": generate_lender_dataset(config).frame,
        "finance_product_sale": generate_finance_product_sale_dataset(config).frame,
        "finance_product_adjustment": generate_finance_product_adjustment_dataset(config).frame,
        "sale_event": generate_sale_dataset(config).frame,
    }
    offending: list[str] = []
    for entity, frame in frames.items():
        for column in frame.columns:
            normalised = str(column).strip().lower().replace("-", "_").replace(" ", "_")
            offending.extend(
                f"{entity}.{column} (contains {token!r})"
                for token in PROHIBITED_LENDING_MECHANICS
                if token in normalised
            )
    assert offending == [], (
        f"the F&I lane declares lending mechanics ARPI does not model: {offending}. "
        "ARPI approves nothing, prices nothing and recommends nothing."
    )


def test_no_fi_sql_object_declares_a_lending_mechanic() -> None:
    """The warehouse side of the same promise, read from the DDL rather than a database.

    Only the column DEFINITIONS are inspected. The comments SHOULD say "no APR, buy rate
    or payment is modelled", repeatedly and prominently, and a check that searched the
    whole file would fail on correct writing.
    """
    column = re.compile(r"^\s{4}([a-z_][a-z0-9_]*)\s+[a-z]", re.MULTILINE)
    offending: list[str] = []
    for name in FI_SQL_FILES:
        text = (SQL_ROOT / name).read_text(encoding="utf-8")
        for match in column.finditer(text):
            identifier = match.group(1)
            offending.extend(
                f"{name}:{identifier} (contains {token!r})"
                for token in PROHIBITED_LENDING_MECHANICS
                if token in identifier
            )
    assert offending == [], f"F&I SQL declares lending mechanics: {offending}"


def test_the_platform_tripwire_covers_the_fi_vocabulary() -> None:
    """DASH.6 extended the shared vocabulary, so a future column fails on the schema."""
    vocabulary = (
        PROHIBITED_PII_FIELD_NAMES | PROHIBITED_PII_SUBSTRINGS | PROHIBITED_PII_WORD_TOKENS
    )
    for token in ("apr", "buy_rate", "sell_rate", "rate_spread", "credit_score", "fico",
                  "income", "stipulation", "adverse_action", "payment"):
        assert token in vocabulary, (
            f"{token!r} is not in the platform privacy vocabulary, so a column carrying it "
            "would reach the warehouse without failing a check"
        )


@pytest.mark.parametrize(
    "column",
    ["apr", "buy_rate", "sell_rate", "rate_spread", "monthly_payment", "credit_score",
     "fico_score", "household_income", "adverse_action_reason", "stipulations", "ssn"],
)
def test_a_planted_prohibited_column_fails_the_tripwire(
    config: ArpiConfig, column: str
) -> None:
    """Seeded defect. A tripwire that has never fired is a tripwire nobody has tested."""
    frame = generate_finance_product_sale_dataset(config).frame.copy()
    frame[column] = None
    result = check_no_prohibited_pii_columns(
        frame,
        check_id="DQ-FPS-016",
        check_name="finance_product_sale declares no prohibited personal-data column",
        target_object="finance_product_sale",
    )
    assert result.is_failure, (
        f"a {column!r} column reached the F&I fact without failing the privacy tripwire"
    )


def test_no_fi_entity_carries_a_customer_reference(config: ArpiConfig) -> None:
    """An F&I contract is the richest source of personal data in a real dealership.

    ARPI's carries none: no customer key, no customer identifier, nothing.
    """
    for frame in (
        generate_finance_product_sale_dataset(config).frame,
        generate_finance_product_adjustment_dataset(config).frame,
    ):
        assert not [name for name in frame.columns if "customer" in str(name).casefold()]


def test_the_adjustment_entity_carries_no_free_text_field(config: ArpiConfig) -> None:
    """A free-text reason is where somebody eventually writes something about a customer."""
    frame = generate_finance_product_adjustment_dataset(config).frame
    for forbidden in ("note", "notes", "comment", "comments", "reason_text", "description"):
        assert forbidden not in {str(name).casefold() for name in frame.columns}


# --------------------------------------------------------------------------------------
# Every institution and administrator is invented
# --------------------------------------------------------------------------------------


def test_no_committed_lender_name_collides_with_a_real_institution() -> None:
    """A synthetic-catalogue contract test, not a global trademark check.

    No check can prove a name is unused in the world. What this proves is narrower and
    genuinely useful: the ten names ARPI ships do not collide with institutions a reader
    would recognise, so no invented lender mix is ever attributed to a real company.
    """
    offending = [
        f"{definition.lender_name} matches {real!r}"
        for definition in LENDER_DEFINITIONS
        for real in REAL_INSTITUTIONS
        if real in definition.lender_name.casefold()
    ]
    assert offending == [], (
        f"a committed lender name resembles a real financial institution: {offending}. "
        "ARPI attaches invented lender mix and an invented program tier to every row, and "
        "attaching those to a real company would be a fabricated claim about it."
    )


def test_no_committed_provider_name_collides_with_a_real_administrator() -> None:
    offending = [
        f"{provider} matches {real!r}"
        for provider in FICTIONAL_PROVIDERS
        for real in REAL_ADMINISTRATORS
        if real in provider.casefold()
    ]
    assert offending == [], f"a committed provider name resembles a real administrator: {offending}"


def test_a_planted_real_lender_name_is_caught() -> None:
    """Seeded defect: the check above must be able to fail.

    Substituting a real institution into the catalogue is exactly the mistake that would
    otherwise ship quietly, because the row would look completely ordinary.
    """
    planted = "Wells Fargo Auto Finance"
    offending = [real for real in REAL_INSTITUTIONS if real in planted.casefold()]
    assert offending, (
        "the real-institution list did not match a name that is obviously one, so the "
        "contract test above is not proving anything"
    )


def test_every_lender_and_provider_name_is_unique() -> None:
    names = [definition.lender_name for definition in LENDER_DEFINITIONS]
    assert len(names) == len(set(names))
    assert len(FICTIONAL_PROVIDERS) == len(set(FICTIONAL_PROVIDERS))
