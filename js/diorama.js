// Diorama: haritadaki görünen alanı katmanlı yan duvarları olan bir 3B blok (maket) olarak gösterir.
// - Yükseklik: AWS Terrain Tiles (Terrarium); doku: seçili temel katman (uydu / yer şekilleri / bitki örtüsü)
// - Model ekranın ortasında sabit kalır; parmakla / fareyle döndürülür ve yakınlaştırılır
// - "Yeraltı": yüzey yarı saydam olur, yeraltı şehirlerinin katları kaynaklı verilerle (yoksa şematik) gösterilir
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { t, lang } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const SAT = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const W = 100;             // blok genişliği (sahne birimi)
const N = 256;             // ızgara çözünürlüğü (köşe sayısı / kenar)

let map, ctx;
let renderer, labelRenderer, scene, camera, controls, raf = 0, resizeObs;
let model = null;          // { grid, hMin, hMax, region, scale, groups… }

// --- Web Mercator yardımcıları -------------------------------------------------
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const mpp = (lat, z) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);

function loadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}
/** Bir karo bölgesini tek bir tuvale birleştirir. Bölge: [x0,y0,x1,y1] (z düzeyinde karo birimi) */
// tmpl: URL kalıbı ya da (z, x, y) → Promise<Image|null> döndüren işlev (PMTiles için)
async function mosaic(tmpl, z, [x0, y0, x1, y1], outPx, fill, smooth = true) {
  const c = document.createElement("canvas");
  c.width = c.height = outPx;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, outPx, outPx); }
  g.imageSmoothingEnabled = smooth;
  const k = outPx / (x1 - x0);                // karo birimi → piksel
  const jobs = [];
  for (let tx = Math.floor(x0); tx < x1; tx++) for (let ty = Math.floor(y0); ty < y1; ty++) {
    const get = typeof tmpl === "function" ? tmpl(z, tx, ty) : loadImage(tmpl.replace("{z}", z).replace("{x}", tx).replace("{y}", ty));
    // karo sınırlarını tam piksele yuvarla (boşluk / üst üste binme olmasın)
    const px0 = Math.round((tx - x0) * k), py0 = Math.round((ty - y0) * k);
    const px1 = Math.round((tx + 1 - x0) * k), py1 = Math.round((ty + 1 - y0) * k);
    jobs.push(get.then((img) => { if (img) g.drawImage(img, px0, py0, px1 - px0, py1 - py0); }));
  }
  await Promise.all(jobs);
  return c;
}

// --- bölge ---------------------------------------------------------------------
function region() {
  const c = map.getCenter();
  const cv = map.getCanvas();
  const z = map.getZoom();
  // görünen alanın kısa kenarı (metre); eğik görünümde abartmamak için 2B ölçüyle hesapla
  let size = Math.min(cv.clientWidth, cv.clientHeight) * (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** z) * 0.95;
  size = Math.max(1500, Math.min(size, 140000));
  return { lng: c.lng, lat: c.lat, size };
}

// --- yükseklik ızgarası --------------------------------------------------------
async function buildGrid(r) {
  const zDem = Math.max(6, Math.min(14, Math.round(Math.log2((420 * mpp(r.lat, 0)) / r.size))));
  const cx = lon2x(r.lng, zDem), cy = lat2y(r.lat, zDem);
  const half = r.size / 2 / mpp(r.lat, zDem) / 256;     // karo birimi
  const box = [cx - half, cy - half, cx + half, cy + half];
  const px = 512;
  const can = await mosaic(TERRARIUM, zDem, box, px, null, false);
  const d = can.getContext("2d").getImageData(0, 0, px, px).data;
  // yüklenemeyen karo / kenar pikselleri (saydam) geçersiz sayılır ve en yakın geçerli komşudan doldurulur
  const raw = new Float32Array(px * px);
  for (let q = 0; q < px * px; q++) raw[q] = d[q * 4 + 3] < 250 ? NaN : d[q * 4] * 256 + d[q * 4 + 1] + d[q * 4 + 2] / 256 - 32768;
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < px; y++) {
    let last = NaN;
    for (let x = 0; x < px; x++) { const q = y * px + x; if (Number.isNaN(raw[q])) raw[q] = last; else last = raw[q]; }
    last = NaN;
    for (let x = px - 1; x >= 0; x--) { const q = y * px + x; if (Number.isNaN(raw[q])) raw[q] = last; else last = raw[q]; }
    if (pass === 0) for (let x = 0; x < px; x++) { // dikey yönde de doldur
      let l2 = NaN;
      for (let yy = 0; yy < px; yy++) { const q = yy * px + x; if (Number.isNaN(raw[q])) raw[q] = l2; else l2 = raw[q]; }
    }
  }
  const elev = (i) => { const v = raw[i / 4]; return Number.isNaN(v) ? 0 : v; };
  const grid = new Float32Array(N * N);
  let hMin = Infinity, hMax = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const fx = (i / (N - 1)) * (px - 1), fy = (j / (N - 1)) * (px - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(px - 1, x0 + 1), y1 = Math.min(px - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const h = (elev((y0 * px + x0) * 4) * (1 - ax) + elev((y0 * px + x1) * 4) * ax) * (1 - ay)
            + (elev((y1 * px + x0) * 4) * (1 - ax) + elev((y1 * px + x1) * 4) * ax) * ay;
    grid[j * N + i] = h;
    if (h < hMin) hMin = h; if (h > hMax) hMax = h;
  }
  return { grid, hMin, hMax, zDem, box, demCanvas: can };
}

