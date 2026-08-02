"""Collect Amherst Subaru vehicle detail pages from its public XML sitemap."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.amherstsubaru.com"
ROOT_SITEMAP = f"{BASE_URL}/sitemap.xml"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)
VIN_PATTERN = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")
MONEY_PATTERN = re.compile(r"\$\s*([0-9][0-9,]*)")
MILEAGE_PATTERN = re.compile(r"(?:Mileage|Odometer)\s*[:\n ]+([0-9][0-9,]*)", re.I)
STOCK_PATTERN = re.compile(r"Stock(?: Number| #)?\s*[:\n ]+([A-Z0-9-]+)", re.I)


def session() -> requests.Session:
    client = requests.Session()
    client.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
    )
    return client


def fetch_text(client: requests.Session, url: str, accept: str, attempts: int = 5) -> str:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = client.get(
                url,
                timeout=60,
                headers={"Accept": accept, "Referer": f"{BASE_URL}/all-inventory/index.htm"},
            )
            response.raise_for_status()
            return response.text
        except requests.RequestException as error:
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"Unable to retrieve {url}") from last_error


def xml_locations(xml_text: str) -> tuple[str, list[str]]:
    root = ElementTree.fromstring(xml_text)
    kind = root.tag.rsplit("}", 1)[-1]
    locations = [
        element.text.strip()
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "loc" and element.text
    ]
    return kind, locations


def collect_sitemap_urls(client: requests.Session) -> tuple[list[str], list[str]]:
    queue = [ROOT_SITEMAP]
    visited: set[str] = set()
    pages: list[str] = []
    sitemap_urls: list[str] = []

    while queue:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        xml_text = fetch_text(client, url, "application/xml,text/xml;q=0.9,*/*;q=0.8")
        kind, locations = xml_locations(xml_text)
        sitemap_urls.append(url)
        if kind == "sitemapindex":
            queue.extend(location for location in locations if location not in visited)
        else:
            pages.extend(locations)

    return sorted(set(pages)), sitemap_urls


def is_vehicle_page(url: str) -> bool:
    path = urlparse(url).path.lower()
    return (
        path.endswith(".htm")
        and (path.startswith("/new/") or path.startswith("/used/"))
        and "-for-sale-" in path
    )


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_int(value: Any) -> int | None:
    match = re.search(r"[0-9][0-9,]*", clean_text(value))
    return int(match.group(0).replace(",", "")) if match else None


def json_ld_objects(soup: BeautifulSoup) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            parsed = json.loads(script.get_text(strip=True))
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = parsed if isinstance(parsed, list) else [parsed]
        for candidate in candidates:
            if isinstance(candidate, dict):
                objects.append(candidate)
                graph = candidate.get("@graph")
                if isinstance(graph, list):
                    objects.extend(item for item in graph if isinstance(item, dict))
    return objects


def first_json_ld(objects: list[dict[str, Any]], *types: str) -> dict[str, Any]:
    wanted = {value.lower() for value in types}
    for item in objects:
        item_type = item.get("@type")
        values = item_type if isinstance(item_type, list) else [item_type]
        if any(str(value).lower() in wanted for value in values):
            return item
    return {}


def parse_title(url: str, soup: BeautifulSoup, text: str) -> tuple[int | None, str, str, str, str]:
    heading = soup.find("h1")
    title = clean_text(heading.get_text(" ") if heading else "")
    if not title:
        meta = soup.find("meta", property="og:title")
        title = clean_text(meta.get("content") if meta else "")
    if not title:
        title = clean_text(soup.title.get_text(" ") if soup.title else "")

    title = re.sub(r"\s+(?:for sale|near|in Amherst|\|).*$", "", title, flags=re.I)
    title = re.sub(r"^(?:New|Used|Certified)\s+", "", title, flags=re.I)
    match = re.match(r"(?P<year>20\d{2}|19\d{2})\s+(?P<make>\S+)\s+(?P<model>\S+)(?:\s+(?P<trim>.*))?", title)
    if match:
        year = int(match.group("year"))
        make = clean_text(match.group("make"))
        model = clean_text(match.group("model"))
        trim = clean_text(match.group("trim"))
        return year, make, model, trim, title

    path_parts = [part for part in urlparse(url).path.split("/") if part]
    condition = path_parts[0].title() if path_parts else ""
    slug = path_parts[2] if len(path_parts) > 2 else ""
    year_match = re.search(r"(19|20)\d{2}", slug)
    year = int(year_match.group(0)) if year_match else None
    make = path_parts[1] if len(path_parts) > 1 else ""
    model_match = re.search(r"Subaru-([^-]+)-for-sale", slug, re.I)
    model = model_match.group(1) if model_match else ""
    display = " ".join(part for part in (str(year or ""), make, model) if part)
    return year, make, model, "", display or condition


def extract_vehicle(url: str, html: str, captured_at: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    visible_text = soup.get_text("\n")
    objects = json_ld_objects(soup)
    vehicle_ld = first_json_ld(objects, "Vehicle", "Car", "Product")
    offer_ld = vehicle_ld.get("offers") if isinstance(vehicle_ld.get("offers"), dict) else {}

    condition = "New" if urlparse(url).path.lower().startswith("/new/") else "Used"
    year, make, model, trim, display = parse_title(url, soup, visible_text)

    vin = clean_text(
        vehicle_ld.get("vehicleIdentificationNumber")
        or vehicle_ld.get("vin")
        or (VIN_PATTERN.search(visible_text).group(0) if VIN_PATTERN.search(visible_text) else "")
    )
    stock_match = STOCK_PATTERN.search(visible_text)
    stock_number = clean_text(stock_match.group(1) if stock_match else "")
    mileage_match = MILEAGE_PATTERN.search(visible_text)
    mileage = parse_int(mileage_match.group(1)) if mileage_match else (1 if condition == "New" else None)

    advertised_price = parse_int(
        offer_ld.get("price")
        or vehicle_ld.get("price")
    )
    if advertised_price is None:
        true_price_match = re.search(
            r"(?:True Price|Sale Price|Internet Price)[^$]{0,80}\$\s*([0-9][0-9,]*)",
            visible_text,
            flags=re.I,
        )
        if true_price_match:
            advertised_price = parse_int(true_price_match.group(1))
    if advertised_price is None:
        money_values = [int(value.replace(",", "")) for value in MONEY_PATTERN.findall(visible_text)]
        plausible = [value for value in money_values if 2_000 <= value <= 150_000]
        advertised_price = plausible[0] if plausible else None

    if not make:
        make = clean_text(vehicle_ld.get("manufacturer") or vehicle_ld.get("brand"))
    if not model:
        model = clean_text(vehicle_ld.get("model"))
    if not trim:
        trim = clean_text(vehicle_ld.get("vehicleConfiguration") or vehicle_ld.get("trim"))
    if not display:
        display = " ".join(part for part in (str(year or ""), make, model, trim) if part)

    return {
        "condition": condition,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "vehicle": display,
        "mileage": mileage,
        "advertised_price": advertised_price,
        "price_status": "Listed" if advertised_price is not None else "Not exposed",
        "vin": vin,
        "stock_number": stock_number,
        "source_url": url,
        "captured_at": captured_at,
        "http_bytes": len(html.encode("utf-8")),
    }


def fetch_vehicle(client: requests.Session, url: str, captured_at: str) -> tuple[str, dict[str, Any] | None, str]:
    try:
        html = fetch_text(client, url, "text/html,application/xhtml+xml")
        return url, extract_vehicle(url, html, captured_at), ""
    except Exception as error:
        return url, None, f"{type(error).__name__}: {error}"


def collect(output_dir: Path, workers: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    client = session()
    pages, sitemap_urls = collect_sitemap_urls(client)
    vehicle_urls = sorted(url for url in pages if is_vehicle_page(url))
    captured_at = datetime.now(UTC).replace(microsecond=0).isoformat()

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "all_sitemap_urls.json").write_text(json.dumps(pages, indent=2), encoding="utf-8")
    (output_dir / "vehicle_urls.json").write_text(json.dumps(vehicle_urls, indent=2), encoding="utf-8")

    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(fetch_vehicle, session(), url, captured_at): url
            for url in vehicle_urls
        }
        for future in as_completed(futures):
            url, record, error = future.result()
            if record is None:
                failures.append({"source_url": url, "error": error})
            else:
                records.append(record)

    records.sort(
        key=lambda row: (
            row["condition"],
            -(row["year"] or 0),
            row["make"],
            row["model"],
            row["trim"],
            row["source_url"],
        )
    )
    metadata = {
        "source": ROOT_SITEMAP,
        "captured_at": captured_at,
        "sitemaps_retrieved": sitemap_urls,
        "all_page_urls": len(pages),
        "vehicle_urls": len(vehicle_urls),
        "vehicle_pages_parsed": len(records),
        "vehicle_page_failures": len(failures),
        "new_records": sum(row["condition"] == "New" for row in records),
        "used_records": sum(row["condition"] == "Used" for row in records),
    }
    (output_dir / "failures.json").write_text(json.dumps(failures, indent=2), encoding="utf-8")
    return records, metadata


def write_outputs(records: list[dict[str, Any]], metadata: dict[str, Any], output_dir: Path) -> None:
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
        "captured_at",
        "http_bytes",
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
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    records, metadata = collect(args.output_dir, args.workers)
    write_outputs(records, metadata, args.output_dir)
    if metadata["vehicle_urls"] < args.minimum_count:
        raise RuntimeError(
            f"Only {metadata['vehicle_urls']} vehicle URLs were found in the sitemap"
        )
    if metadata["vehicle_page_failures"]:
        raise RuntimeError(
            f"{metadata['vehicle_page_failures']} vehicle pages failed to parse"
        )
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
