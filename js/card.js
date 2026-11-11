// Bilgi kartı: yalnızca kaynağı belli verileri gösterir.
//  - Ad, açıklama, görsel, web sitesi, telefon: OpenStreetMap + Wikidata
//  - Özet metin: Vikipedi — Türkçe arayüzde yalnızca Türkçe metin gösterilir (başka dilde makale varsa
//    yalnızca bağlantısı verilir); diğer dillerde seçili dil, yoksa İngilizce/Türkçe
//  - Rehber onaylı metin: data/<il>/curated.json (rehberin kendi doğruladığı içerik)
import { t, lang } from "./i18n.js";
import { DEPLOY } from "../config/deploy.js";
import { trName, isTurkishText } from "./names.js";

const el = () => document.getElementById("card");
let wikidata = null, curated = null, summaries = null, districts = null, currentArgs = null;

export function findFeature(fc, id) {
  if (!fc || !id) return null;
  return fc.features.find((f) => f.properties.id === id && !f.properties._pt) || fc.features.find((f) => f.properties.id === id);
}

export function closeCard() { el().hidden = true; el().innerHTML = ""; currentArgs = null; }
/** Açık kartın bilgileri (diorama bu yerin alanını kullanır); kart kapalıysa null */
export const currentCard = () => currentArgs;
document.addEventListener("langchange", () => currentArgs && openCard(currentArgs));
document.addEventListener("keydown", (e) => e.key === "Escape" && closeCard());

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = {
  dir: '<svg viewBox="0 0 24 24"><path d="M12 2 3 21l9-4 9 4L12 2Z"/></svg>',
  call: '<svg viewBox="0 0 24 24"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  wiki: '<svg viewBox="0 0 24 24"><path d="M2 6h5M10 6h4M17 6h5M4 6l4.5 13L12 9l3.5 10L20 6"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4ZM20 4h-6a3 3 0 0 0-3 3"/><path d="M20 4v14h-7"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
};

function osmUrl(id) {
  const type = { n: "node", w: "way", r: "relation" }[id?.[0]];
  return type ? `https://www.openstreetmap.org/${type}/${id.slice(1)}` : null;
}
function commonsFile(p, w) {
  let f = w?.image || p.wikimedia_commons || (p.image?.includes("commons.wikimedia.org") ? decodeURIComponent(p.image.split("/").pop()) : null);
  if (!f) return null;
  f = f.replace(/^File:/i, "").replace(/^Dosya:/i, "");
  if (/^Category:/i.test(f)) return null;
  return f;
}
function fmtYear(y) {
  if (!y) return null;
  const v = y.y < 0 ? `${t("bce")} ${-y.y}` : String(y.y);
  return y.approx ? `${t("approx")} ${v}` : v;
}
// textOnly: özet metni gösterilecek makale (Türkçede yalnızca Türkçe); değilse bağlantı için herhangi biri
const textLangs = (L) => (L === "tr" ? ["tr"] : [L, "en", "tr"]);
function wikiTitle(p, w, textOnly = false) {
  const L = lang();
  const langs = textOnly ? textLangs(L) : [L, "tr", "en"];
  for (const l of langs) if (w?.wp?.[l]) return { l, title: w.wp[l] };
  if (p.wikipedia) { const [l, ...r] = p.wikipedia.split(":"); if (r.length && (!textOnly || langs.includes(l))) return { l, title: r.join(":") }; }
  return null;
}

