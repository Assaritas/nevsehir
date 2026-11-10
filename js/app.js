import { CATEGORIES, GROUPS } from "../config/categories.js";
import { PROVINCES, DEFAULT_PROVINCE } from "../config/provinces.js";
import { t, setLang, lang, UI_LANGS } from "./i18n.js";
import { openCard, closeCard, findFeature } from "./card.js";
import { initSearch } from "./search.js";
import * as tour from "./tour.js";
import * as history from "./history.js";
import * as diorama from "./diorama.js";

/* global maplibregl, mlcontour */

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const prov = PROVINCES[params.get("il")] || PROVINCES[DEFAULT_PROVINCE];
const DATA = `data/${prov.id}/`;
const GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const store = {
  get(k, d) { try { return localStorage.getItem("rh." + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rh." + k, v); } catch { /* özel pencere */ } },
};

const state = {
  lang: store.get("lang", "tr"),
  theme: store.get("theme", "auto"),          // auto | light | dark
  base: store.get("base", "terrain"),          // terrain | satellite | landforms | vegetation
  is3d: false,
  exag: 1.5,
  active: new Set(),                          // lejant: açılışta hiçbir şey açık değil
  counts: {},
  dates: {},                                  // kategori → [[başlangıç, bitiş]] ya da "timeless"
  data: {},                                   // kategori → FeatureCollection (önbellek)
};
setLang(state.lang);

// Ücretsiz kaynaklar
const SRC = {
  styleLight: "https://tiles.openfreemap.org/styles/liberty",
  styleDark: "https://tiles.openfreemap.org/styles/dark",
  terrarium: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  satellite: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
  landcover: DATA + "landcover/{z}/{x}/{y}.png",   // scripts/build-landcover.mjs ile üretilir (ESA WorldCover)
};
const ATTR = {
  dem: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles (Mapzen/AWS: SRTM, GMTED, ETOPO1)</a>',
  sat: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH</a> (Copernicus Sentinel verisi 2024, CC BY-NC-SA 4.0)',
  lc: '<a href="https://esa-worldcover.org" target="_blank">© ESA WorldCover 2021 (CC BY 4.0)</a>',
  osm: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap katkıcıları</a>, <a href="https://www.wikidata.org" target="_blank">Wikidata</a>',
};
// scripts/build-landcover.mjs içindeki CLASSES ile aynı renkler
const LC_CLASSES = [
  ["trees", "#2d7a3a"], ["shrub", "#b59a52"], ["grass", "#cfe0a0"], ["crops", "#f2cf6b"],
  ["built", "#d9483b"], ["bare", "#cfc6b8"], ["water", "#3b82c4"], ["wetland", "#4fb3a9"], ["snow", "#ffffff"],
];
const BASES = ["terrain", "satellite", "landforms", "vegetation"];

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => state.theme === "dark" || (state.theme === "auto" && darkMQ.matches);
function applyThemeAttr() {
  if (state.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", state.theme);
  document.getElementById("lblTheme").textContent = t(state.theme);
}
applyThemeAttr();

// ---------------------------------------------------------------------------
// Harita
// ---------------------------------------------------------------------------
const demSource = new mlcontour.DemSource({ url: SRC.terrarium, encoding: "terrarium", maxzoom: 13, worker: true, cacheSize: 100 });
demSource.setupMaplibre(maplibregl);

const map = new maplibregl.Map({
  container: "map",
  style: isDark() ? SRC.styleDark : SRC.styleLight,
  center: prov.center,
  zoom: prov.zoom,
  maxBounds: prov.bounds,
  minZoom: 5,
  maxZoom: 18,
  maxPitch: 85,
  attributionControl: false,
  hash: "konum",
  canvasContextAttributes: { antialias: true },
});
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATTR.osm }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");
map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 120 }), "bottom-left");
const geolocate = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true });
map.addControl(geolocate, "bottom-left");
geolocate._container?.classList.add("maplibregl-ctrl-geolocate-hidden");
window.__map = map; // hata ayıklama için

