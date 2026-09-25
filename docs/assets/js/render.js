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
// true total market: recent months are still missing "Others" (Suzuki,
// Isuzu, Mercedes-Benz, ...) -- see Total Industry for the corrected total.
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
  const grouped = carShareSeriesGrouped(rows, 5);
  // Largest-average band at the bottom of the stack (a stable visual
  // anchor); smaller/more volatile bands stacked above it. The legend
  // follows the same order so color position in the stack matches the
  // legend's reading order.
  const ordered = [...grouped].sort((a, b) => avgShare(b) - avgShare(a));
  renderStackedAreaChart(chartEl, periods, ordered, { yFormat: (v) => `${v}%`, endLabels: true });
  renderChartLegend(legendEl, ordered);
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

// "tăng X%" / "giảm -X%" -- toFixed(1) already carries the minus sign for
// negatives, matching the exact phrasing convention of the reference note
// this narrative is modeled on (e.g. "giảm -1% YoY", not "giảm 1%").
function taiGiam(pct) {
  return `${pct >= 0 ? "tăng" : "giảm"} ${pct.toFixed(1)}%`;
}

// Free-text version of the same underlying-demand numbers as the bullets
// below -- a copy-pasteable note in the mixed Vietnamese/English "analyst
// comment" style the user asked to match, not a UI summary. Both read off
// the same computed {pcInclVf, pcExVf, cv, moto, worstMonth, worstBrand}
// inputs so the two presentations can't drift apart.
function buildDemandNarrative({ pcInclVf, pcExVf, cv, moto, worstMonth, worstBrand }) {
  const carLines = [];
  if (pcInclVf) {
    carLines.push(`So far cả ngành Passenger Car, tính cả VinFast ${taiGiam(pcInclVf.pct)} in ${pcInclVf.months}M`);
  }
  if (pcExVf) {
    const worstText = worstMonth ? `, có tháng ${worstMonth.pct >= 0 ? "tăng" : "âm"} tới ${Math.abs(worstMonth.pct).toFixed(1)}% YoY (${fmtPeriodLabel(worstMonth.period)})` : "";
    const brandText = worstBrand ? `, giảm mạnh nhất ở ${worstBrand.brand} (${worstBrand.pct.toFixed(1)}%)` : "";
    carLines.push(`Nhưng nếu bỏ VinFast ra, PC ${taiGiam(pcExVf.pct)} YoY${worstText}${brandText}`);
  }
  if (cv) {
    carLines.push(`Nhóm xe thương mại tốt hơn, cả ngành ${taiGiam(cv.pct)} YoY in ${cv.months}M`);
  }

  const motoLine = moto ? `Xe máy Honda ${taiGiam(moto.pct)} in ${moto.months}M` : "";

  return { carText: carLines.join("\n"), motoText: motoLine };
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

  const { priorYear, latestYear, yoys } = brandAnnualYoy(cars);
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