async function loadSide(dataUrl) {
  if (!wikidata) wikidata = fetch(dataUrl + "wikidata.json").then((r) => r.json()).catch(() => ({}));
  if (!curated) curated = fetch(dataUrl + "curated.json").then((r) => r.json()).then((c) => {
    // bir metin birden çok harita kaydına bağlanabilir: "ids": ["n…", "w…"]
    for (const v of Object.values(c)) for (const id of v.ids || []) c[id] = c[id] || v;
    return c;
  }).catch(() => ({}));
  if (!summaries) summaries = fetch(dataUrl + "summaries.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (!districts) districts = fetch(dataUrl + "search.json").then((r) => r.json()).then((a) => new Map(a.filter((e) => e[6]).map((e) => [e[0], e[6]]))).catch(() => new Map());
  return [await wikidata, await curated, await summaries, await districts];
}

export async function openCard(args) {
  currentArgs = args;
  const { feature, cat, group, lngLat, prov, dataUrl } = args;
  const p = feature.properties;
  const [WD, CUR, SUM, DIST] = await loadSide(dataUrl);
  if (currentArgs !== args) return;
  const w = WD[p.wikidata] || null;
  const L = lang();
  // Türkçede yerel OSM adı (ör. "Göreme Açık Hava Müzesi"), diğer dillerde Wikidata çevirisi öncelikli
  // (OSM adı İngilizce ya da başka yazıyla girilmişse Türkçede Wikidata Türkçe etiketi kullanılır)
  const title = (L === "tr" ? trName(p, w) : w?.label?.[L] || p["name:" + L])
    || p.name || w?.label?.tr || w?.label?.en || (cat.names[L] || cat.names.tr);
  // kısa açıklama yalnızca seçili dilde (Türkçede İngilizce açıklama gösterilmez)
  const desc = w?.desc?.[L] || (L !== "tr" ? w?.desc?.en : "") || "";
  // rehber içeriği: "onayli" herkese, "taslak" yalnızca rehber modunda görünür
  const guide = document.documentElement.dataset.guide === "1";
  let cur = CUR[p.id] || CUR[p.wikidata];
  // kaynaklı açıklamalar herkese açıktır (ek onay gerekmez)
  const file = commonsFile(p, w);
  const wt = wikiTitle(p, w);
  const pt = lngLat || null;

  // eylem düğmeleri
  const acts = [];
  if (pt) acts.push(`<a class="primary" href="https://www.google.com/maps/dir/?api=1&destination=${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}" target="_blank" rel="noopener">${ICON.dir}${t("directions")}</a>`);
  const phone = p.phone || w?.phone;
  if (phone) acts.push(`<a href="tel:${esc(phone.split(";")[0].replace(/[^\d+]/g, ""))}">${ICON.call}${t("call")}</a>`);
  const web = p.website || w?.website;
  if (web) acts.push(`<a href="${esc(web)}" target="_blank" rel="noopener">${ICON.web}${t("website")}</a>`);
  if (wt) acts.push(`<a href="https://${wt.l}.wikipedia.org/wiki/${encodeURIComponent(wt.title.replace(/ /g, "_"))}" target="_blank" rel="noopener">${ICON.wiki}${t("wikipedia")}</a>`);
  if (w?.tdv) acts.push(`<a href="https://islamansiklopedisi.org.tr/${encodeURIComponent(w.tdv)}" target="_blank" rel="noopener">${ICON.book}TDV</a>`);
  if (w?.commonsCat) acts.push(`<a href="https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(w.commonsCat.replace(/ /g, "_"))}" target="_blank" rel="noopener">${ICON.photo}${t("photos")}</a>`);
  if (p.id && cat.id !== "_base") acts.push(`<button type="button" data-share>${ICON.share}${t("share")}</button>`);
  if (guide && pt) acts.push(`<button type="button" class="tour-add" data-touradd>${ICON.flag}${t("g.addToTour")}</button>`);
  const district = DIST.get(p.id) || "";
  const q = [p["name:tr"] || p.name || title, district, prov.names.tr].filter(Boolean).join(" ");
  acts.push(`<a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">${ICON.search}${t("gen.webSearch")}</a>`);
  const osm = osmUrl(p.id) || (p.osmSearch ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(p.osmSearch)}#map=18/${pt?.lat}/${pt?.lng}` : null);
  if (osm) acts.push(`<a href="${osm}" target="_blank" rel="noopener">${ICON.map}${t("osm")}</a>`);

  // bilgiler
  const facts = [];
  const ele = p.ele || w?.ele;
  if (ele && !isNaN(parseFloat(ele))) facts.push([t("elevation"), `${Math.round(parseFloat(ele))} m`]);
  const built = fmtYear(w?.inception) || (p.start_date && /^-?\d{3,4}/.test(p.start_date) ? p.start_date : null);
  if (built) facts.push([t("built"), built]);
  if (p.population) facts.push([t("population"), Number(p.population).toLocaleString(L)]);
  if (p.opening_hours) facts.push([t("openingHours"), p.opening_hours]);

  const c = el();
  c.innerHTML = `
    <button class="x card-close" aria-label="${t("close")}">×</button>
    <div class="grab"></div>
    <div class="card-scroll">
      ${file ? `<div class="card-photo"><img alt="" loading="lazy" src="https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=800">
        <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikimedia Commons</a></div>` : ""}
      <div class="card-body">
        <span class="chip"><span class="pin" style="background:${group.color}"><i style="--icon:url(${new URL(`icons/maki/${cat.icon}.svg`, location.href)})"></i></span>${esc(cat.names[L] || cat.names.tr)}</span>
        <h1>${esc(title)}</h1>
        ${desc ? `<p class="desc">${esc(desc)}</p>` : ""}
        <div class="actions">${acts.join("")}</div>
        <div id="cardSummary">${cur ? curatedHtml(cur, L) : `<p class="summary muted">${t("loading")}</p>`}</div>
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
        <p class="footnote">${cur ? "" : t("autoNote") + " "}${cur ? t("osm") : t("source")}: <a href="${osm || "#"}" target="_blank" rel="noopener">OpenStreetMap</a>${p.wikidata ? `, <a href="https://www.wikidata.org/wiki/${p.wikidata}" target="_blank" rel="noopener">Wikidata</a>` : ""}.</p>
      </div>
    </div>`;
  c.hidden = false;
  c.querySelector(".card-close").onclick = closeCard;
  c.querySelector(".card-photo img")?.addEventListener("error", (e) => e.target.closest(".card-photo").remove());
  const sh = c.querySelector("[data-share]");
  if (sh) sh.onclick = () => share(title, prov, cat, p);
  const ta = c.querySelector("[data-touradd]");
  if (ta) ta.onclick = () => document.dispatchEvent(new CustomEvent("tour:add", { detail: { name: p["name:tr"] || p.name || title, lng: pt.lng, lat: pt.lat } }));
  c.querySelector(".card-scroll").scrollTop = 0;

  if (!cur) {
    const box = c.querySelector("#cardSummary");
    const sum = SUM[p.id];
    const sumWp = sum?.wp && textLangs(L).includes(sum.wp.split(":")[0]) ? sum.wp : null;
    const okWeb = (wb) => wb && (L !== "tr" || isTurkishText(wb.x));
    const html = (await summaryHtml(wikiTitle(p, w, true), L))
      || (sumWp ? await summaryHtml({ l: sumWp.split(":")[0], title: sumWp.slice(sumWp.indexOf(":") + 1) }, L) : null)
      || (okWeb(sum?.web) ? webHtml(sum.web) : null)
      || (await liveHtml(p, w, pt))
      || profileHtml(p, cat, title, district, prov, L);
    if (currentArgs === args) box.innerHTML = html;
  }
}

// --- yerin kendi web sitesinin açıklaması --------------------------------------------------
function webHtml(wb) {
  let host = wb.u;
  try { host = new URL(wb.u).hostname.replace(/^www\./, ""); } catch { /* */ }
  return `<p class="summary">${esc(wb.x)}</p><p class="src">${t("gen.ownSite")}: <a href="${esc(wb.u)}" target="_blank" rel="noopener">${esc(host)}</a></p>`;
}

// --- canlı arama (hazır özet yoksa): yakındaki aynı adlı Vikipedi makalesi, OSM etiketleri, web sitesi ----
const nrm = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i")
  .replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
async function liveHtml(p, w, pt) {
  if (!pt) return null;
  const name = p["name:tr"] || p.name;
  try {
    for (const l of textLangs(lang())) {
      const r = await fetch(`https://${l}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${pt.lat}|${pt.lng}&gsradius=400&gslimit=30&format=json&origin=*`, { signal: AbortSignal.timeout(6000) });
      const hit = (await r.json())?.query?.geosearch?.find((a) => nrm(a.title) === nrm(name) || (p["name:en"] && nrm(a.title) === nrm(p["name:en"])));
      if (hit) { const h = await summaryHtml({ l, title: hit.title }, lang()); if (h) return h; }
    }
    // haritada tıklanan (veri dosyasında olmayan) yerler: OSM etiketlerini getir (web sitesi, işletmeci…)
    if (p._base && !p.website) {
      const nm = String(p.osmSearch || name).replace(/\\/g, "").replace(/"/g, '\\"');
      const q = `[out:json][timeout:8];nwr(around:80,${pt.lat},${pt.lng})["name"="${nm}"];out tags 1;`;
      const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(9000) });
      const tags = (await r.json())?.elements?.[0]?.tags;
      if (tags) {
        for (const [k, v] of Object.entries(tags)) if (p[k] == null) p[k] = v;
        p.website = p.website || tags["contact:website"] || tags.url;
        if (p.wikipedia) { const [l, ...rest] = p.wikipedia.split(":"); if (textLangs(lang()).includes(l)) { const h = await summaryHtml({ l, title: rest.join(":") }, lang()); if (h) return h; } }
      }
    }
    // yerin kendi web sitesi (tam sürüm: Cloudflare üzerindeki küçük okuyucu, yalnızca meta açıklamayı döndürür)
    const web = (p.website || w?.website || "").split(";")[0].trim();
    if (web && DEPLOY.target === "full") {
      const r = await fetch("api/describe?url=" + encodeURIComponent(web), { signal: AbortSignal.timeout(9000) });
      const j = r.ok ? await r.json() : null;
      if (j?.x && (lang() !== "tr" || isTurkishText(j.x))) return webHtml(j);
    }
  } catch { /* çevrimdışı / zaman aşımı → derlenmiş bilgi */ }
  return null;
}

