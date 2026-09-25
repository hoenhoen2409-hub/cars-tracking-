// App state + wiring. Rendering primitives live in render.js (loaded first).

const CAR_BRANDS = Object.keys(BRAND_COLORS);
// §1's toggle list/chart/table offer "Total Industry" (the corrected
// aggregate) alongside the real brands; CAR_BRANDS itself stays real-brands-
// only since it also drives brand-composition logic (missingBrands, share
// chart, etc.) where "Total Industry" would double-count.
const TOGGLE_BRANDS = Object.keys(TOGGLE_COLORS);
const DEFAULT_BRANDS = ["Toyota", "Honda (car)", "VinFast", "Hyundai (Thanh Cong)", "Total Industry", "Total Industry (excl. VinFast)"];
const DEFAULT_SEGMENTS = SEGMENT_TOGGLE_SPECS.map((s) => s.key);

const state = {
  cars: [],
  motos: [],
  meta: {},
  segments: [],
  selectedBrands: new Set(DEFAULT_BRANDS),
  selectedSegments: new Set(DEFAULT_SEGMENTS),
  // Cars section is filtered (and its KPI "as of" reference month is set)
  // by month, not just year -- see renderCarsSection(). Year/month are
  // picked via separate selects (carYearFrom/carMonthFrom etc.) and kept in
  // sync with the derived "YYYY-MM" strings below, which are what the rest
  // of the app (filtering, KPI lookups, CSV export) actually reads.
  carYearFrom: null,
  carMonthFrom: null,
  carYearTo: null,
  carMonthTo: null,
  carPeriodFrom: null,
  carPeriodTo: null,
  motoYearFrom: null,
  motoYearTo: null,
  segYearFrom: null,
  segMonthFrom: null,
  segYearTo: null,
  segMonthTo: null,
  segPeriodFrom: null,
  segPeriodTo: null,
};

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function yearsFromRows(rows) {
  return [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
}

function fillYearSelect(selectEl, years, selected) {
  selectEl.innerHTML = years.map((y) => `<option value="${y}" ${y === selected ? "selected" : ""}>${y}</option>`).join("");
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

function monthsForYear(rows, year) {
  return [...new Set(rows.filter((r) => r.year === year).map((r) => r.month))].sort((a, b) => a - b);
}

function fillMonthSelect(selectEl, months, selected) {
  selectEl.innerHTML = months
    .map((m) => `<option value="${m}" ${m === selected ? "selected" : ""}>${MONTH_NAMES[m - 1]}</option>`)
    .join("");
}

function filterByYear(rows, from, to) {
  return rows.filter((r) => r.year >= from && r.year <= to);
}

// Period strings are "YYYY-MM" so lexicographic comparison is chronological.
function filterByPeriodRange(rows, from, to) {
  return rows.filter((r) => r.period >= from && r.period <= to);
}

// -------------------------------------------------------------- cars tab
function renderBrandToggles() {
  const el = document.getElementById("brand-toggles");
  el.innerHTML = TOGGLE_BRANDS.map(
    (label) => `
    <label class="brand-toggle">
      <input type="checkbox" value="${escapeHtml(label)}" ${state.selectedBrands.has(label) ? "checked" : ""} />
      <span class="dot" style="background:${TOGGLE_COLORS[label]}"></span>
      ${escapeHtml(label)}
    </label>`
  ).join("");
  el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedBrands.add(cb.value);
      else state.selectedBrands.delete(cb.value);
      renderCarsSection();
    });
  });
}