// --- doku ------------------------------------------------------------------------
const RAMP = [[-100, "#7fb3d5"], [0, "#4e9a5f"], [200, "#6fa862"], [500, "#a9c879"], [750, "#d3d98f"], [900, "#e9e29d"], [1050, "#efd68a"],
  [1200, "#e8bf72"], [1350, "#dba461"], [1500, "#c98a52"], [1700, "#b37148"], [2000, "#985e43"], [2400, "#80574d"], [3000, "#958780"], [3800, "#dcd7d3"], [5200, "#ffffff"]]
  .map(([h, c]) => [h, parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
function rampColor(h) {
  for (let k = 1; k < RAMP.length; k++) if (h <= RAMP[k][0]) {
    const a = RAMP[k - 1], b = RAMP[k], f = (h - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  }
  return [255, 255, 255];
}
function reliefTexture(m, light) {
  // fiziki harita renklendirmesi + gölgeli kabartma (ızgaradan)
  const S = 1024, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  const cell = m.region.size / (N - 1);
  const at = (i, j) => m.grid[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fi = (x / (S - 1)) * (N - 1), fj = (y / (S - 1)) * (N - 1), i = Math.round(fi), j = Math.round(fj);
    const h = at(i, j);
    const dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), dzdy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
    // ışık kuzeybatıdan
    const nx = -dzdx * 2.2, ny = -dzdy * 2.2, nz = 1, len = Math.hypot(nx, ny, nz);
    const shade = Math.max(0, (nx * -0.6 + ny * -0.6 + nz * 0.53) / len);
    const [r, gg, b] = light ? [236, 228, 212] : rampColor(h);
    const k = 0.45 + shade * 0.75, o = (y * S + x) * 4;
    img.data[o] = Math.min(255, r * k); img.data[o + 1] = Math.min(255, gg * k); img.data[o + 2] = Math.min(255, b * k); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
async function surfaceTexture(m) {
  const base = ctx.base();
  const r = m.region;
  if (base === "satellite" || base === "vegetation") {
    const zMax = base === "satellite" ? 14 : 14;
    const zTex = Math.max(8, Math.min(zMax, m.zDem + 2));
    const cx = lon2x(r.lng, zTex), cy = lat2y(r.lat, zTex), half = r.size / 2 / mpp(r.lat, zTex) / 256;
    const tmpl = base === "satellite" ? SAT : (z, x, y) => window.__lcArchive.getZxy(z, x, y)
      .then((r) => (r ? createImageBitmap(new Blob([r.data], { type: "image/png" })) : null)).catch(() => null);
    // bitki örtüsü yalnızca il içinde var; dışını kabartmayla doldur
    const under = base === "vegetation" ? reliefTexture(m, true) : null;
    const c = await mosaic(tmpl, zTex, [cx - half, cy - half, cx + half, cy + half], 2048, base === "satellite" ? "#b9a88f" : null);
    if (!under) return c;
    const out = document.createElement("canvas"); out.width = out.height = 2048;
    const g = out.getContext("2d"); g.drawImage(under, 0, 0, 2048, 2048); g.globalAlpha = 0.9; g.drawImage(c, 0, 0);
    return out;
  }
  return overlayWater(m, reliefTexture(m, base === "terrain" && false));
}
// deniz, göl ve nehir alanları (vektör karolarından) kabartma dokusunun üstüne mavi boyanır
function overlayWater(m, c) {
  let feats = [];
  try { feats = map.querySourceFeatures("openmaptiles", { sourceLayer: "water" }); } catch { return c; }
  if (!feats.length) return c;
  const g = c.getContext("2d"), S = c.width;
  g.fillStyle = ctx.isDark() ? "#3f6f95" : "#8fc1e3";
  // her alan ayrı doldurulur (komşu karoların taşma payları üst üste binse de boşluk oluşmaz)
  for (const f of feats) for (const rings of polys(f.geometry)) {
    g.beginPath();
    for (const ring of rings) {
      ring.forEach(([lng, lat], i) => { const [u, v] = lngLatToUV(m, lng, lat); i ? g.lineTo(u * S, v * S) : g.moveTo(u * S, v * S); });
      g.closePath();
    }
    g.fill("evenodd");
  }
  m.hasWater = true;
  return c;
}

// --- duvar dokusu (tüf katmanları) ---------------------------------------------
function strataTexture() {
  const c = document.createElement("canvas"); c.width = 8; c.height = 512;
  const g = c.getContext("2d");
  const bands = ["#d9c3a0", "#cfb48c", "#e3d2b4", "#bf9d74", "#d6bf98", "#a98462", "#cdb08a", "#b8946c", "#9c7856", "#8a6a4c"];
  let y = 0, k = 0;
  while (y < 512) { const hgt = 18 + ((k * 37) % 41); g.fillStyle = bands[k % bands.length]; g.fillRect(0, y, 8, hgt); y += hgt; k++; }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- sahne ---------------------------------------------------------------------
function ensureRenderer() {
  if (renderer) return;
  const stage = $("dioStage");
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "dio-labels";
  stage.appendChild(labelRenderer.domElement);
  camera = new THREE.PerspectiveCamera(38, 1, 0.5, 3000);
  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 25;
  controls.maxDistance = 420;
  controls.autoRotateSpeed = 0.55;
  controls.addEventListener("start", () => { if ($("dioRotate").checked) { $("dioRotate").checked = false; controls.autoRotate = false; } });
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(stage);
}
function resize() {
  const stage = $("dioStage");
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function fitCamera() {
  // blok (kaide dahil ≈ 110 birim) yatayda ve dikeyde sığacak uzaklık
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const need = camera.aspect < 1 ? 58 : 66;   // dikey ekranda modeli daha büyük göster
  const dist = Math.max(need / Math.tan(hfov / 2), (need * 0.85) / Math.tan(vfov / 2));
  const dir = new THREE.Vector3(0, 0.62, 1).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  controls.target.set(0, -4, 0);
  controls.maxDistance = Math.max(420, dist * 2);
  controls.update();
}
function loop() {
  raf = requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
  if ($("dioLabels").checked) labelRenderer.render(scene, camera);
}

function disposeScene() {
  if (!scene) return;
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
    if (o.isCSS2DObject) o.element.remove();
  });
  scene = null;
}

// yükseklik: dünya birimi
function heightAt(m, u, v) {
  const fi = Math.max(0, Math.min(1, u)) * (N - 1), fj = Math.max(0, Math.min(1, v)) * (N - 1);
  const i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(N - 1, i0 + 1), j1 = Math.min(N - 1, j0 + 1), a = fi - i0, b = fj - j0;
  const g = m.grid;
  const h = (g[j0 * N + i0] * (1 - a) + g[j0 * N + i1] * a) * (1 - b) + (g[j1 * N + i0] * (1 - a) + g[j1 * N + i1] * a) * b;
  return (h - m.hMin) * m.scale * m.exag;
}
function lngLatToUV(m, lng, lat) {
  const [x0, y0, x1, y1] = m.box;
  return [(lon2x(lng, m.zDem) - x0) / (x1 - x0), (lat2y(lat, m.zDem) - y0) / (y1 - y0)];
}

function applyHeights(m) {
  const pos = m.terrain.geometry.attributes.position;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pos.setY(j * N + i, (m.grid[j * N + i] - m.hMin) * m.scale * m.exag);
  pos.needsUpdate = true;
  m.terrain.geometry.computeVertexNormals();
  // duvarlar
  const edges = [
    (k) => [k, 0], (k) => [N - 1, k], (k) => [N - 1 - k, N - 1], (k) => [0, N - 1 - k],
  ];
  m.walls.forEach((wall, e) => {
    const p = wall.geometry.attributes.position;
    for (let k = 0; k < N; k++) {
      const [i, j] = edges[e](k);
      p.setY(k * 2, (m.grid[j * N + i] - m.hMin) * m.scale * m.exag);
      p.setY(k * 2 + 1, -m.baseDepth);
    }
    p.needsUpdate = true;
    wall.geometry.computeVertexNormals();
  });
  // etiketler ve yeraltı
  m.labels.forEach((l) => { const y = heightAt(m, l.u, l.v); l.obj.position.y = y + l.lift; l.stem && setStem(l.stem, y, y + l.lift); });
  buildUnderground(m);
  clearTimeout(m._cityT);
  if (m.city) m._cityT = setTimeout(() => { buildCity(m); renderKey(m); }, 200);
}
function setStem(line, y0, y1) {
  const p = line.geometry.attributes.position;
  p.setY(0, y0); p.setY(1, y1 - 0.6); p.needsUpdate = true;
}

function buildBlock(m, tex) {
  scene = new THREE.Scene();
  const dark = ctx.isDark();
  scene.add(new THREE.HemisphereLight(dark ? 0xbfcfe6 : 0xfff6e8, dark ? 0x2a2018 : 0x6b5440, dark ? 1.1 : 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.6 : 2.2);
  sun.position.set(-70, 110, -50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 400 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  // yüzey
  const geo = new THREE.PlaneGeometry(W, W, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);
  const texture = new THREE.CanvasTexture(tex);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const terrainMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0, transparent: true, opacity: 1 });
  m.terrain = new THREE.Mesh(geo, terrainMat);
  m.terrain.castShadow = m.terrain.receiveShadow = true;
  scene.add(m.terrain);

  // duvarlar (kuzey, doğu, güney, batı) — katmanlı tüf dokusu
  const wallMat = new THREE.MeshStandardMaterial({ map: strataTexture(), roughness: 1, transparent: true, opacity: 1, side: THREE.DoubleSide });
  const half = W / 2;
  const edgeXZ = [
    (f) => [-half + f * W, -half], (f) => [half, -half + f * W], (f) => [half - f * W, half], (f) => [-half, half - f * W],
  ];
  m.walls = edgeXZ.map((fn) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 2 * 3), uv = new Float32Array(N * 2 * 2), idx = [];
    for (let k = 0; k < N; k++) {
      const [x, z] = fn(k / (N - 1));
      pos.set([x, 0, z, x, 0, z], k * 6);
      uv.set([k / (N - 1), 1, k / (N - 1), 0], k * 4);
      if (k < N - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, wallMat);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });
  m.wallMat = wallMat;

  // kaide
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 8, 3, W + 8), new THREE.MeshStandardMaterial({ color: dark ? 0x2b2622 : 0x3d3128, roughness: 0.6 }));
  plinth.position.y = -m.baseDepth - 1.5;
  plinth.receiveShadow = true;
  scene.add(plinth);
  m.plinth = plinth;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 64), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -m.baseDepth - 3;
  ground.receiveShadow = true;
  scene.add(ground);

  // kuzey oku
  const north = document.createElement("div");
  north.className = "dio-north"; north.textContent = "K";
  if (lang() !== "tr") north.textContent = "N";
  const no = new CSS2DObject(north); no.position.set(0, 2, -half - 7); scene.add(no);

  m.ugGroup = new THREE.Group();
  m.ugGroup.visible = false;
  scene.add(m.ugGroup);
}

