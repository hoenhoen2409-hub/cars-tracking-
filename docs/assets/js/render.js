// Pure rendering helpers: plain data in, HTML/SVG strings or DOM writes out.
// No framework -- at this scale (tens of rows) it isn't needed.

const BRAND_COLORS = {
  "Toyota": "#0051CC",
  "Ford": "#DC2626",
  "Mitsubishi": "#F59E0B",
  "Honda (car)": "#008478",
  "Peugeot": "#7C3AED",
  "Thaco (total)": "#171819",
  "Others (VAMA)": "#ACAEB0",
  "VinFast": "#0AA630",
  "Hyundai (Thanh Cong)": "#DB2777",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtInt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

function fmtCompact(v) {
  if (v >= 1000) {
    const k = v / 1000;
    return (Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)) + "k";
  }
  return String(Math.round(v));
}

function fmtPeriodLabel(period) {
  const [y, m] = period.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${y}`;
}

function fmtPeriodShort(period) {
  const [y, m] = period.split("-");
  return `${m}/${y.slice(2)}`;
}

// VAMA members only (excludes VinFast and Hyundai Thanh Cong, neither of
// which is a VAMA member). Sums whatever brands are confirmed for the month
// rather than requiring all of them -- `complete` says whether any were
// missing, so callers can show a running total plus a "partial" flag
// instead of hiding the number entirely until every brand is in.
const VAMA_MEMBER_BRANDS = ["Toyota", "Ford", "Mitsubishi", "Honda (car)", "Peugeot", "Thaco (total)", "Others (VAMA)"];

function carVamaPartial(row) {
  let sum = 0;
  let complete = true;
  for (const label of VAMA_MEMBER_BRANDS) {
    const v = row.brands[label];
    if (v == null) complete = false;
    else sum += v;
  }
  return { value: sum, complete };
}

function carMarketExVinFast(row) {
  const vama = carVamaPartial(row);
  const htc = row.brands["Hyundai (Thanh Cong)"];
  return { value: vama.value + (htc ?? 0), complete: vama.complete && htc != null };
}

function carMarketTotal(row) {
  const exVf = carMarketExVinFast(row);
  const vf = row.brands["VinFast"];
  return { value: exVf.value + (vf ?? 0), complete: exVf.complete && vf != null };
}

function shiftPeriod(period, deltaMonths) {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function pctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function pctSpanHtml(pct, { arrows = true } = {}) {
  if (pct == null || Number.isNaN(pct)) return `<span class="muted">n/a</span>`;
  const dir = pct >= 0 ? "up" : "down";
  const arrow = arrows ? (pct >= 0 ? "▲ " : "▼ ") : "";
  return `<span class="${dir}">${arrow}${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
}

// A rowsByPeriod entry is either a plain number (the simple case used by
// the top-summary and moto KPIs) or a {value, complete} pair (the cars
// KPIs, from carMarketTotal/carMarketExVinFast) -- either way, only the
// value is needed here.
function entryValue(v) {
  if (v == null) return null;
  if (typeof v === "object") return v.value;
  return v;
}

// -------------------------------------------------------------- KPI block
// Mirrors the MoM / YoY / YTD-vs-prior-year-YTD logic in the original
// Streamlit app's kpi_row(), just re-derived client-side against the
// {period -> value} lookup instead of a pandas frame.
function kpisAnchoredAt(rowsByPeriod, latestPeriod, valueLabel) {
  const latestValue = entryValue(rowsByPeriod[latestPeriod]);
  const momValue = entryValue(rowsByPeriod[shiftPeriod(latestPeriod, -1)]);
  const yoyValue = entryValue(rowsByPeriod[shiftPeriod(latestPeriod, -12)]);

  const [latestYear, latestMonth] = latestPeriod.split("-").map(Number);
  let ytdCurrent = 0;
  let ytdPrior = 0;
  let havePrior = false;
  for (let m = 1; m <= latestMonth; m++) {
    const p = `${latestYear}-${String(m).padStart(2, "0")}`;
    const v = entryValue(rowsByPeriod[p]);
    if (v != null) ytdCurrent += v;

    const pPrior = `${latestYear - 1}-${String(m).padStart(2, "0")}`;
    const vPrior = entryValue(rowsByPeriod[pPrior]);
    if (vPrior != null) {
      ytdPrior += vPrior;
      havePrior = true;
    }
  }

  return {
    label: valueLabel,
    latestPeriod,
    latestValue,
    momPct: pctChange(latestValue, momValue),
    yoyPct: pctChange(latestValue, yoyValue),
    ytdCurrent,
    ytdPriorPct: havePrior ? pctChange(ytdCurrent, ytdPrior) : null,
    latestYear,
  };
}

function computeKpis(rowsByPeriod, periods, valueLabel) {
  const validPeriods = periods.filter((p) => rowsByPeriod[p] != null);
  if (!validPeriods.length) return null;
  return kpisAnchoredAt(rowsByPeriod, validPeriods[validPeriods.length - 1], valueLabel);
}

// Same MoM/YoY/YTD math as computeKpis, but always anchored on the exact
// `refPeriod` given -- e.g. the user's "Month to" selection -- instead of
// searching backward for the latest period with a non-null value. If
// refPeriod itself has no data yet, the value card shows "-" rather than
// silently substituting an earlier month.
function computeKpisAt(rowsByPeriod, refPeriod, valueLabel) {
  return kpisAnchoredAt(rowsByPeriod, refPeriod, valueLabel);
}

function renderKpis4(containerEl, kpis) {
  if (!kpis) {
    containerEl.innerHTML = `<div class="empty-state">No data available.</div>`;
    return;
  }
  const cards = [
    { lbl: `${kpis.label} — ${fmtPeriodLabel(kpis.latestPeriod)}`, val: fmtInt(kpis.latestValue), sub: "" },
    { lbl: "Month-over-month (MoM)", val: null, pct: kpis.momPct },
    { lbl: "Year-over-year (YoY)", val: null, pct: kpis.yoyPct },
    {
      lbl: `${kpis.latestYear} Year-to-date (YTD)`,
      val: fmtInt(kpis.ytdCurrent),
      sub: kpis.ytdPriorPct == null ? "Not enough prior-year data" : "",
      pct: kpis.ytdPriorPct,
    },
  ];
  containerEl.innerHTML = cards
    .map((c) => {
      const mainHtml =
        c.val != null
          ? `<div class="val">${escapeHtml(c.val)}${c.pct != null ? ` <small>${pctSpanHtml(c.pct)}</small>` : ""}</div>`
          : `<div class="val ${c.pct != null && c.pct >= 0 ? "up" : c.pct != null ? "down" : ""}">${pctSpanHtml(c.pct)}</div>`;
      return `
      <div class="kpi">
        <div class="lbl">${escapeHtml(c.lbl)}</div>
        ${mainHtml}
        ${c.sub ? `<div class="sub">${escapeHtml(c.sub)}</div>` : ""}
      </div>`;
    })
    .join("");
}

// ------------------------------------------------------------- top hero
function renderHero(carsLatest, motoLatest, generatedAt) {
  document.getElementById("hero-meta").textContent =
    `DATA AS OF ${carsLatest ? fmtPeriodLabel(carsLatest).toUpperCase() : "—"} (CARS) · ${motoLatest ? fmtPeriodLabel(motoLatest).toUpperCase() : "—"} (MOTORBIKES)`;
  document.getElementById("footer-generated").textContent = `Generated ${generatedAt}`;
}

// -------------------------------------------------------- top-summary --
function renderTopSummary(carRows, brandLabels) {
  const periods = carRows.map((r) => r.period);
  const marketByPeriod = Object.fromEntries(carRows.map((r) => [r.period, r.total_market]));
  const kpis = computeKpis(marketByPeriod, periods, "Total Market");

  document.getElementById("ts-kpi-date").textContent = kpis ? `AS OF ${fmtPeriodLabel(kpis.latestPeriod)}` : "";
  document.getElementById("ts-kpi-value").textContent = kpis ? fmtInt(kpis.latestValue) : "—";
  document.getElementById("ts-kpi-label").textContent = "Total Market (VAMA + VinFast + Hyundai TC)";
  document.getElementById("ts-kpi-sub").innerHTML = kpis
    ? `MoM ${pctSpanHtml(kpis.momPct)} &middot; YoY ${pctSpanHtml(kpis.yoyPct)}`
    : "Not enough data yet";

  const latestRow = carRows[carRows.length - 1];
  const shares = brandLabels
    .map((label) => ({ label, value: latestRow.brands[label] }))
    .filter((b) => b.value != null && b.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = shares.reduce((s, b) => s + b.value, 0) || 1;
  const top5 = shares.slice(0, 5);
  const rest = shares.slice(5).reduce((s, b) => s + b.value, 0);

  document.getElementById("bm-track").innerHTML =
    top5.map((b) => `<i style="width:${(b.value / total) * 100}%; background:${BRAND_COLORS[b.label]}"></i>`).join("") +
    (rest > 0 ? `<i style="width:${(rest / total) * 100}%; background:var(--rule-3)"></i>` : "");
  document.getElementById("bm-legend").innerHTML =
    top5.map((b) => `<span><i style="background:${BRAND_COLORS[b.label]}"></i>${escapeHtml(b.label)} ${((b.value / total) * 100).toFixed(0)}%</span>`).join("") +
    (rest > 0 ? `<span><i style="background:var(--rule-3)"></i>Others ${((rest / total) * 100).toFixed(0)}%</span>` : "");

  const maxShare = Math.max(1, ...top5.map((b) => b.value));
  document.getElementById("contrib-rows").innerHTML = top5
    .map(
      (b) => `
      <div class="ranked-row">
        <div class="rl-label">${escapeHtml(b.label)}</div>
        <div class="rl-bar"><i style="width:${(b.value / maxShare) * 100}%; background:${BRAND_COLORS[b.label]}"></i></div>
        <div class="rl-value tnum">${fmtInt(b.value)}</div>
      </div>`
    )
    .join("");

  const priorPeriod = shiftPeriod(latestRow.period, -1);
  const priorRow = carRows.find((r) => r.period === priorPeriod);
  const movers = brandLabels
    .map((label) => {
      const cur = latestRow.brands[label];
      const prev = priorRow ? priorRow.brands[label] : null;
      return { label, cur, prev, pct: pctChange(cur, prev) };
    })
    .filter((m) => m.pct != null)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 5);

  document.getElementById("ranked-events").innerHTML = movers
    .map((m) => {
      const dir = m.pct >= 0 ? "up" : "down";
      return `
      <div class="ranked-event">
        <span class="re-dot" style="background:${m.pct >= 0 ? "var(--act-add)" : "var(--act-exit)"}"></span>
        <div class="re-body">
          <span class="re-title">${escapeHtml(m.label)}</span>
          <div class="re-desc">${fmtInt(m.prev)} → ${fmtInt(m.cur)} units</div>
        </div>
        <div class="re-score ${dir} tnum">${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}%</div>
      </div>`;
    })
    .join("");
}

// ------------------------------------------------------------ line chart
// yFormat/tooltipFormat let callers reuse this for non-unit series (e.g.
// percentage share) without duplicating the whole chart -- default to the
// same compact-number formatting the unit charts (car/moto) always used.
function renderLineChart(containerEl, periods, series, { yFormat = fmtCompact, tooltipFormat = fmtInt } = {}) {
  if (!periods.length || !series.length) {
    containerEl.innerHTML = `<div class="empty-state">Select at least one brand.</div>`;
    return;
  }
  const W = 960, H = 320, padL = 44, padR = 16, padT = 16, padB = 26;
  const allVals = series.flatMap((s) => s.values.filter((v) => v != null));
  const maxV = Math.max(1, ...allVals);
  const x = (i) => padL + (i / Math.max(1, periods.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / maxV) * (H - padT - padB);

  const gridVals = [0, maxV / 2, maxV];
  const grid = gridVals
    .map((v) => `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${(y(v) + 4).toFixed(1)}">${yFormat(v)}</text>`)
    .join("");

  let marks = "";
  series.forEach((s) => {
    const segments = [];
    let cur = [];
    periods.forEach((p, i) => {
      const v = s.values[i];
      if (v == null) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else {
        cur.push([i, v]);
      }
    });
    if (cur.length) segments.push(cur);

    segments.forEach((seg) => {
      const d = seg.map(([i, v], idx) => `${idx === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      marks += `<path class="chart-line" d="${d}" style="stroke:${s.color}" />`;
    });
    periods.forEach((p, i) => {
      const v = s.values[i];
      if (v == null) return;
      marks += `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" style="stroke:${s.color}"><title>${escapeHtml(s.label)} · ${fmtPeriodLabel(p)}: ${tooltipFormat(v)}</title></circle>`;
    });
  });

  const tickIdx = periods.length > 1 ? [0, Math.floor((periods.length - 1) / 2), periods.length - 1] : [0];
  const xLabels = [...new Set(tickIdx)]
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtPeriodShort(periods[i])}</text>`)
    .join("");

  containerEl.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}${marks}${xLabels}</svg>`;
}

function renderChartLegend(containerEl, series) {
  containerEl.innerHTML = series
    .map((s) => `<span><i style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`)
    .join("");
}

// ------------------------------------------------------------- bar chart
function renderBarChart(containerEl, periods, values) {
  if (!periods.length) {
    containerEl.innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  const W = 960, H = 300, padL = 44, padR = 16, padT = 16, padB = 26;
  const maxV = Math.max(1, ...values.filter((v) => v != null));
  const n = periods.length;
  const slot = (W - padL - padR) / n;
  const barW = Math.max(2, slot * 0.55);
  const x = (i) => padL + i * slot + (slot - barW) / 2;
  const y = (v) => H - padB - (v / maxV) * (H - padT - padB);

  const gridVals = [0, maxV / 2, maxV];
  const grid = gridVals
    .map((v) => `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${(y(v) + 4).toFixed(1)}">${fmtCompact(v)}</text>`)
    .join("");

  const bars = periods
    .map((p, i) => {
      const v = values[i];
      if (v == null) return "";
      const h = H - padB - y(v);
      return `<rect x="${x(i).toFixed(1)}" y="${y(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${fmtPeriodLabel(p)}: ${fmtInt(v)}</title></rect>`;
    })
    .join("");

  const tickIdx = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  const xLabels = [...new Set(tickIdx)]
    .map((i) => `<text x="${(x(i) + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtPeriodShort(periods[i])}</text>`)
    .join("");

  containerEl.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}"><g class="chart-bar">${grid}${bars}</g>${xLabels}</svg>`;
}

// ------------------------------------------------- market structure (§3)
// Everything below works from the brand-level monthly units already in
// cars.json -- no per-model or per-powertrain data is scraped, so these
// are the trends that CAN be derived from what's tracked today: brand mix
// shift, VinFast (100% BEV, used as an EV proxy) share of the market, and
// annual brand totals/CAGR. A true Hybrid/Gasoline/BEV split per brand or
// VAMA's passenger/commercial/special segmentation would need additional
// scraping this tracker doesn't do yet.

function fmtPct1(v) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

// Sum of every tracked brand column that's confirmed for the month -- the
// denominator for "share of tracked brands" below. Not a claim about the
// true total market: recent months are still missing "Others" (Suzuki,
// Isuzu, Mercedes-Benz, ...), same caveat as carVamaPartial elsewhere.
function carRowKnownTotal(row) {
  let sum = 0;
  for (const label of Object.keys(BRAND_COLORS)) {
    const v = row.brands[label];
    if (v != null) sum += v;
  }
  return sum;
}

function carShareSeries(rows) {
  return Object.keys(BRAND_COLORS).map((label) => ({
    label,
    color: BRAND_COLORS[label],
    values: rows.map((r) => {
      const v = r.brands[label];
      if (v == null) return null;
      const denom = carRowKnownTotal(r);
      return denom > 0 ? (v / denom) * 100 : null;
    }),
  }));
}

function renderShareChart(chartEl, legendEl, rows) {
  const periods = rows.map((r) => r.period);
  const series = carShareSeries(rows);
  renderLineChart(chartEl, periods, series, { yFormat: (v) => `${Math.round(v)}%`, tooltipFormat: fmtPct1 });
  renderChartLegend(legendEl, series);
}

function evShareByPeriod(rows) {
  const out = {};
  rows.forEach((r) => {
    const vf = r.brands["VinFast"];
    const denom = carRowKnownTotal(r);
    out[r.period] = vf != null && denom > 0 ? (vf / denom) * 100 : null;
  });
  return out;
}

function renderEvKpis(containerEl, rows) {
  const shareByPeriod = evShareByPeriod(rows);
  const latestPeriod = rows[rows.length - 1].period;
  const latest = shareByPeriod[latestPeriod] ?? null;
  const mom = shareByPeriod[shiftPeriod(latestPeriod, -1)] ?? null;
  const yoy = shareByPeriod[shiftPeriod(latestPeriod, -12)] ?? null;

  const ppSpan = (cur, prev) => {
    if (cur == null || prev == null) return `<span class="muted">n/a</span>`;
    const d = cur - prev;
    const dir = d >= 0 ? "up" : "down";
    return `<span class="${dir}">${d >= 0 ? "▲ +" : "▼ "}${Math.abs(d).toFixed(1)}pp</span>`;
  };

  const cards = [
    { lbl: `EV (VinFast) share — ${fmtPeriodLabel(latestPeriod)}`, valHtml: escapeHtml(fmtPct1(latest)) },
    { lbl: "vs. 1 month ago", valHtml: ppSpan(latest, mom) },
    { lbl: "vs. 1 year ago", valHtml: ppSpan(latest, yoy) },
  ];
  containerEl.innerHTML = cards
    .map(
      (c) => `
      <div class="kpi">
        <div class="lbl">${escapeHtml(c.lbl)}</div>
        <div class="val">${c.valHtml}</div>
      </div>`
    )
    .join("");
}

function renderEvChart(containerEl, rows) {
  const shareByPeriod = evShareByPeriod(rows);
  const periods = rows.map((r) => r.period);
  const series = [{ label: "VinFast", color: BRAND_COLORS["VinFast"], values: periods.map((p) => shareByPeriod[p]) }];
  renderLineChart(containerEl, periods, series, { yFormat: (v) => `${Math.round(v)}%`, tooltipFormat: fmtPct1 });
}

// { sum, months } per brand per calendar year -- `months` (how many of
// that year's rows had a non-null value for this brand) is what lets the
// CAGR below tell "brand had zero sales" apart from "brand wasn't tracked
// yet that year" (e.g. VinFast in 2023).
function carAnnualTotals(rows) {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const brands = Object.keys(BRAND_COLORS);
  const totals = {};
  brands.forEach((b) => {
    totals[b] = {};
    years.forEach((y) => (totals[b][y] = { sum: 0, months: 0 }));
  });
  const grandTotal = {};
  years.forEach((y) => (grandTotal[y] = 0));

  rows.forEach((r) => {
    brands.forEach((b) => {
      const v = r.brands[b];
      if (v != null) {
        totals[b][r.year].sum += v;
        totals[b][r.year].months += 1;
        grandTotal[r.year] += v;
      }
    });
  });

  const monthsPerYear = Object.fromEntries(years.map((y) => [y, rows.filter((r) => r.year === y).length]));
  return { years, brands, totals, grandTotal, monthsPerYear };
}

function cagrPct(startVal, endVal, numYears) {
  if (startVal == null || endVal == null || startVal <= 0 || numYears <= 0) return null;
  return (Math.pow(endVal / startVal, 1 / numYears) - 1) * 100;
}

function renderAnnualTable(headEl, bodyEl, rows) {
  const { years, brands, totals, grandTotal, monthsPerYear } = carAnnualTotals(rows);
  const fullYears = years.filter((y) => monthsPerYear[y] === 12);
  const firstFullYear = fullYears[0];
  const lastFullYear = fullYears[fullYears.length - 1];
  const cagrYears = firstFullYear != null && lastFullYear != null && lastFullYear > firstFullYear ? lastFullYear - firstFullYear : null;

  headEl.innerHTML =
    `<th class="ta-left">Brand</th>` +
    years.map((y) => `<th>${monthsPerYear[y] < 12 ? `${y} YTD` : y}</th>`).join("") +
    (cagrYears ? `<th>CAGR '${String(firstFullYear).slice(2)}&ndash;'${String(lastFullYear).slice(2)}</th>` : "");

  const brandRows = brands
    .map((b) => {
      const cells = years.map((y) => `<td>${totals[b][y].months > 0 ? fmtInt(totals[b][y].sum) : "—"}</td>`).join("");
      let cagrCell = "";
      if (cagrYears) {
        const startCell = totals[b][firstFullYear];
        const endCell = totals[b][lastFullYear];
        const cagr = startCell.months === 12 && endCell.months === 12 ? cagrPct(startCell.sum, endCell.sum, cagrYears) : null;
        const dir = cagr == null ? "" : cagr >= 0 ? "up" : "down";
        cagrCell = `<td class="pct ${dir}">${cagr == null ? "n/a" : (cagr >= 0 ? "+" : "") + cagr.toFixed(1) + "%"}</td>`;
      }
      return `<tr><td class="ta-left">${escapeHtml(b)}</td>${cells}${cagrCell}</tr>`;
    })
    .join("");

  let totalCagrCell = "";
  if (cagrYears) {
    const totalCagr = cagrPct(grandTotal[firstFullYear], grandTotal[lastFullYear], cagrYears);
    const dir = totalCagr == null ? "" : totalCagr >= 0 ? "up" : "down";
    totalCagrCell = `<td class="pct ${dir}">${totalCagr == null ? "n/a" : (totalCagr >= 0 ? "+" : "") + totalCagr.toFixed(1) + "%"}</td>`;
  }
  const totalRow = `<tr style="font-weight:700; border-top:2px solid var(--ink-1);"><td class="ta-left">Total (tracked brands)</td>${years
    .map((y) => `<td>${fmtInt(grandTotal[y])}</td>`)
    .join("")}${totalCagrCell}</tr>`;

  bodyEl.innerHTML = brandRows + totalRow;
}
