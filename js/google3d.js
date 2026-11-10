// Google Photorealistic 3D Tiles (Map Tiles API) — gerçekçi 3B şehir ve arazi modeli.
// - API anahtarı gerekir (Google Cloud: Map Tiles API etkin, faturalandırma hesabı bağlı). Anahtar
//   config/deploy.js içinde (tam sürüm) ya da rehberin cihazında girilerek (localStorage) verilir.
// - Google koşulları gereği bu katman açıkken başka bir temel harita gösterilmez; yalnızca kendi
//   verilerimiz (lejant noktaları, tur) üstte kalır. Karolar önbelleğe alınmaz. Telif bilgileri gösterilir.
// - deck.gl (≈2 MB) yalnızca katman ilk açıldığında yüklenir.
import { t } from "./i18n.js";
import { DEPLOY } from "../config/deploy.js";

const ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";
const KEY = "rh.gkey";
let map, ctx, overlay = null, active = false, saved = null, credits = "";

export const apiKey = () => DEPLOY.googleMapsKey || (() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } })();
export const isActive = () => active;

function loadDeck() {
  if (window.deck) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "vendor/deck/deck.min.js";
    s.onload = res; s.onerror = () => rej(new Error("deck.gl yüklenemedi"));
    document.head.appendChild(s);
  });
}

function setCredits(text) {
  credits = text;
  const el = document.getElementById("g3dCredits");
  if (el) { el.hidden = !active; el.innerHTML = `<b>Google</b>${text ? " · " + text.replace(/</g, "&lt;") : ""}`; }
}

// temel haritayı (OpenFreeMap / OSM, uydu, kabartma vb.) gizle; kendi katmanlarımız kalır
function hideBase(on) {
  const own = (id) => /^(cat-|tour-|ohm-)/.test(id);
  if (on) {
    saved = {};
    for (const l of map.getStyle().layers) {
      if (own(l.id) || l.type === "background") continue;
      saved[l.id] = map.getLayoutProperty(l.id, "visibility") || "visible";
      map.setLayoutProperty(l.id, "visibility", "none");
    }
    saved.__bg = map.getPaintProperty("background", "background-color");
    if (map.getLayer("background")) map.setPaintProperty("background", "background-color", "#d9dde2");
  } else if (saved) {
    for (const [id, v] of Object.entries(saved)) if (id !== "__bg" && map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    if (saved.__bg && map.getLayer("background")) map.setPaintProperty("background", "background-color", saved.__bg);
    saved = null;
  }
}

export async function enable() {
  const key = apiKey();
  if (!key) { askKey(); return false; }
  ctx.busy(true);
  try {
    // anahtarı önce doğrula (geçersiz anahtarda açık mesaj; deck.gl bu hatayı katmana iletmiyor)
    const chk = await fetch(ROOT, { headers: { "X-GOOG-API-KEY": key } }).catch(() => null);
    if (!chk || !chk.ok) {
      if (chk && [400, 401, 403].includes(chk.status)) { try { localStorage.removeItem(KEY); } catch { /* özel pencere */ } }
      ctx.toast(chk ? t("g3d.bad") : t("g3d.offline"));
      return false;
    }
    await loadDeck();
    const { MapboxOverlay, Tile3DLayer } = window.deck;
    map.setTerrain(null);                         // Google modeli kendi arazisini içerir
    const firstOwn = map.getStyle().layers.find((l) => /^(cat-|tour-)/.test(l.id))?.id;
    const layer = new Tile3DLayer({
      id: "google-3d",
      data: ROOT,
      loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": key } } },
      operation: "terrain+draw",
      ...(firstOwn ? { beforeId: firstOwn } : {}),
      onTilesetLoad: (ts) => {
        ts.options.onTraversalComplete = (sel) => {
          const set = new Set();
          sel.forEach((tile) => (tile.content?.gltf?.asset?.copyright || "").split(";").forEach((c) => c.trim() && set.add(c.trim())));
          setCredits([...set].join("; "));
          return sel;
        };
      },
      onTileError: (e) => console.warn("Google 3B karo hatası", e),
      // anahtar geçersiz / yetkisiz (400, 403): katmanı kapat, kayıtlı anahtarı unut, açık mesaj göster
      onError: (e) => {
        console.warn("Google 3B:", e?.message || e);
        if (/\b(400|401|403)\b/.test(String(e?.message || e))) {
          try { localStorage.removeItem(KEY); } catch { /* özel pencere */ }
          ctx.toast(t("g3d.bad"));
          setTimeout(() => { disable(); ctx.onCancel(); }, 0);
        }
        return true;
      },
    });
    overlay = new MapboxOverlay({ interleaved: true, layers: [layer] });
    map.addControl(overlay);
    hideBase(true);
    active = true;
    setCredits(credits);
    if (map.getPitch() < 45) map.easeTo({ pitch: 60, zoom: Math.max(map.getZoom(), 15.5), duration: 1200 });
    return true;
  } catch (e) {
    console.error(e);
    ctx.toast(String(e.message || e));
    return false;
  } finally { ctx.busy(false); }
}

export function disable() {
  if (!active) return;
  if (overlay) { map.removeControl(overlay); overlay = null; }
  hideBase(false);
  active = false;
  setCredits("");
}

// anahtar penceresi (rehberin kendi cihazı için; tam sürümde anahtar yapılandırmada gömülüdür)
function askKey() {
  const dlg = document.getElementById("g3dDialog");
  dlg.hidden = false;
  const inp = document.getElementById("g3dKey");
  inp.value = "";
  inp.focus();
}
export function initGoogle3d(_map, _ctx) {
  map = _map; ctx = _ctx;
  document.getElementById("g3dSave").onclick = async () => {
    const v = document.getElementById("g3dKey").value.trim();
    if (!v) return;
    try { localStorage.setItem(KEY, v); } catch { /* özel pencere */ }
    document.getElementById("g3dDialog").hidden = true;
    if (await enable()) ctx.onEnabled(); else ctx.onCancel();
  };
  document.getElementById("g3dCancel").onclick = () => { document.getElementById("g3dDialog").hidden = true; ctx.onCancel(); };
}
