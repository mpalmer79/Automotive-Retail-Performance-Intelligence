"""Assembling the roster into ``warehouse.dim_employee`` rows.

Turns assignments into Slowly Changing Dimension Type 2 versions: one row per employee
role-assignment version, the earlier expired the day before the change, the latest
carrying the open-ended ``9999-12-31`` sentinel.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

import pandas as pd

from arpi.constants import SENTINEL_EXPIRATION_DATE, SOURCE_SYSTEM
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.employee.calculations import (
    department_for_role,
    employee_attribute_hash,
    is_manager_for_role,
    tenure_band_for,
)
from arpi.generation.employee.contract import (
    DIM_EMPLOYEE_COLUMNS,
    DIM_EMPLOYEE_DTYPES,
    EMPLOYEE_NAMESPACE,
    ENTITY_DIM_EMPLOYEE,
)
from arpi.generation.employee.roster import build_employee_assignments

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig
    from arpi.generation.employee.models import EmployeeAssignment


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class EmployeeGenerator(BaseGenerator):
    """Build every SCD Type 2 version of every synthetic employee."""

    entity_name = ENTITY_DIM_EMPLOYEE
    declared_columns = DIM_EMPLOYEE_COLUMNS
    namespace = EMPLOYEE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the employee frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 15 contract columns, in order, sorted by ``employee_id`` then
            ``effective_date``, with ``employee_key`` assigned as a deterministic ordinal
            over that ordering.
        """
        window_end = config.reporting.end_date
        records: list[dict[str, Any]] = []
        for assignment in build_employee_assignments(config):
            records.extend(_versions_for(assignment, window_end))
        records.sort(key=lambda row: (row["employee_id"], row["effective_date"]))
        for employee_key, record in enumerate(records, start=1):
            record["employee_key"] = employee_key
        frame = pd.DataFrame.from_records(records, columns=list(DIM_EMPLOYEE_COLUMNS))
        return frame.astype(DIM_EMPLOYEE_DTYPES)


def generate_employee_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_employee`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return EmployeeGenerator().generate(config)


def _versions_for(assignment: EmployeeAssignment, window_end: date) -> list[dict[str, Any]]:
    """Render one person as their one or two contiguous SCD Type 2 versions."""
    tenure_band = tenure_band_for(assignment.hire_date, window_end)
    versions: list[dict[str, Any]] = []
    if assignment.change_date is not None:
        versions.append(
            _version_row(
                assignment,
                dealership_id=str(assignment.prior_dealership_id),
                job_role=str(assignment.prior_job_role),
                termination_date=None,
                tenure_band=tenure_band,
                effective_date=assignment.hire_date,
                expiration_date=assignment.change_date - timedelta(days=1),
                is_current=False,
            )
        )
    versions.append(
        _version_row(
            assignment,
            dealership_id=assignment.dealership_id,
            job_role=assignment.job_role,
            termination_date=assignment.termination_date,
            tenure_band=tenure_band,
            effective_date=assignment.change_date or assignment.hire_date,
            expiration_date=SENTINEL_EXPIRATION_DATE,
            is_current=True,
        )
    )
    return versions


def _version_row(
    assignment: EmployeeAssignment,
    *,
    dealership_id: str,
    job_role: str,
    termination_date: date | None,
    tenure_band: str,
    effective_date: date,
    expiration_date: date,
    is_current: bool,
) -> dict[str, Any]:
    """Render one SCD Type 2 version as a ``dim_employee`` row (minus ``employee_key``)."""
    department = department_for_role(job_role)
    is_manager = is_manager_for_role(job_role)
    is_active = termination_date is None
    return {
        "employee_key": 0,
        "employee_id": assignment.employee_id,
        "dealership_id": dealership_id,
        "department": department,
        "job_role": job_role,
        "hire_date": assignment.hire_date,
        "termination_date": termination_date,
        "is_active": is_active,
        "is_manager": is_manager,
        "tenure_band": tenure_band,
        "effective_date": effective_date,
        "expiration_date": expiration_date,
        "is_current": is_current,
        "attribute_hash": employee_attribute_hash(
            dealership_id,
            department,
            job_role,
            assignment.hire_date,
            termination_date,
            is_active=is_active,
            is_manager=is_manager,
        ),
        "source_system": SOURCE_SYSTEM,
    }