// bitki örtüsü karolarının kapsadığı alan (gereksiz 404 isteklerini önler)
function lcBounds() {
  const r = boundaryData?.features[0].geometry;
  if (!r) return [prov.bounds[0][0], prov.bounds[0][1], prov.bounds[1][0], prov.bounds[1][1]];
  const pts = (r.type === "Polygon" ? r.coordinates : r.coordinates.flat()).flat();
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

// --- yardımcı: katman sırası -------------------------------------------------
function firstLayer(pred) { return map.getStyle().layers.find(pred)?.id; }
const firstSymbol = () => firstLayer((l) => l.type === "symbol");
const firstOf = (sl) => firstLayer((l) => l["source-layer"] === sl);

// --- etiket dili ----------------------------------------------------------
function localizeLabels() {
  const L = lang();
  for (const l of map.getStyle().layers) {
    if (l.type !== "symbol" || l.id.startsWith("cat-") || l.id.startsWith("contour")) continue;
    const tf = map.getLayoutProperty(l.id, "text-field");
    if (!tf) continue;
    const s = JSON.stringify(tf);
    if (!/name/.test(s) || /housenumber|"ref"/.test(s)) continue;
    map.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:" + L], ["get", "name"]]);
  }
}

// --- özel kaynak ve katmanlar (her stil yüklemesinde yeniden kurulur) -----
let boundaryData = null;
async function installCustom() {
  const dark = isDark();
  if (!boundaryData) boundaryData = await fetch(DATA + "boundary.geojson").then((r) => r.json()).catch(() => null);
  if (!map.getSource("dem")) map.addSource("dem", { type: "raster-dem", tiles: [SRC.terrarium], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: ATTR.dem });
  if (!map.getSource("dem-hs")) map.addSource("dem-hs", { type: "raster-dem", tiles: [SRC.terrarium], encoding: "terrarium", tileSize: 256, maxzoom: 15 });
  if (!map.getSource("sat")) map.addSource("sat", { type: "raster", tiles: [SRC.satellite], tileSize: 256, maxzoom: 15, attribution: ATTR.sat });
  if (!map.getSource("lc")) map.addSource("lc", { type: "raster", tiles: [new URL(SRC.landcover, location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}")], tileSize: 256, minzoom: 8, maxzoom: 14, bounds: lcBounds(), attribution: ATTR.lc });
  if (!map.getSource("contours")) map.addSource("contours", {
    type: "vector", maxzoom: 15,
    tiles: [demSource.contourProtocolUrl({ thresholds: { 9: [200, 1000], 11: [100, 500], 12: [50, 250], 13: [20, 100], 15: [10, 50] }, elevationKey: "ele", levelKey: "level", contourLayer: "contours" })],
  });

  const water = firstOf("water") || firstSymbol();
  const roads = firstOf("transportation") || firstSymbol();
  const labels = firstSymbol();

  map.addLayer({ id: "lc-raster", type: "raster", source: "lc", layout: { visibility: "none" }, paint: { "raster-opacity": 0.82, "raster-resampling": "nearest" } }, water);
  map.addLayer({ id: "relief-color", type: "color-relief", source: "dem-hs", layout: { visibility: "none" }, paint: {
    "color-relief-opacity": 1,
    "color-relief-color": ["interpolate", ["linear"], ["elevation"],
      // fiziki harita renk dizisi (mutlak yükseklik; tüm illerde aynı ölçek)
      -100, "#7fb3d5", 0, "#4e9a5f", 200, "#6fa862", 500, "#a9c879", 750, "#d3d98f", 900, "#e9e29d", 1050, "#efd68a",
      1200, "#e8bf72", 1350, "#dba461", 1500, "#c98a52", 1700, "#b37148", 2000, "#985e43", 2400, "#80574d", 3000, "#958780", 3800, "#dcd7d3", 5200, "#ffffff"],
  } }, water);
  map.addLayer({ id: "sat-raster", type: "raster", source: "sat", layout: { visibility: "none" }, paint: { "raster-fade-duration": 200 } }, roads);
  map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs", paint: {
    "hillshade-method": "multidirectional",
    "hillshade-exaggeration": 0.45,
    "hillshade-shadow-color": dark ? "rgba(0,0,0,0.75)" : "rgba(60,40,20,0.55)",
    "hillshade-highlight-color": dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,240,0.35)",
  } }, roads);
  map.addLayer({ id: "contour-lines", type: "line", source: "contours", "source-layer": "contours", minzoom: 10,
    paint: { "line-color": dark ? "rgba(255,230,200,0.28)" : "rgba(110,70,30,0.35)", "line-width": ["match", ["get", "level"], 1, 1.1, 0.5] } }, labels);
  map.addLayer({ id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours", minzoom: 11, filter: [">", ["get", "level"], 0],
    layout: { "symbol-placement": "line", "text-size": 10, "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"], "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": dark ? "#e8d6c0" : "#7a5230", "text-halo-color": dark ? "rgba(0,0,0,.7)" : "rgba(255,255,255,.8)", "text-halo-width": 1.2 } }, labels);

  // il dışını karart + il sınırı
  if (!boundaryData) boundaryData = await fetch(DATA + "boundary.geojson").then((r) => r.json()).catch(() => null);
  if (boundaryData && !map.getSource("boundary")) {
    map.addSource("boundary", { type: "geojson", data: boundaryData });
    const g = boundaryData.features[0].geometry;
    const outers = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
    map.addSource("mask", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...outers.map((r) => [...r].reverse())] } } });
    map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": dark ? "#000" : "#3b3026", "fill-opacity": dark ? 0.45 : 0.28 } }, labels);
    map.addLayer({ id: "prov-casing", type: "line", source: "boundary", paint: { "line-color": dark ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.85)", "line-width": 5 } }, labels);
    map.addLayer({ id: "prov-line", type: "line", source: "boundary", paint: { "line-color": "#b5532c", "line-width": 2.2, "line-dasharray": [3, 1.5] } }, labels);
  }

  localizeLabels();
  await ensureIcons();
  for (const id of state.active) addCatLayers(id);
  tour.installTourLayers();
  history.reinstall();
  applyYearFilters();
  applyBase();
  apply3d(false);
}

