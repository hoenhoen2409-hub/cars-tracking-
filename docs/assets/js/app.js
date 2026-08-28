// App state + wiring. Rendering primitives live in render.js (loaded first).

const CAR_BRANDS = Object.keys(BRAND_COLORS);
const DEFAULT_BRANDS = ["Toyota", "Honda (car)", "VinFast", "Hyundai (Thanh Cong)"];

const state = {
  cars: [],
  motos: [],
  meta: {},
  selectedBrands: new Set(DEFAULT_BRANDS),
  carYearFrom: null,
  carYearTo: null,
  motoYearFrom: null,
  motoYearTo: null,
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

function filterByYear(rows, from, to) {
  return rows.filter((r) => r.year >= from && r.year <= to);
}

// -------------------------------------------------------------- cars tab
function renderBrandToggles() {
  const el = document.getElementById("brand-toggles");
  el.innerHTML = CAR_BRANDS.map(
    (label) => `
    <label class="brand-toggle">
      <input type="checkbox" value="${escapeHtml(label)}" ${state.selectedBrands.has(label) ? "checked" : ""} />
      <span class="dot" style="background:${BRAND_COLORS[label]}"></span>
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
  const filtered = filterByYear(state.cars, state.carYearFrom, state.carYearTo);
  const periods = filtered.map((r) => r.period);
  const brands = CAR_BRANDS.filter((b) => state.selectedBrands.has(b));

  // KPI: Total Market, computed over the full series (not just the
  // year-filtered window) so MoM/YoY always has the adjacent month to
  // compare against even when the filter starts at the latest year.
  const marketByPeriod = Object.fromEntries(state.cars.map((r) => [r.period, r.total_market]));
  const kpis = computeKpis(marketByPeriod, state.cars.map((r) => r.period), "Total Market");
  renderKpis4(document.getElementById("car-kpis"), kpis);

  const series = brands.map((label) => ({
    label,
    color: BRAND_COLORS[label],
    values: filtered.map((r) => r.brands[label]),
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
              const v = r.brands[label];
              const prev = priorRow ? priorRow.brands[label] : null;
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
}

function exportCarsCsv() {
  const filtered = filterByYear(state.cars, state.carYearFrom, state.carYearTo);
  const brands = CAR_BRANDS.filter((b) => state.selectedBrands.has(b));
  const header = ["period", ...brands.flatMap((b) => [b, `${b} MoM%`])];
  const lines = [header.join(",")];
  [...filtered].reverse().forEach((r) => {
    const priorRow = state.cars.find((x) => x.period === shiftPeriod(r.period, -1));
    const cells = brands.flatMap((label) => {
      const v = r.brands[label];
      const pct = pctChange(v, priorRow ? priorRow.brands[label] : null);
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
  const [cars, motos, meta] = await Promise.all([
    loadJson("./data/cars.json"),
    loadJson("./data/motos.json"),
    loadJson("./data/meta.json"),
  ]);
  state.cars = cars;
  state.motos = motos;
  state.meta = meta;

  const carYears = yearsFromRows(cars);
  const motoYears = yearsFromRows(motos);
  state.carYearFrom = carYears[0];
  state.carYearTo = carYears[carYears.length - 1];
  state.motoYearFrom = motoYears[0];
  state.motoYearTo = motoYears[motoYears.length - 1];

  renderHero(meta.latest_car_period, meta.latest_moto_period, meta.generated_at);
  renderTopSummary(cars, CAR_BRANDS);

  fillYearSelect(document.getElementById("car-year-from"), carYears, state.carYearFrom);
  fillYearSelect(document.getElementById("car-year-to"), carYears, state.carYearTo);
  fillYearSelect(document.getElementById("moto-year-from"), motoYears, state.motoYearFrom);
  fillYearSelect(document.getElementById("moto-year-to"), motoYears, state.motoYearTo);

  document.getElementById("car-year-from").addEventListener("change", (e) => {
    state.carYearFrom = Number(e.target.value);
    renderCarsSection();
  });
  document.getElementById("car-year-to").addEventListener("change", (e) => {
    state.carYearTo = Number(e.target.value);
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

  document.getElementById("car-csv-btn").addEventListener("click", exportCarsCsv);
  document.getElementById("moto-csv-btn").addEventListener("click", exportMotosCsv);

  renderBrandToggles();
  renderCarsSection();
  renderMotoSection();
}

init().catch((err) => {
  console.error(err);
  document.getElementById("hero-meta").textContent = "FAILED TO LOAD DATA — see console";
});