// --- etiketler -----------------------------------------------------------------
function addLabel(m, { lng, lat, text, color, cls = "", lift = 5 }) {
  const [u, v] = lngLatToUV(m, lng, lat);
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  const el = document.createElement("div");
  el.className = "dio-pin " + cls;
  el.innerHTML = `<span class="dot" style="background:${color}"></span><span class="txt"></span>`;
  el.querySelector(".txt").textContent = text;
  const obj = new CSS2DObject(el);
  const x = -W / 2 + u * W, z = -W / 2 + v * W, y = heightAt(m, u, v);
  obj.position.set(x, y + lift, z);
  scene.add(obj);
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + lift - 0.6, z)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  scene.add(stem);
  m.labels.push({ u, v, obj, stem, lift });
}

// --- yeraltı -------------------------------------------------------------------
// Blok model: her kat, ortada havalandırma bacası çevresinde dizilmiş odalardan, odaları bağlayan dar
// tünellerden ve katları bağlayan rampalardan oluşur. Kat sayısı, derinlik ve toplam alan kaynaklıdır;
// odaların dizilişi temsilîdir (gerçek plan değildir). Ölçümlü planlar: Yamaç & Tok 2015.
function seeded(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const UG_MAT = {
  room: new THREE.MeshStandardMaterial({ color: 0xd9a066, emissive: 0x4a2208, roughness: 0.9 }),
  roomSchem: new THREE.MeshStandardMaterial({ color: 0xa8a29a, emissive: 0x1e1c1a, roughness: 0.95, transparent: true, opacity: 0.75 }),
  tunnel: new THREE.MeshStandardMaterial({ color: 0x9c6a3c, emissive: 0x2a1406, roughness: 1 }),
  shaft: new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.8 }),
};
function buildUnderground(m) {
  if (!m.ugGroup) return;
  m.ugGroup.clear();
  m.ugInfo = [];
  const sites = (m.ugSites || []).map((s) => ({ ...s, uv: lngLatToUV(m, s.lng, s.lat) }))
    .filter((s) => s.uv[0] >= 0 && s.uv[0] <= 1 && s.uv[1] >= 0 && s.uv[1] <= 1);
  if (!sites.length) { buildResources(m); return; }
  // gerçek ölçekte görünmezler: derinlik ve yatay boyut ortak katsayılarla büyütülür (listede yazar)
  const ref = Math.max(...sites.map((s) => s.depth_m || s.visit_depth_m || 0), 40);
  m.ugExag = Math.max(1, Math.round((W * 0.18) / (ref * m.scale)));
  const k2u = m.scale * m.ugExag;
  const refSide = Math.sqrt(Math.max(...sites.map((s) => s.area_m2 || (s.length_m && s.width_m ? s.length_m * s.width_m : 2500))));
  m.ugHExag = Math.max(1, Math.round((W * 0.2) / (refSide * m.scale)));   // yatay büyütme
  // yatay büyütme: yeraltı şehirleri bloğun yaklaşık beşte birine yayılır, ama komşu yeraltı şehirleriyle üst üste binmez
  if (sites.length > 1) {
    let minD = Infinity;
    for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++)
      minD = Math.min(minD, Math.hypot(sites[a].uv[0] - sites[b].uv[0], sites[a].uv[1] - sites[b].uv[1]) * W);
    m.ugHExag = Math.max(1, Math.min(m.ugHExag, Math.floor((minD * 0.75) / (refSide * m.scale))));
  }
  const h2u = m.scale * m.ugHExag;
  sites.forEach((s, si) => {
    const [u, v] = s.uv, cx = -W / 2 + u * W, cz = -W / 2 + v * W, top = heightAt(m, u, v);
    if (s.type === "cistern") { buildCistern(m, s, si, cx, cz, top, k2u, h2u); return; }
    const rnd = seeded(s.id);
    const floors = s.floors || 4;
    let sp, sourcedUpTo;
    if (s.visit_depth_m && s.visit_floors) { sp = s.visit_depth_m / s.visit_floors; sourcedUpTo = s.visit_floors; }
    else if (s.depth_m && s.floors) { sp = s.depth_m / s.floors; sourcedUpTo = s.floors; }
    else { sp = (ref * 0.6) / floors; sourcedUpTo = 0; }
    // kat başına alan: toplam ölçümlü alan / kat (yoksa varsayılan, şematik)
    const perFloor = (s.area_m2 || 2500) / floors;
    const side = Math.sqrt(perFloor) * h2u;        // bir katın yaklaşık genişliği (sahne birimi)
    const levelH = Math.max(0.35, sp * k2u * 0.55);
    for (let k = 0; k < floors; k++) {
      const sourced = k < sourcedUpTo;
      const y = top - (k + 0.6) * sp * k2u;
      const mat = sourced ? UG_MAT.room : UG_MAT.roomSchem;
      const nRooms = 5 + Math.floor(rnd() * 5);
      const rooms = [];
      for (let r = 0; r < nRooms; r++) {
        const ang = (r / nRooms) * Math.PI * 2 + rnd() * 0.6;
        const dist = side * (0.2 + rnd() * 0.55);
        const w = side * (0.14 + rnd() * 0.16), d = side * (0.1 + rnd() * 0.14);
        const rx = cx + Math.cos(ang) * dist, rz = cz + Math.sin(ang) * dist;
        const room = new THREE.Mesh(new THREE.BoxGeometry(w, levelH, d), mat);
        room.position.set(rx, y, rz);
        room.rotation.y = rnd() * Math.PI;
        m.ugGroup.add(room);
        rooms.push([rx, rz]);
        // bacaya bağlanan dar tünel
        const len = Math.hypot(rx - cx, rz - cz);
        const tun = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.12, side * 0.035), levelH * 0.45, len), UG_MAT.tunnel);
        tun.position.set((rx + cx) / 2, y - levelH * 0.2, (rz + cz) / 2);
        tun.lookAt(rx, y - levelH * 0.2, rz);
        m.ugGroup.add(tun);
        // bazı tünel ağızlarında sürgü taşı
        if (rnd() < 0.3) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(levelH * 0.32, levelH * 0.32, Math.max(0.06, side * 0.02), 16), UG_MAT.stone);
          st.position.set(cx + (rx - cx) * 0.35, y - levelH * 0.1, cz + (rz - cz) * 0.35);
          st.lookAt(rx, y - levelH * 0.1, rz);
          st.rotateX(Math.PI / 2);
          m.ugGroup.add(st);
        }
      }
      // bir alt kata inen rampa
      if (k < floors - 1) {
        const [rx, rz] = rooms[Math.floor(rnd() * rooms.length)];
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.12, side * 0.04), Math.max(0.08, levelH * 0.25), sp * k2u * 1.3), UG_MAT.tunnel);
        ramp.position.set(rx, y - sp * k2u * 0.5, rz);
        ramp.rotation.x = Math.PI / 4;
        m.ugGroup.add(ramp);
      }
    }
    // havalandırma bacası (katlar boyunca) ve kaynakta geçen toplam derinliğe uzanan kuyu
    const floorsBottom = floors * sp;
    const total = Math.max(floorsBottom, s.depth_m || 0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.15, side * 0.03), Math.max(0.15, side * 0.03), total * k2u + 0.6, 10), UG_MAT.shaft);
    shaft.position.set(cx, top - (total * k2u) / 2 + 0.3, cz);
    m.ugGroup.add(shaft);
    // küçük numara etiketi (açıklama listede)
    const tag = document.createElement("div");
    tag.className = "dio-ugtag"; tag.textContent = String(si + 1);
    const lbl = new CSS2DObject(tag);
    lbl.visible = m.ugGroup.visible;
    lbl.position.set(cx + side * 0.6, top - total * k2u * 0.35, cz);
    m.ugGroup.add(lbl);
    m.ugInfo.push({ ...s, n: si + 1, x: cx, z: cz, top, depthU: total * k2u, sourcedUpTo, floors, note: s.notes?.[lang()] || s.notes?.tr });
  });
  buildResources(m);
}