// --- temel katman -----------------------------------------------------------
function applyBase() {
  const b = state.base;
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  vis("sat-raster", b === "satellite");
  vis("lc-raster", b === "vegetation");
  vis("relief-color", b === "landforms");
  vis("contour-lines", b === "terrain" || b === "landforms");
  vis("contour-labels", b === "terrain" || b === "landforms");
  vis("hillshade", true);
  if (map.getLayer("hillshade")) map.setPaintProperty("hillshade", "hillshade-exaggeration", { terrain: 0.4, satellite: 0.15, landforms: 0.75, vegetation: 0.35 }[b]);
  // yer şekilleri / bitki örtüsü modunda temel haritanın arazi kullanımı dolgularını gizle
  for (const l of map.getStyle().layers) {
    if (l.type === "fill" && ["landcover", "landuse", "park"].includes(l["source-layer"])) vis(l.id, b === "terrain" || b === "satellite");
  }
  document.getElementById("baseName").textContent = t(b);
  document.querySelectorAll(".base-opt").forEach((el) => el.classList.toggle("on", el.dataset.base === b));
  document.getElementById("lcKey").hidden = b !== "vegetation";
}

// --- 2B / 3B ----------------------------------------------------------------
function apply3d(animate = true) {
  const btn = document.getElementById("btn3d");
  btn.classList.toggle("on", state.is3d);
  document.getElementById("lbl3d").textContent = state.is3d ? t("mode2d") : t("mode3d");
  document.getElementById("exagPanel").hidden = !state.is3d;
  if (state.is3d) {
    map.setTerrain({ source: "dem", exaggeration: state.exag });
    const dark = isDark();
    map.setSky({
      "sky-color": dark ? "#0d1420" : "#9cc6ec", "horizon-color": dark ? "#2a3446" : "#f3e7d3",
      "fog-color": dark ? "#1a1f29" : "#efe4d2", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.25, "atmosphere-blend": 0.6,
    });
    if (animate) map.easeTo({ pitch: 62, duration: 1200 });
  } else {
    map.setTerrain(null);
    if (animate) map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
  }
}

