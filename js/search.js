// Arama: data/<il>/search.json dizininde, Türkçe karakterlere duyarsız arama.
// "goreme" → Göreme, "kursunlu" → Kurşunlu Camii, "derin" → Derinkuyu …
import { t, lang } from "./i18n.js";

let index = null, ctx = null;
const $ = (id) => document.getElementById(id);

export function norm(s) {
  return String(s || "").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// arama önceliği: önce tarih/inanç/doğa, sonra diğerleri
const GROUP_RANK = { tarih: 0, inanc: 1, doga: 2, yerlesim: 3, ulasim: 4, kaynak: 5, hizmet: 6 };

async function load() {
  if (index) return index;
  const raw = await fetch(ctx.dataUrl + "search.json").then((r) => r.json()).catch(() => []);
  index = raw.map(([id, cat, x, y, name, alt, dist]) => ({
    id, cat, x, y, name, alt: alt || {}, dist: dist || "",
    hay: norm([name, ...Object.values(alt || {}), dist || ""].join(" ")),
    nameN: norm(name),
  }));
  return index;
}

function search(q) {
  const qn = norm(q);
  if (!qn) return [];
  const toks = qn.split(" ");
  const out = [];
  for (const e of index) {
    if (!toks.every((tk) => e.hay.includes(tk))) continue;
    let score = 3;
    if (e.nameN.startsWith(qn)) score = 0;
    else if ((" " + e.hay).includes(" " + toks[0])) score = 1;
    else if (e.hay.includes(qn)) score = 2;
    out.push([score, GROUP_RANK[ctx.cats[e.cat].group] ?? 9, e.name.length, e]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  // aynı ad + birbirine çok yakın (≈300 m) kayıtları tek göster (ör. hem "turistik" hem "kale" olarak işaretli)
  const res = [];
  for (const [, , , e] of out) {
    if (res.some((r) => r.nameN === e.nameN && Math.abs(r.x - e.x) < 0.004 && Math.abs(r.y - e.y) < 0.003)) continue;
    res.push(e);
    if (res.length >= 40) break;
  }
  return res;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render(list, q) {
  const ul = $("searchResults");
  if (!q.trim()) { ul.innerHTML = ""; return; }
  if (!list.length) { ul.innerHTML = `<li class="sr-empty">${t("noResults")}</li>`; return; }
  const L = lang();
  ul.innerHTML = list.map((e, i) => {
    const cat = ctx.cats[e.cat], g = ctx.groups[cat.group];
    const label = (L !== "tr" && e.alt[L]) || e.name;
    const icon = new URL(`icons/maki/${cat.icon}.svg`, location.href);
    return `<li><button data-i="${i}"><span class="pin" style="background:${g.color}"><i style="--icon:url(${icon})"></i></span>
      <span class="sr-text"><b>${esc(label)}</b><small>${esc(cat.names[L] || cat.names.tr)}${e.dist ? " · " + esc(e.dist) : ""}</small></span></button></li>`;
  }).join("");
  ul.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const e = list[+b.dataset.i];
    close();
    ctx.focus(e.cat, e.id);
  }));
}

function open() {
  ctx.closePanels();
  $("searchPanel").hidden = false;
  $("btnSearch").classList.add("on");
  const inp = $("searchInput");
  inp.placeholder = t("searchPh");
  inp.focus();
  inp.select();
  load();
}
function close() {
  $("searchPanel").hidden = true;
  $("btnSearch").classList.remove("on");
}

export function initSearch(_ctx) {
  ctx = _ctx;
  const inp = $("searchInput");
  let timer;
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { await load(); render(search(inp.value), inp.value); }, 120);
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter") $("searchResults").querySelector("button")?.click();
  });
  $("btnSearch").onclick = () => ($("searchPanel").hidden ? open() : close());
  $("searchClose").onclick = close;
  return { open, close };
}
