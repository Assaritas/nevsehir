// Bir ilin harita verilerini OpenStreetMap (Overpass API) ve Wikidata'dan indirir.
// Kullanım:  node fetch-data.mjs [il-id]      (varsayılan: nevsehir)
// Çıktı:     data/<il-id>/*.geojson, wikidata.json, index.json
//
// Tüm kaynaklar ücretsiz ve yeniden kullanılabilir lisanslıdır:
//   OpenStreetMap © katkıda bulunanlar (ODbL), Wikidata (CC0).

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import osmtogeojson from "osmtogeojson";
import pointOnFeature from "@turf/point-on-feature";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { CATEGORIES, LANGS, TOURIST_CATS } from "../config/categories.js";
import { PROVINCES, DEFAULT_PROVINCE } from "../config/provinces.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "rehber-harita/0.1 (open-source tour guide map; data build script)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

const provId = process.argv.slice(2).find((a) => !a.startsWith("--")) || DEFAULT_PROVINCE;
const prov = PROVINCES[provId];
if (!prov) { console.error("Bilinmeyen il:", provId); process.exit(1); }
const OUT = path.join(ROOT, "data", provId);
fs.mkdirSync(OUT, { recursive: true });
// --fresh verilirse önbellek temizlenir (güncel veri için)
const CACHE = path.join(ROOT, "scripts", ".cache", provId);
if (process.argv.includes("--fresh")) fs.rmSync(CACHE, { recursive: true, force: true });
fs.mkdirSync(CACHE, { recursive: true });
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(240000),
      });
      if (res.ok) {
        const json = await res.json();
        // hata notu olan ya da güncel olmayan (7 günden eski) yanıtları reddet
        const age = Date.now() - Date.parse(json.osm3s?.timestamp_osm_base || 0);
        if (json.remark && /error|timed out|runtime/i.test(json.remark)) console.warn("  Overpass hata notu:", json.remark.slice(0, 120));
        else if (!(age < 7 * 864e5)) console.warn(`  ${url} verisi güncel değil (${json.osm3s?.timestamp_osm_base}), başka sunucu denenecek…`);
        else return json;
      } else console.warn(`  Overpass ${res.status}, tekrar denenecek…`);
    } catch (e) {
      console.warn("  Overpass hata:", e.message);
    }
    await sleep(5000 * (attempt + 1));
  }
  throw new Error("Overpass sorgusu başarısız");
}

// --- yardımcılar -----------------------------------------------------------
const round = (c) => (typeof c[0] === "number" ? [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : c.map(round));

function dedupeCoords(coords) {
  // ardışık aynı noktaları sil (yuvarlama sonrası)
  if (typeof coords[0][0] !== "number") return coords.map(dedupeCoords);
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const p = coords[i], q = out[out.length - 1];
    if (p[0] !== q[0] || p[1] !== q[1]) out.push(p);
  }
  return out;
}

const KEEP_TAGS = [
  "name", ...LANGS.map((l) => "name:" + l), "wikidata", "wikipedia", "ele", "phone", "contact:phone",
  "website", "contact:website", "url", "opening_hours", "start_date", "heritage", "image", "wikimedia_commons",
  "highway", "ref", "place", "population", "admin_level", "religion", "historic", "tourism", "amenity",
  "natural", "waterway", "leisure", "boundary", "landuse", "man_made", "railway", "aeroway", "power",
  "plant:source", "resource", "depth", "operator", "description", "description:tr", "description:en",
];

function cleanProps(f, catId) {
  const src = f.properties || {};
  const p = { id: src.id ? src.id.replace("node/", "n").replace("way/", "w").replace("relation/", "r") : undefined, cat: catId };
  for (const k of KEEP_TAGS) if (src[k] != null && src[k] !== "") p[k] = String(src[k]);
  if (!p.phone && p["contact:phone"]) p.phone = p["contact:phone"];
  if (!p.website && (p["contact:website"] || p.url)) p.website = p["contact:website"] || p.url;
  delete p["contact:phone"]; delete p["contact:website"]; delete p.url;
  return p;
}

