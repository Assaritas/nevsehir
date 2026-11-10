// ESA WorldCover 2021 (10 m, CC BY 4.0) verisinden il için bitki örtüsü / arazi örtüsü karoları üretir.
// Kaynak: https://esa-worldcover.org  (AWS açık veri, bulut-optimize GeoTIFF; yalnızca gereken bölüm indirilir)
// Kullanım: node build-landcover.mjs [il-id]
// Çıktı:    data/<il>/landcover/{z}/{x}/{y}.png  (z8–z14, il sınırı dışı şeffaf)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromUrl } from "geotiff";
import UPNG from "upng-js";
import { PROVINCES, DEFAULT_PROVINCE } from "../config/provinces.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provId = process.argv[2] || DEFAULT_PROVINCE;
const OUT = path.join(ROOT, "data", provId, "landcover");
const boundary = JSON.parse(fs.readFileSync(path.join(ROOT, "data", provId, "boundary.geojson"), "utf8")).features[0].geometry;
const MINZ = 8, MAXZ = 14;

// ESA WorldCover sınıfları — okunaklı, doğal tonlarda palet (js/app.js içindeki LC_CLASSES ile aynı olmalı)
export const CLASSES = {
  10: "#2d7a3a", // ağaçlık
  20: "#b59a52", // çalılık
  30: "#cfe0a0", // çayır / mera
  40: "#f2cf6b", // tarım
  50: "#d9483b", // yerleşim
  60: "#cfc6b8", // çıplak / seyrek bitki örtüsü
  70: "#ffffff", // kar / buz
  80: "#3b82c4", // su
  90: "#4fb3a9", // sulak alan
  95: "#00a86b", // mangrov
  100: "#e6d9a8", // yosun / liken
};

// il sınırı kutusu
const rings = boundary.type === "Polygon" ? boundary.coordinates : boundary.coordinates.flat();
let [W, S, E, N] = [180, 90, -180, -90];
for (const r of rings) for (const [x, y] of r) { W = Math.min(W, x); E = Math.max(E, x); S = Math.min(S, y); N = Math.max(N, y); }

// 1) kaynak ızgarası: 1/12000 derece
const RES = 1 / 12000;
const gx0 = Math.floor(W / RES), gx1 = Math.ceil(E / RES), gy0 = Math.floor((90 - N) / RES), gy1 = Math.ceil((90 - S) / RES);
const GW = gx1 - gx0, GH = gy1 - gy0;
console.log(`Izgara ${GW}×${GH} (${(GW * GH / 1e6).toFixed(0)} M piksel)`);
const grid = new Uint8Array(GW * GH);

const tilesNeeded = [];
for (let lat = Math.floor(S / 3) * 3; lat < N; lat += 3)
  for (let lon = Math.floor(W / 3) * 3; lon < E; lon += 3) tilesNeeded.push([lat, lon]);

for (const [lat, lon] of tilesNeeded) {
  const name = `N${String(lat).padStart(2, "0")}E${String(lon).padStart(3, "0")}`;
  const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
  console.log("Okunuyor:", name);
  const tiff = await fromUrl(url, { allowFullFile: false });
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  // bu kaynak karonun ızgaradaki kesişimi
  const sx0 = Math.round(ox / RES), sy0 = Math.round((90 - oy) / RES);
  const ix0 = Math.max(gx0, sx0), ix1 = Math.min(gx1, sx0 + img.getWidth());
  const iy0 = Math.max(gy0, sy0), iy1 = Math.min(gy1, sy0 + img.getHeight());
  if (ix1 <= ix0 || iy1 <= iy0) continue;
  const [band] = await img.readRasters({ window: [ix0 - sx0, iy0 - sy0, ix1 - sx0, iy1 - sy0] });
  const w = ix1 - ix0;
  for (let y = iy0; y < iy1; y++) grid.set(band.subarray((y - iy0) * w, (y - iy0 + 1) * w), (y - gy0) * GW + (ix0 - gx0));
}

// 2) il maskesi (tarama çizgisi ile)
console.log("İl maskesi hazırlanıyor…");
const edges = [];
for (const r of rings) for (let i = 0; i < r.length - 1; i++) edges.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]]);
for (let row = 0; row < GH; row++) {
  const lat = 90 - (gy0 + row + 0.5) * RES;
  const xs = [];
  for (const [x1, y1, x2, y2] of edges) if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
  xs.sort((a, b) => a - b);
  const base = row * GW;
  let inside = new Uint8Array(GW);
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const a = Math.max(0, Math.ceil(xs[k] / RES - gx0 - 0.5)), b = Math.min(GW, Math.floor(xs[k + 1] / RES - gx0 - 0.5) + 1);
    inside.fill(1, a, b);
  }
  for (let c = 0; c < GW; c++) if (!inside[c]) grid[base + c] = 0;
}

// 3) karolar
const codes = Object.keys(CLASSES).map(Number);
const lut = new Uint8Array(256).fill(0);              // sınıf → palet indeksi (0 = şeffaf)
codes.forEach((c, i) => (lut[c] = i + 1));
const rgba = [[0, 0, 0, 0], ...codes.map((c) => { const h = CLASSES[c]; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]; })];

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
let count = 0, bytes = 0;
const buf = new Uint8Array(256 * 256 * 4);
for (let z = MINZ; z <= MAXZ; z++) {
  const tx0 = Math.floor(lon2x(W, z)), tx1 = Math.floor(lon2x(E, z)), ty0 = Math.floor(lat2y(N, z)), ty1 = Math.floor(lat2y(S, z));
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    let any = false;
    for (let py = 0; py < 256; py++) {
      const n = Math.PI - (2 * Math.PI * (ty + (py + 0.5) / 256)) / 2 ** z;
      const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
      const row = Math.floor((90 - lat) / RES) - gy0;
      for (let px = 0; px < 256; px++) {
        const lon = ((tx + (px + 0.5) / 256) / 2 ** z) * 360 - 180;
        const col = Math.floor(lon / RES) - gx0;
        let v = 0;
        if (row >= 0 && row < GH && col >= 0 && col < GW) v = lut[grid[row * GW + col]];
        const o = (py * 256 + px) * 4, c = rgba[v];
        buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = c[3];
        if (v) any = true;
      }
    }
    if (!any) continue;
    const png = UPNG.encode([buf.buffer.slice(0)], 256, 256, 16);
    const dir = path.join(OUT, String(z), String(tx));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ty + ".png"), Buffer.from(png));
    count++; bytes += png.byteLength;
  }
  console.log(`  z${z}: toplam ${count} karo, ${(bytes / 1e6).toFixed(1)} MB`);
}
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ source: "ESA WorldCover 10m 2021 v200 (CC BY 4.0)", bounds: [W, S, E, N], minzoom: MINZ, maxzoom: MAXZ, classes: CLASSES }, null, 2));
console.log("Bitti.");
