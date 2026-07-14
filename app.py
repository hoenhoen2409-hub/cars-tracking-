"""
Vietnam Auto & Motorbike Sales Dashboard
Data sources: VAMA (car members), VinFast (SEC 6-K), Hyundai Thanh Cong (press releases),
Honda Vietnam (motorbike press releases).
"""

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

st.set_page_config(page_title="VN Auto & Motorbike Sales", layout="wide")

DATA_DIR = Path(__file__).parent / "data"

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


@st.cache_data
def load_car_data():
    df = pd.read_csv(DATA_DIR / "monthly_summary.csv")
    df["period"] = pd.to_datetime(dict(year=df["year"], month=df["month"], day=1))
    return df.sort_values("period").reset_index(drop=True)


@st.cache_data
def load_moto_data():
    df = pd.read_csv(DATA_DIR / "monthly_honda_motorbike_sales.csv")
    df["period"] = pd.to_datetime(dict(year=df["year"], month=df["month"], day=1))
    return df.sort_values("period").reset_index(drop=True)


def pct_change_label(current, previous):
    if pd.isna(current) or pd.isna(previous) or previous == 0:
        return "n/a"
    change = (current - previous) / previous * 100
    arrow = "▲" if change >= 0 else "▼"
    return f"{arrow} {change:+.1f}%"


def mom_pct_series(df, col):
    """% change vs the actual prior calendar month (looked up by date, not by row position),
    so gaps in the data don't silently produce a wrong MoM% against a non-adjacent month."""
    lookup = df.set_index("period")[col]
    prev_period = df["period"] - pd.DateOffset(months=1)
    prev_value = prev_period.map(lookup)
    return (df[col] - prev_value) / prev_value * 100


def kpi_row(df, value_col, label):
    if not df[value_col].notna().any():
        st.info(f"No data available for {label}.")
        return

    latest = df.dropna(subset=[value_col]).iloc[-1]
    latest_period = latest["period"]
    latest_value = latest[value_col]

    mom_row = df[df["period"] == (latest_period - pd.DateOffset(months=1))]
    mom_value = mom_row[value_col].iloc[0] if len(mom_row) else None

    yoy_row = df[df["period"] == (latest_period - pd.DateOffset(years=1))]
    yoy_value = yoy_row[value_col].iloc[0] if len(yoy_row) else None

    ytd_current = df[(df["period"].dt.year == latest_period.year) & (df["period"] <= latest_period)][value_col].sum()
    prior_year_same_span = df[
        (df["period"].dt.year == latest_period.year - 1)
        & (df["period"].dt.month <= latest_period.month)
    ][value_col].sum()

    c1, c2, c3, c4 = st.columns(4)
    c1.metric(f"{label} — {latest_period.strftime('%m/%Y')}", f"{latest_value:,.0f}")
    c2.metric("Month-over-month (MoM)", pct_change_label(latest_value, mom_value))
    c3.metric("Year-over-year (YoY)", pct_change_label(latest_value, yoy_value))
    if prior_year_same_span > 0:
        c4.metric(f"{latest_period.year} Year-to-date (YTD)", f"{ytd_current:,.0f}", pct_change_label(ytd_current, prior_year_same_span))
    else:
        c4.metric(f"{latest_period.year} Year-to-date (YTD)", f"{ytd_current:,.0f}")
        c4.caption("Not enough prior-year data for comparison")


st.title("Vietnam Auto & Motorbike Sales Dashboard")
st.caption(
    "Sources: VAMA (association members), VinFast (SEC 6-K filings), Hyundai Thanh Cong "
    "(press releases), Honda Vietnam (motorbike press releases). Unit: vehicles sold/month."
)

tab_cars, tab_moto = st.tabs(["🚗 Cars", "🏍️ Honda Motorbikes"])

