// Tarihsel zaman kaydırıcısı.
// - Sınırlar ve tarihî yer adları: OpenHistoricalMap (CC0), yıla göre süzülür
// - Lejant öğeleri: yalnızca o yılda var olduğu kaynaklarla bilinenler görünür; tarihi bilinmeyenler gizlenir
// - Olaylar: data/<il>/history.json (her olay kaynaklı)
import { t, lang } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const NOW = new Date().getFullYear();
const MIN = -2000;
let map, ctx, year = null, hist = { events: [] }, saved = null;

// kaydırıcı: 0–250 → MÖ 2000–MS 0, 250–1000 → MS 0–bugün (MS dönemine daha fazla çözünürlük)
const toYear = (v) => Math.round(v <= 250 ? MIN + (v / 250) * -MIN : ((v - 250) / 750) * NOW);
const toSlider = (y) => (y <= 0 ? ((y - MIN) / -MIN) * 250 : 250 + (y / NOW) * 750);

export const fmtYear = (y, approx) => (approx ? t("approx") + " " : "") + (y < 0 ? `${t("bce")} ${-y}` : (lang() === "tr" ? "MS " : "") + y);
export const isActive = () => year !== null;
export const currentYear = () => year;

/** Bir kategori o yılda görünür mü? (lejant için) */
export function catVisibleAt(catId, y = year) {
  if (y === null) return true;
  const d = ctx.dates()[catId];
  if (d === "timeless") return true;
  return Array.isArray(d) && d.some(([f, to]) => f <= y && (to == null || to > y));
}
/** O yılda var olduğu bilinen yer sayısı (zamansız kategorilerde null → toplam gösterilir) */
export function countAt(catId, y = year) {
  const d = ctx.dates()[catId];
  if (d === "timeless" || y === null) return null;
  return Array.isArray(d) ? d.filter(([f, to]) => f <= y && (to == null || to > y)).length : 0;
}
/** Kategori katmanları için yıl süzgeci */
export function yearFilter(y = year) {
  if (y === null) return null;
  return ["all", ["has", "_from"], ["<=", ["get", "_from"], y], [">", ["coalesce", ["get", "_to"], 99999], y]];
}