function anyVertexInside(geom, poly) {
  const flat = [];
  const walk = (c) => (typeof c[0] === "number" ? flat.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  const step = Math.max(1, Math.floor(flat.length / 40));
  for (let i = 0; i < flat.length; i += step) if (booleanPointInPolygon(flat[i], poly)) return true;
  return booleanPointInPolygon(flat[flat.length - 1], poly);
}

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- 1) il sınırı ----------------------------------------------------------
console.log(`İl: ${provId} (OSM relation ${prov.osmRelation})`);
const bq = `[out:json][timeout:180];rel(${prov.osmRelation});out geom;`;
const bcache = path.join(CACHE, "boundary-" + hash(bq) + ".json");
const bjson = fs.existsSync(bcache) ? JSON.parse(fs.readFileSync(bcache, "utf8")) : await overpass(bq);
fs.writeFileSync(bcache, JSON.stringify(bjson));
const bgeo = osmtogeojson(bjson, { flatProperties: true });
const boundary = bgeo.features.find((f) => /Polygon/.test(f.geometry.type));
if (!boundary) throw new Error("İl sınırı poligonu oluşturulamadı");
boundary.geometry.coordinates = dedupeCoords(round(boundary.geometry.coordinates));
boundary.properties = { name: boundary.properties.name, id: "r" + prov.osmRelation };
fs.writeFileSync(path.join(OUT, "boundary.geojson"), JSON.stringify({ type: "FeatureCollection", features: [boundary] }));
console.log("  il sınırı kaydedildi");

// --- 2) kategoriler --------------------------------------------------------
const areaId = 3600000000 + prov.osmRelation;
const results = {};
for (const cat of CATEGORIES) {
  const q = `[out:json][timeout:300];area(id:${areaId})->.a;(${cat.osm.map((s) => s + "(area.a);").join("")});out geom;`;
  process.stdout.write(`- ${cat.id} … `);
  // ham yanıtı önbelleğe al: kesinti sonrası yeniden çalıştırmada biten kategoriler tekrar indirilmez
  const cacheFile = path.join(CACHE, cat.id + "-" + hash(q) + ".json");
  let json;
  if (fs.existsSync(cacheFile)) json = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  else { json = await overpass(q); fs.writeFileSync(cacheFile, JSON.stringify(json)); await sleep(1500); }
  const gj = osmtogeojson(json, { flatProperties: true });
  const seen = new Set();
  const feats = [];
  for (const f of gj.features) {
    if (!f.geometry || !f.properties?.id || seen.has(f.properties.id)) continue;
    // ilişki üyesi olarak gelen isimsiz parçaları atla (ör. nehir ilişkisinin tek tek yolları zaten ilişkiyle geliyor)
    seen.add(f.properties.id);
    const isPoint = f.geometry.type === "Point";
    const isLine = /LineString/.test(f.geometry.type);
    const rep = isPoint ? f.geometry.coordinates : pointOnFeature(f).geometry.coordinates;
    const inside = isLine ? anyVertexInside(f.geometry, boundary) : booleanPointInPolygon(rep, boundary);
    if (!inside) continue;
    const props = cleanProps(f, cat.id);
    f.geometry.coordinates = isPoint ? round(f.geometry.coordinates) : dedupeCoords(round(f.geometry.coordinates));
    feats.push({ type: "Feature", properties: props, geometry: f.geometry, _rep: round(rep) });
  }
  results[cat.id] = feats;
  console.log(feats.length);
}

// --- 3) sağlık: yalnızca turistik alanlara yakın olanlar -------------------
const touristPts = TOURIST_CATS.flatMap((c) => (results[c] || []).map((f) => f._rep));
for (const cat of CATEGORIES.filter((c) => c.near)) {
  const before = results[cat.id].length;
  results[cat.id] = results[cat.id].filter((f) => touristPts.some((t) => haversine(t, f._rep) <= cat.near));
  console.log(`  ${cat.id}: ${before} → ${results[cat.id].length} (turistik alanlara ≤ ${cat.near} m)`);
}

