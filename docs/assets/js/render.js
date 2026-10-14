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
// the moto KPIs) or a {value, complete} pair (the cars
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
// Range totals for the Vehicle Segment card: Passenger (always incl. Hyundai
// TC passenger cars; + VinFast when inclVf), Commercial, and PV + CV, summed
// over [from, to] with YoY against the same months a year earlier.
function renderSegmentRangeTotals(containerEl, labelEl, segments, cars, from, to, inclVf) {
  const vfBy = Object.fromEntries(cars.map((r) => [r.period, r.brands["VinFast"]]));
  const rows = segments.filter((r) => r.period >= from && r.period <= to);
  const segBy = Object.fromEntries(segments.map((r) => [r.period, r]));
  const pv = (p) => {
    const r = segBy[p];
    if (!r || r.passenger_cars_incl_hyundai == null) return null;
    if (!inclVf) return r.passenger_cars_incl_hyundai;
    return vfBy[p] != null ? r.passenger_cars_incl_hyundai + vfBy[p] : null;
  };
  const cv = (p) => (segBy[p] ? segBy[p].commercial_vehicles : null);
  const both = (p) => (pv(p) != null && cv(p) != null ? pv(p) + cv(p) : null);

  // Sum over months with data; YoY only when every one of those months has a
  // prior-year value too (like-for-like), otherwise n/a.
  const sumRange = (get) => {
    const have = rows.map((r) => r.period).filter((p) => get(p) != null);
    const cur = have.reduce((a, p) => a + get(p), 0);
    const priorVals = have.map((p) => get(shiftPeriod(p, -12)));
    const prior = priorVals.every((v) => v != null) && have.length ? priorVals.reduce((a, v) => a + v, 0) : null;
    return { cur: have.length ? cur : null, months: have.length, yoy: pctChange(cur, prior) };
  };

  const vfTxt = inclVf ? "incl. VinFast" : "excl. VinFast";
  const cards = [
    { lbl: `Passenger vehicles (${vfTxt})`, sub: "incl. Hyundai", ...sumRange(pv) },
    { lbl: "Commercial vehicles", sub: "VAMA whole market", ...sumRange(cv) },
    { lbl: `PV + CV (${vfTxt})`, sub: "", ...sumRange(both) },
  ];
  labelEl.textContent = rows.length ? `Range total · ${fmtPeriodLabel(from)} – ${fmtPeriodLabel(to)} (${rows.length} months)` : "Range total";
  containerEl.innerHTML = cards
    .map((c) => {
      const gap = c.months < rows.length ? ` · ${rows.length - c.months} month(s) missing data` : "";
      return `
      <div class="kpi">
        <div class="lbl">${escapeHtml(c.lbl)}</div>
        <div class="val">${fmtInt(c.cur)}${c.yoy != null ? ` <small>${pctSpanHtml(c.yoy)}</small>` : ""}</div>
        <div class="sub">${escapeHtml(c.sub ? `${c.sub} · ` : "")}${c.yoy != null ? "YoY vs same months a year earlier" : "YoY n/a (prior-year data incomplete)"}${escapeHtml(gap)}</div>
      </div>`;
    })
    .join("");
}