function renderCarsSection() {
  const filtered = filterByPeriodRange(state.cars, state.carPeriodFrom, state.carPeriodTo);
  const periods = filtered.map((r) => r.period);
  const brands = TOGGLE_BRANDS.filter((b) => state.selectedBrands.has(b));

  // KPI lookups (MoM/YoY/YTD) always resolve against the full, unfiltered
  // series -- a YoY comparison still needs the same month a year earlier
  // even if that's outside the selected range -- but the "latest" anchor
  // itself is always exactly carPeriodTo (the selected "Month to"), not a
  // search for the closest earlier month with data.
  //
  // Both totals are summed from whatever's confirmed that month
  // (carTotalIndustry / carTotalIndustryExVf return {value, complete})
  // rather than requiring every input to be in -- a running total that's
  // mostly there is more useful than a blank "-", as long as it's clearly
  // marked "partial" (via renderKpis4) when something's missing.
  const marketByPeriod = Object.fromEntries(state.cars.map((r) => [r.period, carTotalIndustry(r)]));
  const kpis = computeKpisAt(marketByPeriod, state.carPeriodTo, "Total Industry");
  renderKpis4(document.getElementById("car-kpis"), kpis);

  const marketExVfByPeriod = Object.fromEntries(state.cars.map((r) => [r.period, carTotalIndustryExVf(r)]));
  const kpisExVf = computeKpisAt(marketExVfByPeriod, state.carPeriodTo, "Total Industry (ex. VinFast)");
  renderKpis4(document.getElementById("car-kpis-exvf"), kpisExVf);

  const series = brands.map((label) => ({
    label,
    color: TOGGLE_COLORS[label],
    values: filtered.map((r) => seriesValue(r, label)),
  }));
  renderLineChart(document.getElementById("car-chart"), periods, series);
  renderChartLegend(document.getElementById("car-chart-legend"), series);

  document.getElementById("car-table-head").innerHTML =
    `<th class="ta-left">Month</th>` + brands.map((b) => `<th>${escapeHtml(b)}</th><th>MoM %</th>`).join("");

  const rowsDesc = [...filtered].reverse();
  document.getElementById("car-table-body").innerHTML = rowsDesc.length
    ? rowsDesc
        .map((r) => {
          const priorPeriod = shiftPeriod(r.period, -1);
          const priorRow = state.cars.find((x) => x.period === priorPeriod);
          const cells = brands
            .map((label) => {
              const v = seriesValue(r, label);
              const prev = priorRow ? seriesValue(priorRow, label) : null;
              const pct = pctChange(v, prev);
              const dir = pct == null ? "flat" : pct >= 0 ? "up" : "down";
              return `<td>${fmtInt(v)}</td><td class="pct ${dir}">${pct == null ? "n/a" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</td>`;
            })
            .join("");
          return `<tr><td class="ta-left">${fmtPeriodLabel(r.period)}</td>${cells}</tr>`;
        })
        .join("")
    : `<tr><td colspan="${1 + brands.length * 2}" class="empty-state">No data in this range.</td></tr>`;

  document.getElementById("car-count-label").textContent = `${filtered.length} months shown · ${brands.length} brand(s) selected`;

  // Flag missing brands for the selected "as of" month (carPeriodTo), not
  // always the dataset's true latest -- the note should explain whatever
  // month the KPI cards above actually landed on.
  const refRow = state.cars.find((r) => r.period === state.carPeriodTo) || state.cars[state.cars.length - 1];
  const missingBrands = CAR_BRANDS.filter((b) => refRow.brands[b] == null);
  const noteEl = document.getElementById("car-data-note");
  noteEl.textContent =
    missingBrands.length > 0
      ? `Note: ${fmtPeriodLabel(refRow.period)} — ${missingBrands.join(", ")} not yet confirmed from the official VAMA report; Total Market figures above are tagged "partial" for this month (sum of confirmed brands only, so understated by whatever ${missingBrands.join(", ")} would add).`
      : "";
}

function exportCarsCsv() {
  const filtered = filterByPeriodRange(state.cars, state.carPeriodFrom, state.carPeriodTo);
  const brands = TOGGLE_BRANDS.filter((b) => state.selectedBrands.has(b));
  const header = ["period", ...brands.flatMap((b) => [b, `${b} MoM%`])];
  const lines = [header.join(",")];
  [...filtered].reverse().forEach((r) => {
    const priorRow = state.cars.find((x) => x.period === shiftPeriod(r.period, -1));
    const cells = brands.flatMap((label) => {
      const v = seriesValue(r, label);
      const pct = pctChange(v, priorRow ? seriesValue(priorRow, label) : null);
      return [v ?? "", pct == null ? "" : pct.toFixed(1)];
    });
    lines.push([r.period, ...cells].join(","));
  });
  downloadCsv(lines.join("\n"), "car_sales_filtered.csv");
}

