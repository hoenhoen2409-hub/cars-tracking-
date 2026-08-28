# VN Auto & Motorbike Sales

Monthly unit sales tracker for Vietnam's car market (VAMA members, VinFast, Hyundai Thanh Cong)
and Honda Vietnam motorbikes.

Sources: VAMA association reports, VinFast SEC 6-K filings, Hyundai Thanh Cong press releases,
Honda Vietnam press releases.

## Public dashboard (GitHub Pages)

A static, no-login dashboard is published from [`docs/`](docs/):

**https://hoenhoen2409-hub.github.io/cars-tracking-/**

*(enable once: repo Settings → Pages → Source = "Deploy from a branch" → Branch `main` / `docs`.)*

It reads pre-built JSON in `docs/data/` — there's no backend, so it costs nothing to host and
loads instantly.

### Updating the data

1. Edit `data/monthly_summary.csv` / `data/monthly_honda_motorbike_sales.csv`.
2. Regenerate the site data:
   ```
   pip install -r requirements.txt
   python export_site_data.py
   ```
3. Commit both the CSV change and the regenerated `docs/data/*.json`, then push to `main` —
   GitHub Pages redeploys automatically within a minute or two.

## Local interactive app (Streamlit)

For ad-hoc exploration (brand multiselect, year-range slider) rather than the fixed dashboard:

```
pip install -r requirements.txt
streamlit run app.py
```
