// Pure rendering helpers: plain data in, HTML/SVG strings or DOM writes out.
// No framework -- at this scale (tens of rows) it isn't needed.

// "Others" = Ford + Mitsubishi + Peugeot + VAMA's remaining members (folded
// together in export_site_data.py; the source CSV keeps each column).
const BRAND_COLORS = {
  "Toyota": "#0051CC",
  "Honda (car)": "#008478",
  "Thaco (total)": "#171819",
  "VinFast": "#0AA630",
  "Hyundai (Thanh Cong)": "#DB2777",
  "Others": "#ACAEB0",
};

// "Total Industry" isn't a brand VAMA reports per se -- it's the corrected
// market aggregate (see carTotalIndustry) -- kept out of BRAND_COLORS so it
// never gets counted inside brand-composition math (carRowKnownTotal,
// carShareSeries), but still offered as a togglable series in §1.
const TOGGLE_COLORS = {
  ...BRAND_COLORS,
  "Total Industry": "#EA580C",
  "Total Industry (excl. VinFast)": "#9A3412",
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

// The corrected market total: VAMA's own whole-industry figure
// (row.vamaIndustryTotal, from its Cover Letter report -- VAMA members +
// imported CBU from non-members) plus Hyundai Thanh Cong and VinFast,
// neither of which is a VAMA member. NOT the same as summing VAMA's
// per-brand columns (Toyota, Thaco, etc.) + Hyundai + VinFast -- that
// members-only sum misses the non-member-imported-CBU volume that VAMA's
// own whole-industry total includes.
function carTotalIndustryExVf(row) {
  const vama = row.vamaIndustryTotal;
  if (vama == null) return { value: null, complete: false };
  const htc = row.brands["Hyundai (Thanh Cong)"];
  return { value: vama + (htc ?? 0), complete: htc != null };
}

function carTotalIndustry(row) {
  const exVf = carTotalIndustryExVf(row);
  if (exVf.value == null) return { value: null, complete: false };
  const vf = row.brands["VinFast"];
  return { value: exVf.value + (vf ?? 0), complete: exVf.complete && vf != null };
}

// §1's brand toggles/chart/table read straight off row.brands[label] for
// real brands, but the Total Industry series are derived aggregates, not
// CSV columns -- this is the one seam callers need instead of row.brands[label].
function seriesValue(row, label) {
  if (label === "Total Industry") return entryValue(carTotalIndustry(row));
  if (label === "Total Industry (excl. VinFast)") return entryValue(carTotalIndustryExVf(row));
  return row.brands[label];
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
// KPIs, from carTotalIndustry/carTotalIndustryExVf) -- either way, only the
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
  // Minor brands are already folded into "Others" upstream, so every
  // remaining series is shown -- no second, client-side "Others" bucket.
  const shown = shares;
  const rest = 0;

  document.getElementById("bm-track").innerHTML =
    shown.map((b) => `<i style="width:${(b.value / total) * 100}%; background:${BRAND_COLORS[b.label]}"></i>`).join("") +
    (rest > 0 ? `<i style="width:${(rest / total) * 100}%; background:var(--rule-3)"></i>` : "");
  document.getElementById("bm-legend").innerHTML =
    shown.map((b) => `<span><i style="background:${BRAND_COLORS[b.label]}"></i>${escapeHtml(b.label)} ${((b.value / total) * 100).toFixed(0)}%</span>`).join("") +
    (rest > 0 ? `<span><i style="background:var(--rule-3)"></i>Others ${((rest / total) * 100).toFixed(0)}%</span>` : "");

  const maxShare = Math.max(1, ...shown.map((b) => b.value));
  document.getElementById("contrib-rows").innerHTML = shown
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
function renderLineChart(containerEl, periods, series, { yFormat = fmtCompact, tooltipFormat = fmtInt, connectGaps = false } = {}) {
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
    const known = [];
    periods.forEach((p, i) => {
      if (s.values[i] != null) known.push([i, s.values[i]]);
    });

    // With connectGaps, a missing month still gets a line drawn straight
    // across it instead of splitting the series into disconnected islands.
    for (let k = 1; k < known.length; k++) {
      const [i0, v0] = known[k - 1];
      const [i1, v1] = known[k];
      const isGap = i1 - i0 > 1;
      if (isGap && !connectGaps) continue;
      marks += `<path class="chart-line" d="M${x(i0).toFixed(1)},${y(v0).toFixed(1)} L${x(i1).toFixed(1)},${y(v1).toFixed(1)}" style="stroke:${s.color}" />`;
    }
    known.forEach(([i, v]) => {
      const p = periods[i];
      // s.moms/s.yoys (parallel to s.values) are optional -- callers with
      // access to full unfiltered history (e.g. renderSegmentChart) can
      // supply them so the tooltip reads like the detail table's MoM/YoY
      // columns; callers that don't just get the plain value, as before.
      const mom = s.moms ? s.moms[i] : undefined;
      const yoy = s.yoys ? s.yoys[i] : undefined;
      const momYoyText = mom !== undefined || yoy !== undefined
        ? ` (MoM ${mom == null ? "n/a" : (mom >= 0 ? "+" : "") + mom.toFixed(1) + "%"}, YoY ${yoy == null ? "n/a" : (yoy >= 0 ? "+" : "") + yoy.toFixed(1) + "%"})`
        : "";
      marks += `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" style="stroke:${s.color}"><title>${escapeHtml(s.label)} · ${fmtPeriodLabel(p)}: ${tooltipFormat(v)}${momYoyText}</title></circle>`;
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

// ----------------------------------------------------- stacked bar chart
// series: [{label, color, values}] stacked bottom-up in array order; a null
// value just skips that segment. labels are the x-axis category labels;
// tooltipLabels (optional, parallel) give a longer name for hover text. Bar
// totals are printed above each bar when there's room (few categories).
function renderStackedBarChart(containerEl, labels, series, { tooltipLabels = labels, maxTicks = 8 } = {}) {
  if (!labels.length || !series.length) {
    containerEl.innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  const W = 960, H = 320, padL = 44, padR = 16, padT = 22, padB = 26;
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const maxV = Math.max(1, ...totals);
  const slot = (W - padL - padR) / n;
  const barW = Math.max(2, slot * 0.62);
  const x = (i) => padL + i * slot + (slot - barW) / 2;
  const y = (v) => H - padB - (v / maxV) * (H - padT - padB);

  const grid = [0, maxV / 2, maxV]
    .map((v) => `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${(y(v) + 4).toFixed(1)}">${fmtCompact(v)}</text>`)
    .join("");

  const showTotals = n <= 16;
  let bars = "";
  labels.forEach((_, i) => {
    let base = 0;
    series.forEach((s) => {
      const v = s.values[i];
      if (v == null || v <= 0) return;
      const top = y(base + v);
      const h = y(base) - top;
      const share = totals[i] ? ` (${((v / totals[i]) * 100).toFixed(1)}%)` : "";
      bars += `<rect x="${x(i).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" style="fill:${s.color}"><title>${escapeHtml(tooltipLabels[i])} · ${escapeHtml(s.label)}: ${fmtInt(v)}${share}</title></rect>`;
      base += v;
    });
    // Only label a bar whose every segment is known -- otherwise the sum
    // would pass off a partial stack as the full total.
    if (showTotals && totals[i] > 0 && series.every((s) => s.values[i] != null)) {
      bars += `<text class="chart-bar-value" x="${(x(i) + barW / 2).toFixed(1)}" y="${(y(totals[i]) - 5).toFixed(1)}" text-anchor="middle">${fmtInt(totals[i])}</text>`;
    }
  });

  const step = Math.max(1, Math.ceil(n / maxTicks));
  const xLabels = labels
    .map((lbl, i) => (i % step === 0 || i === n - 1 ? `<text x="${(x(i) + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${escapeHtml(lbl)}</text>` : ""))
    .join("");

  containerEl.innerHTML = `<svg class="chart-svg chart-stacked" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}${bars}${xLabels}</svg>`;
}

// ------------------------------------------------- market structure (§3)
// Everything below works from the brand-level monthly units already in
// cars.json -- no per-model or per-powertrain data is scraped, so these
// are the trends that CAN be derived from what's tracked today: brand mix
// shift, VinFast (100% BEV, used as an EV proxy) share of the market, and
// annual brand totals/YoY. A true Hybrid/Gasoline/BEV split per brand or
// VAMA's passenger/commercial/special segmentation would need additional
// scraping this tracker doesn't do yet.

function fmtPct1(v) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

// Sum of every tracked brand column that's confirmed for the month -- the
// denominator for "share of tracked brands" below. Not a claim about the
// true total market: a series that's null for the month (e.g. "Others"
// before VAMA's full table is in) simply drops out of the sum, and non-VAMA
// importers aren't tracked at all -- see Total Industry for the corrected total.
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

function avgShare(s) {
  const vals = s.values.filter((v) => v != null);
  return vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : 0;
}

// Caps the stack at topK individually-colored brands (by average share) and
// folds the rest into one grey "Other tracked brands" band -- 9 overlapping
// colors was too much to read at once, so the smaller/noisier brands are
// collapsed into a single band instead of demanding a color for each.
function carShareSeriesGrouped(rows, topK) {
  const all = carShareSeries(rows);
  const ranked = [...all].sort((a, b) => avgShare(b) - avgShare(a));
  const top = ranked.slice(0, topK);
  const rest = ranked.slice(topK);
  if (!rest.length) return top;
  const otherValues = rows.map((_, i) => rest.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const other = {
    label: "Other tracked brands",
    color: "#ACAEB0",
    values: otherValues,
    members: rest.map((s) => s.label),
  };
  return [...top, other];
}

// 100%-stacked area instead of 9 overlapping/crossing lines -- much easier
// to read a composition-over-time story from than a spaghetti line chart.
function renderShareChart(chartEl, legendEl, rows) {
  const periods = rows.map((r) => r.period);
  // Every tracked series gets its own band now that minor brands are
  // already folded into "Others" upstream (export_site_data.py).
  const grouped = carShareSeriesGrouped(rows, Object.keys(BRAND_COLORS).length);
  // Largest-average band at the bottom of the stack (a stable visual
  // anchor); smaller/more volatile bands stacked above it. The legend
  // follows the same order so color position in the stack matches the
  // legend's reading order.
  const ordered = [...grouped].sort((a, b) => avgShare(b) - avgShare(a));
  renderStackedAreaChart(chartEl, periods, ordered, { yFormat: (v) => `${v}%`, endLabels: true });
  renderChartLegend(legendEl, ordered);
}

// Analyst-style read of the share chart above: computed off the ungrouped
// per-brand series (not the chart's TopK+"Other tracked brands" display
// grouping), comparing each brand's share at the first tracked period
// against the latest one.
function buildShareNarrative(cars) {
  if (cars.length < 2) return "";
  const periods = cars.map((r) => r.period);
  const series = carShareSeries(cars);
  const firstIdx = 0;
  const lastIdx = periods.length - 1;

  const vf = series.find((s) => s.label === "VinFast");
  const vfFirstIdx = vf ? vf.values.findIndex((v) => v != null) : -1;
  if (vfFirstIdx === -1) return "";
  const vfStart = vf.values[vfFirstIdx] ?? 0;
  const vfEnd = vf.values[lastIdx];
  if (vfEnd == null) return "";

  const others = series
    // "Others" is a bucket, not a brand -- keep it out of brand comparisons.
    .filter((s) => s.label !== "VinFast" && s.label !== "Others")
    .map((s) => ({ label: s.label, start: s.values[firstIdx] ?? 0, end: s.values[lastIdx] ?? 0 }))
    .map((s) => ({ ...s, delta: s.end - s.start }));
  if (!others.length) return "";
  const largestNow = others.reduce((a, b) => (b.end > a.end ? b : a));
  const biggestLoser = others.reduce((a, b) => (b.delta < a.delta ? b : a));

  const overtookText = vfEnd > largestNow.end
    ? `, overtaking ${largestNow.label} (${fmtPct1(largestNow.end)}) to become the largest single brand by share`
    : `, still behind ${largestNow.label} at ${fmtPct1(largestNow.end)}`;

  return (
    `VinFast has expanded from ${fmtPct1(vfStart)} of tracked-brand volume in ${fmtPeriodLabel(periods[vfFirstIdx])} ` +
    `to ${fmtPct1(vfEnd)} in ${fmtPeriodLabel(periods[lastIdx])}${overtookText}. ` +
    `${biggestLoser.label} has given up the most share over the same window, down ${abs1(biggestLoser.delta)}pp to ${fmtPct1(biggestLoser.end)}.`
  );
}

function renderShareNarrative(containerEl, cars) {
  const text = buildShareNarrative(cars);
  containerEl.innerHTML = text
    ? `<p>${escapeHtml(text)}</p>`
    : `<div class="empty-state">Not enough history yet to summarize.</div>`;
}

// Cumulative stack per period (series[0] at the bottom); each brand's
// nulls are treated as a 0% contribution that month so the stack stays a
// continuous 0-100% band even where a brand isn't confirmed yet.
function renderStackedAreaChart(containerEl, periods, series, { yFormat = (v) => `${v}`, endLabels = false } = {}) {
  if (!periods.length || !series.length) {
    containerEl.innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  const W = 960, H = 340, padL = 44, padT = 16, padB = 26;
  const padR = endLabels ? 140 : 16;
  const n = periods.length;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / 100) * (H - padT - padB);

  const cum = periods.map((_, i) => {
    let running = 0;
    return series.map((s) => (running += s.values[i] ?? 0));
  });

  const gridVals = [0, 25, 50, 75, 100];
  const grid = gridVals
    .map((v) => `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${(y(v) + 4).toFixed(1)}">${yFormat(v)}</text>`)
    .join("");

  let areas = "";
  const endLabelSpecs = [];
  series.forEach((s, j) => {
    const topAt = (i) => cum[i][j];
    const bottomAt = (i) => (j === 0 ? 0 : cum[i][j - 1]);
    let d = "";
    for (let i = 0; i < n; i++) d += `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(topAt(i)).toFixed(1)} `;
    for (let i = n - 1; i >= 0; i--) d += `L${x(i).toFixed(1)},${y(bottomAt(i)).toFixed(1)} `;
    d += "Z";
    areas += `<path d="${d}" fill="${s.color}" fill-opacity="0.88" stroke="${s.color}" stroke-width="0.5"><title>${escapeHtml(s.label)}</title></path>`;

    // Direct end-of-line labels so the latest share/brand can be read
    // straight off the chart instead of cross-referencing the legend.
    // Skipped for bands too thin to hold a label without overlapping.
    if (endLabels) {
      const latestVal = topAt(n - 1) - bottomAt(n - 1);
      if (latestVal >= 4) {
        endLabelSpecs.push({
          y: y((topAt(n - 1) + bottomAt(n - 1)) / 2),
          text: `${s.label} ${Math.round(latestVal)}%`,
          color: s.color,
        });
      }
    }
  });

  let endLabelsHtml = "";
  if (endLabels && endLabelSpecs.length) {
    endLabelSpecs.sort((a, b) => a.y - b.y);
    const minGap = 14;
    for (let i = 1; i < endLabelSpecs.length; i++) {
      if (endLabelSpecs[i].y - endLabelSpecs[i - 1].y < minGap) {
        endLabelSpecs[i].y = endLabelSpecs[i - 1].y + minGap;
      }
    }
    const lineX1 = W - padR + 2, lineX2 = W - padR + 10;
    endLabelsHtml = endLabelSpecs
      .map(
        (l) => `<line x1="${lineX1}" x2="${lineX2}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" style="stroke:${l.color}" stroke-width="1"/>
        <text x="${lineX2 + 4}" y="${(l.y + 3.5).toFixed(1)}" style="fill:${l.color}; font-weight:600;">${escapeHtml(l.text)}</text>`
      )
      .join("");
  }

  const tickIdx = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  const xLabels = [...new Set(tickIdx)]
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtPeriodShort(periods[i])}</text>`)
    .join("");

  containerEl.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}${areas}${endLabelsHtml}${xLabels}</svg>`;
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

// --------------------------------------- VAMA segment/powertrain (segments.json)
// `segRows` here are flat {period, year, month, total, passenger_cars,
// commercial_vehicles, trucks, buses, special_purpose, bev, hybrid,
// bus_chassis} rows -- a different shape from cars.json's {brands: {...}}
// rows. total/passenger_cars/commercial_vehicles/special_purpose are VAMA's
// whole-industry figures (from its Cover Letter report -- same basis as
// carTotalIndustry, includes imported CBU from non-members); VinFast still
// isn't itself a line item in this breakdown. trucks/buses/bev/hybrid/
// bus_chassis remain VAMA-members-only (from its Summary report -- no
// whole-industry equivalent is published) and aren't rendered anywhere.

function segShare(row, key) {
  return row.total != null && row[key] != null && row.total > 0 ? (row[key] / row.total) * 100 : null;
}

// The base 3 are VAMA's own PC/CV/SPV split (always sum to `total`).
// "Passenger Cars (incl. Hyundai)" is a 4th, opt-in series -- Hyundai
// Thanh Cong's volume added straight into the PC number (see
// passenger_cars_incl_hyundai's build note in export_site_data.py), so it
// intentionally does NOT fit into the PC/CV/SPV split-of-`total` picture.
const SEGMENT_SPECS = [
  { key: "passenger_cars", label: "Passenger cars", color: "#008478" },
  { key: "commercial_vehicles", label: "Commercial vehicles", color: "#171819" },
  { key: "special_purpose", label: "Special-purpose", color: "#ACAEB0" },
];
const SEGMENT_EXTRA_SPECS = [
  { key: "passenger_cars_incl_hyundai", label: "Passenger Cars (incl. Hyundai)", color: "#DB2777" },
];
const SEGMENT_TOGGLE_SPECS = [...SEGMENT_SPECS, ...SEGMENT_EXTRA_SPECS];

// Absolute units (not % share) so the chart doubles as a growth-rate view,
// matching §1's chart style -- MoM/YoY reads straight off the detail table
// below it (and now the hover tooltip too) instead of needing a separate
// share-vs-growth mental model. `allRows` (full, unfiltered history) is
// used for the MoM/YoY lookups so a point at the edge of the filtered
// range still shows correct deltas -- same pattern as renderSegmentTable.
function renderSegmentChart(chartEl, legendEl, segRows, specs, allRows) {
  const periods = segRows.map((r) => r.period);
  const series = specs.map((s) => ({
    label: s.label,
    color: s.color,
    values: segRows.map((r) => r[s.key]),
    moms: segRows.map((r) => {
      const prior = allRows.find((x) => x.period === shiftPeriod(r.period, -1));
      return pctChange(r[s.key], prior ? prior[s.key] : null);
    }),
    yoys: segRows.map((r) => {
      const prior = allRows.find((x) => x.period === shiftPeriod(r.period, -12));
      return pctChange(r[s.key], prior ? prior[s.key] : null);
    }),
  }));
  renderLineChart(chartEl, periods, series, { connectGaps: true });
  renderChartLegend(legendEl, series);
}

// `allRows` (full, unfiltered history) is used for the prior-month/prior-
// year lookups so a row at the edge of the filtered range still shows a
// correct MoM%/YoY% instead of "n/a" -- same pattern as the §1 car table.
function renderSegmentTable(headEl, bodyEl, filteredRows, allRows, specs) {
  headEl.innerHTML = `<th class="ta-left">Month</th>` + specs.map((s) => `<th>${escapeHtml(s.label)}</th><th>MoM %</th><th>YoY %</th>`).join("");

  const rowsDesc = [...filteredRows].reverse();
  bodyEl.innerHTML = rowsDesc.length && specs.length
    ? rowsDesc
        .map((r) => {
          const priorRow = allRows.find((x) => x.period === shiftPeriod(r.period, -1));
          const yoyRow = allRows.find((x) => x.period === shiftPeriod(r.period, -12));
          const cells = specs.map((s) => {
            const v = r[s.key];
            const mom = pctChange(v, priorRow ? priorRow[s.key] : null);
            const yoy = pctChange(v, yoyRow ? yoyRow[s.key] : null);
            const pctCell = (pct) => {
              const dir = pct == null ? "flat" : pct >= 0 ? "up" : "down";
              return `<td class="pct ${dir}">${pct == null ? "n/a" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</td>`;
            };
            return `<td>${fmtInt(v)}</td>${pctCell(mom)}${pctCell(yoy)}`;
          }).join("");
          return `<tr><td class="ta-left">${fmtPeriodLabel(r.period)}</td>${cells}</tr>`;
        })
        .join("")
    : `<tr><td colspan="${1 + Math.max(specs.length, 1) * 3}" class="empty-state">${specs.length ? "No data in this range." : "Select at least one series."}</td></tr>`;
}

// { sum, months } per brand per calendar year -- `months` (how many of
// that year's rows had a non-null value for this brand) is what lets the
// Annual Sales table tell "brand had zero sales" apart from "brand wasn't
// tracked yet that year" (e.g. VinFast in 2023).
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

// Per-brand YoY: the latest calendar year's sum vs the prior year's sum
// over the *same set of months* (so a partial current year, e.g. 2026
// Jan-Aug, is compared against 2025 Jan-Aug too, not misleadingly against
// all 12 months of 2025). null if the brand is missing any of those months
// in the prior year. Shared by the Annual Sales table and the Deep Dive
// Summary.
function brandAnnualYoy(rows) {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const latestYear = years[years.length - 1] ?? null;
  const priorYear = latestYear != null ? latestYear - 1 : null;
  const brands = Object.keys(BRAND_COLORS);
  const months = latestYear != null ? rows.filter((r) => r.year === latestYear).map((r) => r.month) : [];

  const sumOver = (year, brand) =>
    rows
      .filter((r) => r.year === year && months.includes(r.month) && r.brands[brand] != null)
      .reduce((s, r) => s + r.brands[brand], 0);
  const countOver = (year, brand) => rows.filter((r) => r.year === year && months.includes(r.month) && r.brands[brand] != null).length;

  const yoys =
    priorYear != null && months.length
      ? brands
          .map((b) => {
            const sum = sumOver(latestYear, b);
            const priorSum = countOver(priorYear, b) === months.length ? sumOver(priorYear, b) : null;
            return { brand: b, pct: pctChange(sum, priorSum), sum, priorSum };
          })
          .filter((c) => c.pct != null)
      : [];

  return { latestYear, priorYear, months: months.length, yoys };
}

function renderAnnualTable(headEl, bodyEl, rows) {
  const { years, totals, grandTotal, monthsPerYear } = carAnnualTotals(rows);
  const { latestYear, priorYear, months, yoys } = brandAnnualYoy(rows);
  const yoyByBrand = Object.fromEntries(yoys.map((c) => [c.brand, c.pct]));
  const brands = Object.keys(BRAND_COLORS);
  const hasYoy = months > 0;

  const yoyCellHtml = (pct) => {
    if (!hasYoy) return "";
    const dir = pct == null ? "" : pct >= 0 ? "up" : "down";
    return `<td class="pct ${dir}">${pct == null ? "n/a" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</td>`;
  };

  headEl.innerHTML =
    `<th class="ta-left">Brand</th>` +
    years.map((y) => `<th>${monthsPerYear[y] < 12 ? `${y} YTD` : y}</th>`).join("") +
    (hasYoy ? `<th>YoY (${monthsPerYear[latestYear] < 12 ? `${months}mo, ` : ""}'${String(priorYear).slice(2)}&rarr;'${String(latestYear).slice(2)})</th>` : "");

  const brandRows = brands
    .map((b) => {
      const cells = years.map((y) => `<td>${totals[b][y].months > 0 ? fmtInt(totals[b][y].sum) : "—"}</td>`).join("");
      return `<tr><td class="ta-left">${escapeHtml(b)}</td>${cells}${yoyCellHtml(yoyByBrand[b] ?? null)}</tr>`;
    })
    .join("");

  let totalYoy = null;
  if (hasYoy) {
    const monthsList = rows.filter((r) => r.year === latestYear).map((r) => r.month);
    const sumFor = (year) =>
      monthsList.reduce((total, m) => {
        const row = rows.find((r) => r.year === year && r.month === m);
        return row ? total + carRowKnownTotal(row) : total;
      }, 0);
    totalYoy = pctChange(sumFor(latestYear), sumFor(priorYear));
  }
  const totalRow = `<tr style="font-weight:700; border-top:2px solid var(--ink-1);"><td class="ta-left">Total (tracked brands)</td>${years
    .map((y) => `<td>${fmtInt(grandTotal[y])}</td>`)
    .join("")}${yoyCellHtml(totalYoy)}</tr>`;

  bodyEl.innerHTML = brandRows + totalRow;
}

// ---------------------------------------------------- Deep Dive Summary
function ppDeltaSpan(d) {
  if (d == null || Number.isNaN(d)) return `<span class="muted">n/a</span>`;
  const dir = d >= 0 ? "up" : "down";
  return `<span class="${dir}">${d >= 0 ? "▲ +" : "▼ "}${Math.abs(d).toFixed(1)}pp</span>`;
}

function summaryRowHtml({ title, desc, deltaHtml, dir }) {
  return `
    <div class="ranked-event">
      <span class="re-dot" style="background:${dir === "up" ? "var(--act-add)" : "var(--act-exit)"}"></span>
      <div class="re-body">
        <span class="re-title">${escapeHtml(title)}</span>
        <div class="re-desc">${escapeHtml(desc)}</div>
      </div>
      <div class="re-score tnum">${deltaHtml}</div>
    </div>`;
}

// Sums a {period: number|null} lookup over whatever calendar months
// (1..latestMonth) are non-null in BOTH the latest period's year and the
// prior year, using that same month-set on both sides -- a partial current
// year (e.g. Honda Motorbikes missing Jun/Jul 2026) is compared fairly
// against the matching prior-year months instead of a full prior year,
// which would understate growth (an 8-of-8-month current sum vs. a
// 6-of-8-month one reads as a much bigger drop than actually happened).
// Mirrors brandAnnualYoy's logic but for a flat period->value map.
function fairYtdYoy(rowsByPeriod, latestPeriod) {
  const [latestYear, latestMonth] = latestPeriod.split("-").map(Number);
  const priorYear = latestYear - 1;
  let curSum = 0;
  let priorSum = 0;
  let months = 0;
  for (let m = 1; m <= latestMonth; m++) {
    const v = rowsByPeriod[`${latestYear}-${String(m).padStart(2, "0")}`];
    const pv = rowsByPeriod[`${priorYear}-${String(m).padStart(2, "0")}`];
    if (v == null || pv == null) continue;
    curSum += v;
    priorSum += pv;
    months++;
  }
  if (!months) return null;
  return { months, curSum, priorSum, pct: pctChange(curSum, priorSum) };
}

// The worst single month's YoY within the same YTD window -- flags "some
// months down double digits" even when the YTD total itself is only
// mildly negative.
function worstMonthYoy(rowsByPeriod, latestPeriod) {
  const [latestYear, latestMonth] = latestPeriod.split("-").map(Number);
  let worst = null;
  for (let m = 1; m <= latestMonth; m++) {
    const p = `${latestYear}-${String(m).padStart(2, "0")}`;
    const pct = pctChange(rowsByPeriod[p], rowsByPeriod[`${latestYear - 1}-${String(m).padStart(2, "0")}`]);
    if (pct != null && (worst == null || pct < worst.pct)) worst = { period: p, pct };
  }
  return worst;
}

function ytdYoyItem(title, ytd, { worstNote = "" } = {}) {
  return {
    title: `${title} (${ytd.months}mo YTD YoY)`,
    desc: `${fmtInt(ytd.priorSum)} → ${fmtInt(ytd.curSum)} units${worstNote}`,
    deltaHtml: pctSpanHtml(ytd.pct),
    dir: ytd.pct >= 0 ? "up" : "down",
  };
}

// ------------------------------------------------------- monthly brief --
// Page-top block: a KPI strip (Total / PV / CV, incl. and excl. VinFast,
// MoM & YoY) and a short analyst-style comment that explains the month --
// what drove the change (contribution by brand), what it says about
// underlying demand -- rather than restating the numbers.
//
// PV = VAMA whole-market passenger cars (members + CBU importers) + Hyundai
// TC passenger cars (segments.passenger_cars_incl_hyundai); CV = VAMA
// whole-market commercial vehicles; Total = carTotalIndustry. Anchored on
// the latest month present in BOTH cars and segments.
// Key PV brands commented on, in this order.
const BRIEF_PV_BRANDS = ["Toyota", "Hyundai (Thanh Cong)", "Honda (car)", "VinFast"];

function shortBrand(label) {
  return label.replace(" (car)", "").replace(" (Thanh Cong)", "").replace(" (total)", "");
}

// Rounded for prose: "+28%", "−1%".
function pctR(pct) {
  if (pct == null) return "n/a";
  const r = Math.round(pct);
  return `${r >= 0 ? "+" : "−"}${Math.abs(r)}%`;
}

// Magnitude only, for sentences whose verb already carries the direction.
function pctAbs(pct) {
  return `${Math.abs(Math.round(pct))}%`;
}

const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function momYoy(byPeriod, period) {
  const v = byPeriod[period];
  return {
    value: v,
    mom: pctChange(v, byPeriod[shiftPeriod(period, -1)]),
    yoy: pctChange(v, byPeriod[shiftPeriod(period, -12)]),
  };
}

function sumOver(byPeriod, periods) {
  const vals = periods.map((p) => byPeriod[p]);
  return vals.some((v) => v == null) ? null : vals.reduce((a, v) => a + v, 0);
}

// Brief comment: one short paragraph (4 sentences) in a fixed order --
// total (incl. & excl. VinFast) -> PV, implying CV -> key PV brands ->
// ex-VinFast demand read with seasonality. Quarter-end months add one
// sentence on the quarter's total market.

// Calendar-month context for the seasonality clause (VN auto market).
const SEASON_NOTE = { 1: "pre-Tet", 2: "Tet", 3: "post-Tet", 8: "Ghost Month", 9: "Ghost Month", 12: "year-end" };

function verb(p) {
  return p >= 0 ? "rose" : "fell";
}

// "rose 28% YoY and 29% MoM" / "fell 1% YoY but rose 45% MoM" / "were flat YoY ...".
function movePhrase(yoy, chg, chgLabel, be = "was") {
  const flat = (p) => p != null && Math.round(p) === 0;
  const one = (p, lbl) => (flat(p) ? `${be} flat ${lbl}` : `${verb(p)} ${pctAbs(p)} ${lbl}`);
  if (yoy == null && chg == null) return "had no comparable data";
  if (chg == null) return one(yoy, "YoY");
  if (yoy == null) return one(chg, chgLabel);
  if (flat(yoy) && flat(chg)) return `${be} flat YoY and ${chgLabel}`;
  if (flat(yoy)) return `${be} flat YoY but ${one(chg, chgLabel)}`;
  if (flat(chg)) return `${one(yoy, "YoY")} and ${be} flat ${chgLabel}`;
  return (yoy >= 0) === (chg >= 0)
    ? `${verb(yoy)} ${pctAbs(yoy)} YoY and ${pctAbs(chg)} ${chgLabel}`
    : `${verb(yoy)} ${pctAbs(yoy)} YoY but ${verb(chg)} ${pctAbs(chg)} ${chgLabel}`;
}

// "healthy" / "subdued" / "weak", read off ex-VinFast passenger-car YoY.
function demandVerdict(pct) {
  if (pct == null) return null;
  if (pct >= 5) return "healthy";
  if (pct > -5) return "subdued";
  return "weak";
}

// Average change over `lag` months for the same calendar slot in the prior
// `years` years (needs >= 2 years), from a period -> value getter.
function seasonalNorm(get, period, lag, years = 3) {
  const pcts = [];
  for (let k = 1; k <= years; k++) {
    const p = shiftPeriod(period, -12 * k);
    const pct = pctChange(get(p), get(shiftPeriod(p, -lag)));
    if (pct != null) pcts.push(pct);
  }
  return pcts.length >= 2 ? pcts.reduce((a, v) => a + v, 0) / pcts.length : null;
}

function joinAnd(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "";
}

function buildMonthComment({ P, totIn, totEx, pvIn, pvEx, cv, brands, season }) {
  const out = [];
  // 1) Total, incl. and excl. VinFast.
  out.push(
    `Total market sales ${movePhrase(totIn.yoy, totIn.mom, "MoM", "were")}` +
      (totEx.yoy != null ? ` (excl. VinFast: ${pctR(totEx.yoy)} YoY, ${pctR(totEx.mom)} MoM).` : ".")
  );
  // 2) PV, and the CV it implies.
  const exGap = pvIn.yoy != null && pvEx.yoy != null ? pvIn.yoy - pvEx.yoy : null;
  out.push(
    `Passenger vehicles ${movePhrase(pvIn.yoy, pvIn.mom, "MoM", "were")}` +
      (exGap != null ? (exGap >= 5 ? `, but only ${pctR(pvEx.yoy)} YoY excluding VinFast` : ` (${pctR(pvEx.yoy)} YoY excl. VinFast)`) : "") +
      `, implying commercial vehicles ${pctR(cv.yoy)} YoY and ${pctR(cv.mom)} MoM.`
  );
  // 3) Key PV brands: VinFast vs the legacy names.
  const vf = brands.find((b) => b.name === "VinFast");
  const legacy = brands.filter((b) => b.name !== "VinFast" && b.yoy != null);
  const down = legacy.filter((b) => b.yoy < 0);
  const up = legacy.filter((b) => b.yoy >= 0);
  const fmtB = (b) => `${b.name} (${pctR(b.yoy)})`;
  let s3 = vf && vf.yoy != null ? `VinFast ${verb(vf.yoy)} ${pctAbs(vf.yoy)} YoY to a ${vf.share.toFixed(1)}% market share` : "";
  const legacyParts = [];
  if (down.length) legacyParts.push(`${joinAnd(down.map(fmtB))} ${down.length === legacy.length && down.length > 1 ? "all " : ""}fell YoY`);
  if (up.length) legacyParts.push(`${joinAnd(up.map(fmtB))} grew`);
  if (legacyParts.length) {
    const rebound = down.length && down.every((b) => b.chg != null && b.chg >= 10);
    s3 += `${s3 ? ", while " : ""}${legacyParts.join(" and ")}${rebound ? " despite double-digit MoM rebounds" : ""}`;
  }
  if (s3) out.push(`${s3[0].toUpperCase()}${s3.slice(1)}.`);
  // 4) Demand read (ex-VinFast PV) with seasonality.
  const verdict = demandVerdict(pvEx.yoy);
  if (verdict) {
    let s4 = `Ex-VinFast passenger demand remains ${verdict}`;
    const { chg, norm, prevChg, prevNorm, twoChg, twoNorm, month, prevMonth, prevNote } = season;
    if (chg != null && norm != null) {
      const diff = chg - norm;
      const prevDiff = prevChg != null && prevNorm != null ? prevChg - prevNorm : null;
      if (Math.abs(diff) >= 8 && prevDiff != null && prevDiff * diff < 0 && Math.abs(prevDiff) >= 8 && twoChg != null && twoNorm != null) {
        const vs = twoChg < twoNorm - 3 ? "below" : twoChg > twoNorm + 3 ? "above" : "in line with";
        s4 += `: the ${month} ${diff > 0 ? "rebound" : "pullback"} largely ${diff > 0 ? "offsets an unusually weak" : "reverses an unusually strong"} ${prevMonth}${prevNote ? ` (${prevNote})` : ""}, leaving two-month volume ${vs} seasonal norms (${pctR(twoChg)} vs a typical ${pctR(twoNorm)})`;
      } else if (Math.abs(diff) < 8) {
        s4 += `, with the ${pctR(chg)} MoM move in line with the usual ${month} pattern (3-yr avg ${pctR(norm)})`;
      } else {
        s4 += `, though the ${pctR(chg)} MoM move was ${diff > 0 ? "stronger" : "weaker"} than the usual ${month} pattern (3-yr avg ${pctR(norm)})`;
      }
    }
    out.push(`${s4}.`);
  }
  return out.join(" ");
}

// One sentence on the quarter's total market (incl. and excl. VinFast, with QoQ seasonality).
function buildQuarterComment({ qLabel, q, vfShareOfGrowth, qoqNorm }) {
  if (q.totIn.yoy == null) return null;
  let s = `Total market sales ${movePhrase(q.totIn.yoy, q.totIn.qoq, "QoQ", "were")}`;
  if (q.totIn.yoy > 0 && vfShareOfGrowth != null && vfShareOfGrowth >= 0.5) s += `, largely VinFast-driven`;
  if (q.totEx.yoy != null) {
    s += `; excluding VinFast, sales ${movePhrase(q.totEx.yoy, q.totEx.qoq, "QoQ", "were")}`;
    if (qoqNorm != null) s += ` (vs a typical ${pctR(qoqNorm)} QoQ for ${qLabel})`;
  }
  return `${s}.`;
}

function buildMonthlyBrief(cars, segments) {
  const segPeriods = new Set(segments.map((r) => r.period));
  const carRow = [...cars].reverse().find((r) => segPeriods.has(r.period) && entryValue(carTotalIndustry(r)) != null);
  if (!carRow) return null;
  const P = carRow.period;
  const [py, pm] = P.split("-").map(Number);
  const carBy = Object.fromEntries(cars.map((r) => [r.period, r]));

  const vfBy = Object.fromEntries(cars.map((r) => [r.period, r.brands["VinFast"]]));
  const totalInclBy = Object.fromEntries(cars.map((r) => [r.period, entryValue(carTotalIndustry(r))]));
  const totalExBy = Object.fromEntries(cars.map((r) => [r.period, entryValue(carTotalIndustryExVf(r))]));
  const pvExBy = Object.fromEntries(segments.map((r) => [r.period, r.passenger_cars_incl_hyundai]));
  const pvInclBy = Object.fromEntries(
    segments.map((r) => [r.period, r.passenger_cars_incl_hyundai != null && vfBy[r.period] != null ? r.passenger_cars_incl_hyundai + vfBy[r.period] : null])
  );
  const cvBy = Object.fromEntries(segments.map((r) => [r.period, r.commercial_vehicles]));

  // ---- month
  const totIn = momYoy(totalInclBy, P);
  const totEx = momYoy(totalExBy, P);
  const pvIn = momYoy(pvInclBy, P);
  const pvEx = momYoy(pvExBy, P);
  const cv = momYoy(cvBy, P);
  const brands = BRIEF_PV_BRANDS.map((label) => {
    const by = Object.fromEntries(cars.map((r) => [r.period, r.brands[label]]));
    const m = momYoy(by, P);
    return { name: shortBrand(label), yoy: m.yoy, chg: m.mom, share: m.value != null && totIn.value ? (m.value / totIn.value) * 100 : null };
  });
  const getEx = (p) => totalExBy[p];
  const P1 = shiftPeriod(P, -1);
  const P2 = shiftPeriod(P, -2);
  const P12 = shiftPeriod(P, -12);
  const monthText = buildMonthComment({
    P, totIn, totEx, pvIn, pvEx, cv, brands,
    season: {
      chg: totEx.mom,
      norm: seasonalNorm(getEx, P, 1),
      prevChg: pctChange(totalExBy[P1], totalExBy[P2]),
      prevNorm: seasonalNorm(getEx, P1, 1),
      twoChg: pctChange(totalExBy[P], totalExBy[P2]),
      twoNorm: seasonalNorm(getEx, P, 2),
      month: MONTH_LONG[pm - 1],
      prevMonth: MONTH_LONG[Number(P1.split("-")[1]) - 1],
      prevNote: SEASON_NOTE[Number(P1.split("-")[1])],
    },
  });

  // ---- quarter (quarter-end months only)
  let quarter = null;
  if (pm % 3 === 0) {
    const qPeriods = (end) => [shiftPeriod(end, -2), shiftPeriod(end, -1), end];
    const qSum = (by) => (end) => sumOver(by, qPeriods(end));
    const qm = (by) => {
      const get = qSum(by);
      const v = get(P);
      return { value: v, qoq: pctChange(v, get(shiftPeriod(P, -3))), yoy: pctChange(v, get(P12)) };
    };
    const q = { totIn: qm(totalInclBy), totEx: qm(totalExBy), pvIn: qm(pvInclBy), pvEx: qm(pvExBy), cv: qm(cvBy) };
    const vfDelta = (qSum(vfBy)(P) ?? 0) - (qSum(vfBy)(P12) ?? 0);
    const totDelta = q.totIn.value != null && qSum(totalInclBy)(P12) != null ? q.totIn.value - qSum(totalInclBy)(P12) : null;
    const qLabel = `Q${pm / 3}`;
    quarter = {
      label: `${qLabel} ${py}`,
      short: qLabel,
      yoy: { totIn: q.totIn.yoy, totEx: q.totEx.yoy, pvIn: q.pvIn.yoy, pvEx: q.pvEx.yoy, cv: q.cv.yoy },
      text: buildQuarterComment({
        qLabel,
        q,
        vfShareOfGrowth: totDelta ? vfDelta / totDelta : null,
        qoqNorm: seasonalNorm(qSum(totalExBy), P, 3),
      }),
    };
  }

  return {
    period: P,
    quarter,
    // Rows x (incl. | excl. VinFast); VinFast sells no CV, so CV has no excl. split.
    rows: [
      { label: "Total industry", incl: { ...totIn, q: quarter && quarter.yoy.totIn }, ex: { ...totEx, q: quarter && quarter.yoy.totEx } },
      { label: "Passenger vehicles", incl: { ...pvIn, q: quarter && quarter.yoy.pvIn }, ex: { ...pvEx, q: quarter && quarter.yoy.pvEx } },
      { label: "Commercial vehicles", incl: { ...cv, q: quarter && quarter.yoy.cv }, ex: null },
    ],
    monthText,
  };
}

function renderMonthlyBrief(containerEl, cars, segments) {
  const brief = buildMonthlyBrief(cars, segments);
  if (!brief) {
    containerEl.innerHTML = `<p class="muted">Not enough data for the latest month yet.</p>`;
    return;
  }
  const withQ = brief.quarter != null;
  const cols = withQ ? 4 : 3;
  const pctCell = (pct) => {
    const dir = pct == null ? "flat" : pct >= 0 ? "up" : "down";
    return `<td class="pct ${dir}">${pct == null ? "n/a" : (pct >= 0 ? "+" : "−") + Math.abs(pct).toFixed(1) + "%"}</td>`;
  };
  const group = (m) =>
    m
      ? `<td class="brief-units">${fmtInt(m.value)}</td>${pctCell(m.mom)}${pctCell(m.yoy)}${withQ ? pctCell(m.q) : ""}`
      : `<td colspan="${cols}" class="brief-na">n/a — VinFast sells no CVs</td>`;
  const subHead = `<th class="grp-start">Units</th><th>MoM</th><th>YoY</th>${withQ ? `<th>${escapeHtml(brief.quarter.short)} YoY</th>` : ""}`;
  const rows = brief.rows
    .map((r) => `<tr><td class="ta-left brief-row">${escapeHtml(r.label)}</td>${group(r.incl)}${group(r.ex)}</tr>`)
    .join("");
  containerEl.innerHTML = `
    <div class="brief-head"><span class="eyebrow">Monthly brief · ${escapeHtml(fmtPeriodLabel(brief.period))}</span></div>
    <div class="table-wrap">
      <table class="table brief-table">
        <thead>
          <tr><th class="ta-left" rowspan="2"></th><th colspan="${cols}" class="brief-group">Incl. VinFast</th><th colspan="${cols}" class="brief-group">Excl. VinFast</th></tr>
          <tr>${subHead}${subHead}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="dd-narrative brief-body">
      <p><strong>${escapeHtml(fmtPeriodLabel(brief.period))}.</strong> ${escapeHtml(brief.monthText)}</p>
      ${brief.quarter && brief.quarter.text ? `<p><strong>${escapeHtml(brief.quarter.label)}.</strong> ${escapeHtml(brief.quarter.text)}</p>` : ""}
    </div>
    <p class="muted brief-note">PV = VAMA whole-market passenger cars (members + CBU importers) + Hyundai TC passenger cars; CV = VAMA whole-market commercial vehicles. Demand read is rule-based (ex-VinFast PV YoY ≥ +5% healthy, ±5% subdued, ≤ −5% weak); seasonal norm = 3-year average change for the same month/quarter.</p>`;
}

function roseFell(pct) {
  return pct >= 0 ? "rose" : "fell";
}
function upDown(pct) {
  return pct >= 0 ? "up" : "down";
}
function abs1(pct) {
  return Math.abs(pct).toFixed(1);
}

// Free-text version of the same underlying-demand numbers as the bullets
// below -- a copy-pasteable analyst-style note, not a UI summary. Both
// presentations read off the same computed {pcInclVf, pcExVf, cv, moto,
// worstMonth, worstBrand} inputs so they can't drift apart.
function buildDemandNarrative({ pcInclVf, pcExVf, cv, moto, worstMonth, worstBrand }) {
  const carSentences = [];
  if (pcInclVf) {
    carSentences.push(
      `Vietnam's passenger car industry, including VinFast, ${roseFell(pcInclVf.pct)} ${abs1(pcInclVf.pct)}% YoY over the first ${pcInclVf.months} months of the year.`
    );
  }
  if (pcExVf) {
    const worstText = worstMonth
      ? `, with the weakest month at ${abs1(worstMonth.pct)}% ${worstMonth.pct >= 0 ? "growth" : "decline"} in ${fmtPeriodLabel(worstMonth.period)}`
      : "";
    const brandText = worstBrand ? ` — ${worstBrand.brand} posted the steepest brand-level decline, down ${abs1(worstBrand.pct)}%` : "";
    carSentences.push(
      `Excluding VinFast, however, underlying PC demand ${roseFell(pcExVf.pct)} ${abs1(pcExVf.pct)}% YoY${worstText}${brandText}.`
    );
  }
  if (cv) {
    carSentences.push(`Commercial vehicles held up better, ${upDown(cv.pct)} ${abs1(cv.pct)}% YoY over the same period.`);
  }

  const motoSentence = moto
    ? `Honda motorbike volumes were ${upDown(moto.pct)} ${abs1(moto.pct)}% YoY over ${moto.months} months of comparable data.`
    : "";

  return { carText: carSentences.join(" "), motoText: motoSentence };
}

function renderDeepDiveNarrative(containerEl, { pcInclVf, pcExVf, cv, moto, worstMonth, worstBrand }) {
  const { carText, motoText } = buildDemandNarrative({ pcInclVf, pcExVf, cv, moto, worstMonth, worstBrand });
  if (!carText && !motoText) {
    containerEl.innerHTML = `<div class="empty-state">Not enough history yet to summarize.</div>`;
    return;
  }
  containerEl.innerHTML = [carText, motoText]
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Synthesizes the headline "underlying demand" numbers from cars/segments/
// motos into a short, scannable list -- computed fresh each load, not
// hardcoded, so it can't drift out of sync as months are added. Structure
// mirrors a monthly analyst note: PC industry incl./excl. VinFast, CV
// industry, Honda Motorbikes, then brand-level color and the EV share
// shift (VinFast being the reason incl./excl.-VinFast PC diverge so much).
function renderDeepDiveSummary(containerEl, cars, segments, motos, narrativeEl) {
  const items = [];
  const latestPeriod = segments.length ? segments[segments.length - 1].period : null;

  let pcInclVf = null, pcExVf = null, cv = null, moto = null, worstMonth = null;
  if (latestPeriod) {
    const vfByPeriod = Object.fromEntries(cars.map((r) => [r.period, r.brands["VinFast"]]));
    const pcExVfByPeriod = Object.fromEntries(segments.map((r) => [r.period, r.passenger_cars_incl_hyundai]));
    const pcInclVfByPeriod = Object.fromEntries(
      segments.map((r) => {
        const vf = vfByPeriod[r.period];
        const pcExVf2 = r.passenger_cars_incl_hyundai;
        return [r.period, pcExVf2 != null && vf != null ? pcExVf2 + vf : null];
      })
    );
    const cvByPeriod = Object.fromEntries(segments.map((r) => [r.period, r.commercial_vehicles]));
    const motoByPeriod = Object.fromEntries(motos.map((r) => [r.period, r.sales]));

    pcInclVf = fairYtdYoy(pcInclVfByPeriod, latestPeriod);
    if (pcInclVf) items.push(ytdYoyItem("Passenger Car industry, incl. VinFast", pcInclVf));

    pcExVf = fairYtdYoy(pcExVfByPeriod, latestPeriod);
    if (pcExVf) {
      worstMonth = worstMonthYoy(pcExVfByPeriod, latestPeriod);
      const worstNote = worstMonth ? `; worst month ${fmtPeriodLabel(worstMonth.period)} ${worstMonth.pct >= 0 ? "+" : ""}${worstMonth.pct.toFixed(1)}%` : "";
      items.push(ytdYoyItem("Passenger Car industry, excl. VinFast", pcExVf, { worstNote }));
    }

    cv = fairYtdYoy(cvByPeriod, latestPeriod);
    if (cv) items.push(ytdYoyItem("Commercial Vehicle industry", cv));

    moto = fairYtdYoy(motoByPeriod, latestPeriod);
    if (moto) items.push(ytdYoyItem("Honda Motorbikes", moto));
  }

  const { priorYear, latestYear, yoys: allYoys } = brandAnnualYoy(cars);
  // "Others" is a bucket, not a brand -- never call it fastest/steepest.
  const yoys = allYoys.filter((c) => c.brand !== "Others");
  let worstBrand = null;
  if (yoys.length) {
    const best = yoys.reduce((a, b) => (b.pct > a.pct ? b : a));
    worstBrand = yoys.reduce((a, b) => (b.pct < a.pct ? b : a));
    items.push({
      title: `Fastest-growing brand (${priorYear}→${latestYear} YoY)`,
      desc: `${best.brand}: ${fmtInt(best.priorSum)} → ${fmtInt(best.sum)} units`,
      deltaHtml: pctSpanHtml(best.pct),
      dir: "up",
    });
    if (worstBrand.brand !== best.brand) {
      items.push({
        title: `Steepest decline (${priorYear}→${latestYear} YoY)`,
        desc: `${worstBrand.brand}: ${fmtInt(worstBrand.priorSum)} → ${fmtInt(worstBrand.sum)} units`,
        deltaHtml: pctSpanHtml(worstBrand.pct),
        dir: "down",
      });
    }
  }

  if (narrativeEl) renderDeepDiveNarrative(narrativeEl, { pcInclVf, pcExVf, cv, moto, worstMonth, worstBrand });

  const evByPeriod = evShareByPeriod(cars);
  const firstVfRow = cars.find((r) => r.brands["VinFast"] != null);
  const latestCarRow = cars[cars.length - 1];
  if (firstVfRow) {
    const startShare = evByPeriod[firstVfRow.period];
    const latestShare = evByPeriod[latestCarRow.period];
    const momShare = evByPeriod[shiftPeriod(latestCarRow.period, -1)] ?? null;
    const momDelta = momShare != null ? latestShare - momShare : null;
    const momNote = momDelta != null ? `; ${momDelta >= 0 ? "+" : ""}${momDelta.toFixed(1)}pp vs. last month` : "";
    items.push({
      title: "EV (VinFast) share of market",
      desc: `${fmtPct1(startShare)} in ${fmtPeriodLabel(firstVfRow.period)} → ${fmtPct1(latestShare)} in ${fmtPeriodLabel(latestCarRow.period)}${momNote}`,
      deltaHtml: ppDeltaSpan(latestShare - startShare),
      dir: latestShare >= startShare ? "up" : "down",
    });
  }

  containerEl.innerHTML = items.length
    ? items.map(summaryRowHtml).join("")
    : `<div class="empty-state">Not enough history yet to summarize.</div>`;
}
