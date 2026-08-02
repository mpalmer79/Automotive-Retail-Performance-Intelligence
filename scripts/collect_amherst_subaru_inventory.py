"""Collect every Amherst Subaru listing exposed by the Cars.com dealer inventory."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

INVENTORY_URL = "https://www.cars.com/dealers/156767/amherst-subaru/inventory/"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)
ARRAY_MARKER = '"search_type":"general-inventory-search","vehicle_array":'


def parse_vehicle_array(html: str) -> list[dict[str, Any]]:
    marker_index = html.find(ARRAY_MARKER)
    if marker_index < 0:
        raise RuntimeError("Cars.com vehicle array was not found in the page source")
    array_start = marker_index + len(ARRAY_MARKER)
    parsed, _ = json.JSONDecoder().raw_decode(html[array_start:])
    if not isinstance(parsed, list):
        raise RuntimeError("Cars.com vehicle array was not a JSON list")
    return [row for row in parsed if isinstance(row, dict)]


def parse_total(html: str) -> int:
    patterns = (
        r"([0-9][0-9,]*)\s+vehicles\s+for\s+sale",
        r"See all\s+([0-9][0-9,]*)\s+vehicles",
    )
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE)
        if match:
            return int(match.group(1).replace(",", ""))
    raise RuntimeError("Cars.com inventory total was not found")


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
    )
    return session


def fetch_page(session: requests.Session, page: int, page_size: int) -> str:
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            response = session.get(
                INVENTORY_URL,
                params={"page": page, "page_size": page_size},
                timeout=45,
            )
            response.raise_for_status()
            if ARRAY_MARKER not in response.text:
                raise RuntimeError(
                    f"Cars.com returned HTML without inventory data on page {page}"
                )
            return response.text
        except (requests.RequestException, RuntimeError) as error:
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"Unable to retrieve Cars.com inventory page {page}") from last_error


def normalize(row: dict[str, Any], captured_at: str) -> dict[str, Any]:
    condition = str(row.get("stock_type") or "").strip()
    year = int(row["year"]) if str(row.get("year") or "").isdigit() else None
    make = str(row.get("make") or "").strip()
    model = str(row.get("model") or "").strip()
    trim = str(row.get("trim") or "").strip()
    mileage_text = str(row.get("mileage") or "").replace(",", "").strip()
    price_text = str(row.get("price") or "").replace(",", "").strip()
    mileage = int(float(mileage_text)) if mileage_text else None
    advertised_price = int(float(price_text)) if price_text else None
    listing_id = str(row.get("listing_id") or "").strip()
    vin = str(row.get("vin") or "").strip()
    source_url = f"https://www.cars.com/vehicledetail/{listing_id}/" if listing_id else ""
    vehicle = " ".join(
        value for value in (str(year) if year else "", make, model, trim) if value
    )
    return {
        "condition": condition,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "vehicle": vehicle,
        "mileage": mileage,
        "advertised_price": advertised_price,
        "price_status": "Listed" if advertised_price is not None else "Call for price",
        "vin": vin,
        "listing_id": listing_id,
        "source_url": source_url,
        "certified": bool(row.get("certified_preowned") or row.get("cpo_indicator")),
        "exterior_color": str(row.get("exterior_color") or "").strip(),
        "interior_color": str(row.get("interior_color") or "").strip(),
        "fuel_type": str(row.get("fuel_type") or "").strip(),
        "drivetrain": str(row.get("drivetrain") or "").strip(),
        "body_style": str(row.get("bodystyle") or "").strip(),
        "captured_at": captured_at,
    }


def collect(page_size: int, debug_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    session = build_session()
    first_html = fetch_page(session, 1, page_size)
    debug_dir.mkdir(parents=True, exist_ok=True)
    (debug_dir / "page-1.html").write_text(first_html, encoding="utf-8")

    expected = parse_total(first_html)
    first_rows = parse_vehicle_array(first_html)
    actual_page_size = len(first_rows)
    if actual_page_size < 1:
        raise RuntimeError("Cars.com page 1 contained no inventory records")

    total_pages = math.ceil(expected / actual_page_size)
    source_rows = list(first_rows)
    for page in range(2, total_pages + 1):
        html = fetch_page(session, page, page_size)
        page_rows = parse_vehicle_array(html)
        if not page_rows:
            raise RuntimeError(f"Cars.com page {page} contained no records")
        source_rows.extend(page_rows)

    captured_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    records_by_key: dict[str, dict[str, Any]] = {}
    for source_row in source_rows:
        normalized = normalize(source_row, captured_at)
        key = normalized["vin"] or normalized["listing_id"]
        if key:
            records_by_key[key] = normalized

    records = sorted(
        records_by_key.values(),
        key=lambda row: (
            row["condition"],
            -(row["year"] or 0),
            row["make"],
            row["model"],
            row["trim"],
            row["vin"],
        ),
    )
    metadata = {
        "source": INVENTORY_URL,
        "captured_at": captured_at,
        "expected_records": expected,
        "raw_records": len(source_rows),
        "unique_records": len(records),
        "requested_page_size": page_size,
        "actual_page_size": actual_page_size,
        "pages_retrieved": total_pages,
        "new_records": sum(row["condition"].lower() == "new" for row in records),
        "used_records": sum(row["condition"].lower() == "used" for row in records),
        "cpo_records": sum(bool(row["certified"]) for row in records),
    }
    return records, metadata


def write_outputs(records: list[dict[str, Any]], metadata: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    fields = [
        "condition",
        "year",
        "make",
        "model",
        "trim",
        "vehicle",
        "mileage",
        "advertised_price",
        "price_status",
        "vin",
        "listing_id",
        "source_url",
        "certified",
        "exterior_color",
        "interior_color",
        "fuel_type",
        "drivetrain",
        "body_style",
        "captured_at",
    ]
    with (output_dir / "amherst_subaru_inventory_complete.csv").open(
        "w", encoding="utf-8", newline=""
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(records)
    (output_dir / "amherst_subaru_inventory_complete.json").write_text(
        json.dumps(records, indent=2), encoding="utf-8"
    )
    (output_dir / "amherst_subaru_inventory_metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/amherst-inventory"))
    parser.add_argument("--page-size", type=int, default=72)
    parser.add_argument("--minimum-count", type=int, default=250)
    args = parser.parse_args()

    records, metadata = collect(args.page_size, args.output_dir / "debug")
    write_outputs(records, metadata, args.output_dir)
    if len(records) != metadata["expected_records"]:
        raise RuntimeError(
            "Inventory reconciliation failed: "
            f"expected={metadata['expected_records']}, unique={len(records)}"
        )
    if len(records) < args.minimum_count:
        raise RuntimeError(f"Only {len(records)} unique units were collected")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
