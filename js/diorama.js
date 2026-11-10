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
async function mosaic(tmpl, z, [x0, y0, x1, y1], outPx, fill, smooth = true) {
  const c = document.createElement("canvas");
  c.width = c.height = outPx;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, outPx, outPx); }
  g.imageSmoothingEnabled = smooth;
  const k = outPx / (x1 - x0);                // karo birimi → piksel
  const jobs = [];
  for (let tx = Math.floor(x0); tx < x1; tx++) for (let ty = Math.floor(y0); ty < y1; ty++) {
    const url = tmpl.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
    // karo sınırlarını tam piksele yuvarla (boşluk / üst üste binme olmasın)
    const px0 = Math.round((tx - x0) * k), py0 = Math.round((ty - y0) * k);
    const px1 = Math.round((tx + 1 - x0) * k), py1 = Math.round((ty + 1 - y0) * k);
    jobs.push(loadImage(url).then((img) => { if (img) g.drawImage(img, px0, py0, px1 - px0, py1 - py0); }));
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
    const tmpl = base === "satellite" ? SAT : new URL(ctx.dataUrl + "landcover/{z}/{x}/{y}.png", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}");
    // bitki örtüsü yalnızca il içinde var; dışını kabartmayla doldur
    const under = base === "vegetation" ? reliefTexture(m, true) : null;
    const c = await mosaic(tmpl, zTex, [cx - half, cy - half, cx + half, cy + half], 2048, base === "satellite" ? "#b9a88f" : null);
    if (!under) return c;
    const out = document.createElement("canvas"); out.width = out.height = 2048;
    const g = out.getContext("2d"); g.drawImage(under, 0, 0, 2048, 2048); g.globalAlpha = 0.9; g.drawImage(c, 0, 0);
    return out;
  }
  return reliefTexture(m, base === "terrain" && false);
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
function buildUnderground(m) {
  if (!m.ugGroup) return;
  m.ugGroup.clear();
  m.ugInfo = [];
  const sites = (m.ugSites || []).map((s) => ({ ...s, uv: lngLatToUV(m, s.lng, s.lat) }))
    .filter((s) => s.uv[0] >= 0 && s.uv[0] <= 1 && s.uv[1] >= 0 && s.uv[1] <= 1);
  if (!sites.length) return;
  // gerçek ölçekte 85 m bu blokta görünmez; derinlik ortak bir katsayıyla büyütülür (açıklamada yazar)
  const ref = Math.max(...sites.map((s) => s.depth_m || s.visit_depth_m || 0), 40);
  m.ugExag = Math.max(1, Math.round((W * 0.18) / (ref * m.scale)));
  const k2u = m.scale * m.ugExag;                       // metre → sahne birimi
  const matSourced = new THREE.MeshStandardMaterial({ color: 0xe07a3f, emissive: 0x5a1e00, transparent: true, opacity: 0.88, roughness: 0.6 });
  const matSchem = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, emissive: 0x222222, transparent: true, opacity: 0.6, roughness: 0.8 });
  for (const s of sites) {
    const [u, v] = s.uv, x = -W / 2 + u * W, z = -W / 2 + v * W, top = heightAt(m, u, v);
    const floors = s.floors || 4;
    // kat aralığı (m): önce "açık kısım derinliği / açık kat", yoksa "toplam derinlik / toplam kat", yoksa şematik
    let sp, sourcedUpTo;
    if (s.visit_depth_m && s.visit_floors) { sp = s.visit_depth_m / s.visit_floors; sourcedUpTo = s.visit_floors; }
    else if (s.depth_m && s.floors) { sp = s.depth_m / s.floors; sourcedUpTo = s.floors; }
    else { sp = (ref * 0.6) / floors; sourcedUpTo = 0; }
    const r = Math.max(1.6, Math.min(4, W * 0.025));
    for (let k = 0; k < floors; k++) {
      const sourced = k < sourcedUpTo;
      const y = top - (k + 0.6) * sp * k2u;
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(r * (1 - k * 0.035), r * (1 - k * 0.035), Math.max(0.25, sp * k2u * 0.45), 24), sourced ? matSourced : matSchem);
      slab.position.set(x, y, z);
      m.ugGroup.add(slab);
    }
    const floorsBottom = floors * sp;                   // metre
    const total = Math.max(floorsBottom, s.depth_m || 0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, floorsBottom * k2u + 1, 8), new THREE.MeshBasicMaterial({ color: 0x3a2412 }));
    shaft.position.set(x, top - (floorsBottom * k2u) / 2, z);
    m.ugGroup.add(shaft);
    // katların altında kalan, kaynakta geçen toplam derinlik (ör. Derinkuyu: açık 8 kat ≈ 55 m, toplam ≈ 85 m)
    if (s.depth_m && s.depth_m > floorsBottom + 1) {
      const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.12, (s.depth_m - floorsBottom) * k2u, 10), matSourced);
      ext.position.set(x, top - (floorsBottom + (s.depth_m - floorsBottom) / 2) * k2u, z);
      m.ugGroup.add(ext);
    }
    const L = lang();
    const line2 = [`${floors} ${t("d.floors")}`, s.depth_m ? `${t("d.total")} ~${s.depth_m} m` : t("d.totalUnknown")];
    const line3 = [];
    if (s.visit_floors) line3.push(`${t("d.visit")}: ${s.visit_floors} ${t("d.floors")}${s.visit_depth_m ? ` (~${s.visit_depth_m} m)` : ""}`);
    if (sourcedUpTo < floors) line3.push(sourcedUpTo ? `${sourcedUpTo + 1}–${floors}. ${t("d.floors")}: ${t("d.schematic")}` : t("d.schematic"));
    const el = document.createElement("div");
    el.className = "dio-ug";
    el.innerHTML = `<b></b><small></small><small></small>`;
    const [b, sm1, sm2] = el.children;
    b.textContent = s.name; sm1.textContent = line2.join(" · "); sm2.textContent = line3.join(" · ");
    sm2.style.display = line3.length ? "block" : "none";
    const lbl = new CSS2DObject(el);
    lbl.visible = m.ugGroup.visible;   // CSS2D etiketleri üst grubun görünürlüğüne bakmaz
    lbl.position.set(x + r + 1, top - total * k2u * 0.45, z);
    m.ugGroup.add(lbl);
    m.ugInfo.push({ ...s, note: s.notes?.[L] || s.notes?.tr });
  }
}
function setUnderground(on) {
  if (!model) return;
  const m = model;
  m.ugGroup.visible = on;
  m.ugGroup.traverse((o) => { if (o.isCSS2DObject) o.visible = on; });
  m.terrain.material.opacity = on ? 0.32 : 1;
  m.terrain.material.depthWrite = !on;
  m.wallMat.opacity = on ? 0.35 : 1;
  m.wallMat.depthWrite = !on;
  m.labels.forEach((l) => (l.obj.element.style.opacity = on ? 0.45 : 1));
  const lg = $("dioLegend");
  if (!on) { lg.hidden = true; return; }
  if (!m.ugInfo?.length) { lg.innerHTML = `<p>${t("d.underNone")}</p>`; lg.hidden = false; return; }
  const srcs = [...new Map(m.ugInfo.flatMap((s) => s.sources || []).map((s) => [s.url, s])).values()];
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  lg.innerHTML = `<p><b>${t("d.depthNote").replace("{x}", m.ugExag)}</b> ${t("d.spacing")}</p>
    <p class="sw"><i style="background:#e07a3f"></i>${t("d.sourced")}<i style="background:#9a9a9a"></i>${t("d.schematic")}</p>
    ${m.ugInfo.map((s) => `<p class="ug-note"><b>${esc(s.name)}:</b> ${esc(s.note || "")}</p>`).join("")}
    <ul>${srcs.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>`;
  lg.hidden = false;
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
    const ugData = await fetch(ctx.dataUrl + "underground.json").then((x) => x.json()).catch(() => ({ sites: [] }));
    m.ugSites = ugData.sites || [];
    // yeraltı varsa blok tabanını derinleştir
    if (m.ugSites.some((s) => { const [u, v] = lngLatToUV(m, s.lng, s.lat); return u >= 0 && u <= 1 && v >= 0 && v <= 1; })) m.baseDepth = Math.max(m.baseDepth, W * 0.24);
    const tex = await surfaceTexture(m);
    buildBlock(m, tex);
    model = m;
    // etiketler: tur durakları + açık lejant öğeleri (en fazla 120)
    ctx.tourStops().forEach((s, i) => addLabel(m, { lng: s.x, lat: s.y, text: `${i + 1}. ${s.n || ""}`, color: "#b5532c", cls: "tour", lift: 7 }));
    ctx.activePoints().slice(0, 120).forEach((p) => addLabel(m, { lng: p.lng, lat: p.lat, text: p.name, color: ctx.groups[ctx.cats[p.cat].group].color }));
    applyHeights(m);
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
  $("dioRotate").onchange = (e) => { if (controls) controls.autoRotate = e.target.checked; };
  $("dioLabels").onchange = (e) => { if (labelRenderer) labelRenderer.domElement.classList.toggle("hide", !e.target.checked); };
  $("dioExag").oninput = (e) => {
    $("dioExagV").textContent = parseFloat(e.target.value).toFixed(1) + "×";
    if (!model) return;
    model.exag = parseFloat(e.target.value);
    applyHeights(model);
    setUnderground($("dioUnder").checked);
  };
}
