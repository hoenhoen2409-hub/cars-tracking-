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

// -------------------------------------------------------------- KPI block
// Mirrors the MoM / YoY / YTD-vs-prior-year-YTD logic in the original
// Streamlit app's kpi_row(), just re-derived client-side against the
// {period -> value} lookup instead of a pandas frame.
function computeKpis(rowsByPeriod, periods, valueLabel) {
  const validPeriods = periods.filter((p) => rowsByPeriod[p] != null);
  if (!validPeriods.length) return null;
  const latestPeriod = validPeriods[validPeriods.length - 1];
  const latestValue = rowsByPeriod[latestPeriod];

  const momValue = rowsByPeriod[shiftPeriod(latestPeriod, -1)] ?? null;
  const yoyValue = rowsByPeriod[shiftPeriod(latestPeriod, -12)] ?? null;

  const [latestYear, latestMonth] = latestPeriod.split("-").map(Number);
  let ytdCurrent = 0;
  let ytdPrior = 0;
  let havePrior = false;
  for (let m = 1; m <= latestMonth; m++) {
    const p = `${latestYear}-${String(m).padStart(2, "0")}`;
    if (rowsByPeriod[p] != null) ytdCurrent += rowsByPeriod[p];
    const pPrior = `${latestYear - 1}-${String(m).padStart(2, "0")}`;
    if (rowsByPeriod[pPrior] != null) {
      ytdPrior += rowsByPeriod[pPrior];
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
function renderLineChart(containerEl, periods, series) {
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
    .map((v) => `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${(y(v) + 4).toFixed(1)}">${fmtCompact(v)}</text>`)
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
      marks += `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" style="stroke:${s.color}"><title>${escapeHtml(s.label)} · ${fmtPeriodLabel(p)}: ${fmtInt(v)}</title></circle>`;
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
