# VN Auto & Motorbike Sales

Monthly unit sales tracker for Vietnam's car market (VAMA members, VinFast, Hyundai Thanh Cong)
and Honda Vietnam motorbikes.

Sources: VAMA association reports, VinFast SEC 6-K filings, Hyundai Thanh Cong press releases,
Honda Vietnam press releases, Vietnam Customs (truck imports by origin).

## Public dashboard (GitHub Pages)

A static, no-login dashboard is published from [`docs/`](docs/):

**https://hoenhoen2409-hub.github.io/cars-tracking-/**

*(enable once: repo Settings → Pages → Source = "Deploy from a branch" → Branch `main` / `docs`.)*

It reads pre-built JSON in `docs/data/` — there's no backend, so it costs nothing to host and
loads instantly.

### Updating the data

1. Edit `data/monthly_summary.csv` / `data/monthly_honda_motorbike_sales.csv` / `data/monthly_customs_truck_imports.csv`
   (Vietnam Customs monthly CBU import reports, customs.gov.vn pageId=442).
2. Regenerate the site data:
   ```
   pip install -r requirements.txt
   python export_site_data.py
   ```
3. Commit both the CSV change and the regenerated `docs/data/*.json`, then push to `main` —
   GitHub Pages redeploys automatically within a minute or two.

### Automated monthly update

A scheduled Claude Code cloud routine runs on the 15th of each month: it runs
`python scripts/scrape_customs_trucks.py` (appends any new Customs truck-import
months, back-deriving a skipped month from the next report), fills new VAMA /
VinFast / Hyundai TC / Honda months from their published sources, regenerates
`docs/data/*.json`, and pushes to `main`. `data/monthly_vama_segments.csv` is
sourced from an internal tracker and is still updated by hand.

## Local interactive app (Streamlit)

For ad-hoc exploration (brand multiselect, year-range slider) rather than the fixed dashboard:

```
pip install -r requirements.txt
streamlit run app.py
```
