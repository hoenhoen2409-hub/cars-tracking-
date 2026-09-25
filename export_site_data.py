"""
Build the static JSON files consumed by docs/index.html (GitHub Pages) from
the source CSVs in data/. Run this after updating the CSVs, then commit the
regenerated docs/data/*.json alongside the CSV change.

    python export_site_data.py
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
OUT_DIR = Path(__file__).parent / "docs" / "data"

CAR_BRAND_COLUMNS = {
    "Toyota": "toyota",
    "Ford": "ford",
    "Mitsubishi": "mitsubishi",
    "Honda (car)": "honda",
    "Peugeot": "peugeot",
    "Thaco (total)": "thaco_total",
    "Others (VAMA)": "others",
    "VinFast": "vinfast",
    "Hyundai (Thanh Cong)": "hyundai_tc",
}


def clean(value):
    """NaN -> None so json.dumps emits null instead of the invalid literal NaN."""
    if pd.isna(value):
        return None
    return value


def build_cars_json():
    df = pd.read_csv(DATA_DIR / "monthly_summary.csv")
    df["period"] = pd.to_datetime(dict(year=df["year"], month=df["month"], day=1))
    df = df.sort_values("period").reset_index(drop=True)

    rows = []
    for _, r in df.iterrows():
        row = {
            "period": r["period"].strftime("%Y-%m"),
            "year": int(r["year"]),
            "month": int(r["month"]),
            "brands": {label: clean(r[col]) for label, col in CAR_BRAND_COLUMNS.items()},
            "total_market": clean(r["total_market"]),
            # VAMA's own whole-industry total (members + imported CBU from
            # non-members), from its Cover Letter report -- NOT the same as
            # summing the VAMA-member brand columns above (see
            # carTotalIndustry in render.js).
            "vamaIndustryTotal": clean(r["vama_industry_total"]),
        }
        rows.append(row)
    return rows


def build_motos_json():
    df = pd.read_csv(DATA_DIR / "monthly_honda_motorbike_sales.csv")
    df["period"] = pd.to_datetime(dict(year=df["year"], month=df["month"], day=1))
    df = df.sort_values("period").reset_index(drop=True)

    rows = []
    for _, r in df.iterrows():
        rows.append(
            {
                "period": r["period"].strftime("%Y-%m"),
                "year": int(r["year"]),
                "month": int(r["month"]),
                "sales": clean(r["honda_motorbike_sales"]),
                "source_url": r["source_url"],
            }
        )
    return rows


SEGMENT_COLUMNS = [
    "total",
    "passenger_cars",
    "commercial_vehicles",
    "trucks",
    "buses",
    "special_purpose",
    "bev",
    "hybrid",
    "bus_chassis",
    "passenger_cars_incl_hyundai",
]


def build_segments_json():
    """total/passenger_cars/commercial_vehicles/special_purpose are VAMA's
    whole-industry figures (VAMA members + imported CBU from non-members,
    same basis as cars.json's vamaIndustryTotal), sourced from a Dragon
    Capital analyst's internal tracker (bottom-up per-model PC/CV/SPV
    classification), not VAMA's own published PDFs -- see source_url per
    row. passenger_cars_incl_hyundai adds Hyundai Thanh Cong's volume
    directly into the PC total without splitting it into PC/CV/SPV itself
    (no model-level segment tags exist for Hyundai TC in that tracker).
    trucks/buses/bev/hybrid/bus_chassis remain VAMA-members-only (from
    VAMA's own Summary report -- no whole-industry equivalent for those);
    VinFast isn't a line item here -- see cars.json for VinFast-share-of-
    market figures."""
    df = pd.read_csv(DATA_DIR / "monthly_vama_segments.csv")
    df["period"] = pd.to_datetime(dict(year=df["year"], month=df["month"], day=1))
    df = df.sort_values("period").reset_index(drop=True)

    rows = []
    for _, r in df.iterrows():
        rows.append(
            {
                "period": r["period"].strftime("%Y-%m"),
                "year": int(r["year"]),
                "month": int(r["month"]),
                **{col: clean(r[col]) for col in SEGMENT_COLUMNS},
            }
        )
    return rows


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cars = build_cars_json()
    motos = build_motos_json()
    segments = build_segments_json()

    (OUT_DIR / "cars.json").write_text(json.dumps(cars, indent=2), encoding="utf-8")
    (OUT_DIR / "motos.json").write_text(json.dumps(motos, indent=2), encoding="utf-8")
    (OUT_DIR / "segments.json").write_text(json.dumps(segments, indent=2), encoding="utf-8")
    (OUT_DIR / "meta.json").write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "latest_car_period": cars[-1]["period"] if cars else None,
                "latest_moto_period": motos[-1]["period"] if motos else None,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(cars)} car rows, {len(motos)} moto rows, {len(segments)} segment rows to {OUT_DIR}")


if __name__ == "__main__":
    main()
