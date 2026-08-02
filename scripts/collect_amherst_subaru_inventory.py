"""Collect every public Amherst Subaru listing from AutoTrader."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlencode

import cloudscraper

BASE_URL = "https://www.autotrader.com"
DEALER_URL = f"{BASE_URL}/car-dealers/amherst-nh/70248507/amherst-subaru"
RECORDS_PER_PAGE = 25
NEXT_DATA_PATTERN = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)


def walk_dicts(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_dicts(child)


def find_eggs_state(data: dict[str, Any]) -> dict[str, Any]:
    direct = (
        data.get("props", {})
        .get("pageProps", {})
        .get("__eggsState", {})
    )
    if isinstance(direct, dict) and direct.get("inventory"):
        return direct

    for candidate in walk_dicts(data):
        if isinstance(candidate.get("inventory"), dict) and (
            isinstance(candidate.get("srp_results"), dict)
            or isinstance(candidate.get("searchResults"), dict)
        ):
            return candidate
    raise RuntimeError("AutoTrader inventory state was not found in __NEXT_DATA__")


def parse_next_data(html: str) -> dict[str, Any]:
    match = NEXT_DATA_PATTERN.search(html)
    if not match:
        raise RuntimeError("AutoTrader __NEXT_DATA__ script was not found")
    parsed = json.loads(match.group(1))
    if not isinstance(parsed, dict):
        raise RuntimeError("AutoTrader __NEXT_DATA__ was not an object")
    return parsed


def value_name(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("name", "value", "label", "displayName"):
            if value.get(key) not in (None, ""):
                return str(value[key]).strip()
    return str(value or "").strip()


def parse_int(value: Any) -> int | None:
    if isinstance(value, dict):
        value = value.get("value") or value.get("amount")
    if value in (None, ""):
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return round(float(match.group(0))) if match else None


def first_nonempty(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def listing_price(raw: dict[str, Any]) -> int | None:
    pricing = raw.get("pricingDetail")
    if isinstance(pricing, dict):
        for key in ("salePrice", "incentive", "price", "msrp"):
            parsed = parse_int(pricing.get(key))
            if parsed is not None:
                return parsed
    for key in ("salePrice", "price", "internetPrice", "askingPrice", "msrp"):
        parsed = parse_int(raw.get(key))
        if parsed is not None:
            return parsed
    return None


def total_and_ids(eggs: dict[str, Any]) -> tuple[int, list[str]]:
    result_state = eggs.get("srp_results")
    if not isinstance(result_state, dict):
        result_state = eggs.get("searchResults")
    if not isinstance(result_state, dict):
        result_state = {}

    total = parse_int(
        first_nonempty(result_state, "count", "totalCount", "total", "resultCount")
    ) or 0
    active = first_nonempty(
        result_state,
        "activeResults",
        "activeResultIds",
        "listingIds",
        "results",
    )
    ids: list[str] = []
    if isinstance(active, list):
        for entry in active:
            if isinstance(entry, dict):
                candidate = first_nonempty(entry, "id", "listingId", "listingID")
            else:
                candidate = entry
            if candidate not in (None, ""):
                ids.append(str(candidate))

    inventory = eggs.get("inventory")
    if not ids and isinstance(inventory, dict):
        ids = [str(key) for key in inventory]
    return total, ids


def normalize(
    listing_id: str,
    raw: dict[str, Any],
    owners: dict[str, Any],
    captured_at: str,
) -> dict[str, Any]:
    owner_id = str(first_nonempty(raw, "ownerId", "dealerId", "sellerId") or "")
    owner = owners.get(owner_id)
    if not isinstance(owner, dict):
        owner = {}

    year = parse_int(raw.get("year"))
    make = value_name(raw.get("make"))
    model = value_name(raw.get("model"))
    trim = value_name(raw.get("trim"))
    condition = value_name(
        first_nonempty(raw, "listingType", "condition", "stockType", "newOrUsed")
    )
    certified = bool(
        first_nonempty(raw, "certified", "isCertified", "manufacturerCertified")
    ) or condition.lower() == "certified"
    if certified and condition.lower() not in {"new", "used"}:
        condition = "Certified"

    mileage = parse_int(first_nonempty(raw, "mileage", "odometer"))
    advertised_price = listing_price(raw)
    vin = value_name(first_nonempty(raw, "vin", "vehicleIdentificationNumber"))
    stock_number = value_name(
        first_nonempty(raw, "stockNumber", "stockNum", "stock", "dealerStockNumber")
    )
    title = value_name(first_nonempty(raw, "titleLong", "title"))
    if not title:
        title = " ".join(
            part for part in (str(year) if year else "", make, model, trim) if part
        )

    return {
        "condition": condition,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "vehicle": title,
        "mileage": mileage,
        "advertised_price": advertised_price,
        "price_status": "Listed" if advertised_price is not None else "Call for price",
        "vin": vin,
        "stock_number": stock_number,
        "listing_id": listing_id,
        "source_url": f"{BASE_URL}/cars-for-sale/vehicle/{listing_id}",
        "owner_id": owner_id,
        "dealer_name": value_name(first_nonempty(owner, "name", "displayName"))
        or value_name(raw.get("ownerName")),
        "certified": certified,
        "body_style": value_name(first_nonempty(raw, "bodyStyle", "bodyType")),
        "exterior_color": value_name(first_nonempty(raw, "exteriorColor", "color")),
        "interior_color": value_name(raw.get("interiorColor")),
        "drivetrain": value_name(first_nonempty(raw, "driveType", "drivetrain")),
        "fuel_type": value_name(raw.get("fuelType")),
        "transmission": value_name(raw.get("transmission")),
        "captured_at": captured_at,
    }


def fetch_html(scraper: Any, first_record: int) -> str:
    params = {
        "firstRecord": first_record,
        "numRecords": RECORDS_PER_PAGE,
        "searchRadius": 0,
        "zip": "03031",
    }
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            response = scraper.get(
                f"{DEALER_URL}?{urlencode(params)}",
                timeout=60,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache",
                    "Referer": DEALER_URL,
                },
            )
            response.raise_for_status()
            if "__NEXT_DATA__" not in response.text:
                raise RuntimeError(
                    f"AutoTrader response omitted __NEXT_DATA__: {response.text[:300]}"
                )
            return response.text
        except Exception as error:
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"AutoTrader request failed at firstRecord={first_record}") from last_error


def collect(output_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )
    captured_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    records_by_key: dict[str, dict[str, Any]] = {}
    expected = 0
    first_record = 0
    pages = 0

    debug_dir = output_dir / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)

    while True:
        html = fetch_html(scraper, first_record)
        data = parse_next_data(html)
        eggs = find_eggs_state(data)
        inventory = eggs.get("inventory")
        owners = eggs.get("owners")
        if not isinstance(inventory, dict):
            raise RuntimeError("AutoTrader inventory map was missing")
        if not isinstance(owners, dict):
            owners = {}

        page_total, active_ids = total_and_ids(eggs)
        expected = max(expected, page_total)
        if pages == 0:
            (debug_dir / "page-1-next-data.json").write_text(
                json.dumps(data, indent=2), encoding="utf-8"
            )

        page_added = 0
        for listing_id in active_ids:
            raw = inventory.get(str(listing_id))
            if not isinstance(raw, dict):
                continue
            row = normalize(str(listing_id), raw, owners, captured_at)
            key = row["vin"] or row["listing_id"]
            if key and key not in records_by_key:
                records_by_key[key] = row
                page_added += 1

        pages += 1
        if not active_ids or page_added == 0:
            break
        if expected and len(records_by_key) >= expected:
            break
        if len(active_ids) < RECORDS_PER_PAGE and not expected:
            break
        first_record += RECORDS_PER_PAGE
        if first_record > 2500:
            raise RuntimeError("AutoTrader pagination exceeded safety limit")
        time.sleep(1.5)

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
        "source": DEALER_URL,
        "captured_at": captured_at,
        "expected_records": expected,
        "unique_records": len(records),
        "pages_retrieved": pages,
        "new_records": sum(row["condition"].lower() == "new" for row in records),
        "used_records": sum(row["condition"].lower() == "used" for row in records),
        "certified_records": sum(bool(row["certified"]) for row in records),
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
        "stock_number",
        "listing_id",
        "source_url",
        "owner_id",
        "dealer_name",
        "certified",
        "body_style",
        "exterior_color",
        "interior_color",
        "drivetrain",
        "fuel_type",
        "transmission",
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
    parser.add_argument("--minimum-count", type=int, default=250)
    args = parser.parse_args()

    records, metadata = collect(args.output_dir)
    write_outputs(records, metadata, args.output_dir)
    expected = int(metadata["expected_records"] or 0)
    if expected and len(records) != expected:
        raise RuntimeError(
            f"Inventory reconciliation failed: expected={expected}, unique={len(records)}"
        )
    if len(records) < args.minimum_count:
        raise RuntimeError(f"Only {len(records)} unique units were collected")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
