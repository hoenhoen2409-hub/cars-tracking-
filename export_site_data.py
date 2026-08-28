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


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cars = build_cars_json()
    motos = build_motos_json()

    (OUT_DIR / "cars.json").write_text(json.dumps(cars, indent=2), encoding="utf-8")
    (OUT_DIR / "motos.json").write_text(json.dumps(motos, indent=2), encoding="utf-8")
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
    print(f"Wrote {len(cars)} car rows and {len(motos)} moto rows to {OUT_DIR}")


if __name__ == "__main__":
    main()