// --- ikonlar (yüksek çözünürlüklü, 3× piksel yoğunluğu) ---------------------
const iconCache = {};
async function svgText(name) {
  if (!iconCache[name]) iconCache[name] = fetch(`icons/maki/${name}.svg`).then((r) => r.text());
  return iconCache[name];
}
async function makePin(cat) {
  const R = 3, size = 30 * R;
  const color = GROUP[cat.group].color;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 3 * R; ctx.shadowOffsetY = R;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, 12 * R, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath(); ctx.arc(size / 2, size / 2, 10.5 * R, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  let svg = await svgText(cat.icon);
  svg = svg.replace(/<svg /, '<svg fill="#ffffff" ').replace(/width="15"/, `width="${15 * R}"`).replace(/height="15"/, `height="${15 * R}"`);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const s = 13 * R;
  ctx.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
  return { data: ctx.getImageData(0, 0, size, size), ratio: R };
}
const pinImages = {};
async function ensureIcons() {
  await Promise.all(CATEGORIES.map(async (c) => {
    if (!pinImages[c.id]) pinImages[c.id] = await makePin(c);
    if (!map.hasImage("pin-" + c.id)) map.addImage("pin-" + c.id, pinImages[c.id].data, { pixelRatio: pinImages[c.id].ratio });
  }));
}

// --- kategori katmanları ----------------------------------------------------
async function loadCat(id) {
  if (!state.data[id]) state.data[id] = await fetch(DATA + id + ".geojson").then((r) => r.json());
  return state.data[id];
}
const catLayerIds = (id) => ["fill", "line", "icon", "label"].map((s) => `cat-${id}-${s}`);
const nameExpr = () => ["coalesce", ["get", "name:" + lang()], ["get", "name"]];

function addCatLayers(id) {
  const cat = CAT[id], color = GROUP[cat.group].color;
  const src = "cat-" + id;
  if (!state.data[id]) return;
  if (!map.getSource(src)) map.addSource(src, { type: "geojson", data: state.data[id] });
  if (map.getLayer(`cat-${id}-fill`)) return;
  const isBorder = cat.kind === "border";
  const poly = ["==", ["geometry-type"], "Polygon"];
  const line = ["==", ["geometry-type"], "LineString"];
  const point = ["==", ["geometry-type"], "Point"];

  const below = map.getLayer("tour-line") ? "tour-line" : undefined;
  map.addLayer({ id: `cat-${id}-fill`, type: "fill", source: src, filter: poly,
    paint: { "fill-color": color, "fill-opacity": isBorder ? 0.01 : 0.16 } }, below);

  let lineColor = color, lineWidth = 2, dash = null;
  if (id === "yollar") { lineColor = ["match", ["get", "highway"], "motorway", "#d4442e", "trunk", "#e0742d", "primary", "#e8a33a", "#c9b23a"]; lineWidth = ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 6]; }
  if (id === "akarsu_gol") { lineColor = "#2b7bd1"; lineWidth = ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 4]; }
  if (isBorder) { lineWidth = id === "ilceler" ? 2.2 : 1.2; dash = [2, 1.5]; }
  map.addLayer({ id: `cat-${id}-line`, type: "line", source: src, filter: ["any", poly, line],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": lineColor, "line-width": lineWidth, "line-opacity": 0.9, ...(dash ? { "line-dasharray": dash } : {}) } }, below);

  map.addLayer({ id: `cat-${id}-icon`, type: "symbol", source: src, filter: isBorder ? ["==", ["geometry-type"], "None"] : point,
    layout: { "icon-image": "pin-" + id, "icon-allow-overlap": true, "icon-ignore-placement": false, "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.75, 13, 1] } }, below);

  map.addLayer({ id: `cat-${id}-label`, type: "symbol", source: src,
    filter: isBorder ? point : (["yollar", "akarsu_gol"].includes(id) ? ["any", point, line] : point),
    minzoom: isBorder ? (id === "ilceler" ? 7 : 11) : 11.5,
    layout: {
      "text-field": nameExpr(), "text-font": ["Noto Sans Regular"], "text-size": isBorder ? (id === "ilceler" ? 14 : 11.5) : 12,
      "text-offset": isBorder ? [0, 0] : [0, 1.4], "text-anchor": isBorder ? "center" : "top", "text-optional": true, "text-max-width": 9,
      "symbol-placement": ["yollar", "akarsu_gol"].includes(id) ? "line" : "point",
      ...(isBorder ? { "text-transform": id === "ilceler" ? "uppercase" : "none", "text-letter-spacing": id === "ilceler" ? 0.12 : 0 } : {}),
    },
    paint: { "text-color": isBorder ? color : (isDark() ? "#f0ebe3" : "#2a2420"), "text-halo-color": isDark() ? "rgba(0,0,0,.8)" : "rgba(255,255,255,.92)", "text-halo-width": 1.6 } }, below);
}
// zaman kaydırıcısı: kategori katmanlarına yıl süzgeci ekle / kaldır
const baseFilters = {};
function applyYearFilters() {
  const yf = history.yearFilter();
  for (const id of state.active) for (const l of catLayerIds(id)) {
    if (!map.getLayer(l)) continue;
    if (!(l in baseFilters)) baseFilters[l] = map.getFilter(l) ?? null;
    const base = baseFilters[l];
    map.setFilter(l, yf ? (base ? ["all", base, yf] : yf) : base);
  }
}
function removeCatLayers(id) {
  for (const l of catLayerIds(id)) delete baseFilters[l];
  for (const l of catLayerIds(id)) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource("cat-" + id)) map.removeSource("cat-" + id);
}
async function setCat(id, on) {
  if (on) {
    state.active.add(id);
    await loadCat(id);
    try { if (state.active.has(id)) { addCatLayers(id); applyYearFilters(); } } catch { /* stil yeniden yükleniyor; style.load sonrası eklenecek */ }
  } else {
    state.active.delete(id);
    removeCatLayers(id);
  }
  syncLegend();
}

// --- tıklama → bilgi kartı ------------------------------------------------
const activeLayerIds = () => [...state.active].flatMap(catLayerIds).filter((l) => map.getLayer(l));
map.on("click", (e) => {
  if (tour.handleMapClick(e)) return;
  const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
  const feats = map.queryRenderedFeatures(box, { layers: activeLayerIds() });
  if (!feats.length) return;
  const rank = (f) => (f.geometry.type === "Point" && !CAT[f.properties.cat]?.kind ? 0 : f.geometry.type.includes("Line") ? 1 : 2);
  feats.sort((a, b) => rank(a) - rank(b));
  const f = feats[0];
  const full = findFeature(state.data[f.properties.cat], f.properties.id) || f;
  showCard(full, e.lngLat);
});
map.on("mousemove", (e) => {
  const ids = activeLayerIds();
  if (tour.isAddMode()) { map.getCanvas().style.cursor = "crosshair"; return; }
  if (map.getLayer("tour-pt")) ids.push("tour-pt");
  map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? "pointer" : "";
});

function showCard(feature, lngLat) {
  const cat = CAT[feature.properties.cat];
  // yol tarifi için tıklanan yer yerine nesnenin kendi noktasını kullan (alanlar için iç nokta)
  const fc = state.data[cat.id];
  const ptF = feature.geometry?.type === "Point" ? feature : fc?.features.find((x) => x.properties.id === feature.properties.id && x.properties._pt);
  if (ptF) lngLat = { lng: ptF.geometry.coordinates[0], lat: ptF.geometry.coordinates[1] };
  openCard({ feature, cat, group: GROUP[cat.group], lngLat, prov, dataUrl: DATA, onClose: () => {} });
}

/** Bir yeri bul, kategorisini aç, haritada göster ve kartını aç (arama ve paylaşılan bağlantılar). */
async function focusFeature(cid, fid) {
  if (!CAT[cid]) return;
  await setCat(cid, true);
  const fc = state.data[cid];
  const f = findFeature(fc, fid);
  if (!f) return;
  const ptF = f.geometry.type === "Point" ? f : fc.features.find((x) => x.properties.id === fid && x.properties._pt);
  if (f.geometry.type === "Point") map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15), duration: 1200 });
  else {
    const b = new maplibregl.LngLatBounds();
    const walk = (c) => (typeof c[0] === "number" ? b.extend(c) : c.forEach(walk));
    walk(f.geometry.coordinates);
    const wide = innerWidth > 720;
    map.fitBounds(b, { padding: { top: 80, bottom: wide ? 60 : innerHeight * 0.55, left: wide ? 420 : 40, right: wide ? 170 : 70 }, maxZoom: 16, duration: 1200 });
  }
  showCard(f, ptF ? { lng: ptF.geometry.coordinates[0], lat: ptF.geometry.coordinates[1] } : null);
}