// --- 3b) yinelenenleri ayıkla ------------------------------------------------
// Aynı yer OSM'de bazen hem nokta hem alan olarak işaretlenir. Aynı Wikidata kimliği ya da
// aynı ad + 500 m'den yakınsa tek kayıt tutulur (alan geometrisi ve daha çok bilgi içeren tercih edilir).
const score = (f) => (/Polygon/.test(f.geometry.type) ? 100 : 0) + Object.keys(f.properties).length;
const norm = (s) => (s || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
for (const cat of CATEGORIES) {
  if (cat.kind === "border" || ["yollar", "akarsu_gol", "rayli"].includes(cat.id)) continue;
  const list = [...results[cat.id]].sort((a, b) => score(b) - score(a));
  const kept = [];
  for (const f of list) {
    const p = f.properties;
    const dup = kept.find((k) => (p.wikidata && k.properties.wikidata === p.wikidata) ||
      (p.name && norm(k.properties.name) === norm(p.name) && haversine(k._rep, f._rep) < 500));
    if (dup) { for (const [k, v] of Object.entries(p)) if (dup.properties[k] == null) dup.properties[k] = v; }
    else kept.push(f);
  }
  if (kept.length !== results[cat.id].length) console.log(`  ${cat.id}: ${results[cat.id].length} → ${kept.length} (yinelenenler ayıklandı)`);
  results[cat.id] = kept;
}

// --- 3c) elle düzeltmeler (data/<il>/overrides.json) ------------------------
const ovFile = path.join(OUT, "overrides.json");
const overrides = fs.existsSync(ovFile) ? JSON.parse(fs.readFileSync(ovFile, "utf8")) : {};
for (const feats of Object.values(results)) for (const f of feats) {
  const o = overrides[f.properties.id];
  if (!o) continue;
  for (const [k, v] of Object.entries(o)) { if (k.startsWith("_") || k === "addTo") continue; if (v === null) delete f.properties[k]; else f.properties[k] = v; }
}
// "addTo": yanlış kategoride işaretlenmiş yeri doğru kategorilere de ekle (ör. park olarak işaretli türbe)
for (const [id, o] of Object.entries(overrides)) for (const target of o.addTo || []) {
  const src = Object.values(results).flat().find((f) => f.properties.id === id);
  if (src && results[target] && !results[target].some((f) => f.properties.id === id))
    results[target].push({ ...src, properties: { ...src.properties, cat: target } });
}

// --- 4) Wikidata zenginleştirme -------------------------------------------
const qids = [...new Set(Object.values(results).flat().map((f) => f.properties.wikidata).filter((q) => /^Q\d+$/.test(q || "")))];
console.log(`Wikidata: ${qids.length} öğe`);
const wiki = {};
// Wikidata yanıtları önbelleğe alınır (--fresh ile yenilenir); hız sınırında bekleyip tekrar dener
async function wikidataGet(url) {
  const f = path.join(CACHE, "wd-" + hash(url) + ".json");
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      const txt = await res.text();
      if (res.ok && txt.startsWith("{")) { fs.writeFileSync(f, txt); await sleep(1000); return JSON.parse(txt); }
      console.warn(`  Wikidata ${res.status} (${txt.slice(0, 50)}…), bekleniyor…`);
    } catch (e) { console.warn("  Wikidata hata:", e.message); }
    await sleep(15000 * (attempt + 1));
  }
  throw new Error("Wikidata isteği başarısız");
}
// yerleşim türleri: bir anıt / müze / yeraltı şehri bu öğelere bağlanmışsa (ör. "Kaymaklı" kasabası) bağlantı yanlıştır
const SETTLEMENT_TYPES = new Set(["Q486972", "Q532", "Q3957", "Q515", "Q15284", "Q1529096", "Q2039348", "Q17318027", "Q1637706", "Q5084", "Q1115575", "Q123705", "Q188509", "Q2514025", "Q815324"]);
const SETTLEMENT_CATS = new Set(["yerlesimler", "ilceler", "koy_mahalle_sinir", "kamu"]);
const BAD_WD_TYPES = new Set(["Q13406463", "Q4167410", "Q4167836", "Q11266439", "Q22808320", "Q15184295"]);
const rejectedWd = [];
const claim = (e, p) => e.claims?.[p]?.find((c) => c.rank !== "deprecated")?.mainsnak?.datavalue?.value;
const year = (v) => {
  if (!v?.time) return undefined;
  const m = v.time.match(/^([+-])0*(\d+)-/);
  if (!m) return undefined;
  const y = parseInt(m[2], 10) * (m[1] === "-" ? -1 : 1);
  return v.precision < 9 ? { y, approx: true } : { y }; // 9 = yıl hassasiyeti
};
for (let i = 0; i < qids.length; i += 50) {
  const ids = qids.slice(i, i + 50).join("|");
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|descriptions|claims|sitelinks&languages=${LANGS.join("|")}&sitefilter=${LANGS.map((l) => l + "wiki").join("|")}|commonswiki&format=json`;
  const data = await wikidataGet(url);
  for (const [q, e] of Object.entries(data.entities || {})) {
    if (e.missing !== undefined) continue;
    // OSM'de yanlış eşleştirilmiş Vikimedya liste / anlam ayrımı / kategori / şablon öğelerini reddet
    const p31 = (e.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
    const txt = [e.labels?.tr?.value, e.labels?.en?.value, e.descriptions?.tr?.value, e.descriptions?.en?.value].join(" | ");
    if (p31.some((q) => BAD_WD_TYPES.has(q)) || /listesi|^list of|madde listesi|wikimedia list|anlam ayrımı|disambiguation/i.test(txt)) { rejectedWd.push(`${q} (${e.labels?.tr?.value || e.labels?.en?.value || ""})`); continue; }
    const w = { label: {}, desc: {}, wp: {} };
    for (const l of LANGS) {
      if (e.labels?.[l]) w.label[l] = e.labels[l].value;
      if (e.descriptions?.[l]) w.desc[l] = e.descriptions[l].value;
      if (e.sitelinks?.[l + "wiki"]) w.wp[l] = e.sitelinks[l + "wiki"].title;
    }
    if (p31.length && p31.every((q) => SETTLEMENT_TYPES.has(q))) w._settlement = true; // yalnızca yerleşim olan öğeler
    const img = claim(e, "P18"); if (img) w.image = img;
    const web = claim(e, "P856"); if (web) w.website = web;
    const tel = claim(e, "P1329"); if (tel) w.phone = tel;
    const tdv = claim(e, "P7314"); if (tdv) w.tdv = tdv;
    const cc = claim(e, "P373"); if (cc) w.commonsCat = cc;
    const inc = year(claim(e, "P571")); if (inc) w.inception = inc;
    const dis = year(claim(e, "P576")); if (dis) w.dissolved = dis;
    const ele = claim(e, "P2044"); if (ele?.amount) w.ele = Math.round(parseFloat(ele.amount));
    wiki[q] = w;
  }
  await sleep(500);
}
fs.writeFileSync(path.join(OUT, "wikidata.json"), JSON.stringify(wiki));
if (rejectedWd.length) console.log(`  Reddedilen Wikidata eşleşmeleri (liste/anlam ayrımı): ${rejectedWd.join(", ")}`);
// reddedilen kimlikleri özelliklerden de kaldır
// (reddedilen öğenin OSM'deki Vikipedi bağlantısı da çoğunlukla aynı hatayı taşır; o da kaldırılır)
const settleRejected = new Set();
for (const [catId, feats] of Object.entries(results)) for (const f of feats) {
  const q = f.properties.wikidata;
  if (!q) continue;
  const wrongSettlement = wiki[q]?._settlement && !SETTLEMENT_CATS.has(catId) && !overrides[f.properties.id]?.wikidata;
  if (!wiki[q] || wrongSettlement) {
    if (wrongSettlement) settleRejected.add(`${f.properties.name} → ${q} (${wiki[q].label?.tr || ""})`);
    delete f.properties.wikidata; delete f.properties.wikipedia;
  }
}
for (const w of Object.values(wiki)) delete w._settlement;
fs.writeFileSync(path.join(OUT, "wikidata.json"), JSON.stringify(wiki));
if (settleRejected.size) console.log(`  Yerleşim öğesine yanlış bağlanmış ${settleRejected.size} yer: ${[...settleRejected].join("; ")}`);

// --- 4b) tarihler (zaman kaydırıcısı) -----------------------------------------
// öncelik: data/<il>/history.json (kaynaklı) > Wikidata kuruluş (P571; yerleşim/idari sınırlar hariç) > OSM start_date
const histFile = path.join(OUT, "history.json");
const hist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, "utf8")) : { features: {}, timeless: [] };
const NO_WD_DATE = new Set(["yerlesimler", "ilceler", "koy_mahalle_sinir", "kamu", "parklar"]); // idari kuruluş ≠ yerin yaşı
const osmYear = (v) => { const m = String(v || "").match(/^(-?\d{1,4})(?:-\d\d)?(?:-\d\d)?$/); return m ? parseInt(m[1], 10) : null; };
for (const [catId, feats] of Object.entries(results)) for (const f of feats) {
  const p = f.properties, h = hist.features[p.id], w = wiki[p.wikidata];
  let from = null, to = null;
  if (h) { from = h.from ?? null; to = h.to ?? null; }
  else if (w?.inception && !NO_WD_DATE.has(catId)) { from = w.inception.y; to = w.dissolved?.y ?? null; }
  else if (osmYear(p.start_date) != null) from = osmYear(p.start_date);
  if (from != null) p._from = from;
  if (to != null) p._to = to;
}

// --- 5) yaz ---------------------------------------------------------------
const index = { province: provId, generated: new Date().toISOString(), counts: {}, sources: ["OpenStreetMap (ODbL)", "Wikidata (CC0)"] };
for (const cat of CATEGORIES) {
  const out = [];
  for (const f of results[cat.id]) {
    const { _rep, ...feat } = f;
    out.push(feat);
    // alan/sınır özellikleri için ikon ve etiket noktası
    if (/Polygon/.test(f.geometry.type)) out.push({ type: "Feature", properties: { ...f.properties, _pt: 1 }, geometry: { type: "Point", coordinates: _rep } });
  }
  index.counts[cat.id] = results[cat.id].length;
  index.dates = index.dates || {};
  index.dates[cat.id] = (hist.timeless || []).includes(cat.id) ? "timeless"
    : results[cat.id].filter((f) => f.properties._from != null).map((f) => [f.properties._from, f.properties._to ?? null]);
  fs.writeFileSync(path.join(OUT, cat.id + ".geojson"), JSON.stringify({ type: "FeatureCollection", features: out }));
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));

// --- 6) arama dizini ----------------------------------------------------------
// [id, kategori, boylam, enlem, ad, {dil: ad}] — adı olan her şey (yol parçaları ve köy sınırları hariç)
const search = [];
// her kaydın hangi ilçede olduğu (aynı adlı yerleri ayırt etmek için)
const districts = results.ilceler.filter((f) => /Polygon/.test(f.geometry.type));
const districtOf = (pt) => {
  const d = districts.find((f) => booleanPointInPolygon(pt, f));
  return d ? (d.properties.name || "").replace(/ (Merkez|İlçesi)$/, "") : "";
};
const seenNames = new Set();
for (const cat of CATEGORIES) {
  if (["yollar", "koy_mahalle_sinir"].includes(cat.id)) continue;
  for (const f of results[cat.id]) {
    const p = f.properties;
    const w = wiki[p.wikidata];
    const name = p["name:tr"] || p.name || w?.label?.tr;
    if (!name) continue;
    // nehirler birçok parça hâlinde gelir: aynı ad + kategori bir kez
    const key = cat.id + "|" + name;
    if (cat.id === "akarsu_gol" && seenNames.has(key)) continue;
    seenNames.add(key);
    const alt = {};
    for (const l of LANGS) { const v = w?.label?.[l] || p["name:" + l]; if (v && v !== name) alt[l] = v; }
    const dist = cat.id === "ilceler" ? "" : districtOf(f._rep);
    search.push([p.id, cat.id, f._rep[0], f._rep[1], name, alt, ...(dist && dist !== name ? [dist] : [])]);
  }
}
fs.writeFileSync(path.join(OUT, "search.json"), JSON.stringify(search));
console.log(`Arama dizini: ${search.length} kayıt`);
if (!fs.existsSync(path.join(OUT, "curated.json"))) fs.writeFileSync(path.join(OUT, "curated.json"), "{}\n");
console.log("Bitti →", OUT);