// §1 range block: per selected series, the sum over [from, to], the same
// months a year earlier, YoY, and share of Total Industry (incl. VinFast).
function renderCarRangeYoy(headEl, bodyEl, labelEl, cars, from, to, labels) {
  const carBy = Object.fromEntries(cars.map((r) => [r.period, r]));
  const periods = cars.filter((r) => r.period >= from && r.period <= to).map((r) => r.period);
  const val = (label, p) => (carBy[p] ? seriesValue(carBy[p], label) : null);
  // Like-for-like: months where the series has a value now; YoY only if all have a prior-year value.
  const sumFor = (label) => {
    const have = periods.filter((p) => val(label, p) != null);
    if (!have.length) return { cur: null, prior: null, months: 0, have };
    const cur = have.reduce((a, p) => a + val(label, p), 0);
    const pv = have.map((p) => val(label, shiftPeriod(p, -12)));
    return { cur, prior: pv.every((v) => v != null) ? pv.reduce((a, v) => a + v, 0) : null, months: have.length, have };
  };
  labelEl.textContent = periods.length ? `Range YoY by brand · ${fmtPeriodLabel(from)} – ${fmtPeriodLabel(to)} (${periods.length} months)` : "Range YoY by brand";
  headEl.innerHTML = `<th class="ta-left">Brand</th><th>Range total</th><th>Same months, prior year</th><th>YoY</th><th>Share of total</th>`;
  if (!labels.length) {
    bodyEl.innerHTML = `<tr><td colspan="5" class="empty-state">Select at least one brand.</td></tr>`;
    return;
  }
  bodyEl.innerHTML = labels
    .map((label) => {
      const s = sumFor(label);
      const yoy = pctChange(s.cur, s.prior);
      const dir = yoy == null ? "flat" : yoy >= 0 ? "up" : "down";
      const isTotal = label.startsWith("Total Industry");
      // Share over the brand's own months, so a partially-missing brand isn't diluted.
      const totSum = s.have.reduce((a, p) => a + (val("Total Industry", p) ?? 0), 0);
      const share = !isTotal && s.cur != null && totSum ? (s.cur / totSum) * 100 : null;
      const gap = s.months && s.months < periods.length ? ` <span class="muted">(${s.months}/${periods.length} mo)</span>` : "";
      return `<tr>
        <td class="ta-left">${escapeHtml(label)}${gap}</td>
        <td>${fmtInt(s.cur)}</td>
        <td>${fmtInt(s.prior)}</td>
        <td class="pct ${dir}">${yoy == null ? "n/a" : (yoy >= 0 ? "+" : "") + yoy.toFixed(1) + "%"}</td>
        <td>${share == null ? "—" : share.toFixed(1) + "%"}</td>
      </tr>`;
    })
    .join("");
}