// --- derlenmiş bilgi metni (son çare): OSM ve Wikidata özelliklerinden -----------------------
const TYPE_KEYS = ["tourism", "historic", "amenity", "leisure", "natural", "man_made", "place", "shop", "office", "railway", "aeroway", "power", "landuse", "craft", "waterway", "_type"];
function typeLabel(p, cat, L) {
  if (L === "tr" || L === "en") for (const k of TYPE_KEYS) {
    const v = p[k];
    if (!v || v === "yes") continue;
    const key = k === "amenity" && v === "place_of_worship" && p.religion ? p.religion : v;
    const tx = t("types." + key);
    if (tx !== "types." + key) return tx;
  }
  return cat.names[L] || cat.names.tr;
}
function profileHtml(p, cat, title, district, prov, L) {
  const pv = (prov.names[L] || prov.names.tr).split(" · ")[0];
  const type = typeLabel(p, cat, L);
  const place = district && district !== pv && district !== prov.names.tr.split(" · ")[0] ? t("gen.placeD").replace("{d}", district).replace("{p}", pv)
    : district ? t("gen.placeC").replace("{p}", pv) : t("gen.placeP").replace("{p}", pv);
  let intro = t("gen.intro").replace("{name}", title).replace("{place}", place)
    .replace("{type}", L === "tr" ? type.toLocaleLowerCase("tr") : L === "en" ? type.toLowerCase() : type);
  if (L === "en") intro = intro.replace(/ a ([aeiou])/i, " an $1");
  const facts = [];
  const add = (k, v) => v && facts.push([t("gen." + k), v]);
  add("address", [p["addr:street"] && [p["addr:street"], p["addr:housenumber"]].filter(Boolean).join(" "), p["addr:district"], p["addr:city"]].filter(Boolean).join(", "));
  add("district", district);
  add("operator", p.operator || p.brand);
  if (p.ext || p.method) add("method", t("gen.m." + (p.method === "cozelti" ? "cozelti" : p.ext || "yeralti")));
  add("resource", p.res);
  if (p.depth_m) add("depth", `~${p.depth_m} m`);
  if (p["plant:source"]) add("power", p["plant:source"].split(";").map((x) => { const k = "gen.src." + x.trim(); const v = t(k); return v === k ? x : v; }).join(", "));
  add("output", p["plant:output:electricity"]);
  add("cuisine", p.cuisine && p.cuisine.replace(/_/g, " ").replace(/;/g, ", "));
  add("stars", p.stars && "★".repeat(Math.min(7, parseInt(p.stars, 10) || 0)));
  add("denomination", p.denomination);
  add("artist", p.artist_name);
  add("architect", p.architect);
  add("levels", p["building:levels"]);
  add("capacity", p.capacity);
  add("inscription", p.inscription);
  if (p.heritage) add("heritage", t("gen.heritageYes"));
  if (p.fee) add("fee", p.fee === "no" ? t("gen.free") : p.fee === "yes" ? t("gen.paid") : p.fee);
  const note = p["description:" + L] || p.description || "";
  return `<p class="summary">${esc(intro)}</p>${note ? `<p class="summary"><i>“${esc(note)}”</i></p>` : ""}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    <p class="src muted">${t("gen.compiled")}</p>`;
}

