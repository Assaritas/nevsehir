// Tur programı: bir ya da birden çok gün, her günün kendi durakları ve rengi.
// Sunucu gerektirmez: program bağlantının içine yazılır (?tur=…). Rehber programı ?rehber=1 ile açılan
// rehber modunda hazırlar, "Bağlantıyı paylaş" ile WhatsApp grubuna gönderir.
// Tur ekranı açıkken haritada yalnızca seçili günün durakları ve güzergâhı görünür.
import { t, lang } from "./i18n.js";

const KEY = "rh.tour";
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* özel pencere */ } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r5 = (v) => Math.round(v * 1e5) / 1e5;
export const DAY_COLORS = ["#b5532c", "#2a62b0", "#2f7d32", "#7b2d8e", "#b8860b", "#0f7c80", "#c0392b"];

let map, ctx, tour = null, day = 0, guide = false, addMode = false, highlight = -1;

// --- kodlama: base64url(JSON) — tüm telefonlarda çözülebilir -----------------
function b64u(bytes) { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
export function encodeTour(obj) { return "j" + b64u(new TextEncoder().encode(JSON.stringify(obj))); }
/** v1 (tek gün: {d, s}) ve v2 ({days:[{d, s}]}) biçimlerini v2'ye çevirir */
function normalize(o) {
  if (!o || typeof o !== "object") return null;
  if (!Array.isArray(o.days)) o = { v: 2, t: o.t, days: [{ d: o.d, s: o.s || [] }] };
  o.v = 2;
  o.days = o.days.slice(0, 14).map((d) => ({
    d: d.d, l: d.l,
    s: (d.s || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 60),
  }));
  if (!o.days.length) o.days = [{ d: today(), s: [] }];
  return o;
}
export function decodeTour(s) {
  if (!s || s[0] !== "j") return null;
  try { return normalize(JSON.parse(new TextDecoder().decode(unb64u(s.slice(1))))); } catch { return null; }
}

const cur = () => tour?.days[day] || null;
const stops = () => cur()?.s || [];
const color = (i = day) => DAY_COLORS[i % DAY_COLORS.length];
const totalStops = () => (tour?.days || []).reduce((n, d) => n + d.s.length, 0);

function persist() { store.set(KEY, tour ? JSON.stringify(tour) : null); }
function save() { persist(); render(); updateMap(); }
function saveQuiet() { persist(); updateMap(); renderHead(); }

// --- harita katmanları -------------------------------------------------------
function geojson() {
  const s = stops();
  return {
    type: "FeatureCollection",
    features: [
      ...(s.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: s.map((p) => [p.x, p.y]) } }] : []),
      ...s.map((p, i) => ({ type: "Feature", properties: { i, n: String(i + 1), hl: i === highlight ? 1 : 0 }, geometry: { type: "Point", coordinates: [p.x, p.y] } })),
    ],
  };
}
export function installTourLayers() {
  if (!map.getSource("tour")) map.addSource("tour", { type: "geojson", data: geojson() });
  if (!map.getLayer("tour-pt")) {
    map.addLayer({ id: "tour-line-casing", type: "line", source: "tour", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.8 } });
    map.addLayer({ id: "tour-line", type: "line", source: "tour", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color(), "line-width": 3.5, "line-dasharray": [1.2, 1.6] } });
    map.addLayer({ id: "tour-pt", type: "circle", source: "tour", filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": ["case", ["==", ["get", "hl"], 1], 17, 13], "circle-color": color(),
        "circle-stroke-color": "#ffffff", "circle-stroke-width": ["case", ["==", ["get", "hl"], 1], 4, 3], "circle-pitch-alignment": "viewport" } });
    map.addLayer({ id: "tour-num", type: "symbol", source: "tour", filter: ["==", ["geometry-type"], "Point"],
      layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" } });
  }
  updateMap();
}
function updateMap() {
  map.getSource("tour")?.setData(geojson());
  if (map.getLayer("tour-pt")) {
    map.setPaintProperty("tour-pt", "circle-color", color());
    map.setPaintProperty("tour-line", "line-color", color());
  }
  $("btnTour").hidden = !(totalStops() || guide);
  $("tourBadge").hidden = !totalStops();
  $("tourBadge").textContent = totalStops() || "";
}
export function fitTour() {
  const s = stops();
  if (!s.length) return;
  if (s.length === 1) { map.flyTo({ center: [s[0].x, s[0].y], zoom: 15 }); return; }
  const b = new maplibregl.LngLatBounds();
  s.forEach((p) => b.extend([p.x, p.y]));
  const wide = innerWidth > 720;
  map.fitBounds(b, { padding: { top: 90, bottom: wide ? 90 : innerHeight * 0.55, left: 60, right: wide ? 480 : 70 }, maxZoom: 15.5 });
}

