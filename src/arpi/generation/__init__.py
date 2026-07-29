"""Synthetic data generators for the ARPI warehouse.

Every Phase 1 dimension is implemented here, together with the two pre-warehouse source
entities that feed the facts -- ``acquisition_event`` and ``sale_event``. The remaining
source entities (``lead``, ``appointment``, ``marketing_spend_event``) have generators or
reserved ingestion specs but no warehouse target yet, so their facts are **Planned**, not
implemented.

The CSV and manifest writer lives in :mod:`arpi.generation.writer`.
"""

from __future__ import annotations

from arpi.generation.acquisition import (
    AcquisitionGenerator,
    generate_acquisition_dataset,
)
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.calendar import CalendarDateGenerator, generate_date_dataset
from arpi.generation.customer import CustomerGenerator, generate_customer_dataset
from arpi.generation.dealership import DealershipGenerator, generate_dealership_dataset
from arpi.generation.employee import EmployeeGenerator, generate_employee_dataset
from arpi.generation.lead_source import LeadSourceGenerator, generate_lead_source_dataset
from arpi.generation.marketing import (
    MarketingCampaignGenerator,
    MarketingSpendGenerator,
    generate_marketing_campaign_dataset,
    generate_marketing_spend_dataset,
)
from arpi.generation.sale import SaleGenerator, generate_sale_dataset
from arpi.generation.vehicle import VehicleGenerator, generate_vehicle_dataset
from arpi.generation.vehicle_model import (
    VehicleModelGenerator,
    generate_vehicle_model_dataset,
)

__all__ = [
    "AcquisitionGenerator",
    "BaseGenerator",
    "CalendarDateGenerator",
    "CustomerGenerator",
    "DealershipGenerator",
    "EmployeeGenerator",
    "GeneratedDataset",
    "LeadSourceGenerator",
    "MarketingCampaignGenerator",
    "MarketingSpendGenerator",
    "SaleGenerator",
    "VehicleGenerator",
    "VehicleModelGenerator",
    "generate_acquisition_dataset",
    "generate_customer_dataset",
    "generate_date_dataset",
    "generate_dealership_dataset",
    "generate_employee_dataset",
    "generate_lead_source_dataset",
    "generate_marketing_campaign_dataset",
    "generate_marketing_spend_dataset",
    "generate_sale_dataset",
    "generate_vehicle_dataset",
    "generate_vehicle_model_dataset",
]