# ---------------------------------------------------------------- CARS TAB
with tab_cars:
    car_df = load_car_data()
    all_years = sorted(car_df["year"].unique())

    filter_col1, filter_col2 = st.columns([1, 2])
    with filter_col1:
        year_range = st.select_slider(
            "Year range", options=all_years, value=(all_years[0], all_years[-1]), key="car_year_range"
        )
    with filter_col2:
        selected_brands = st.multiselect(
            "Select brand(s)",
            options=list(CAR_BRAND_COLUMNS.keys()),
            default=["Toyota", "Honda (car)", "VinFast", "Hyundai (Thanh Cong)"],
            key="car_brands",
        )

    filtered = car_df[(car_df["year"] >= year_range[0]) & (car_df["year"] <= year_range[1])]

    st.subheader("Market Overview")
    st.caption(
        "total_market = total_vama + vinfast + hyundai_tc, calculated only when all 3 sources "
        "have data for that month (fully available from 12/2024 onward). total_vama = sum of "
        "VAMA member brands (excludes VinFast, excludes Hyundai Thanh Cong)."
    )
    kpi_row(filtered, "total_market", "Total Market (VAMA+VinFast+Hyundai)")

    st.divider()

    if not selected_brands:
        st.warning("Select at least 1 brand to view the chart/table.")
    else:
        st.subheader("Monthly Trend")
        fig = go.Figure()
        for brand_label in selected_brands:
            col = CAR_BRAND_COLUMNS[brand_label]
            fig.add_trace(
                go.Scatter(
                    x=filtered["period"], y=filtered[col], mode="lines+markers",
                    name=brand_label, connectgaps=False,
                )
            )
        fig.update_layout(
            xaxis_title="Month", yaxis_title="Vehicles sold", hovermode="x unified",
            legend=dict(orientation="h", yanchor="bottom", y=1.02), height=480,
        )
        st.plotly_chart(fig, use_container_width=True)

        st.subheader("Detail Table + MoM % Change")
        display_df = filtered[["period"]].copy()
        for brand_label in selected_brands:
            col = CAR_BRAND_COLUMNS[brand_label]
            display_df[brand_label] = filtered[col]
            display_df[f"{brand_label} MoM%"] = mom_pct_series(filtered, col)

        display_df = display_df.sort_values("period", ascending=False)
        display_df["period"] = display_df["period"].dt.strftime("%m/%Y")

        number_cols = {b: st.column_config.NumberColumn(format="%.0f") for b in selected_brands}
        pct_cols = {f"{b} MoM%": st.column_config.NumberColumn(format="%+.1f%%") for b in selected_brands}
        column_config = {**number_cols, **pct_cols}

        st.dataframe(display_df.set_index("period"), use_container_width=True, column_config=column_config)

        csv_bytes = display_df.to_csv(index=False).encode("utf-8-sig")
        st.download_button("Download table (CSV)", csv_bytes, "car_sales_filtered.csv", "text/csv", key="car_dl")

# --------------------------------------------------------------- MOTO TAB
with tab_moto:
    moto_df = load_moto_data()
    moto_years = sorted(moto_df["year"].unique())

    moto_year_range = st.select_slider(
        "Year range", options=moto_years, value=(moto_years[0], moto_years[-1]), key="moto_year_range"
    )
    moto_filtered = moto_df[(moto_df["year"] >= moto_year_range[0]) & (moto_df["year"] <= moto_year_range[1])]

    st.subheader("Honda Vietnam — Monthly Motorbike Sales")
    st.caption("Data only available from 09/2024 onward (Honda VN did not publish monthly reports on its website before then).")
    kpi_row(moto_filtered, "honda_motorbike_sales", "Honda Motorbikes")

    st.divider()

    fig_moto = go.Figure()
    fig_moto.add_trace(
        go.Bar(x=moto_filtered["period"], y=moto_filtered["honda_motorbike_sales"],
               name="Honda motorbike sales", marker_color="#C8952A")
    )
    fig_moto.update_layout(xaxis_title="Month", yaxis_title="Motorbikes sold", height=450)
    st.plotly_chart(fig_moto, use_container_width=True)

    st.subheader("Detail Table")
    moto_table = moto_filtered[["period", "honda_motorbike_sales"]].copy()
    moto_table["MoM%"] = mom_pct_series(moto_filtered, "honda_motorbike_sales")
    moto_table = moto_table.sort_values("period", ascending=False)
    moto_table["period"] = moto_table["period"].dt.strftime("%m/%Y")
    moto_table = moto_table.rename(columns={"honda_motorbike_sales": "Units sold"})

    st.dataframe(
        moto_table.set_index("period"),
        use_container_width=True,
        column_config={
            "Units sold": st.column_config.NumberColumn(format="%.0f"),
            "MoM%": st.column_config.NumberColumn(format="%+.1f%%"),
        },
    )

    csv_bytes_moto = moto_table.to_csv(index=False).encode("utf-8-sig")
    st.download_button("Download table (CSV)", csv_bytes_moto, "honda_motorbike_filtered.csv", "text/csv", key="moto_dl")