// ---------------------------------------------------------------------------
// Arayüz
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), 2200);
}
window.__toast = toast;

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute("aria-label", t(el.dataset.i18nTitle)); });
  $("provName").textContent = prov.names[lang()] || prov.names.tr;
  $("lblLang").textContent = lang().toUpperCase();
  $("lblTheme").textContent = t(state.theme);
  $("lbl3d").textContent = state.is3d ? t("mode2d") : t("mode3d");
  $("baseName").textContent = t(state.base);
  document.title = (prov.names[lang()] || prov.names.tr) + " – " + (lang() === "tr" ? "Rehber Harita" : "Guide Map");
  buildBaseGrid(); buildLegend(); buildLangList(); updateAltitude();
}

// panel aç/kapa
const panels = ["layersPanel", "legendPanel", "langPanel", "searchPanel", "tourPanel"];
const panelBtn = { layersPanel: "btnLayers", legendPanel: "btnLegend", searchPanel: "btnSearch", tourPanel: "btnTour" };
function closePanels() { panels.forEach((p) => ($(p).hidden = true)); Object.values(panelBtn).forEach((b) => $(b).classList.remove("on")); }
function togglePanel(id, force) {
  const el = $(id);
  const open = force ?? el.hidden;
  if (open) panels.forEach((p) => p !== id && ($(p).hidden = true));
  el.hidden = !open;
  for (const [p, b] of Object.entries(panelBtn)) $(b).classList.toggle("on", !$(p).hidden);
  if (open && id === "legendPanel" && matchMedia("(max-width: 720px)").matches) closeCard();
}
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => togglePanel(b.dataset.close, false)));
$("btnLayers").onclick = () => togglePanel("layersPanel");
$("btnLegend").onclick = () => togglePanel("legendPanel");
$("btnLang").onclick = () => togglePanel("langPanel");
$("btnLocate").onclick = () => geolocate.trigger();

