#!/usr/bin/env python3
"""Validate the preserved source CSVs and build the browser data snapshot.

Run from the repository root with ``python scripts/build-data.py``.
Inputs are the preserved original CSVs and streaming_companies.json in data;
no network is required. Supplemental comparison records remain distinct from
annual observations, including when their display year is 2026.
Revenue units are USD billions and revenue per employee is USD millions.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REVENUE_FILE = DATA / "revenue_per_employee_dataset.csv"
EVENT_FILE = DATA / "layoff_markers.csv"
STREAMING_FILE = DATA / "streaming_companies.json"

COLORS = {
    "Anthropic": "#c77a55",
    "OpenAI": "#202b2e",
    "Nvidia": "#86a541",
    "Block": "#3e5058",
    "Opendoor": "#2989c3",
    "Netflix": "#b64b5e",
    "Meta": "#397fb0",
    "Alphabet": "#8c90bd",
    "Apple": "#677780",
    "Microsoft": "#9465b1",
    "Amazon": "#d0a13f",
    "Coinbase": "#5876bd",
}
AI_NATIVE = {"OpenAI", "Anthropic"}
BIG_TECH = {"Alphabet", "Amazon", "Apple", "Meta", "Microsoft", "Netflix", "Nvidia"}
RESTRUCTURERS = {"Block", "Coinbase", "Oracle", "Salesforce", "Twilio", "X / Twitter"}
YEARS = list(range(2019, 2027))
STREAMING_SCOPES = {
    "Netflix": "Consolidated Netflix; the original source dataset is retained.",
    "Spotify": "Consolidated Spotify, including music, podcast and other operations; the original source dataset is retained.",
    "Alphabet": "Consolidated Alphabet, including Google and YouTube. These figures are not YouTube standalone revenue or headcount.",
    "Amazon": "Consolidated Amazon, including retail, logistics and AWS. These figures are not Prime Video standalone revenue or headcount.",
    "Apple": "Consolidated Apple, including hardware and services. These figures are not Apple TV standalone revenue or headcount.",
}
EXPECTED_SOURCE_HASHES = {
    "revenue": "c5f8052d70f53d1c9e5469d843b01844c9cafa63eb4c8ce0ec9d622198b6edfb",
    "events": "ecc49a190cf34e9175a4afac8ea5c2ddc9250760bfa3d269a2bfb4deb3cdb465",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def rows_from_csv(path: Path, required: set[str]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        require(required.issubset(reader.fieldnames or []), f"Missing required columns in {path.name}")
        rows = list(reader)
    require(bool(rows), f"Empty source: {path.name}")
    return rows


def classify_status(status: str) -> str:
    """A mixed estimate is never classified as fully reported."""
    normalized = status.lower()
    if "projection" in normalized:
        return "projection"
    if "estimate" in normalized or "run-rate" in normalized or "private" in normalized:
        return "estimate"
    if normalized.startswith("actual"):
        return "reported"
    raise ValueError(f"Unrecognized source status: {status!r}")


def cohort_for(name: str, group: str) -> str:
    """Exclusive display cohorts; the source Group remains unchanged."""
    if name in AI_NATIVE:
        return "AI-native"
    if name in BIG_TECH:
        return "Big Tech"
    if name in RESTRUCTURERS:
        return "Restructurers"
    if any(term in group.lower() for term in ("operationally", "marketplace", "ad-supported", "immersive")):
        return "Platforms"
    return "Software & infrastructure"


def validate_supplemental_point(point: dict, label: str) -> float:
    """Check derived ratios and provenance without modifying reported inputs."""
    for key in ("revenue", "headcount", "rpe"):
        value = point.get(key)
        require(isinstance(value, (int, float)) and math.isfinite(value) and value > 0,
                f"Invalid supplemental {key}: {label}")
    require(float(point["headcount"]).is_integer(), f"Non-integral supplemental workforce: {label}")
    calculated = point["revenue"] * 1000 / point["headcount"]
    require(math.isclose(calculated, point["rpe"], rel_tol=1e-11, abs_tol=1e-11),
            f"Supplemental RPE formula mismatch: {label}")
    require(point.get("kind") in {"reported", "estimate", "projection"}, f"Invalid supplemental kind: {label}")
    require(bool(point.get("status")) and bool(point.get("note")), f"Missing supplemental basis: {label}")
    require(point.get("approximateHeadcount") is True, f"Missing approximate workforce qualifier: {label}")
    require(bool(point.get("fiscalYearEnd")) and bool(point.get("headcountDate")),
            f"Missing supplemental dates: {label}")
    sources = point.get("sources")
    require(isinstance(sources, list) and bool(sources), f"Missing supplemental sources: {label}")
    for source in sources:
        require(bool(source.get("label")) and str(source.get("url", "")).startswith("https://"),
                f"Invalid supplemental source: {label}")
    return abs(calculated - point["rpe"])


def main() -> None:
    source_rows = rows_from_csv(REVENUE_FILE, {
        "Company", "Year", "Revenue_Billions_USD", "Headcount", "RPE_Millions_USD", "Status", "Group"
    })
    companies: dict[str, dict] = {}
    keys: set[tuple[str, int]] = set()
    status_counts: Counter = Counter()
    year_counts: Counter = Counter()
    year_status_counts: dict[int, Counter] = defaultdict(Counter)
    max_formula_error = 0.0

    for raw in source_rows:
        name, status, group = raw["Company"], raw["Status"], raw["Group"]
        require(bool(name.strip()) and bool(status.strip()) and bool(group.strip()), "Blank company/status/group")
        year = int(raw["Year"])
        require(year in YEARS, f"Unexpected year for {name}: {year}")
        revenue = float(raw["Revenue_Billions_USD"])
        headcount_number = float(raw["Headcount"])
        rpe = float(raw["RPE_Millions_USD"])
        require(all(math.isfinite(v) and v > 0 for v in (revenue, headcount_number, rpe)), f"Invalid domain: {name} {year}")
        require(headcount_number.is_integer(), f"Non-integral headcount: {name} {year}")
        headcount = int(headcount_number)
        require((name, year) not in keys, f"Duplicate company/year: {name} {year}")
        keys.add((name, year))
        calculated = revenue * 1000 / headcount
        error = abs(calculated - rpe)
        max_formula_error = max(max_formula_error, error)
        require(math.isclose(calculated, rpe, rel_tol=1e-11, abs_tol=1e-11), f"RPE formula mismatch: {name} {year}")
        kind = classify_status(status)
        status_counts[kind] += 1
        year_counts[year] += 1
        year_status_counts[year][kind] += 1
        if name not in companies:
            companies[name] = {
                "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "name": name,
                "group": group,
                "cohort": cohort_for(name, group),
                "color": COLORS.get(name, "#b6bebb"),
                "featured": name in COLORS,
                "rows": [],
            }
        require(companies[name]["group"] == group, f"Source group changes across years: {name}")
        companies[name]["rows"].append({
            "year": year,
            "revenue": revenue,
            "headcount": headcount,
            "rpe": rpe,
            "status": status,
            "kind": kind,
        })

    require(len(source_rows) == 400, f"Expected snapshot of 400 rows; got {len(source_rows)}")
    require(len(companies) == 51, f"Expected 51 companies; got {len(companies)}")
    require(len({company["id"] for company in companies.values()}) == len(companies), "Slug collision")
    for name, company in companies.items():
        company["rows"].sort(key=lambda row: row["year"])
        expected_years = YEARS[4:] if name in AI_NATIVE else YEARS
        require([row["year"] for row in company["rows"]] == expected_years, f"Unexpected year coverage: {name}")
    require(dict(year_counts) == {year: (49 if year < 2023 else 51) for year in YEARS}, "Unexpected annual counts")

    raw_events = rows_from_csv(EVENT_FILE, {"Company", "Year", "Layoff_Label"})
    events = []
    event_keys = set()
    for raw in raw_events:
        name, year, label = raw["Company"], int(raw["Year"]), raw["Layoff_Label"]
        require(name in companies, f"Unknown event company: {name}")
        require(year in YEARS and (name, year) in keys, f"Event outside data coverage: {name} {year}")
        require(bool(label.strip()), f"Empty event label: {name} {year}")
        require((name, year, label) not in event_keys, f"Duplicate event: {name} {year}")
        event_keys.add((name, year, label))
        events.append({"company": name, "year": year, "label": label})
    require(len(events) == 80, f"Expected 80 event annotations; got {len(events)}")
    events.sort(key=lambda event: (event["year"], event["company"].lower(), event["label"]))

    # Preserve the original snapshot's accounting before extending the payload.
    base_company_count = len(companies)
    base_year_counts = dict(year_counts)
    base_status_counts = dict(status_counts)
    base_year_status_counts = {year: dict(year_status_counts[year]) for year in YEARS}
    for name, scope in STREAMING_SCOPES.items():
        require(name in companies, f"Unknown base streaming company: {name}")
        companies[name].update({"streaming": True, "scopeNote": scope, "employeeUnit": "employees"})

    supplemental = json.loads(STREAMING_FILE.read_text(encoding="utf-8"))
    added_companies = supplemental.get("companies", [])
    expected_supplemental_ids = {"skydance", "tubi", "disney", "comcast", "fox", "roku"}
    require(len(added_companies) == 6, "Expected six supplemental streaming companies")
    require({company.get("id") for company in added_companies} == expected_supplemental_ids,
            "Unexpected supplemental company IDs")
    existing_ids = {company["id"] for company in companies.values()}
    supplemental_row_count = 0
    comparison_count = 0
    comparison_year_counts: Counter = Counter()
    comparison_status_counts: Counter = Counter()
    max_supplemental_formula_error = 0.0
    for company in added_companies:
        name, company_id = company.get("name"), company["id"]
        require(bool(name) and name not in companies and company_id not in existing_ids,
                f"Duplicate supplemental company: {name}")
        existing_ids.add(company_id)
        require(company.get("cohort") == "Streaming & media", f"Invalid streaming cohort: {name}")
        require(all(company.get(flag) is True for flag in ("streaming", "supplemental", "featured")),
                f"Missing supplemental flags: {name}")
        require(bool(company.get("employeeUnit")) and bool(company.get("scopeNote")),
                f"Missing supplemental workforce/scope definition: {name}")
        require(bool(re.fullmatch(r"#[0-9a-fA-F]{6}", company.get("color", ""))),
                f"Invalid supplemental color: {name}")
        annual_rows = company.get("rows", [])
        annual_years = [row.get("year") for row in annual_rows]
        expected_years = (list(range(2023, 2027)) if company_id == "fox" else
                          list(range(2019, 2026)) if company_id in {"disney", "comcast", "roku"} else [])
        require(annual_years == expected_years, f"Unexpected supplemental annual coverage: {name}")
        for row in annual_rows:
            year = row["year"]
            require((name, year) not in keys, f"Duplicate supplemental company/year: {name} {year}")
            keys.add((name, year))
            require(row["kind"] == "reported", f"Supplemental annual row must be reported: {name} {year}")
            max_supplemental_formula_error = max(max_supplemental_formula_error,
                validate_supplemental_point(row, f"{name} {year}"))
            supplemental_row_count += 1
            status_counts[row["kind"]] += 1
            year_counts[year] += 1
            year_status_counts[year][row["kind"]] += 1
        comparison_keys = set()
        comparisons = company.get("comparisons", [])
        require(len(comparisons) == (0 if company_id == "fox" else 1), f"Unexpected comparison count: {name}")
        for point in comparisons:
            view_year, source_year = point.get("viewYear"), point.get("sourceYear")
            require(view_year == 2026 and source_year == 2025, f"Invalid comparison period: {name}")
            require(view_year not in comparison_keys and view_year not in annual_years,
                    f"Duplicate comparison year or annual overlap: {name} {view_year}")
            comparison_keys.add(view_year)
            expected_type = "proforma" if company_id == "skydance" else "mixed" if company_id == "tubi" else "carry"
            require(point.get("comparisonType") == expected_type, f"Invalid comparison type: {name}")
            require(point["kind"] == ("reported" if expected_type == "carry" else "estimate"),
                    f"Invalid comparison status: {name}")
            max_supplemental_formula_error = max(max_supplemental_formula_error,
                validate_supplemental_point(point, f"{name} comparison in {view_year}"))
            if expected_type == "carry":
                source_row = next(row for row in annual_rows if row["year"] == source_year)
                require(all(point[key] == source_row[key] for key in ("revenue", "headcount", "rpe")),
                        f"Carried values differ from their source year: {name}")
            if company_id == "tubi":
                require(point.get("revenueFloor") is True, "Tubi must retain its revenue-floor qualifier")
            comparison_count += 1
            comparison_year_counts[view_year] += 1
            comparison_status_counts[point["kind"]] += 1
        companies[name] = company
    require(supplemental_row_count == 25 and comparison_count == 5, "Unexpected supplemental coverage totals")
    total_rows = len(source_rows) + supplemental_row_count

    hashes = {
        "revenue": hashlib.sha256(REVENUE_FILE.read_bytes()).hexdigest(),
        "events": hashlib.sha256(EVENT_FILE.read_bytes()).hexdigest(),
    }
    require(hashes == EXPECTED_SOURCE_HASHES, "Original source CSV bytes changed")
    hashes["streaming"] = hashlib.sha256(STREAMING_FILE.read_bytes()).hexdigest()
    meta = {
        "title": "Revenue per employee — original dataset and streaming additions",
        "author": "Derrick Ongchin",
        "retrieved": "2026-10-28",
        "sourceUrl": "https://www.derrickongchin.com/analysis/ai-efficiency-era",
        "sources": {
            "analysis": "https://www.derrickongchin.com/analysis/ai-efficiency-era",
            "revenue": "https://www.derrickongchin.com/data/ai-efficiency-era/revenue_per_employee_dataset.csv",
            "events": "https://www.derrickongchin.com/data/ai-efficiency-era/layoff_markers.csv",
            "anthropicS1": "https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm",
            "streaming": "data/streaming_companies.json",
        },
        "companyCount": len(companies),
        "baseCompanyCount": base_company_count,
        "supplementalCompanyCount": len(added_companies),
        "rowCount": total_rows,
        "baseRowCount": len(source_rows),
        "supplementalRowCount": supplemental_row_count,
        "comparisonCount": comparison_count,
        "eventCount": len(events),
        "counts": {"companies": len(companies), "observations": total_rows, "events": len(events),
                   "comparisons": comparison_count, "baseCompanies": base_company_count,
                   "supplementalCompanies": len(added_companies), "baseObservations": len(source_rows),
                   "supplementalObservations": supplemental_row_count},
        "years": YEARS,
        "yearCounts": dict(sorted(year_counts.items())),
        "baseYearCounts": dict(sorted(base_year_counts.items())),
        "comparisonYearCounts": dict(sorted(comparison_year_counts.items())),
        "displayYearCounts": {year: year_counts[year] + comparison_year_counts[year] for year in YEARS},
        "statusCounts": dict(sorted(status_counts.items())),
        "baseStatusCounts": dict(sorted(base_status_counts.items())),
        "comparisonStatusCounts": dict(sorted(comparison_status_counts.items())),
        "yearStatusCounts": {year: dict(sorted(year_status_counts[year].items())) for year in YEARS},
        "baseYearStatusCounts": {year: dict(sorted(base_year_status_counts[year].items())) for year in YEARS},
        "sha256": hashes,
        "units": {"revenue": "USD billions", "rpe": "USD millions per employee or stated workforce unit", "headcount": "employees; company-specific FTE/full-time/team bases are labeled"},
        "cohortNote": "Original display cohorts remain mutually exclusive editorial groupings, separate from the unmodified source Group field. The Streaming & media filter additionally includes Netflix, Spotify, Alphabet, Amazon and Apple via streaming membership; consolidated parent figures are not standalone service metrics.",
        "statusNote": "For the original 51 companies, Reported means the source labels a row Actual; it does not mean independently verified. Mixed Actual/Estimate rows remain estimates. Supplemental annual rows use cited company filings; comparison records are separately labeled and excluded from annual observation counts.",
        "eventNote": "Events are year-level source restructuring annotations. Some are qualitative business changes, not layoff counts; they are not independently verified.",
        "coverageNote": "OpenAI and Anthropic begin in 2023. No earlier observations are inferred. Original annual and fiscal-year periods, estimates, projections, and run rates are mixed. Disney, Comcast and Roku have 2019–2025 annual rows; Fox has 2023–2026. Separate 2026-view comparisons carry FY2025 values for Disney, Comcast and Roku and add Skydance merger pro forma and Tubi mixed-date estimates. They are not FY2026 annual observations.",
        "referenceNote": "The screenshot uses a separate Anthropic Sep 2026 TTM threshold (> $6.6M; approximately 5,300 employees) and carries OpenAI's 2025 estimate into the 2026 view. Neither replaces the original CSV rows here.",
    }
    payload = {"meta": meta, "companies": sorted(companies.values(), key=lambda company: company["name"].lower()), "events": events}
    serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    (DATA / "data.js").write_text("/* Generated by scripts/build-data.py; source CSV values preserved. */\nwindow.EFFICIENCY_DATA = " + serialized + ";\n", encoding="utf-8")
    print(json.dumps({
        "companies": len(companies), "baseCompanies": base_company_count,
        "supplementalCompanies": len(added_companies), "rows": total_rows,
        "baseRows": len(source_rows), "supplementalRows": supplemental_row_count,
        "comparisons": comparison_count, "events": len(events),
        "yearCounts": dict(sorted(year_counts.items())),
        "comparisonYearCounts": dict(sorted(comparison_year_counts.items())),
        "statusCounts": dict(sorted(status_counts.items())),
        "maxFormulaError": max_formula_error,
        "maxSupplementalFormulaError": max_supplemental_formula_error, "sha256": hashes,
        "output": str(DATA / "data.js"),
    }, indent=2))


if __name__ == "__main__":
    main()