// §2 range block: one row per year in the filtered range (current year =
// YTD) plus the whole range, each against the same months a year earlier.
function renderMotoRangeYoy(bodyEl, labelEl, motos, filtered) {
  const by = Object.fromEntries(motos.map((r) => [r.period, r.sales]));
  const withData = filtered.filter((r) => r.sales != null);
  if (!withData.length) {
    labelEl.textContent = "Range YoY";
    bodyEl.innerHTML = `<tr><td colspan="5" class="empty-state">No data in this range.</td></tr>`;
    return;
  }
  // Full-period YoY when every month has a prior-year value; otherwise a
  // like-for-like YoY on just the comparable months, marked with *.
  const rowFor = (label, periods) => {
    const cur = periods.reduce((a, p) => a + by[p], 0);
    const comparable = periods.filter((p) => by[shiftPeriod(p, -12)] != null);
    const full = comparable.length === periods.length;
    const prior = comparable.reduce((a, p) => a + by[shiftPeriod(p, -12)], 0);
    const curComp = comparable.reduce((a, p) => a + by[p], 0);
    const yoy = comparable.length ? pctChange(curComp, prior) : null;
    const dir = yoy == null ? "flat" : yoy >= 0 ? "up" : "down";
    const yoyTxt = yoy == null ? "n/a" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%${full ? "" : "*"}`;
    const priorTxt = comparable.length ? `${fmtInt(prior)}${full ? "" : ` <span class="muted">(${comparable.length} of ${periods.length} mo)</span>`}` : "—";
    return `<tr><td class="ta-left">${escapeHtml(label)}</td><td>${fmtInt(cur)}</td><td>${priorTxt}</td><td class="pct ${dir}">${yoyTxt}</td><td>${periods.length}</td></tr>`;
  };
  const years = [...new Set(withData.map((r) => r.year))].sort((a, b) => a - b);
  const rows = years.map((y) => {
    const ps = withData.filter((r) => r.year === y).map((r) => r.period);
    const last = ps[ps.length - 1];
    const label = ps.length < 12 ? `${y} (${fmtPeriodLabel(ps[0]).split(" ")[0]}–${fmtPeriodLabel(last).split(" ")[0]})` : `${y}`;
    return rowFor(label, ps);
  });
  const all = withData.map((r) => r.period);
  if (years.length > 1) rows.push(rowFor(`Whole range (${fmtPeriodLabel(all[0])} – ${fmtPeriodLabel(all[all.length - 1])})`, all).replace("<tr>", '<tr class="brief-total">'));
  labelEl.textContent = `Range YoY · ${fmtPeriodLabel(all[0])} – ${fmtPeriodLabel(all[all.length - 1])}`;
  bodyEl.innerHTML = rows.join("");
}

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

// Brief comment: one short paragraph in a fixed order -- total incl.
// VinFast -> total excl. VinFast -> ex-VinFast PV, implying CV -> key PV
// brands -> ex-VinFast demand read with seasonality. Quarter-end months add one
// sentence on the quarter's total market.

// Calendar-month context for the seasonality clause (VN auto market).
const SEASON_NOTE = { 1: "pre-Tet", 2: "Tet", 3: "post-Tet", 8: "Ghost Month", 9: "Ghost Month", 12: "year-end" };

// Signed, rounded % for the "(±x% YoY, ±y% MoM)" pairs; "flat" when it rounds to 0.
function sgn(p) {
  if (p == null) return "n/a";
  return Math.round(p) === 0 ? "flat" : pctR(p);
}

// "(+28% YoY, +29% MoM)"
function pair(yoy, chg, chgLabel) {
  return `(${sgn(yoy)} YoY, ${sgn(chg)} ${chgLabel})`;
}

// Direction verb, read off YoY (the headline comparison).
function dirVerb(yoy, plural = true) {
  if (yoy == null || Math.round(yoy) === 0) return plural ? "were broadly flat" : "was broadly flat";
  return yoy > 0 ? "rose" : "fell";
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

// All commentary is on an ex-VinFast basis; incl.-VinFast figures only appear
// in brackets as context. Order: PC (household) -> CV (industrial) -> total auto.
function buildMonthComment({ totIn, totEx, pvIn, pvEx, cv, brands, exGainers, season }) {
  const out = [];
  // "(+4% YoY, +47% MoM; incl. VinFast: +26% YoY, +31% MoM)"
  const withIncl = (ex, inc) => `(${sgn(ex.yoy)} YoY, ${sgn(ex.mom)} MoM${inc.yoy != null ? `; incl. VinFast: ${sgn(inc.yoy)} YoY, ${sgn(inc.mom)} MoM` : ""})`;
  // 1) Passenger vehicles = household consumption.
  if (pvEx.yoy != null) {
    out.push(`Excluding VinFast, passenger vehicles ${dirVerb(pvEx.yoy)} ${withIncl(pvEx, pvIn)}.`);
  }
  // 2) Commercial vehicles = industrial consumption (VinFast sells no CVs).
  if (cv.yoy != null) out.push(`Commercial vehicles ${dirVerb(cv.yoy)} ${pair(cv.yoy, cv.mom, "MoM")}.`);
  // 3) Total auto = PC + CV.
  if (totEx.yoy != null) {
    out.push(`Excluding VinFast, total auto ${dirVerb(totEx.yoy)} ${withIncl(totEx, totIn)}.`);
  }
  // 4) Brands within the ex-VinFast market: which gainers offset which
  // decliners, so a rising total with falling legacy brands reads as consistent.
  const fmtB = (b) => `${b.name} ${pair(b.yoy, b.chg, "MoM")}`;
  const legacy = brands.filter((b) => b.name !== "VinFast" && b.yoy != null);
  const down = legacy.filter((b) => b.yoy < 0);
  const up = legacy.filter((b) => b.yoy >= 0);
  const gainers = exGainers.filter((g) => g.yoyPp != null && g.yoyPp >= 2);
  if (totEx.yoy != null && totEx.yoy > 0 && down.length && gainers.length) {
    out.push(`Within ex-VinFast sales, gains at ${joinAnd(gainers.map(fmtB))} more than offset declines at ${joinAnd(down.map(fmtB))}${up.length ? `, while ${joinAnd(up.map(fmtB))} also grew` : ""}.`);
  } else if (totEx.yoy != null && totEx.yoy < 0 && down.length) {
    out.push(`The ex-VinFast decline was led by ${joinAnd(down.map(fmtB))}${up.length ? `, partly offset by ${joinAnd(up.map(fmtB))}` : ""}.`);
  } else if (legacy.length) {
    out.push(`By brand: ${joinAnd(legacy.map(fmtB))}.`);
  }
  // 5) Demand read (ex-VinFast PV) with seasonality.
  const verdict = demandVerdict(pvEx.yoy);
  if (verdict) {
    let s5 = `Ex-VinFast passenger demand remains ${verdict}`;
    const { chg, norm, prevChg, prevNorm, twoChg, twoNorm, month, prevMonth, prevNote } = season;
    if (chg != null && norm != null) {
      const diff = chg - norm;
      const prevDiff = prevChg != null && prevNorm != null ? prevChg - prevNorm : null;
      if (Math.abs(diff) >= 8 && prevDiff != null && prevDiff * diff < 0 && Math.abs(prevDiff) >= 8 && twoChg != null && twoNorm != null) {
        const vs = twoChg < twoNorm - 3 ? "below" : twoChg > twoNorm + 3 ? "above" : "in line with";
        s5 += `: the ${month} ${diff > 0 ? "rebound" : "pullback"} largely ${diff > 0 ? "offsets an unusually weak" : "reverses an unusually strong"} ${prevMonth}${prevNote ? ` (${prevNote})` : ""}, leaving two-month volume ${vs} seasonal norms (${sgn(twoChg)} vs the 3-yr average of ${sgn(twoNorm)})`;
      } else if (Math.abs(diff) < 8) {
        s5 += `, with the MoM move (${sgn(chg)}) in line with the usual ${month} pattern (3-yr avg ${sgn(norm)})`;
      } else {
        s5 += `, though the MoM move (${sgn(chg)}) was ${diff > 0 ? "stronger" : "weaker"} than the usual ${month} pattern (3-yr avg ${sgn(norm)})`;
      }
    }
    out.push(`${s5}.`);
  }
  return out.join(" ");
}

// One sentence on the quarter's total market, ex-VinFast first; QoQ is
// compared with the 3-year average change for the same quarter.
function buildQuarterComment({ qLabel, prevQLabel, q, qoqNorm }) {
  if (q.totEx.yoy == null) return null;
  let s = `Excluding VinFast, total auto sales ${dirVerb(q.totEx.yoy)} ${pair(q.totEx.yoy, q.totEx.qoq, "QoQ")}`;
  if (qoqNorm != null && q.totEx.qoq != null) {
    const d = q.totEx.qoq - qoqNorm;
    const vs = d <= -3 ? "below" : d >= 3 ? "above" : "in line with";
    s += `, ${vs} the 3-year average ${prevQLabel}→${qLabel} seasonal change of ${sgn(qoqNorm)}`;
  }
  if (q.totIn.yoy != null) s += ` (incl. VinFast: ${sgn(q.totIn.yoy)} YoY, ${sgn(q.totIn.qoq)} QoQ)`;
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
  // Non-VAMA CBU importers = VAMA whole-market total minus the VAMA member brands.
  const impBy = Object.fromEntries(
    cars.map((r) => {
      const members = ["Toyota", "Honda (car)", "Thaco (total)", "Others"].map((k) => r.brands[k]);
      return [r.period, r.vamaIndustryTotal != null && members.every((v) => v != null) ? r.vamaIndustryTotal - members.reduce((a, v) => a + v, 0) : null];
    })
  );
  const thacoBy = Object.fromEntries(cars.map((r) => [r.period, r.brands["Thaco (total)"]]));
  // Gainer candidates in the ex-VinFast market; pp = YoY change / prior-year ex-VinFast total.
  const exGainers = [
    ["non-VAMA CBU importers", impBy],
    ["Thaco", thacoBy],
  ].map(([name, by]) => {
    const m = momYoy(by, P);
    return { name, yoy: m.yoy, chg: m.mom, yoyPp: by[P] != null && by[P12] != null && totalExBy[P12] ? ((by[P] - by[P12]) / totalExBy[P12]) * 100 : null };
  });
  const monthText = buildMonthComment({
    totIn, totEx, pvIn, pvEx, cv, brands, exGainers,
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
    const qLabel = `Q${pm / 3}`;
    quarter = {
      label: `${qLabel} ${py}`,
      short: qLabel,
      yoy: { totIn: q.totIn.yoy, totEx: q.totEx.yoy, pvIn: q.pvIn.yoy, pvEx: q.pvEx.yoy, cv: q.cv.yoy },
      text: buildQuarterComment({
        qLabel,
        prevQLabel: `Q${pm / 3 === 1 ? 4 : pm / 3 - 1}`,
        q,
        qoqNorm: seasonalNorm(qSum(totalExBy), P, 3),
      }),
    };
  }

  return {
    period: P,
    quarter,
    // Rows x (incl. | excl. VinFast); VinFast sells no CV, so CV has no excl. split.
    rows: [
      { label: "Passenger vehicles (PC)", sub: "Household consumption", incl: { ...pvIn, q: quarter && quarter.yoy.pvIn }, ex: { ...pvEx, q: quarter && quarter.yoy.pvEx } },
      { label: "Commercial vehicles (CV)", sub: "Industrial consumption", incl: { ...cv, q: quarter && quarter.yoy.cv }, ex: null },
      { label: "Total auto", sub: "= PC + CV + special vehicles (small)", total: true, incl: { ...totIn, q: quarter && quarter.yoy.totIn }, ex: { ...totEx, q: quarter && quarter.yoy.totEx } },
    ],
    monthText,
  };
}

// One line on Honda Vietnam motorbikes for the brief's month, plus the
// quarter on quarter-end months.
function buildMotoComment(motos, P) {
  const by = Object.fromEntries(motos.map((r) => [r.period, r.sales]));
  const m = momYoy(by, P);
  if (m.value == null) return null;
  let s = `Honda Vietnam motorbike sales ${dirVerb(m.yoy)} ${pair(m.yoy, m.mom, "MoM")}`;
  const pm = Number(P.split("-")[1]);
  if (pm % 3 === 0) {
    const qs = (end) => sumOver(by, [shiftPeriod(end, -2), shiftPeriod(end, -1), end]);
    const q = qs(P);
    if (q != null) s += `, taking Q${pm / 3} to (${sgn(pctChange(q, qs(shiftPeriod(P, -12))))} YoY, ${sgn(pctChange(q, qs(shiftPeriod(P, -3))))} QoQ)`;
  }
  return `${s}.`;
}

function renderMonthlyBrief(containerEl, cars, segments, motos = []) {
  const brief = buildMonthlyBrief(cars, segments);
  if (!brief) {
    containerEl.innerHTML = `<p class="muted">Not enough data for the latest month yet.</p>`;
    return;
  }
  const motoText = buildMotoComment(motos, brief.period);
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
    .map((r) => `<tr${r.total ? ` class="brief-total"` : ""}><td class="ta-left brief-row">${escapeHtml(r.label)}${r.sub ? `<div class="brief-row-sub">${escapeHtml(r.sub)}</div>` : ""}</td>${group(r.incl)}${group(r.ex)}</tr>`)
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
      ${motoText ? `<p><strong>Motorbikes.</strong> ${escapeHtml(motoText)}</p>` : ""}
    </div>
    <p class="muted brief-note">PC (household consumption) = VAMA whole-market passenger cars (members + CBU importers) + Hyundai TC passenger cars (+ VinFast where included). CV (industrial consumption) = VAMA whole-market commercial vehicles. Total auto = PC + CV + special-purpose vehicles (small). Demand read is rule-based (ex-VinFast PC YoY ≥ +5% healthy, ±5% subdued, ≤ −5% weak); seasonal norm = 3-year average change for the same month/quarter.</p>`;
}

function abs1(pct) {
  return Math.abs(pct).toFixed(1);
}