// --- OpenHistoricalMap katmanları -------------------------------------------
const OHM_TILES = "https://vtiles.openhistoricalmap.org/maps/osm/{z}/{x}/{y}.pbf";
function dateFilter(y) {
  return ["all",
    ["<=", ["coalesce", ["get", "start_decdate"], -99999], y + 0.5],
    [">", ["coalesce", ["get", "end_decdate"], 99999], y + 0.5]];
}
function ohmName() {
  const L = lang();
  return ["coalesce", ["get", "name_" + L], ["get", "name_tr"], ["get", "name_en"], ["get", "name"]];
}
export function installHistoryLayers() {
  if (year === null) return;
  if (!map.getSource("ohm")) map.addSource("ohm", { type: "vector", tiles: [OHM_TILES], maxzoom: 14,
    attribution: '<a href="https://www.openhistoricalmap.org" target="_blank">OpenHistoricalMap</a> (CC0)' });
  const before = map.getLayer("tour-line") ? "tour-line" : undefined;
  if (!map.getLayer("ohm-borders")) {
    map.addLayer({ id: "ohm-borders-casing", type: "line", source: "ohm", "source-layer": "land_ohm_lines",
      filter: ["<=", ["get", "admin_level"], 4],
      paint: { "line-color": "rgba(255,255,255,.7)", "line-width": ["match", ["get", "admin_level"], 2, 6, 3.5] } }, before);
    map.addLayer({ id: "ohm-borders", type: "line", source: "ohm", "source-layer": "land_ohm_lines",
      filter: ["<=", ["get", "admin_level"], 4],
      paint: { "line-color": ["match", ["get", "admin_level"], 2, "#7b2d8e", "#b0569f"], "line-width": ["match", ["get", "admin_level"], 2, 2.6, 1.4],
        "line-dasharray": ["match", ["get", "admin_level"], 2, ["literal", [1]], ["literal", [3, 2]]] } }, before);
    map.addLayer({ id: "ohm-states", type: "symbol", source: "ohm", "source-layer": "land_ohm_centroids",
      filter: ["<=", ["get", "admin_level"], 4],
      layout: { "text-field": ohmName(), "text-font": ["Noto Sans Bold"], "text-size": ["match", ["get", "admin_level"], 2, 16, 13],
        "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 10 },
      paint: { "text-color": "#6a2479", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 2 } }, before);
    map.addLayer({ id: "ohm-places", type: "symbol", source: "ohm", "source-layer": "place_points_centroids",
      layout: { "text-field": ohmName(), "text-font": ["Noto Sans Italic"], "text-size": 13, "icon-optional": true },
      paint: { "text-color": "#4a2a10", "text-halo-color": "rgba(255,248,235,.95)", "text-halo-width": 1.8 } }, before);
  }
  applyOhmFilter();
}
function applyOhmFilter() {
  if (!map.getLayer("ohm-borders")) return;
  const f = dateFilter(year);
  map.setFilter("ohm-borders", ["all", ["<=", ["get", "admin_level"], 4], f]);
  map.setFilter("ohm-borders-casing", ["all", ["<=", ["get", "admin_level"], 4], f]);
  map.setFilter("ohm-states", ["all", ["<=", ["get", "admin_level"], 4], f]);
  map.setFilter("ohm-places", f);
  for (const id of ["ohm-states", "ohm-places"]) map.setLayoutProperty(id, "text-field", ohmName());
}
function removeHistoryLayers() {
  for (const id of ["ohm-places", "ohm-states", "ohm-borders", "ohm-borders-casing"]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource("ohm")) map.removeSource("ohm");
}

// --- günümüze ait temel harita öğelerini gizle (yollar, binalar, güncel yer adları, sınırlar) ----
function hideModern(on) {
  const style = map.getStyle();
  if (on && !saved) {
    saved = {};
    for (const l of style.layers) {
      if (l.source !== "openmaptiles") continue;
      const keep = ["water", "waterway", "landcover"].includes(l["source-layer"]) && l.type !== "symbol";
      if (keep) continue;
      saved[l.id] = map.getLayoutProperty(l.id, "visibility") || "visible";
      map.setLayoutProperty(l.id, "visibility", "none");
    }
  } else if (!on && saved) {
    for (const [id, v] of Object.entries(saved)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    saved = null;
  }
}

// --- arayüz -------------------------------------------------------------------
function nearestEvents(y) {
  const ev = hist.events || [];
  return [...ev].sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y)).slice(0, 3).sort((a, b) => a.y - b.y);
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// o yıl bölgede kayıtlı devlet(ler): yüklü OHM karolarındaki merkez noktalarından
function statesAt(y) {
  if (!map.getSource("ohm")) return [];
  const L = lang();
  const names = new Set();
  for (const f of map.querySourceFeatures("ohm", { sourceLayer: "land_ohm_centroids" })) {
    const p = f.properties;
    if ((p.admin_level ?? 9) > 2) continue;
    if ((p.start_decdate ?? -99999) > y + 0.5 || (p.end_decdate ?? 99999) <= y + 0.5) continue;
    names.add(p["name_" + L] || p.name_tr || p.name_en || p.name);
  }
  return [...names];
}
function renderStates() {
  const st = statesAt(year);
  $("tbStates").innerHTML = st.length
    ? `${t("h.states")}: <b>${st.map(esc).join(", ")}</b>`
    : `<span class="muted">${t("h.noState")}</span>`;
}

function renderBar() {
  $("tbYear").textContent = fmtYear(year);
  const L = lang();
  $("tbEvents").innerHTML = nearestEvents(year).map((e) => `
    <li class="${Math.abs(e.y - year) <= 10 ? "now" : ""}"><button data-y="${e.y}"><b>${esc(fmtYear(e.y, e.approx))}</b> ${esc(e[L] || e.tr)}</button>
      <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.src)}</a></li>`).join("");
  $("tbEvents").querySelectorAll("button[data-y]").forEach((b) => (b.onclick = () => setYear(+b.dataset.y)));
  const hidden = ctx.cats.filter((c) => !catVisibleAt(c.id)).length;
  $("tbNote").textContent = t("h.note").replace("{n}", hidden);
  renderStates();
}
function renderTicks() {
  $("tbTicks").innerHTML = (hist.events || []).map((e) =>
    `<button class="tick" style="left:${(toSlider(e.y) / 10).toFixed(2)}%" data-y="${e.y}" title="${esc(fmtYear(e.y, e.approx))}"></button>`).join("") +
    [-2000, -1000, 0, 500, 1000, 1500, 2000].map((y) => `<span class="lbl${[-1000, 500, 1500].includes(y) ? " minor" : ""}" style="left:${(toSlider(y) / 10).toFixed(2)}%">${y < 0 ? t("bce") + " " + -y : y}</span>`).join("");
  $("tbTicks").querySelectorAll(".tick").forEach((b) => (b.onclick = () => setYear(+b.dataset.y)));
}

export function setYear(y) {
  year = Math.max(MIN, Math.min(NOW, y));
  $("tbSlider").value = toSlider(year);
  installHistoryLayers();
  applyOhmFilter();
  hideModern(true);
  ctx.onChange();
  renderBar();
}
export function open() {
  ctx.closePanels();
  $("timebar").hidden = false;
  $("btnTime").classList.add("on");
  document.documentElement.classList.add("history-mode");
  renderTicks();
  setYear(year ?? 1726);
}
export function close() {
  year = null;
  $("timebar").hidden = true;
  $("btnTime").classList.remove("on");
  document.documentElement.classList.remove("history-mode");
  removeHistoryLayers();
  hideModern(false);
  ctx.onChange();
}

export async function initHistory(_map, _ctx) {
  map = _map; ctx = _ctx;
  hist = await fetch(ctx.dataUrl + "history.json").then((r) => r.json()).catch(() => ({ events: [] }));
  $("btnTime").onclick = () => ($("timebar").hidden ? open() : close());
  $("tbClose").onclick = close;
  const sl = $("tbSlider");
  sl.min = 0; sl.max = 1000; sl.step = 1;
  sl.oninput = () => setYear(toYear(+sl.value));
  $("tbPrev").onclick = () => { const e = [...hist.events].reverse().find((x) => x.y < year); if (e) setYear(e.y); };
  $("tbNext").onclick = () => { const e = hist.events.find((x) => x.y > year); if (e) setYear(e.y); };
  document.addEventListener("langchange", () => { if (year !== null) { renderTicks(); renderBar(); applyOhmFilter(); } });
  // karolar yüklendikçe devlet bilgisini güncelle
  map.on("sourcedata", (e) => { if (year !== null && e.sourceId === "ohm" && e.isSourceLoaded) renderStates(); });
}
/** Stil yeniden yüklendiğinde (tema değişimi) */
export function reinstall() { if (year !== null) { saved = null; installHistoryLayers(); hideModern(true); } }