// sarnıç: boyutları ve sütun sayısı kaynaklı dikdörtgen salon; derinlik bilinmiyorsa şematik konumda
function buildCistern(m, s, si, cx, cz, top, k2u, h2u) {
  const L = (s.length_m || 60) * h2u, Wd = (s.width_m || 40) * h2u;
  const hallH = 9 * k2u;                                  // salon yüksekliği (şematik ~9 m)
  const depthTop = (s.depth_m ?? 6) * k2u;                // örtü üstü toprak (bilinmiyorsa şematik)
  const yMid = top - depthTop - hallH / 2;
  const sourcedDims = !!(s.length_m && s.width_m);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(L, Math.max(0.15, hallH * 0.08), Wd), sourcedDims ? UG_MAT.room : UG_MAT.roomSchem);
  floor.position.set(cx, yMid - hallH / 2, cz);
  m.ugGroup.add(floor);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L, Math.max(0.12, hallH * 0.06), Wd),
    new THREE.MeshStandardMaterial({ color: 0xc58a55, transparent: true, opacity: 0.35, roughness: 0.9 }));
  roof.position.set(cx, yMid + hallH / 2, cz);
  m.ugGroup.add(roof);
  // sütun ızgarası: sütun sayısına en yakın satır × sütun düzeni (en/boy oranına göre)
  const n = s.columns || 0;
  if (n) {
    const ratio = (s.length_m || 1) / (s.width_m || 1);
    let rows = Math.max(1, Math.round(Math.sqrt(n / ratio))), cols = Math.max(1, Math.round(n / rows));
    const col = new THREE.InstancedMesh(new THREE.CylinderGeometry(Math.max(0.04, Math.min(L, Wd) * 0.012), Math.max(0.04, Math.min(L, Wd) * 0.012), hallH, 8), UG_MAT.stone, rows * cols);
    const mtx = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      mtx.makeTranslation(cx - L / 2 + ((i + 0.5) * L) / cols, yMid, cz - Wd / 2 + ((j + 0.5) * Wd) / rows);
      col.setMatrixAt(k++, mtx);
    }
    m.ugGroup.add(col);
  }
  const tag = document.createElement("div");
  tag.className = "dio-ugtag"; tag.textContent = String(si + 1);
  const lbl = new CSS2DObject(tag);
  lbl.visible = m.ugGroup.visible;
  lbl.position.set(cx + L * 0.55, yMid + hallH, cz);
  m.ugGroup.add(lbl);
  m.ugInfo.push({ ...s, n: si + 1, x: cx, z: cz, top, depthU: depthTop + hallH, sourcedUpTo: 0, floors: null,
    area_m2: s.length_m && s.width_m ? s.length_m * s.width_m : s.area_m2, note: s.notes?.[lang()] || s.notes?.tr });
}

function renderUgList(m) {
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const body = $("dioListBody");
  const res = m.resInfo || [];
  $("dioListTitle").textContent = `${!res.length ? t("d.ugList") : !m.ugInfo.length ? t("d.resTitle") : t("d.under")} (${m.ugInfo.length + res.length})`;
  if (!m.ugInfo.length && !res.length) { body.innerHTML = `<p>${t("d.underNone")}</p>`; return; }
  const resHtml = res.length ? `${m.ugInfo.length ? `<h4 class="ug-sec">${t("d.resTitle")}</h4>` : ""}<p>${t("d.resNote").replace("{x}", m.resExag)}</p>
    ${res.map((r, i) => `<div class="ug-item"><button data-res="${i}"><span class="n res ${r.ext}">${r.n}</span><span><b>${esc(r.name || t("d.k.res." + r.ext))}</b>
      <small>${esc([t("d.k.res." + r.ext), r.res, r.depth_m ? `~${r.depth_m} m` : r.ext === "yerustu" ? null : t("d.depthUnknown"), r.operator, r.status].filter(Boolean).join(" · "))}</small></span></button>
      ${r.hasText ? `<a class="ug-more" href="#" data-rescard="${esc(r.id)}">${t("d.details")} ›</a>` : ""}</div>`).join("")}` : "";
  if (!m.ugInfo.length) { body.innerHTML = resHtml; bindUgList(m, body); return; }
  body.innerHTML = `<p>${t("d.depthNote").replace("{x}", m.ugExag)} ${t("d.hNote").replace("{x}", m.ugHExag)} ${t("d.layoutNote")}</p>
    <p class="sw"><i style="background:#d9a066"></i>${t("d.sourced")}<i style="background:#a8a29a"></i>${t("d.schematic")}</p>
    ${m.ugInfo.map((s, i) => {
      const facts = s.type === "cistern" ? [`${s.length_m} × ${s.width_m} m`, s.columns ? `${s.columns} ${t("d.columns")}` : null, s.depth_m ? `~${s.depth_m} m` : t("d.depthUnknown")].filter(Boolean).join(" · ") : [s.floors && s.floors !== 4 || s.sourcedUpTo ? `${s.floors} ${t("d.floors")}` : t("d.floorsUnknown"),
        s.depth_m ? `${t("d.total")} ~${s.depth_m} m` : t("d.totalUnknown"),
        s.area_m2 ? `${s.area_m2.toLocaleString(lang())} m²` : null,
        s.visit_floors ? `${t("d.visit")}: ${s.visit_floors} ${t("d.floors")}${s.visit_depth_m ? ` (~${s.visit_depth_m} m)` : ""}` : null].filter(Boolean).join(" · ");
      return `<div class="ug-item"><button data-ug="${i}"><span class="n">${s.n}</span><span><b>${esc(s.name)}</b><small>${esc(facts)}</small></span></button>
        <details><summary>${t("d.details")}</summary><p>${esc(s.note || "")}</p>
        <ul>${(s.sources || []).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("")}</ul></details></div>`;
    }).join("")}${resHtml}`;
  bindUgList(m, body);
}
function bindUgList(m, body) {
  body.querySelectorAll("[data-ug]").forEach((b) => (b.onclick = () => focusUg(m.ugInfo[+b.dataset.ug])));
  body.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => focusUg(m.resInfo[+b.dataset.res])));
  body.querySelectorAll("[data-rescard]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); close(); ctx.openFeature(a.dataset.rescard); }));
}
function focusUg(s) {
  // kamerayı seçilen yeraltı şehrine çevir
  controls.autoRotate = false; $("dioRotate").checked = false;
  const target = new THREE.Vector3(s.x, s.top - s.depthU * 0.5, s.z);
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = Math.max(30, s.depthU * 2.6);
  const from = controls.target.clone(), fromPos = camera.position.clone();
  const toPos = target.clone().add(dir.multiplyScalar(dist));
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 700), e = k * (2 - k);
    controls.target.lerpVectors(from, target, e);
    camera.position.lerpVectors(fromPos, toPos, e);
    if (k < 1) requestAnimationFrame(step);
  };
  step();
  if (innerWidth <= 720) setListOpen(false);
}
function setListOpen(open) {
  $("dioListToggle").setAttribute("aria-expanded", String(open));
  $("dioListBody").hidden = !open;
}
function setUnderground(on) {
  if (!model) return;
  const m = model;
  m.ugGroup.visible = on;
  m.ugGroup.traverse((o) => { if (o.isCSS2DObject) o.visible = on; });
  m.terrain.material.opacity = on ? 0.3 : 1;
  m.terrain.material.depthWrite = !on;
  m.wallMat.opacity = on ? 0.3 : 1;
  m.wallMat.depthWrite = !on;
  m.labels.forEach((l) => (l.obj.element.style.opacity = on ? 0.35 : 1));
  $("dioLegend").hidden = !on;
  if (on) { renderUgList(m); setListOpen(innerWidth > 720); }
  syncCityToggles(m);
  renderKey(m);
}

