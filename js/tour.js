// "Bugünkü tur": rehberin buluşma noktaları ve durakları.
// Sunucu gerektirmez: tur bağlantının içine yazılır (?tur=…). Rehber turu ?rehber=1 ile açılan
// rehber modunda hazırlar, "Bağlantıyı paylaş" ile WhatsApp grubuna gönderir.
// Misafir bağlantıyı açtığında tur cihazına kaydedilir; ana ekrandan açıldığında da görünür.
import { t, lang } from "./i18n.js";

const KEY = "rh.tour";
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* özel pencere */ } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r5 = (v) => Math.round(v * 1e5) / 1e5;

let map, ctx, tour = null, guide = false, addMode = false, highlight = -1;

// --- kodlama: base64url(JSON) — tüm telefonlarda çözülebilir -----------------
function b64u(bytes) { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
export function encodeTour(obj) { return "j" + b64u(new TextEncoder().encode(JSON.stringify(obj))); }
export function decodeTour(s) {
  if (!s || s[0] !== "j") return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(unb64u(s.slice(1))));
    if (!Array.isArray(o.s)) return null;
    o.s = o.s.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 60);
    return o;
  } catch { return null; }
}

function saveQuiet() {
  store.set(KEY, tour ? JSON.stringify(tour) : null);
  updateMap();
  $("tourTitle").textContent = tour?.t || t("tourDefault");
}
function save() {
  store.set(KEY, tour ? JSON.stringify(tour) : null);
  render();
  updateMap();
}