// katman seçici
const thumbs = {
  satellite: `url("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/11/785/1222.jpg")`,
  vegetation: `url("${DATA}landcover/11/1222/785.png")`,
  landforms: "linear-gradient(160deg, #4e9a5f 0%, #b9cf83 28%, #ecd28c 48%, #cf985a 68%, #9a6545 86%, #e6e2df 100%)",
  terrain: "repeating-radial-gradient(circle at 60% 45%, #efe9dc 0 7px, #c9b89a 7px 8px)",
};
function buildBaseGrid() {
  const g = $("baseGrid");
  g.innerHTML = "";
  for (const b of BASES) {
    const btn = document.createElement("button");
    btn.className = "base-opt" + (state.base === b ? " on" : "");
    btn.dataset.base = b;
    btn.innerHTML = `<div class="thumb" style='background-image:${thumbs[b]}'></div><span>${t(b)}</span>`;
    btn.onclick = () => { state.base = b; store.set("base", b); applyBase(); };
    g.appendChild(btn);
  }
  const note = document.createElement("p"); note.className = "base-note"; note.textContent = t("satNote");
  g.after(note); g.parentElement.querySelectorAll(".base-note").forEach((n, i) => i > 0 && n.remove());
  $("lcKey").innerHTML = `<h3>${t("lcTitle")}</h3><ul>${LC_CLASSES.map(([k, c]) => `<li><i style="background:${c}"></i>${t("lc." + k)}</li>`).join("")}</ul>`;
}