// ----------------------------------------------------------- moto tab
function renderMotoSection() {
  const filtered = filterByYear(state.motos, state.motoYearFrom, state.motoYearTo);
  const periods = filtered.map((r) => r.period);

  const salesByPeriod = Object.fromEntries(state.motos.map((r) => [r.period, r.sales]));
  const kpis = computeKpis(salesByPeriod, state.motos.map((r) => r.period), "Honda Motorbikes");
  renderKpis4(document.getElementById("moto-kpis"), kpis);

  renderBarChart(document.getElementById("moto-chart"), periods, filtered.map((r) => r.sales));

  document.getElementById("moto-table-head").innerHTML = `<th class="ta-left">Month</th><th>Units sold</th><th>MoM %</th>`;
  const rowsDesc = [...filtered].reverse();
  document.getElementById("moto-table-body").innerHTML = rowsDesc.length
    ? rowsDesc
        .map((r) => {
          const priorRow = state.motos.find((x) => x.period === shiftPeriod(r.period, -1));
          const pct = pctChange(r.sales, priorRow ? priorRow.sales : null);
          const dir = pct == null ? "flat" : pct >= 0 ? "up" : "down";
          return `<tr><td class="ta-left">${fmtPeriodLabel(r.period)}</td><td>${fmtInt(r.sales)}</td><td class="pct ${dir}">${pct == null ? "n/a" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="3" class="empty-state">No data in this range.</td></tr>`;

  document.getElementById("moto-count-label").textContent = `${filtered.length} months shown`;
}

function exportMotosCsv() {
  const filtered = filterByYear(state.motos, state.motoYearFrom, state.motoYearTo);
  const lines = ["period,units_sold,mom_pct"];
  [...filtered].reverse().forEach((r) => {
    const priorRow = state.motos.find((x) => x.period === shiftPeriod(r.period, -1));
    const pct = pctChange(r.sales, priorRow ? priorRow.sales : null);
    lines.push([r.period, r.sales ?? "", pct == null ? "" : pct.toFixed(1)].join(","));
  });
  downloadCsv(lines.join("\n"), "honda_motorbike_filtered.csv");
}

// ---------------------------------------------------------- segment tab
function renderSegmentToggles() {
  const el = document.getElementById("segment-toggles");
  el.innerHTML = SEGMENT_TOGGLE_SPECS.map(
    (s) => `
    <label class="brand-toggle">
      <input type="checkbox" value="${escapeHtml(s.key)}" ${state.selectedSegments.has(s.key) ? "checked" : ""} />
      <span class="dot" style="background:${s.color}"></span>
      ${escapeHtml(s.label)}
    </label>`
  ).join("");
  el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedSegments.add(cb.value);
      else state.selectedSegments.delete(cb.value);
      renderSegmentSection();
    });
  });
}

function renderSegmentSection() {
  const filtered = filterByPeriodRange(state.segments, state.segPeriodFrom, state.segPeriodTo);
  const specs = SEGMENT_TOGGLE_SPECS.filter((s) => state.selectedSegments.has(s.key));
  renderSegmentChart(document.getElementById("segment-chart"), document.getElementById("segment-chart-legend"), filtered, specs, state.segments);
  renderSegmentTable(document.getElementById("segment-table-head"), document.getElementById("segment-table-body"), filtered, state.segments, specs);
  document.getElementById("seg-count-label").textContent = `${filtered.length} months shown`;
}