// --- yer altı / yer üstü kaynakları (madenler, kuyular, açık ocaklar) ----------------
// Veri: yeralti_maden.geojson ve acik_ocak.geojson (OSM + kaynaklı resources.json kayıtları).
// Derinlik yalnızca kaynakta varsa gerçek (ortak katsayıyla); yoksa şematik ve listede "bilinmiyor" yazar.
const RES_MAT = {
  shaft: new THREE.MeshStandardMaterial({ color: 0x4a4f5c, roughness: 0.6, metalness: 0.3 }),
  shaftSchem: new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.8, transparent: true, opacity: 0.6 }),
  head: new THREE.MeshStandardMaterial({ color: 0xc23b22, roughness: 0.5, metalness: 0.4 }),
  cavern: new THREE.MeshStandardMaterial({ color: 0x5fb3dd, emissive: 0x0d3550, roughness: 0.3, transparent: true, opacity: 0.7 }),
  pit: new THREE.MeshStandardMaterial({ color: 0xe0913f, emissive: 0x3a1c04, roughness: 0.9, side: THREE.DoubleSide }),
};
const ORE_COLORS = [[/kömür|linyit|coal|lignite/i, 0x2b2b2b], [/trona|soda|tuz|salt|bor/i, 0xf1eefa], [/bakır|copper/i, 0xb87333], [/altın|gold/i, 0xd4af37],
  [/demir|iron|krom|chrom/i, 0x7a4a3a], [/petrol|oil|gaz|gas/i, 0x1d1d1d], [/jeotermal|geotherm/i, 0xd94f30], [/pomza|pumice|tüf|tuff/i, 0xe9e2cf], [/mermer|marble|traverten/i, 0xf3f0ea]];
const oreColor = (r) => (ORE_COLORS.find(([re]) => re.test(r || "")) || [0, 0x8e6bbf])[1];
export const RES_KEY = { yeralti: "#4a4f5c", cozelti: "#5fb3dd", kuyu: "#1d1d1d", yerustu: "#e0913f" };

function polyArea(geom) {
  // yaklaşık alan (m²) — açık ocak çukurunun boyutu için
  const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.type === "MultiPolygon" ? geom.coordinates[0][0] : null;
  if (!ring) return 0;
  const lat0 = ring[0][1] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * kx * ring[i + 1][1] * ky - ring[i + 1][0] * kx * ring[i][1] * ky;
  return Math.abs(a / 2);
}
function buildResources(m) {
  m.resInfo = [];
  const feats = (m.resFeats || []).map((f) => {
    const p = f.properties, [lng, lat] = f._pt;
    const [u, v] = lngLatToUV(m, lng, lat);
    return { p, u, v, lng, lat, area: f._area || 0, d2: (u - 0.5) ** 2 + (v - 0.5) ** 2 };
  }).filter((r) => r.u >= 0.02 && r.u <= 0.98 && r.v >= 0.02 && r.v <= 0.98)
    .sort((a, b) => (b.p._src ? 1 : 0) - (a.p._src ? 1 : 0) || (b.p.name ? 1 : 0) - (a.p.name ? 1 : 0) || a.d2 - b.d2)
    .slice(0, 40);
  if (!feats.length) return;
  const known = feats.map((r) => +r.p.depth_m).filter((d) => d > 0);
  const ref = Math.max(300, ...known);
  m.resExag = Math.max(1, Math.round((m.baseDepth * 0.85) / (ref * m.scale)));
  const k = m.scale * m.resExag;
  const rad = Math.max(0.18, W * 0.004);
  feats.forEach((r, i) => {
    const x = -W / 2 + r.u * W, z = -W / 2 + r.v * W, top = heightAt(m, r.u, r.v);
    const p = r.p, ext = p.method === "cozelti" ? "cozelti" : p.ext || "yeralti";
    const depthM = +p.depth_m || 0, sourced = depthM > 0;
    let depthU;
    if (ext === "yerustu") {
      // açık ocak: basamaklı çukur (alan OSM'den; derinlik bilinmiyorsa şematik)
      const R = Math.max(0.5, Math.min(W * 0.06, Math.sqrt(Math.max(r.area, 20000) / Math.PI) * m.scale));
      depthU = sourced ? depthM * k : Math.max(0.6, R * 0.5);
      for (let s = 0; s < 3; s++) {
        const r0 = R * (1 - s * 0.28), r1 = R * (1 - (s + 1) * 0.28) + R * 0.06;
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, depthU / 3, 28, 1, true), RES_MAT.pit);
        ring.position.set(x, top + 0.05 - (s + 0.5) * (depthU / 3), z);
        m.ugGroup.add(ring);
      }
    } else {
      depthU = sourced ? depthM * k : m.baseDepth * 0.35;
      const mat = sourced ? RES_MAT.shaft : RES_MAT.shaftSchem;
      const nPipes = ext === "cozelti" ? 3 : 1;
      for (let q = 0; q < nPipes; q++) {
        const ox = nPipes > 1 ? Math.cos((q / nPipes) * Math.PI * 2) * rad * 4 : 0, oz = nPipes > 1 ? Math.sin((q / nPipes) * Math.PI * 2) * rad * 4 : 0;
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(ext === "yeralti" ? rad : rad * 0.5, ext === "yeralti" ? rad : rad * 0.5, depthU, 10), mat);
        pipe.position.set(x + ox, top - depthU / 2, z + oz);
        m.ugGroup.add(pipe);
      }
      // ocak ağzı / kuyu başı (yüzeyde kırmızı işaret)
      const head = new THREE.Mesh(ext === "yeralti" ? new THREE.ConeGeometry(rad * 3, rad * 6, 4) : new THREE.CylinderGeometry(rad * 1.6, rad * 1.6, rad * 2, 10), RES_MAT.head);
      head.position.set(x, top + rad * 2.5, z);
      m.ugGroup.add(head);
      // cevher / çözelti boşluğu
      if (ext === "cozelti") {
        const cav = new THREE.Mesh(new THREE.SphereGeometry(rad * 7, 20, 12), RES_MAT.cavern);
        cav.scale.set(1.4, 0.35, 1.1);
        cav.position.set(x, top - depthU, z);
        m.ugGroup.add(cav);
      } else if (ext === "yeralti") {
        const ore = new THREE.Mesh(new THREE.BoxGeometry(rad * 14, rad * 1.6, rad * 9),
          new THREE.MeshStandardMaterial({ color: oreColor(p.res), roughness: 0.7, transparent: !sourced, opacity: sourced ? 1 : 0.6 }));
        ore.position.set(x, top - depthU, z);
        m.ugGroup.add(ore);
        // galeri (yatay tünel)
        const gal = new THREE.Mesh(new THREE.BoxGeometry(rad * 10, rad * 0.8, rad * 0.8), mat);
        gal.position.set(x + rad * 5, top - depthU + rad * 1.2, z);
        m.ugGroup.add(gal);
      } else {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(rad * 3, 14, 10), new THREE.MeshStandardMaterial({ color: oreColor(p.res || "petrol"), roughness: 0.4 }));
        blob.scale.y = 0.5;
        blob.position.set(x, top - depthU, z);
        m.ugGroup.add(blob);
      }
    }
    const tag = document.createElement("div");
    tag.className = "dio-ugtag res " + ext; tag.textContent = "M" + (i + 1);
    const lbl = new CSS2DObject(tag);
    lbl.visible = m.ugGroup.visible;
    lbl.position.set(x, top + (ext === "yerustu" ? 1.2 : rad * 9), z);
    m.ugGroup.add(lbl);
    m.resInfo.push({ n: "M" + (i + 1), ext, name: p.name || p["name:tr"] || "", res: p.res, depth_m: depthM || null, operator: p.operator, status: p.status, id: p.id,
      x, z, top, depthU, sourced, hasText: !!p._src });
  });
}