function curatedHtml(cur, L) {
  // metin paragraflara bölünebilir (boş satır); dilde yoksa Türkçe, o da yoksa İngilizce
  const text = cur.text?.[L] || cur.text?.tr || cur.text?.en || "";
  const paras = text.split(/\n\s*\n/).map((x) => `<p class="summary">${esc(x.trim())}</p>`).join("");
  const srcs = (cur.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("");
  const badge = `<span class="curated">✓ ${t("curatedNote")}</span>`;
  return `${badge}${paras}${srcs ? `<div class="src">${t("source")}:<ul class="src-list">${srcs}</ul></div>` : ""}`;
}

async function summaryHtml(wt, L) {
  if (!wt) return null;
  try {
    // seçili dilde makale yoksa langlinks üzerinden bul
    let { l, title } = wt;
    const r = await fetch(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (!r.ok) throw new Error(r.status);
    const s = await r.json();
    if (!s.extract || s.type === "disambiguation") throw new Error("boş");
    const url = s.content_urls?.desktop?.page || `https://${l}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    const note = l !== L ? ` (${l.toUpperCase()})` : "";
    return `<p class="summary">${esc(s.extract)}</p><p class="src">${t("source")}: <a href="${url}" target="_blank" rel="noopener">Wikipedia${note}</a> · CC BY-SA 4.0</p>`;
  } catch {
    return null;
  }
}

async function share(title, prov, cat, p) {
  const u = new URL(location.href);
  u.hash = "";
  u.search = `?il=${prov.id}&poi=${cat.id}:${p.id}`;
  const data = { title, text: `${title} – ${prov.names[lang()] || prov.names.tr}`, url: u.toString() };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); window.__toast?.(t("copied")); }
  } catch { /* kullanıcı iptal etti */ }
}