// --- zaman ------------------------------------------------------------------
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function nextIndex() {
  const c = cur();
  if (!c?.d || c.d !== today()) return -1;
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  return c.s.findIndex((p) => { if (!p.h) return false; const [h, m] = p.h.split(":").map(Number); return h * 60 + m >= mins - 10; });
}
function fmtDate(d, opts = { weekday: "long", day: "numeric", month: "long" }) {
  if (!d) return "";
  try { return new Date(d + "T12:00:00").toLocaleDateString(lang(), opts); } catch { return d; }
}
const dayLabel = (d, i) => d.l || (d.d ? fmtDate(d.d, { weekday: "short", day: "numeric", month: "short" }) : `${t("g.day")} ${i + 1}`);

// --- panel -------------------------------------------------------------------
const ICON = {
  dir: '<svg viewBox="0 0 24 24"><path d="M12 2 3 21l9-4 9 4L12 2Z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
};
const dirUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.y},${p.x}`;

function renderHead() {
  $("tourTitle").textContent = tour?.t || t("tourDefault");
  const c = cur(), n = stops().length;
  $("tourDate").textContent = [c?.d ? fmtDate(c.d) : "", n ? `${n} ${t("stops")}` : ""].filter(Boolean).join(" · ");
}
function render() {
  const body = $("tourBody");
  if (!body) return;
  renderHead();
  $("tourPanel").classList.toggle("guide", guide);
  const s = stops();
  const nx = nextIndex();
  let html = "";

  // gün sekmeleri
  if (tour && (tour.days.length > 1 || guide)) {
    html += `<div class="day-tabs" role="tablist">${tour.days.map((d, i) => `
      <button role="tab" class="day-tab${i === day ? " on" : ""}" data-day="${i}" style="--dc:${color(i)}">
        <i></i>${esc(dayLabel(d, i))}<small>${d.s.length}</small></button>`).join("")}
      ${guide ? `<button class="day-tab add" id="gAddDay">${ICON.plus}${t("g.addDay")}</button>` : ""}</div>`;
  }
  if (guide) {
    html += `<div class="g-head"><span class="g-badge">${t("g.mode")}</span>
      <label>${t("g.title")}<input id="gTitle" value="${esc(tour?.t || "")}" placeholder="${esc(t("tourDefault"))}"></label>
      <label>${t("g.date")}<input id="gDate" type="date" value="${esc(cur()?.d || today())}"></label>
      <label class="wide">${t("g.dayName")}<input id="gDayName" value="${esc(cur()?.l || "")}" placeholder="${esc(cur()?.d ? fmtDate(cur().d, { weekday: "long" }) : "")}"></label></div>`;
  }
  if (!s.length) html += `<p class="t-empty">${guide ? t("g.empty") : ""}</p>`;
  html += `<ol class="stops" style="--dc:${color()}">${s.map((p, i) => guide ? `
      <li class="stop edit${i === highlight ? " hl" : ""}" data-i="${i}">
        <span class="num">${i + 1}</span>
        <div class="fields">
          <div class="row"><input class="g-time" type="time" value="${esc(p.h || "")}" data-f="h"><input class="g-name" value="${esc(p.n || "")}" placeholder="${esc(t("g.stopName"))}" data-f="n"></div>
          <input class="g-note" value="${esc(p.o || "")}" placeholder="${esc(t("g.note"))}" data-f="o">
        </div>
        <div class="ops">
          <button data-op="up" title="${t("g.up")}" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
          <button data-op="down" title="${t("g.down")}" ${i === s.length - 1 ? "disabled" : ""}>${ICON.down}</button>
          <button data-op="del" title="${t("g.del")}">${ICON.del}</button>
        </div>
      </li>` : `
      <li class="stop${i === nx ? " next" : ""}${i === highlight ? " hl" : ""}" data-i="${i}">
        <span class="num">${i + 1}</span>
        <button class="info" data-op="show">
          ${p.h ? `<span class="time">${esc(p.h)}</span>` : ""}${i === nx ? `<span class="next-tag">${t("next")}</span>` : ""}
          <b>${esc(p.n || "—")}</b>${p.o ? `<small>${esc(p.o)}</small>` : ""}
        </button>
        <a class="dir" href="${dirUrl(p)}" target="_blank" rel="noopener" title="${t("directions")}">${ICON.dir}<span>${t("directions")}</span></a>
      </li>`).join("")}</ol>`;

  html += `<div class="t-actions">`;
  if (guide) {
    html += `<button id="gAdd" class="${addMode ? "on" : ""}">${ICON.plus}${addMode ? t("g.adding") : t("g.addStop")}</button>
      <button id="gShare" class="primary" ${totalStops() ? "" : "disabled"}>${ICON.share}${t("g.share")}</button>
      ${tour && tour.days.length > 1 ? `<button id="gDelDay" class="text-btn">${t("g.delDay")}</button>` : ""}
      <button id="gNew" class="text-btn">${t("g.newTour")}</button>
      <button id="gExit" class="text-btn">${t("g.exit")}</button>`;
  } else if (s.length) {
    html += `<button id="tFit">${t("showAll")}</button><button id="tRemove" class="text-btn">${t("removeTour")}</button>`;
  }
  html += `</div>`;
  body.innerHTML = html;
  wire();
}

function setDay(i) {
  day = Math.max(0, Math.min((tour?.days.length || 1) - 1, i));
  highlight = -1;
  render(); updateMap(); fitTour();
}

function wire() {
  const body = $("tourBody");
  body.querySelectorAll(".day-tab[data-day]").forEach((b) => (b.onclick = () => setDay(+b.dataset.day)));
  body.querySelectorAll(".stop").forEach((li) => {
    const i = +li.dataset.i;
    li.querySelectorAll("[data-op]").forEach((b) => (b.onclick = () => {
      const s = stops();
      if (b.dataset.op === "show") { highlight = i; updateMap(); render(); map.flyTo({ center: [s[i].x, s[i].y], zoom: Math.max(map.getZoom(), 15) }); }
      if (b.dataset.op === "up" && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; save(); }
      if (b.dataset.op === "down" && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; save(); }
      if (b.dataset.op === "del") { s.splice(i, 1); save(); }
    }));
    // alan değişikliklerinde listeyi yeniden çizme (odak kaybolmasın), yalnızca kaydet
    li.querySelectorAll("input[data-f]").forEach((inp) => (inp.onchange = () => {
      const p = stops()[i];
      p[inp.dataset.f] = inp.value.trim();
      if (!p[inp.dataset.f]) delete p[inp.dataset.f];
      saveQuiet();
    }));
  });
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  const title = $("gTitle"), date = $("gDate"), dname = $("gDayName");
  if (title) title.onchange = () => { ensure(); tour.t = title.value.trim() || undefined; saveQuiet(); };
  if (date) date.onchange = () => { ensure(); cur().d = date.value || undefined; save(); };
  if (dname) dname.onchange = () => { ensure(); cur().l = dname.value.trim() || undefined; save(); };
  on("gAddDay", () => {
    ensure();
    const last = tour.days[tour.days.length - 1]?.d;
    const next = last ? new Date(new Date(last + "T12:00:00").getTime() + 864e5).toISOString().slice(0, 10) : today();
    tour.days.push({ d: next, s: [] });
    day = tour.days.length - 1; save();
  });
  on("gDelDay", () => { if (tour.days.length > 1 && confirm(t("g.delDayConfirm"))) { tour.days.splice(day, 1); day = Math.max(0, day - 1); save(); } });
  on("gAdd", () => { addMode = !addMode; render(); if (addMode) { ctx.toast(t("g.addHint")); if (innerWidth <= 720) close(); } });
  on("gShare", share);
  on("gNew", () => { if (confirm(t("g.newConfirm"))) { tour = { v: 2, days: [{ d: today(), s: [] }] }; day = 0; highlight = -1; save(); } });
  on("gExit", () => setGuide(false));
  on("tFit", () => { fitTour(); });
  on("tRemove", () => { if (confirm(t("removeConfirm"))) { tour = null; highlight = -1; save(); close(); stripUrl(); } });
}

function ensure() { if (!tour) { tour = { v: 2, days: [{ d: today(), s: [] }] }; day = 0; } }
function stripUrl() {
  const u = new URL(location.href);
  if (u.searchParams.has("tur")) { u.searchParams.delete("tur"); history.replaceState(null, "", u); }
}

function shareUrl() {
  const u = new URL(location.href);
  u.hash = "";
  u.search = "";
  u.searchParams.set("il", ctx.prov.id);
  u.searchParams.set("tur", encodeTour(tour));
  return u.toString();
}
async function share() {
  const url = shareUrl();
  const lines = [`🗺️ ${tour.t || t("tourDefault")}`];
  tour.days.forEach((d, di) => {
    if (!d.s.length) return;
    lines.push("", `📅 ${d.l ? d.l + (d.d ? " – " + fmtDate(d.d) : "") : d.d ? fmtDate(d.d) : t("g.day") + " " + (di + 1)}`);
    d.s.forEach((p, i) => lines.push(`${i + 1}) ${p.h ? p.h + " · " : ""}${p.n || "—"}${p.o ? " (" + p.o + ")" : ""}`));
  });
  lines.push("", `${t("g.map")}: ${url}`);
  const text = lines.join("\n");
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); ctx.toast(t("copied")); }
  } catch { /* iptal */ }
  history.replaceState(null, "", url);
}

// --- dış arayüz --------------------------------------------------------------
export function open() {
  ctx.closePanels();
  render();
  $("tourPanel").hidden = false;
  $("btnTour").classList.add("on");
  ctx.setFocus(true);           // yalnızca tur durakları görünsün
  updateMap();
}
export function close() {
  $("tourPanel").hidden = true;
  $("btnTour").classList.remove("on");
  ctx.setFocus(false);
}
export const isOpen = () => !$("tourPanel").hidden;
export const isAddMode = () => addMode;
export const allStops = () => stops();

export function addStop(name, lng, lat) {
  ensure();
  stops().push({ n: name || undefined, x: r5(lng), y: r5(lat) });
  highlight = stops().length - 1;
  save();
  ctx.toast(`${t("g.added")}: ${name || stops().length} (${dayLabel(cur(), day)})`);
}

/** Harita tıklaması: durak noktasına dokunulduysa ya da ekleme modundaysa işler ve true döner. */
export function handleMapClick(e) {
  const hit = map.getLayer("tour-pt") && map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ["tour-pt"] })[0];
  if (hit && !addMode) { highlight = hit.properties.i; updateMap(); open(); $("tourBody").querySelector(".stop.hl")?.scrollIntoView({ block: "nearest" }); return true; }
  if (!addMode) return false;
  const named = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]])
    .find((f) => f.properties && (f.properties["name:" + lang()] || f.properties.name) && f.layer.type === "symbol" && !f.layer.id.startsWith("contour"));
  addStop(named ? named.properties["name:tr"] || named.properties.name : "", e.lngLat.lng, e.lngLat.lat);
  addMode = false;
  open();
  return true;
}

export function setGuide(on) {
  guide = on;
  document.documentElement.dataset.guide = on ? "1" : "0";
  store.set("rh.guide", on ? "1" : null);
  addMode = false;
  updateMap();
  render();
  if (!on) close();
}
export const isGuide = () => guide;

export function initTour(_map, _ctx) {
  map = _map; ctx = _ctx;
  const params = new URLSearchParams(location.search);
  if (params.get("rehber") === "1") store.set("rh.guide", "1");
  if (params.get("rehber") === "0") store.set("rh.guide", null);
  guide = store.get("rh.guide") === "1";
  document.documentElement.dataset.guide = guide ? "1" : "0";

  const fromUrl = decodeTour(params.get("tur"));
  if (fromUrl) { tour = fromUrl; persist(); }
  else { try { tour = normalize(JSON.parse(store.get(KEY) || "null")); } catch { tour = null; } }
  // bugünün günü varsa onu seç
  if (tour) { const i = tour.days.findIndex((d) => d.d === today()); day = i >= 0 ? i : 0; }

  $("btnTour").onclick = () => ($("tourPanel").hidden ? open() : close());
  document.addEventListener("tour:add", (e) => addStop(e.detail.name, e.detail.lng, e.detail.lat));
  document.addEventListener("langchange", render);
  setInterval(() => { if (!$("tourPanel").hidden && !guide) render(); }, 60000);
  updateMap();
  return { openOnLoad: !!fromUrl && totalStops() > 0 };
}