// --- 3B şehir: binalar, anıt modelleri, yollar ve kaldırımlar ----------------------------
// Binalar ve yollar haritanın vektör karolarından (OpenFreeMap / OpenMapTiles, © OSM) alınır; anıt modelleri
// data/<il>/monuments.geojson (OSM building:part, kubbe / minare dilimleri). Yükseklikler gerçek ölçekte (abartısız).
const CITY_MAX = 12000;     // m — daha geniş bölgelerde bina / yol çizilmez
const ROAD_STYLE = {
  motorway: [22, 0xe8913a, 6], trunk: [18, 0xf0a64a, 6], primary: [14, 0xf6c95a, 5], secondary: [11, 0xf8e08a, 4], tertiary: [9, 0xffffff, 3],
  minor: [7, 0xfbfaf6, 2], service: [4.5, 0xf1eee8, 1], track: [3, 0xc8b08a, 1], path: [2.4, 0xd9c7a4, 0], rail: [3.2, 0x5b5b66, 3], transit: [3.2, 0x5b5b66, 3],
  pedestrian: [6, 0xe9dfcf, 2], raceway: [8, 0xffffff, 1], busway: [7, 0xfbfaf6, 2],
};
const KEY_ROADS = [["main", 0xf6c95a], ["street", 0xfbfaf6], ["path", 0xd9c7a4], ["rail", 0x5b5b66]];
function mergeGeos(geos) {
  // basit birleştirme (aynı malzemeli çok sayıda parçayı tek çizim çağrısına indirir)
  let n = 0;
  const flat = geos.map((g) => { const ng = g.index ? g.toNonIndexed() : g; n += ng.attributes.position.count; return ng; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = flat.some((g) => g.attributes.color) ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const g of flat) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (col && g.attributes.color) col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}
const xz = (m, lng, lat) => { const [u, v] = lngLatToUV(m, lng, lat); return [-W / 2 + u * W, -W / 2 + v * W, u, v]; };
function groundRange(m, ring) {
  let lo = Infinity, hi = -Infinity;
  const step = Math.max(1, Math.floor(ring.length / 8));
  for (let i = 0; i < ring.length; i += step) { const [, , u, v] = xz(m, ring[i][0], ring[i][1]); const h = heightAt(m, u, v); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  return [lo, hi];
}
function extrude(m, rings, b, h, sinkTo) {
  const shape = new THREE.Shape(rings[0].map(([lng, lat]) => { const [X, Z] = xz(m, lng, lat); return new THREE.Vector2(X, -Z); }));
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([lng, lat]) => { const [X, Z] = xz(m, lng, lat); return new THREE.Vector2(X, -Z); })));
  const [lo, hi] = groundRange(m, rings[0]);
  const base = (sinkTo ?? lo) + b;
  const top = hi + h;                       // eğimli arazide çatı yüksek taraftan ölçülür
  if (top - base < 0.01) return null;
  const g = new THREE.ExtrudeGeometry(shape, { depth: top - base, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  return g;
}
const polys = (geom) => (geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : []);
const inRegion = (m, ring) => ring.some(([lng, lat]) => { const [u, v] = lngLatToUV(m, lng, lat); return u > 0 && u < 1 && v > 0 && v < 1; });
// bloğun kenarından taşan bina / anıt parçası çizilmez
const allInside = (m, ring) => ring.every(([lng, lat]) => { const [u, v] = lngLatToUV(m, lng, lat); return u >= 0.002 && u <= 0.998 && v >= 0.002 && v <= 0.998; });

function buildCity(m) {
  if (m.city) { m.city.forEach((g) => { scene.remove(g); g.traverse((o) => { o.geometry?.dispose?.(); }); }); }
  m.city = [];
  m.cityInfo = { bld: 0, mon: 0, roads: {} };
  if (m.region.size > CITY_MAX) return;
  const vs = m.scale;                       // gerçek ölçek (m → sahne birimi)
  // anıt modelleri (kaplanan alanlar sıradan binalardan çıkarılır)
  const monCells = new Set();
  const cellOf = (lng, lat) => `${Math.round(lng * 3000)}|${Math.round(lat * 4000)}`;
  const monByColor = new Map();
  for (const f of m.monFeats || []) {
    for (const rings of polys(f.geometry)) {
      if (!allInside(m, rings[0])) continue;
      // taban = zemin + b, tepe = zemin + h (b, h: metre)
      const g = extrude(m, rings, (f.properties.b || 0) * vs, (f.properties.h || 10) * vs);
      if (!g) continue;
      const c = f.properties.c || "#e6dccb";
      if (!monByColor.has(c)) monByColor.set(c, []);
      monByColor.get(c).push(g);
      for (const [lng, lat] of rings[0]) monCells.add(cellOf(lng, lat));
      m.cityInfo.mon++;
    }
  }
  const monGroup = new THREE.Group(); monGroup.name = "mon";
  for (const [c, geos] of monByColor) {
    const mesh = new THREE.Mesh(mergeGeos(geos), new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.75, metalness: 0.05, transparent: true, opacity: 1 }));
    mesh.castShadow = mesh.receiveShadow = true;
    monGroup.add(mesh);
  }
  // binalar
  const bGeos = [];
  const seen = new Set();
  let tileFeats = [];
  try { tileFeats = map.querySourceFeatures("openmaptiles", { sourceLayer: "building" }); } catch { /* stil yok */ }
  for (const f of tileFeats) {
    if (bGeos.length > 14000) break;
    const p = f.properties || {};
    if (p.hide_3d) continue;
    for (const rings of polys(f.geometry)) {
      const r0 = rings[0];
      if (!r0 || r0.length < 4 || !allInside(m, r0)) continue;
      const key = r0.length + "|" + r0[0][0].toFixed(6) + "|" + r0[0][1].toFixed(6);
      if (seen.has(key)) continue;
      seen.add(key);
      let cx = 0, cy = 0; for (const [a, b] of r0) { cx += a; cy += b; } cx /= r0.length; cy /= r0.length;
      if (monCells.has(cellOf(cx, cy))) continue;
      const h = Math.max(3, +p.render_height || +p.height || 8), b = +p.render_min_height || 0;
      const g = extrude(m, rings, b * vs, h * vs);
      if (g) bGeos.push(g);
    }
  }
  const bldGroup = new THREE.Group(); bldGroup.name = "bld";
  if (bGeos.length) {
    const dark = ctx.isDark();
    const mesh = new THREE.Mesh(mergeGeos(bGeos), new THREE.MeshStandardMaterial({ color: dark ? 0xc9c3b8 : 0xeee8dc, roughness: 0.85, transparent: true, opacity: 1 }));
    mesh.castShadow = mesh.receiveShadow = true;
    bldGroup.add(mesh);
  }
  m.cityInfo.bld = bGeos.length;
  // yollar, sokaklar, yaya yolları / kaldırımlar, raylar — araziye serilmiş şeritler
  let roads = [];
  try { roads = map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" }); } catch { /* stil yok */ }
  const pos = [], col = [], idx = [];
  const tmpC = new THREE.Color();
  const seenR = new Set();
  const cell = W / (N - 1);
  for (const f of roads) {
    const p = f.properties || {};
    if (p.brunnel === "tunnel") continue;
    let cls = p.class;
    if (cls === "path" && /pedestrian/.test(p.subclass || "")) cls = "pedestrian";
    const st = ROAD_STYLE[cls];
    if (!st) continue;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const line of lines) {
      if (line.length < 2 || !inRegion(m, line)) continue;
      const key = cls + line.length + line[0][0].toFixed(6) + line[0][1].toFixed(6);
      if (seenR.has(key)) continue;
      seenR.add(key);
      const kind = cls === "rail" || cls === "transit" ? "rail" : cls === "path" || cls === "track" || cls === "pedestrian" ? "path" : ["motorway", "trunk", "primary", "secondary"].includes(cls) ? "main" : "street";
      m.cityInfo.roads[kind] = (m.cityInfo.roads[kind] || 0) + 1;
      const hw = Math.max(0.035, (st[0] * m.scale) / 2);
      const lift = 0.06 + st[2] * 0.004 + (p.brunnel === "bridge" ? 0.15 : 0);
      tmpC.setHex(st[1]);
      // noktaları arazi ızgarası aralığında sıklaştır (şerit araziyi izlesin)
      const pts = [];
      for (let i = 0; i < line.length; i++) {
        const [X, Z] = xz(m, line[i][0], line[i][1]);
        if (i) {
          const [pX, pZ] = pts[pts.length - 1];
          const n = Math.min(40, Math.floor(Math.hypot(X - pX, Z - pZ) / cell));
          for (let s = 1; s <= n; s++) pts.push([pX + ((X - pX) * s) / (n + 1), pZ + ((Z - pZ) * s) / (n + 1)]);
        }
        pts.push([X, Z]);
      }
      // blok dışına taşan kısımlar kesilir: yalnızca içteki ardışık nokta dizileri çizilir
      const lim = W / 2 - hw - 0.05;
      const runs = [[]];
      for (const q of pts) { if (Math.abs(q[0]) <= lim && Math.abs(q[1]) <= lim) runs[runs.length - 1].push(q); else if (runs[runs.length - 1].length) runs.push([]); }
      for (const run of runs) {
        if (run.length < 2) continue;
        const base = pos.length / 3;
        for (let i = 0; i < run.length; i++) {
          const [X, Z] = run[i];
          const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
          const y = heightAt(m, (X + W / 2) / W, (Z + W / 2) / W) + lift;
          pos.push(X - dz * hw, y, Z + dx * hw, X + dz * hw, y, Z - dx * hw);
          col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
          if (i) { const q = base + (i - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
        }
      }
    }
  }
  const roadGroup = new THREE.Group(); roadGroup.name = "roads";
  if (idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, transparent: true, opacity: 1 }));
    mesh.receiveShadow = true;
    roadGroup.add(mesh);
  }
  for (const g of [roadGroup, bldGroup, monGroup]) { scene.add(g); m.city.push(g); }
  syncCityToggles(m);
}
function syncCityToggles(m) {
  const show = { bld: $("dioBld").checked, mon: $("dioMon").checked, roads: $("dioRoads").checked };
  for (const g of m.city || []) g.visible = show[g.name];
  const ug = $("dioUnder").checked;
  for (const g of m.city || []) g.traverse((o) => { if (o.material) { o.material.opacity = ug ? 0.25 : 1; o.material.depthWrite = !ug; } });
  const has = { bld: m.cityInfo?.bld, mon: m.cityInfo?.mon, roads: Object.keys(m.cityInfo?.roads || {}).length };
  for (const [k, id] of [["bld", "dioBldW"], ["mon", "dioMonW"], ["roads", "dioRoadsW"]]) $(id).hidden = !has[k];
}