function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------------- init
async function init() {
  const [cars, motos, meta, segments] = await Promise.all([
    loadJson("./data/cars.json"),
    loadJson("./data/motos.json"),
    loadJson("./data/meta.json"),
    loadJson("./data/segments.json"),
  ]);
  state.cars = cars;
  state.motos = motos;
  state.meta = meta;
  state.segments = segments;

  const carYears = yearsFromRows(cars);
  const motoYears = yearsFromRows(motos);

  state.carYearFrom = carYears[0];
  state.carYearTo = carYears[carYears.length - 1];
  const fromMonths = monthsForYear(cars, state.carYearFrom);
  const toMonths = monthsForYear(cars, state.carYearTo);
  state.carMonthFrom = fromMonths[0];
  state.carMonthTo = toMonths[toMonths.length - 1];
  state.carPeriodFrom = `${state.carYearFrom}-${pad2(state.carMonthFrom)}`;
  state.carPeriodTo = `${state.carYearTo}-${pad2(state.carMonthTo)}`;

  state.motoYearFrom = motoYears[0];
  state.motoYearTo = motoYears[motoYears.length - 1];

  const segYears = yearsFromRows(segments);
  state.segYearFrom = segYears[0];
  state.segYearTo = segYears[segYears.length - 1];
  const segFromMonths = monthsForYear(segments, state.segYearFrom);
  const segToMonths = monthsForYear(segments, state.segYearTo);
  state.segMonthFrom = segFromMonths[0];
  state.segMonthTo = segToMonths[segToMonths.length - 1];
  state.segPeriodFrom = `${state.segYearFrom}-${pad2(state.segMonthFrom)}`;
  state.segPeriodTo = `${state.segYearTo}-${pad2(state.segMonthTo)}`;

  renderHero(meta.latest_car_period, meta.latest_moto_period, meta.generated_at);
  renderTopSummary(cars, CAR_BRANDS);

  fillYearSelect(document.getElementById("car-year-from"), carYears, state.carYearFrom);
  fillYearSelect(document.getElementById("car-year-to"), carYears, state.carYearTo);
  fillMonthSelect(document.getElementById("car-month-from"), fromMonths, state.carMonthFrom);
  fillMonthSelect(document.getElementById("car-month-to"), toMonths, state.carMonthTo);
  fillYearSelect(document.getElementById("moto-year-from"), motoYears, state.motoYearFrom);
  fillYearSelect(document.getElementById("moto-year-to"), motoYears, state.motoYearTo);
  fillYearSelect(document.getElementById("seg-year-from"), segYears, state.segYearFrom);
  fillYearSelect(document.getElementById("seg-year-to"), segYears, state.segYearTo);
  fillMonthSelect(document.getElementById("seg-month-from"), segFromMonths, state.segMonthFrom);
  fillMonthSelect(document.getElementById("seg-month-to"), segToMonths, state.segMonthTo);

  document.getElementById("car-year-from").addEventListener("change", (e) => {
    state.carYearFrom = Number(e.target.value);
    const months = monthsForYear(state.cars, state.carYearFrom);
    if (!months.includes(state.carMonthFrom)) state.carMonthFrom = months[0];
    fillMonthSelect(document.getElementById("car-month-from"), months, state.carMonthFrom);
    state.carPeriodFrom = `${state.carYearFrom}-${pad2(state.carMonthFrom)}`;
    renderCarsSection();
  });
  document.getElementById("car-month-from").addEventListener("change", (e) => {
    state.carMonthFrom = Number(e.target.value);
    state.carPeriodFrom = `${state.carYearFrom}-${pad2(state.carMonthFrom)}`;
    renderCarsSection();
  });
  document.getElementById("car-year-to").addEventListener("change", (e) => {
    state.carYearTo = Number(e.target.value);
    const months = monthsForYear(state.cars, state.carYearTo);
    if (!months.includes(state.carMonthTo)) state.carMonthTo = months[months.length - 1];
    fillMonthSelect(document.getElementById("car-month-to"), months, state.carMonthTo);
    state.carPeriodTo = `${state.carYearTo}-${pad2(state.carMonthTo)}`;
    renderCarsSection();
  });
  document.getElementById("car-month-to").addEventListener("change", (e) => {
    state.carMonthTo = Number(e.target.value);
    state.carPeriodTo = `${state.carYearTo}-${pad2(state.carMonthTo)}`;
    renderCarsSection();
  });
  document.getElementById("moto-year-from").addEventListener("change", (e) => {
    state.motoYearFrom = Number(e.target.value);
    renderMotoSection();
  });
  document.getElementById("moto-year-to").addEventListener("change", (e) => {
    state.motoYearTo = Number(e.target.value);
    renderMotoSection();
  });
  document.getElementById("seg-year-from").addEventListener("change", (e) => {
    state.segYearFrom = Number(e.target.value);
    const months = monthsForYear(state.segments, state.segYearFrom);
    if (!months.includes(state.segMonthFrom)) state.segMonthFrom = months[0];
    fillMonthSelect(document.getElementById("seg-month-from"), months, state.segMonthFrom);
    state.segPeriodFrom = `${state.segYearFrom}-${pad2(state.segMonthFrom)}`;
    renderSegmentSection();
  });
  document.getElementById("seg-month-from").addEventListener("change", (e) => {
    state.segMonthFrom = Number(e.target.value);
    state.segPeriodFrom = `${state.segYearFrom}-${pad2(state.segMonthFrom)}`;
    renderSegmentSection();
  });
  document.getElementById("seg-year-to").addEventListener("change", (e) => {
    state.segYearTo = Number(e.target.value);
    const months = monthsForYear(state.segments, state.segYearTo);
    if (!months.includes(state.segMonthTo)) state.segMonthTo = months[months.length - 1];
    fillMonthSelect(document.getElementById("seg-month-to"), months, state.segMonthTo);
    state.segPeriodTo = `${state.segYearTo}-${pad2(state.segMonthTo)}`;
    renderSegmentSection();
  });
  document.getElementById("seg-month-to").addEventListener("change", (e) => {
    state.segMonthTo = Number(e.target.value);
    state.segPeriodTo = `${state.segYearTo}-${pad2(state.segMonthTo)}`;
    renderSegmentSection();
  });

  document.getElementById("car-csv-btn").addEventListener("click", exportCarsCsv);
  document.getElementById("moto-csv-btn").addEventListener("click", exportMotosCsv);

  renderBrandToggles();
  renderCarsSection();
  renderMotoSection();

  // §3 Market Structure -- Brand Market Share Trend/Annual table/Deep Dive
  // Summary are a fixed full-history view, not tied to any filter, so they
  // only need rendering once at load. Vehicle Segment Trend has its own
  // Month from/to filter (renderSegmentSection), same pattern as §1.
  renderShareChart(document.getElementById("share-chart"), document.getElementById("share-chart-legend"), cars);
  renderShareNarrative(document.getElementById("share-narrative"), cars);
  renderSegmentToggles();
  renderSegmentSection();
  renderAnnualTable(document.getElementById("annual-table-head"), document.getElementById("annual-table-body"), cars);
  renderDeepDiveSummary(document.getElementById("deep-dive-summary"), cars, segments, motos, document.getElementById("deep-dive-narrative"));
}

init().catch((err) => {
  console.error(err);
  document.getElementById("hero-meta").textContent = "FAILED TO LOAD DATA — see console";
});