// --- harita katmanları -------------------------------------------------------
function geojson() {
  const s = tour?.s || [];
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
  if (map.getLayer("tour-pt")) return;
  map.addLayer({ id: "tour-line", type: "line", source: "tour", filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#b5532c", "line-width": 3.5, "line-dasharray": [1.2, 1.6], "line-opacity": 0.9 } });
  map.addLayer({ id: "tour-pt", type: "circle", source: "tour", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": ["case", ["==", ["get", "hl"], 1], 17, 13], "circle-color": ["case", ["==", ["get", "hl"], 1], "#7d2e14", "#b5532c"],
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 3, "circle-pitch-alignment": "viewport" } });
  map.addLayer({ id: "tour-num", type: "symbol", source: "tour", filter: ["==", ["geometry-type"], "Point"],
    layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#ffffff" } });
}
function updateMap() {
  map.getSource("tour")?.setData(geojson());
  $("btnTour").hidden = !(tour?.s?.length || guide);
  $("tourBadge").hidden = !tour?.s?.length;
  $("tourBadge").textContent = tour?.s?.length || "";
}
export function fitTour() {
  const s = tour?.s || [];
  if (!s.length) return;
  if (s.length === 1) { map.flyTo({ center: [s[0].x, s[0].y], zoom: 15 }); return; }
  const b = new maplibregl.LngLatBounds();
  s.forEach((p) => b.extend([p.x, p.y]));
  const wide = innerWidth > 720;
  map.fitBounds(b, { padding: { top: 90, bottom: wide ? 90 : innerHeight * 0.5, left: 60, right: wide ? 480 : 70 }, maxZoom: 15.5 });
}

// --- zaman ------------------------------------------------------------------
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function nextIndex() {
  if (!tour?.d || tour.d !== today()) return -1;
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  return tour.s.findIndex((p) => { if (!p.h) return false; const [h, m] = p.h.split(":").map(Number); return h * 60 + m >= mins - 10; });
}
function fmtDate(d) {
  if (!d) return "";
  try { return new Date(d + "T12:00:00").toLocaleDateString(lang(), { weekday: "long", day: "numeric", month: "long" }); } catch { return d; }
}

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

function render() {
  const body = $("tourBody");
  if (!body) return;
  const s = tour?.s || [];
  const nx = nextIndex();
  $("tourTitle").textContent = tour?.t || t("tourDefault");
  $("tourDate").textContent = [fmtDate(tour?.d), s.length ? `${s.length} ${t("stops")}` : ""].filter(Boolean).join(" · ");
  $("tourPanel").classList.toggle("guide", guide);

  let html = "";
  if (guide) {
    html += `<div class="g-head"><span class="g-badge">${t("g.mode")}</span>
      <label>${t("g.title")}<input id="gTitle" value="${esc(tour?.t || "")}" placeholder="${esc(t("tourDefault"))}"></label>
      <label>${t("g.date")}<input id="gDate" type="date" value="${esc(tour?.d || today())}"></label></div>`;
  }
  if (!s.length) html += `<p class="t-empty">${guide ? t("g.empty") : ""}</p>`;
  html += `<ol class="stops">${s.map((p, i) => guide ? `
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
      <button id="gShare" class="primary" ${s.length ? "" : "disabled"}>${ICON.share}${t("g.share")}</button>
      <button id="gNew" class="text-btn">${t("g.newTour")}</button>
      <button id="gExit" class="text-btn">${t("g.exit")}</button>`;
  } else if (s.length) {
    html += `<button id="tFit">${t("showAll")}</button><button id="tRemove" class="text-btn">${t("removeTour")}</button>`;
  }
  html += `</div>`;
  body.innerHTML = html;
  wire();
}

function wire() {
  const body = $("tourBody");
  body.querySelectorAll(".stop").forEach((li) => {
    const i = +li.dataset.i;
    li.querySelectorAll("[data-op]").forEach((b) => (b.onclick = () => {
      const s = tour.s;
      if (b.dataset.op === "show") { highlight = i; updateMap(); render(); map.flyTo({ center: [s[i].x, s[i].y], zoom: Math.max(map.getZoom(), 15) }); if (innerWidth <= 720) close(); }
      if (b.dataset.op === "up" && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; save(); }
      if (b.dataset.op === "down" && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; save(); }
      if (b.dataset.op === "del") { s.splice(i, 1); save(); }
    }));
    // alan değişikliklerinde listeyi yeniden çizme (odak kaybolmasın), yalnızca kaydet
    li.querySelectorAll("input[data-f]").forEach((inp) => (inp.onchange = () => {
      tour.s[i][inp.dataset.f] = inp.value.trim();
      if (!tour.s[i][inp.dataset.f]) delete tour.s[i][inp.dataset.f];
      saveQuiet();
    }));
  });
  const title = $("gTitle"), date = $("gDate");
  if (title) title.onchange = () => { ensure(); tour.t = title.value.trim() || undefined; saveQuiet(); };
  if (date) date.onchange = () => { ensure(); tour.d = date.value || undefined; saveQuiet(); };
  if ($("gAdd")) $("gAdd").onclick = () => { addMode = !addMode; render(); if (addMode) { ctx.toast(t("g.addHint")); if (innerWidth <= 720) close(); } };
  if ($("gShare")) $("gShare").onclick = share;
  if ($("gNew")) $("gNew").onclick = () => { if (confirm(t("g.newConfirm"))) { tour = { v: 1, d: today(), s: [] }; highlight = -1; save(); } };
  if ($("gExit")) $("gExit").onclick = () => setGuide(false);
  if ($("tFit")) $("tFit").onclick = () => { fitTour(); if (innerWidth <= 720) close(); };
  if ($("tRemove")) $("tRemove").onclick = () => { if (confirm(t("removeConfirm"))) { tour = null; highlight = -1; save(); close(); stripUrl(); } };
}

function ensure() { if (!tour) tour = { v: 1, d: today(), s: [] }; }
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
  const lines = [`🗺️ ${tour.t || t("tourDefault")}${tour.d ? " – " + fmtDate(tour.d) : ""}`, ""];
  tour.s.forEach((p, i) => lines.push(`${i + 1}) ${p.h ? p.h + " · " : ""}${p.n || "—"}${p.o ? " (" + p.o + ")" : ""}`));
  lines.push("", `${t("g.map")}: ${url}`);
  const text = lines.join("\n");
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); ctx.toast(t("copied")); }
  } catch { /* iptal */ }
  // kendi cihazında da bağlantı adres çubuğunda dursun
  history.replaceState(null, "", url);
}

// --- dış arayüz --------------------------------------------------------------
export function open() {
  ctx.closePanels();
  render();
  $("tourPanel").hidden = false;
  $("btnTour").classList.add("on");
}
export function close() { $("tourPanel").hidden = true; $("btnTour").classList.remove("on"); }
export const isAddMode = () => addMode;

export function addStop(name, lng, lat) {
  ensure();
  tour.s.push({ n: name || undefined, x: r5(lng), y: r5(lat) });
  highlight = tour.s.length - 1;
  save();
  ctx.toast(`${t("g.added")}: ${name || tour.s.length}`);
}

/** Harita tıklaması: ekleme modundaysa durak ekler ve true döner. */
export function handleMapClick(e) {
  // durak noktasına dokunuldu mu?
  const hit = map.queryRenderedFeatures(e.point, { layers: ["tour-pt"].filter((l) => map.getLayer(l)) })[0];
  if (hit && !addMode) { highlight = hit.properties.i; updateMap(); open(); $("tourBody").querySelector(".stop.hl")?.scrollIntoView({ block: "nearest" }); return true; }
  if (!addMode) return false;
  // dokunulan yerde adı olan bir nesne varsa adını öner
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
  if (fromUrl) { tour = fromUrl; store.set(KEY, JSON.stringify(tour)); }
  else { try { tour = JSON.parse(store.get(KEY) || "null"); } catch { tour = null; } }

  $("btnTour").onclick = () => ($("tourPanel").hidden ? open() : close());
  document.addEventListener("tour:add", (e) => addStop(e.detail.name, e.detail.lng, e.detail.lat));
  document.addEventListener("langchange", render);
  setInterval(() => { if (!$("tourPanel").hidden && !guide) render(); }, 60000); // "Sıradaki" güncel kalsın
  updateMap();
  return { openOnLoad: !!fromUrl && fromUrl.s.length > 0 };
}
