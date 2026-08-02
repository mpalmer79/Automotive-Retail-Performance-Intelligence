"""Collect every public Amherst Subaru inventory listing from Dealer.com."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE_URL = "https://www.amherstsubaru.com"
ENDPOINTS = {
    "New": "/apis/widget/INVENTORY_LISTING_DEFAULT_AUTO_NEW:inventory-data-bus1/getInventory",
    "Used": "/apis/widget/INVENTORY_LISTING_DEFAULT_AUTO_USED:inventory-data-bus1/getInventory",
}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class FetchResult:
    condition: str
    expected_count: int
    records: list[dict[str, Any]]
    accounts: dict[str, Any]


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(value))
    text = text.replace("®", "").replace("Â", "")
    return re.sub(r"\s+", " ", text).strip()


def parse_number(value: Any) -> int | None:
    if value is None or value == "":
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if match is None:
        return None
    return round(float(match.group(0)))


def normalized_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", clean_text(value).lower())


def attribute_map(item: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    attributes = item.get("attributes")
    if not isinstance(attributes, list):
        return result
    for attribute in attributes:
        if not isinstance(attribute, dict):
            continue
        value = clean_text(
            attribute.get("value")
            or attribute.get("normalizedValue")
            or attribute.get("labeledValue")
        )
        for key_source in (attribute.get("name"), attribute.get("label")):
            key = normalized_key(key_source)
            if key and value and key not in result:
                result[key] = value
    return result


def first_value(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, "", []):
            return value
    return None


def final_price(item: dict[str, Any]) -> int | None:
    pricing = item.get("pricing")
    if not isinstance(pricing, dict):
        return None
    display_prices = pricing.get("dPrice")
    if isinstance(display_prices, list):
        for price in display_prices:
            if isinstance(price, dict) and price.get("isFinalPrice") is True:
                parsed = parse_number(price.get("value"))
                if parsed is not None:
                    return parsed
        for price in reversed(display_prices):
            if isinstance(price, dict):
                parsed = parse_number(price.get("value"))
                if parsed is not None:
                    return parsed
    return parse_number(pricing.get("retailPrice"))


def make_request(opener: Any, url: str, accept: str) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": f"{BASE_URL}/all-inventory/index.htm",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with opener.open(request, timeout=45) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            if isinstance(exc, HTTPError) and exc.code not in {403, 429, 500, 502, 503, 504}:
                raise
            time.sleep(2**attempt)
    raise RuntimeError(f"Request failed after retries: {url}") from last_error


def warm_session(opener: Any) -> None:
    for path in ("/", "/all-inventory/index.htm"):
        make_request(opener, urljoin(BASE_URL, path), "text/html,application/xhtml+xml")


def fetch_condition(
    opener: Any,
    condition: str,
    endpoint: str,
    page_size: int,
) -> FetchResult:
    records: list[dict[str, Any]] = []
    accounts: dict[str, Any] = {}
    expected_count = 0
    start = 0
    seen_page_signatures: set[tuple[str, ...]] = set()

    while True:
        query = urlencode({"start": start, "count": page_size})
        url = f"{urljoin(BASE_URL, endpoint)}?{query}"
        payload = json.loads(make_request(opener, url, "application/json").decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError(f"Unexpected {condition} response type: {type(payload).__name__}")

        page_records = payload.get("inventory")
        if not isinstance(page_records, list):
            raise RuntimeError(f"{condition} response did not contain an inventory array")

        page_info = payload.get("pageInfo")
        if isinstance(page_info, dict):
            expected_count = max(expected_count, int(page_info.get("totalCount") or 0))

        page_accounts = payload.get("accounts")
        if isinstance(page_accounts, dict):
            accounts.update(page_accounts)

        signature = tuple(
            clean_text(record.get("uuid") or record.get("link"))
            for record in page_records
            if isinstance(record, dict)
        )
        if signature in seen_page_signatures:
            raise RuntimeError(f"{condition} pagination repeated at start={start}")
        seen_page_signatures.add(signature)

        valid_records = [record for record in page_records if isinstance(record, dict)]
        records.extend(valid_records)
        if not valid_records:
            break

        start += len(valid_records)
        if expected_count and start >= expected_count:
            break
        if len(valid_records) < page_size and not expected_count:
            break
        if start > 5000:
            raise RuntimeError(f"{condition} pagination exceeded the safety limit")

    return FetchResult(
        condition=condition,
        expected_count=expected_count,
        records=records,
        accounts=accounts,
    )


def tracking_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    page_info = payload.get("pageInfo")
    if not isinstance(page_info, dict):
        return {}
    tracking = page_info.get("trackingData")
    if not isinstance(tracking, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for row in tracking:
        if not isinstance(row, dict):
            continue
        key = clean_text(row.get("uuid") or row.get("vin") or row.get("link"))
        if key:
            result[key] = row
    return result


def normalize_record(
    condition: str,
    item: dict[str, Any],
    accounts: dict[str, Any],
    captured_at: str,
) -> dict[str, Any]:
    attrs = attribute_map(item)
    title = item.get("title")
    title_parts = [clean_text(part) for part in title] if isinstance(title, list) else []

    year = parse_number(first_value(attrs, "modelyear", "year"))
    make = clean_text(first_value(attrs, "make", "manufacturer"))
    model = clean_text(first_value(attrs, "model") or item.get("model"))
    trim = clean_text(first_value(attrs, "trim", "series"))

    if year is None and title_parts:
        year = parse_number(title_parts[0])
    if not make and len(title_parts) > 1:
        make = title_parts[1]
    if not model and len(title_parts) > 2:
        model = title_parts[2]
    if not trim and len(title_parts) > 3:
        trim = " ".join(title_parts[3:])

    vin = clean_text(first_value(attrs, "vin", "vehicleidentificationnumber"))
    stock_number = clean_text(first_value(attrs, "stocknumber", "stock", "stockno"))
    mileage = parse_number(first_value(attrs, "odometer", "mileage", "miles"))
    account_id = clean_text(item.get("accountId"))
    account = accounts.get(account_id)
    account_name = clean_text(account.get("name")) if isinstance(account, dict) else ""
    source_url = urljoin(BASE_URL, clean_text(item.get("link")))
    price = final_price(item)

    vehicle = " ".join(
        part for part in (str(year) if year is not None else "", make, model, trim) if part
    )
    unique_key = vin or clean_text(item.get("uuid")) or source_url

    return {
        "source_key": unique_key,
        "condition": condition,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "vehicle": vehicle,
        "mileage": mileage,
        "advertised_price": price,
        "price_status": "Listed" if price is not None else "Call for price",
        "vin": vin,
        "stock_number": stock_number,
        "source_url": source_url,
        "account_id": account_id,
        "account_name": account_name,
        "certified": bool(item.get("certified")),
        "captured_at": captured_at,
    }


def collect(page_size: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    warm_session(opener)
    captured_at = datetime.now(UTC).replace(microsecond=0).isoformat()

    fetch_results = [
        fetch_condition(opener, condition, endpoint, page_size)
        for condition, endpoint in ENDPOINTS.items()
    ]

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in fetch_results:
        for item in result.records:
            row = normalize_record(result.condition, item, result.accounts, captured_at)
            key = clean_text(row["source_key"])
            if not key or key in seen:
                continue
            seen.add(key)
            normalized.append(row)

    normalized.sort(
        key=lambda row: (
            row["condition"],
            -(row["year"] or 0),
            row["make"],
            row["model"],
            row["trim"],
            row["source_key"],
        )
    )

    metadata = {
        "source": BASE_URL,
        "captured_at": captured_at,
        "records": len(normalized),
        "new_records": sum(row["condition"] == "New" for row in normalized),
        "used_records": sum(row["condition"] == "Used" for row in normalized),
        "endpoint_counts": {
            result.condition: {
                "expected": result.expected_count,
                "retrieved": len(result.records),
            }
            for result in fetch_results
        },
    }
    return normalized, metadata


def write_outputs(
    records: list[dict[str, Any]],
    metadata: dict[str, Any],
    output_dir: Path,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "amherst_subaru_inventory_complete.csv"
    json_path = output_dir / "amherst_subaru_inventory_complete.json"
    metadata_path = output_dir / "amherst_subaru_inventory_metadata.json"

    fieldnames = [
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
        "source_url",
        "account_id",
        "account_name",
        "certified",
        "captured_at",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    json_path.write_text(json.dumps(records, indent=2), encoding="utf-8")
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/amherst-inventory"))
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--minimum-count", type=int, default=250)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    records, metadata = collect(args.page_size)
    write_outputs(records, metadata, args.output_dir)

    expected_total = sum(
        value["expected"] for value in metadata["endpoint_counts"].values()
    )
    retrieved_total = sum(
        value["retrieved"] for value in metadata["endpoint_counts"].values()
    )
    if retrieved_total != expected_total:
        raise RuntimeError(
            f"Inventory reconciliation failed: retrieved={retrieved_total}, expected={expected_total}"
        )
    if len(records) < args.minimum_count:
        raise RuntimeError(
            f"Only {len(records)} unique records were collected; minimum is {args.minimum_count}"
        )

    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
