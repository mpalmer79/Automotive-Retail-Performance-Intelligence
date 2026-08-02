"""Collect and reconcile Amherst Subaru's public Dealer.com inventory."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin

import requests

BASE_URL = "https://www.amherstsubaru.com"
INVENTORY_PAGE = f"{BASE_URL}/all-inventory/index.htm"
ENDPOINTS = {
    "New": "/apis/widget/INVENTORY_LISTING_DEFAULT_AUTO_NEW:inventory-data-bus1/getInventory",
    "Used": "/apis/widget/INVENTORY_LISTING_DEFAULT_AUTO_USED:inventory-data-bus1/getInventory",
}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(value))
    return re.sub(r"\s+", " ", text.replace("®", "").replace("Â", "")).strip()


def number(value: Any) -> int | None:
    match = re.search(r"-?\d+(?:\.\d+)?", clean(value).replace(",", ""))
    return round(float(match.group(0))) if match else None


def key_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", clean(value).lower())


def attrs(item: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for attribute in item.get("attributes") or []:
        if not isinstance(attribute, dict):
            continue
        value = clean(
            attribute.get("value")
            or attribute.get("normalizedValue")
            or attribute.get("labeledValue")
        )
        for candidate in (attribute.get("name"), attribute.get("label")):
            name = key_name(candidate)
            if name and value and name not in result:
                result[name] = value
    return result


def first(mapping: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = mapping.get(name)
        if value not in (None, "", []):
            return value
    return None


def price(item: dict[str, Any]) -> int | None:
    pricing = item.get("pricing")
    if not isinstance(pricing, dict):
        return None
    displayed = pricing.get("dPrice")
    if isinstance(displayed, list):
        ordered = sorted(
            (row for row in displayed if isinstance(row, dict)),
            key=lambda row: bool(row.get("isFinalPrice")),
            reverse=True,
        )
        for row in ordered:
            parsed = number(row.get("value"))
            if parsed is not None:
                return parsed
    return number(pricing.get("retailPrice"))


def direct_fetcher() -> Callable[[str, int, int], dict[str, Any]]:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": INVENTORY_PAGE,
            "X-Requested-With": "XMLHttpRequest",
        }
    )

    def fetch(endpoint: str, start: int, count: int) -> dict[str, Any]:
        response = session.get(
            urljoin(BASE_URL, endpoint),
            params={"start": start, "count": count},
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("Dealer.com returned a non-object response")
        return payload

    return fetch


def browser_fetcher() -> tuple[Callable[[str, int, int], dict[str, Any]], Callable[[], None]]:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait

    options = Options()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(f"--user-agent={USER_AGENT}")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    driver = webdriver.Chrome(options=options)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {
            "source": (
                "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
                "Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});"
                "Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});"
            )
        },
    )
    driver.set_page_load_timeout(90)
    driver.get(INVENTORY_PAGE)
    WebDriverWait(driver, 60).until(lambda current: current.execute_script("return document.readyState") == "complete")
    time.sleep(8)

    script = """
        const endpoint = arguments[0];
        const start = arguments[1];
        const count = arguments[2];
        const done = arguments[arguments.length - 1];
        const url = `${endpoint}?start=${start}&count=${count}`;
        fetch(url, {
            credentials: 'include',
            headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}
        })
        .then(async response => ({status: response.status, text: await response.text()}))
        .then(done)
        .catch(error => done({status: 0, text: String(error)}));
    """

    def fetch(endpoint: str, start: int, count: int) -> dict[str, Any]:
        result = driver.execute_async_script(script, endpoint, start, count)
        status = int(result.get("status") or 0)
        if status != 200:
            raise RuntimeError(f"Browser fetch failed with HTTP {status}: {result.get('text', '')[:300]}")
        payload = json.loads(result["text"])
        if not isinstance(payload, dict):
            raise RuntimeError("Dealer.com browser response was not an object")
        return payload

    return fetch, driver.quit


def fetch_all(
    fetch: Callable[[str, int, int], dict[str, Any]],
    page_size: int,
) -> tuple[list[tuple[str, dict[str, Any], dict[str, Any]]], dict[str, Any]]:
    collected: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    counts: dict[str, Any] = {}

    for condition, endpoint in ENDPOINTS.items():
        start = 0
        expected = 0
        retrieved = 0
        accounts: dict[str, Any] = {}
        seen_pages: set[tuple[str, ...]] = set()

        while True:
            payload = fetch(endpoint, start, page_size)
            page_records = payload.get("inventory")
            if not isinstance(page_records, list):
                raise RuntimeError(f"{condition} response has no inventory array")

            page_info = payload.get("pageInfo")
            if isinstance(page_info, dict):
                expected = max(expected, int(page_info.get("totalCount") or 0))
            page_accounts = payload.get("accounts")
            if isinstance(page_accounts, dict):
                accounts.update(page_accounts)

            valid = [row for row in page_records if isinstance(row, dict)]
            signature = tuple(clean(row.get("uuid") or row.get("link")) for row in valid)
            if signature in seen_pages:
                raise RuntimeError(f"{condition} pagination repeated at start={start}")
            seen_pages.add(signature)

            for row in valid:
                collected.append((condition, row, accounts))
            retrieved += len(valid)
            start += len(valid)

            if not valid or (expected and start >= expected):
                break
            if not expected and len(valid) < page_size:
                break
            if start > 5000:
                raise RuntimeError(f"{condition} inventory exceeded safety limit")

        counts[condition] = {"expected": expected, "retrieved": retrieved}

    return collected, counts


def normalize(
    condition: str,
    item: dict[str, Any],
    accounts: dict[str, Any],
    captured_at: str,
) -> dict[str, Any]:
    attributes = attrs(item)
    title = item.get("title")
    title_parts = [clean(part) for part in title] if isinstance(title, list) else []

    year = number(first(attributes, "modelyear", "year"))
    make = clean(first(attributes, "make", "manufacturer"))
    model = clean(first(attributes, "model") or item.get("model"))
    trim = clean(first(attributes, "trim", "series"))

    if year is None and title_parts:
        year = number(title_parts[0])
    if not make and len(title_parts) > 1:
        make = title_parts[1]
    if not model and len(title_parts) > 2:
        model = title_parts[2]
    if not trim and len(title_parts) > 3:
        trim = " ".join(title_parts[3:])

    account_id = clean(item.get("accountId"))
    account = accounts.get(account_id)
    listed_price = price(item)
    source_url = urljoin(BASE_URL, clean(item.get("link")))
    vin = clean(first(attributes, "vin", "vehicleidentificationnumber"))

    return {
        "source_key": vin or clean(item.get("uuid")) or source_url,
        "condition": condition,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "vehicle": " ".join(
            part for part in (str(year) if year else "", make, model, trim) if part
        ),
        "mileage": number(first(attributes, "odometer", "mileage", "miles")),
        "advertised_price": listed_price,
        "price_status": "Listed" if listed_price is not None else "Call for price",
        "vin": vin,
        "stock_number": clean(first(attributes, "stocknumber", "stock", "stockno")),
        "source_url": source_url,
        "account_id": account_id,
        "account_name": clean(account.get("name")) if isinstance(account, dict) else "",
        "certified": bool(item.get("certified")),
        "captured_at": captured_at,
    }


def collect(page_size: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    close: Callable[[], None] = lambda: None
    method = "direct"
    try:
        source_rows, counts = fetch_all(direct_fetcher(), page_size)
    except requests.HTTPError as error:
        if error.response is None or error.response.status_code != 403:
            raise
        method = "browser"
        fetch, close = browser_fetcher()
        source_rows, counts = fetch_all(fetch, page_size)
    finally:
        close()

    captured_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for condition, item, accounts in source_rows:
        row = normalize(condition, item, accounts, captured_at)
        unique_key = clean(row["source_key"])
        if unique_key and unique_key not in seen:
            seen.add(unique_key)
            records.append(row)

    records.sort(
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
        "method": method,
        "captured_at": captured_at,
        "records": len(records),
        "new_records": sum(row["condition"] == "New" for row in records),
        "used_records": sum(row["condition"] == "Used" for row in records),
        "endpoint_counts": counts,
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
        "source_url",
        "account_id",
        "account_name",
        "certified",
        "captured_at",
    ]
    with (output_dir / "amherst_subaru_inventory_complete.csv").open(
        "w", encoding="utf-8", newline=""
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
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
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--minimum-count", type=int, default=250)
    args = parser.parse_args()

    records, metadata = collect(args.page_size)
    write_outputs(records, metadata, args.output_dir)

    expected = sum(row["expected"] for row in metadata["endpoint_counts"].values())
    retrieved = sum(row["retrieved"] for row in metadata["endpoint_counts"].values())
    if expected != retrieved:
        raise RuntimeError(f"Reconciliation failed: expected={expected}, retrieved={retrieved}")
    if len(records) < args.minimum_count:
        raise RuntimeError(f"Only {len(records)} unique units were collected")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