// --- diorama lejantı -----------------------------------------------------------------
function renderKey(m) {
  const L = lang(), esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hex = (n) => "#" + n.toString(16).padStart(6, "0");
  const sw = (c, label, cls = "") => `<li><i class="${cls}" style="background:${c}"></i>${esc(label)}</li>`;
  const base = ctx.base();
  const out = [];
  // yüzey
  let surf;
  if (base === "satellite") surf = `<ul>${sw("linear-gradient(135deg,#6d7b52,#b9a88f,#e8e1d3)", t("d.k.sat"))}</ul>`;
  else if (base === "vegetation") surf = `<ul>${ctx.lcClasses.map(([k, c]) => sw(c, t("lc." + k))).join("")}</ul>`;
  else {
    const stops = [];
    for (let q = 0; q <= 6; q++) { const h = m.hMin + ((m.hMax - m.hMin) * q) / 6; const [r, g, b] = rampColor(h); stops.push(`rgb(${r | 0},${g | 0},${b | 0})`); }
    surf = `<div class="dk-ramp" style="background:linear-gradient(90deg,${stops.join(",")})"></div><div class="dk-ramp-l"><span>${Math.round(m.hMin)} m</span><span>${Math.round(m.hMax)} m</span></div>`;
  }
  if (m.hasWater) surf += `<ul>${sw(ctx.isDark() ? "#3f6f95" : "#8fc1e3", t("lc.water"))}</ul>`;
  out.push(`<h4>${t("d.k.surface")}</h4>${surf}<ul>${sw("repeating-linear-gradient(180deg,#d9c3a0 0 3px,#a98462 3px 6px)", t("d.k.walls"))}</ul>`);
  // şehir
  const ci = m.cityInfo || {};
  if (ci.bld || ci.mon || Object.keys(ci.roads || {}).length) {
    const items = [];
    if (ci.bld) items.push(sw(ctx.isDark() ? "#c9c3b8" : "#eee8dc", `${t("d.k.bld")} (${ci.bld.toLocaleString(L)})`));
    if (ci.mon) items.push(sw("linear-gradient(135deg,#e6dccb 50%,#9aa3aa 50%)", t("d.k.mon")));
    for (const [k, c] of KEY_ROADS) if (ci.roads?.[k]) items.push(sw(hex(c), t("d.k.road." + k), "line"));
    out.push(`<h4>${t("d.k.city")}</h4><ul>${items.join("")}</ul>`);
  } else if (m.region.size <= CITY_MAX) out.push(`<p class="dk-note">${t("d.k.zoomCity")}</p>`);
  else out.push(`<p class="dk-note">${t("d.k.zoomCity")}</p>`);
  // noktalar
  const pts = [];
  if (ctx.tourStops().length) pts.push(sw("#b5532c", t("d.k.tour"), "dot"));
  const cats = [...new Set(ctx.activePoints().map((p) => p.cat))];
  for (const c of cats) pts.push(sw(ctx.groups[ctx.cats[c].group].color, ctx.cats[c].names[L] || ctx.cats[c].names.tr, "dot"));
  if (pts.length) out.push(`<h4>${t("d.k.points")}</h4><ul>${pts.join("")}</ul>`);
  // yeraltı
  if ($("dioUnder").checked) {
    const u = [];
    if (m.ugInfo?.length) {
      u.push(sw("#d9a066", t("d.sourced")), sw("#a8a29a", t("d.schematic")), sw("#9c6a3c", t("d.k.tunnel")), sw("#3a2412", t("d.k.shaft")));
      if (m.ugInfo.some((s) => s.type === "cistern")) u.push(sw("#e9dcc6", t("d.k.columns")));
    }
    if (m.resInfo?.length) {
      const exts = new Set(m.resInfo.map((r) => r.ext));
      for (const e of ["yeralti", "cozelti", "kuyu", "yerustu"]) if (exts.has(e)) u.push(sw(RES_KEY[e], t("d.k.res." + e)));
      u.push(sw("#c23b22", t("d.k.head")));
    }
    if (u.length) out.push(`<h4>${t("d.under")}</h4><ul>${u.join("")}</ul>`);
  }
  const km = m.region.size >= 10000 ? Math.round(m.region.size / 1000) : (m.region.size / 1000).toFixed(1);
  out.push(`<p class="dk-note">${t("d.k.scale").replace("{km}", km).replace("{x}", m.exag.toFixed(1))}</p>`);
  $("dioKeyBody").innerHTML = out.join("");
}