// dil listesi
function buildLangList() {
  $("langList").innerHTML = "";
  for (const l of UI_LANGS) {
    const b = document.createElement("button");
    b.className = l.id === lang() ? "on" : "";
    b.innerHTML = `<span>${l.label}</span><span>${l.id.toUpperCase()}</span>`;
    b.onclick = () => {
      state.lang = l.id; store.set("lang", l.id); setLang(l.id); applyI18n(); localizeLabels();
      for (const id of state.active) if (map.getLayer(`cat-${id}-label`)) map.setLayoutProperty(`cat-${id}-label`, "text-field", nameExpr());
      togglePanel("langPanel", false);
      document.dispatchEvent(new CustomEvent("langchange"));
    };
    $("langList").appendChild(b);
  }
}

// lejant
const openGroups = new Set(GROUPS.map((g) => g.id));
function catName(c) { return c.names[lang()] || c.names.tr; }
function buildLegend() {
  const body = $("legendBody");
  body.innerHTML = "";
  for (const g of GROUPS) {
    const cats = CATEGORIES.filter((c) => c.group === g.id);
    const wrap = document.createElement("section");
    wrap.className = "lg-group" + (openGroups.has(g.id) ? "" : " closed");
    const head = document.createElement("button");
    head.className = "lg-ghead";
    head.innerHTML = `<span class="dot" style="background:${g.color}"></span>${g.names[lang()] || g.names.tr}<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
    head.onclick = () => { openGroups.has(g.id) ? openGroups.delete(g.id) : openGroups.add(g.id); wrap.classList.toggle("closed"); };
    const items = document.createElement("div");
    items.className = "lg-items";
    const visibleCats = cats.filter((c) => history.catVisibleAt(c.id));
    if (!visibleCats.length) continue;
    for (const c of visibleCats) {
      const n = history.isActive() ? history.countAt(c.id) ?? state.counts[c.id] : state.counts[c.id];
      const empty = n === 0;
      const row = document.createElement("label");
      row.className = "lg-item" + (empty ? " empty" : "");
      row.innerHTML = `<span class="pin" style="background:${g.color}"><i style="--icon:url(${new URL(`icons/maki/${c.icon}.svg`, location.href)})"></i></span>
        <span class="name">${catName(c)}</span><span class="count">${n == null ? "" : empty ? t("noData") : n}</span>
        <span class="switch"><input type="checkbox" data-cat="${c.id}" ${state.active.has(c.id) ? "checked" : ""} ${empty ? "disabled" : ""}><span></span></span>`;
      row.querySelector("input").onchange = (ev) => setCat(c.id, ev.target.checked);
      items.appendChild(row);
    }
    wrap.append(head, items);
    body.appendChild(wrap);
  }
}
function syncLegend() {
  document.querySelectorAll("#legendBody input[data-cat]").forEach((i) => (i.checked = state.active.has(i.dataset.cat)));
  const b = $("legendBadge"); b.hidden = state.active.size === 0; b.textContent = state.active.size;
}
$("allOff").onclick = () => { [...state.active].forEach((id) => setCat(id, false)); };

// tema
$("btnTheme").onclick = () => {
  state.theme = { auto: "light", light: "dark", dark: "auto" }[state.theme];
  store.set("theme", state.theme);
  const wasDark = map.getStyle().sprite?.toString().includes("dark") ?? false;
  applyThemeAttr();
  reloadStyleIfNeeded(wasDark);
};
darkMQ.addEventListener("change", () => state.theme === "auto" && reloadStyleIfNeeded());
let currentStyleDark = isDark();
function reloadStyleIfNeeded() {
  if (currentStyleDark === isDark()) return;
  currentStyleDark = isDark();
  for (const id of state.active) removeCatLayers(id);
  for (const k of Object.keys(baseFilters)) delete baseFilters[k];
  map.setStyle(currentStyleDark ? SRC.styleDark : SRC.styleLight, { diff: false });
}

// 2B/3B
$("btn3d").onclick = () => { state.is3d = !state.is3d; apply3d(true); };
$("exagSlider").oninput = (e) => {
  state.exag = parseFloat(e.target.value);
  $("exagValue").textContent = state.exag.toFixed(1) + "×";
  if (state.is3d) map.setTerrain({ source: "dem", exaggeration: state.exag });
};

// yakınlaştırma + irtifa
$("zoomIn").onclick = () => map.zoomIn();
$("zoomOut").onclick = () => map.zoomOut();
const alt = $("altSlider");
alt.oninput = () => map.jumpTo({ zoom: parseFloat(alt.value) });
function cameraAltitude() {
  // görüş alanı varsayılan 36.87°, harita yüksekliğinin yarısı / tan(fov/2) × metre/piksel
  const lat = map.getCenter().lat;
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const h = map.getCanvas().clientHeight / 2 / Math.tan((36.87 / 2) * (Math.PI / 180));
  return h * mpp * Math.cos((map.getPitch() * Math.PI) / 180);
}
function updateAltitude() {
  alt.value = map.getZoom();
  const m = cameraAltitude();
  $("altValue").textContent = m >= 10000 ? Math.round(m / 1000) + " km" : m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m";
  $("compass").hidden = Math.abs(map.getBearing()) < 1 && map.getPitch() < 1;
  $("compass").querySelector("svg").style.transform = `rotate(${-map.getBearing()}deg)`;
}
map.on("move", updateAltitude);
$("compass").onclick = () => map.easeTo({ bearing: 0, pitch: state.is3d ? map.getPitch() : 0 });

// ---------------------------------------------------------------------------
// Başlat
// ---------------------------------------------------------------------------
map.on("style.load", () => { installCustom().catch((e) => console.error(e)); });
// kaynak satırı kapalı başlasın (ⓘ ile açılır), ölçek çubuğunun üstüne binmesin
map.once("load", () => { document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"); });
fetch(DATA + "index.json").then((r) => r.json()).then((idx) => { state.counts = idx.counts; state.dates = idx.dates || {}; buildLegend(); syncLegend(); }).catch(() => {});
applyI18n();
syncLegend();

// Arama ve tur
initSearch({ dataUrl: DATA, cats: CAT, groups: GROUP, focus: focusFeature, closePanels });
const tourInit = tour.initTour(map, { prov, toast, closePanels });
history.initHistory(map, {
  dataUrl: DATA, cats: CATEGORIES, dates: () => state.dates, closePanels,
  onChange: () => { applyYearFilters(); buildLegend(); syncLegend(); },
});
diorama.initDiorama(map, {
  dataUrl: DATA, prov, toast, closePanels, cats: CAT, groups: GROUP,
  base: () => state.base, exag: () => state.exag, isDark,
  activePoints: () => [...state.active].flatMap((id) => (state.data[id]?.features || [])
    .filter((f) => f.geometry.type === "Point" && !CAT[id].kind && (f.properties.name || f.properties["name:tr"]))
    .filter((f) => !history.isActive() || (f.properties._from != null && f.properties._from <= history.currentYear()))
    .map((f) => ({ cat: id, name: f.properties["name:tr"] || f.properties.name, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))),
  tourStops: () => { try { return JSON.parse(localStorage.getItem("rh.tour") || "null")?.s || []; } catch { return []; } },
});

map.once("load", () => {
  // Paylaşılan bağlantı: ?poi=<kategori>:<osm-id>
  const poi = params.get("poi");
  if (poi) { const [cid, fid] = poi.split(":"); focusFeature(cid, fid); }
  else if (tourInit.openOnLoad) { tour.fitTour(); tour.open(); }
});

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