// --- aç / kapa -------------------------------------------------------------------
async function open() {
  ctx.closePanels();
  const r = region();
  $("diorama").hidden = false;
  document.documentElement.classList.add("dio-open");
  $("dioBusy").hidden = false;
  $("dioLegend").hidden = true;
  $("dioUnder").checked = false;
  $("dioKeyBody").hidden = innerWidth <= 720; $("dioKeyToggle").setAttribute("aria-expanded", String(innerWidth > 720));
  $("dioHint").textContent = t("d.hint");
  ensureRenderer();
  resize();
  cancelAnimationFrame(raf);
  disposeScene();
  try {
    const g = await buildGrid(r);
    const exag = parseFloat($("dioExag").value);
    const m = { ...g, region: r, scale: W / r.size, exag, labels: [] };
    const relief = (g.hMax - g.hMin) * m.scale;
    m.baseDepth = Math.max(5, W * 0.06 + relief * 0.15);
    const getJson = (f, d) => fetch(ctx.dataUrl + f).then((x) => (x.ok ? x.json() : d)).catch(() => d);
    const [ugData, resA, resB, mon] = await Promise.all([getJson("underground.json", { sites: [] }), getJson("yeralti_maden.geojson", { features: [] }),
      getJson("acik_ocak.geojson", { features: [] }), r.size <= CITY_MAX ? getJson("monuments.geojson", { features: [] }) : { features: [] }]);
    m.ugSites = ugData.sites || [];
    m.monFeats = mon.features || [];
    // kaynaklar: alanlar için etiket noktası (_pt) ve alan; noktalar doğrudan
    const area = new Map();
    for (const f of [...resA.features, ...resB.features]) if (/Polygon/.test(f.geometry.type)) area.set(f.properties.id, polyArea(f.geometry));
    m.resFeats = [...resA.features, ...resB.features].filter((f) => f.geometry.type === "Point")
      .map((f) => ({ properties: f.properties, _pt: f.geometry.coordinates, _area: area.get(f.properties.id) || 0 }));
    const inside = (lng, lat) => { const [u, v] = lngLatToUV(m, lng, lat); return u >= 0 && u <= 1 && v >= 0 && v <= 1; };
    // yeraltı varsa blok tabanını derinleştir
    if (m.ugSites.some((s) => inside(s.lng, s.lat)) || m.resFeats.some((f) => inside(f._pt[0], f._pt[1]))) m.baseDepth = Math.max(m.baseDepth, W * 0.24);
    const tex = await surfaceTexture(m);
    buildBlock(m, tex);
    model = m;
    // etiketler: tur durakları + açık lejant öğeleri (en fazla 120)
    ctx.tourStops().forEach((s, i) => addLabel(m, { lng: s.x, lat: s.y, text: `${i + 1}. ${s.n || ""}`, color: "#b5532c", cls: "tour", lift: 7 }));
    ctx.activePoints().slice(0, 120).forEach((p) => addLabel(m, { lng: p.lng, lat: p.lat, text: p.name, color: ctx.groups[ctx.cats[p.cat].group].color }));
    applyHeights(m);
    buildCity(m);
    renderKey(m);
    const km = (r.size / 1000).toFixed(r.size < 10000 ? 1 : 0);
    $("dioTitle").textContent = `${ctx.prov.names[lang()] || ctx.prov.names.tr} · ≈ ${km} × ${km} km`;
    fitCamera();
    controls.autoRotate = $("dioRotate").checked;
    controls.update();
    loop();
  } catch (e) {
    console.error(e);
    ctx.toast(String(e.message || e));
  } finally {
    $("dioBusy").hidden = true;
  }
}
function close() {
  cancelAnimationFrame(raf);
  $("diorama").hidden = true;
  document.documentElement.classList.remove("dio-open");
  disposeScene();
  model = null;
}

export function initDiorama(_map, _ctx) {
  map = _map; ctx = _ctx;
  $("btnDiorama").onclick = open;
  $("dioClose").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("diorama").hidden) close(); });
  $("dioUnder").onchange = (e) => setUnderground(e.target.checked);
  $("dioListToggle").onclick = () => setListOpen($("dioListBody").hidden);
  $("dioRotate").onchange = (e) => { if (controls) controls.autoRotate = e.target.checked; };
  $("dioLabels").onchange = (e) => { if (labelRenderer) labelRenderer.domElement.classList.toggle("hide", !e.target.checked); };
  for (const id of ["dioBld", "dioMon", "dioRoads"]) $(id).onchange = () => model && syncCityToggles(model);
  $("dioKeyToggle").onclick = () => {
    const open = $("dioKeyBody").hidden;
    $("dioKeyBody").hidden = !open; $("dioKeyToggle").setAttribute("aria-expanded", String(open));
    if (open && innerWidth <= 720) setListOpen(false);
  };
  $("dioExag").oninput = (e) => {
    $("dioExagV").textContent = parseFloat(e.target.value).toFixed(1) + "×";
    if (!model) return;
    model.exag = parseFloat(e.target.value);
    applyHeights(model);
    setUnderground($("dioUnder").checked);
  };
}
