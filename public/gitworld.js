/* GitWorld: walk through any public GitHub repo as a pixel cat, together. Git it together at GitWorld. */
(() => {
'use strict';
const E = window.GW;
const { T, C, mk, R, box, text, textW, ring, glow, catSprite, drawAcc, player } = E;
const $ = id => document.getElementById(id);
const ACC = '#3dffc0';
const API = 'https://api.github.com', RAW = 'https://raw.githubusercontent.com';
const PER_PAGE = 60, MAX_FILE = 200 * 1024, LAZY_KB = 150000;
const POPULAR = [['samsagewize/rain-world', 'Rain\u2019s World, the pixel world GitWorld grew from'], ['vercel/next.js', 'Huge: the React framework'], ['solana-labs/solana', 'Solana validator (archived)'], ['torvalds/linux', 'Gigantic: the Linux kernel'], ['facebook/react', 'The UI library'], ['microsoft/vscode', 'Visual Studio Code']];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n | 0);
const fmtB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const trunc = (s, n) => s.length > n ? s.slice(0, n - 2) + '..' : s;
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const baseName = p => p.slice(p.lastIndexOf('/') + 1);
const dirName = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// pixel font only knows a small charset; everything else becomes '?'
const pix = s => String(s).toUpperCase().replace(/[^A-Z0-9 $!?.\-'&:_/()+#@,=[\]*%<>~|";{}^]/g, '?');

// ---------- local storage helpers ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('gw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gw.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
function cacheGet(k) { try { const s = localStorage.getItem('gwc.' + k); if (!s) return null; const o = JSON.parse(s); if (Date.now() > o.x) { localStorage.removeItem('gwc.' + k); return null; } return o.v; } catch (e) { return null; } }
function cacheSet(k, v, ttl) {
  let s; try { s = JSON.stringify({ x: Date.now() + ttl, v }); } catch (e) { return; }
  if (s.length > 2500000) return;
  for (let i = 0; i < 3; i++) { try { localStorage.setItem('gwc.' + k, s); return; } catch (e) { pruneCache(); } }
}
function pruneCache() { try { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gwc.')) ks.push(k); } ks.sort((a, b) => (JSON.parse(localStorage.getItem(a)).x) - (JSON.parse(localStorage.getItem(b)).x)); ks.slice(0, Math.max(1, ks.length >> 1)).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ } }

// ---------- session ----------
const ME = { auth: false, rt: false, store: null, user: null, profile: null, building: null, loaded: false };
async function loadMe() {
  try { const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }); if (r.ok) Object.assign(ME, await r.json()); } catch (e) { /* static mode */ }
  ME.loaded = true; renderAuth();
}

// ---------- GitHub data (signed in: our server proxy with your token; guests: straight from the browser, 60/hr) ----------
const RATE = { remaining: null, limit: 60, reset: 0, via: 'direct' };
const mem = new Map();
function compactTree(d) { return { truncated: !!d.truncated, t: (d.tree || []).map(e => [e.path, e.type === 'tree' ? 't' : e.type === 'commit' ? 'c' : 'b', e.size || 0, e.type === 'tree' ? e.sha : '']) }; }
async function gh(path, ttl = 30 * 60e3) {
  if (mem.has(path)) return mem.get(path);
  const c = cacheGet(path); if (c) { const res = { ok: true, status: 200, data: c }; mem.set(path, res); return res; }
  let res = null;
  if (ME.user) {
    try {
      const r = await fetch('/api/gh?p=' + encodeURIComponent(path), { credentials: 'same-origin' });
      if (r.status !== 401 && r.status !== 503) { res = await toRes(r, 'proxy'); }
    } catch (e) { /* fall back to direct */ }
  }
  if (!res) { try { res = await toRes(await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } }), 'direct'); } catch (e) { return { ok: false, kind: 'network', msg: 'Could not reach GitHub. Check your connection.' }; } }
  if (res.ok) { if (path.includes('/git/trees/')) res.data = compactTree(res.data); cacheSet(path, res.data, ttl); mem.set(path, res); }
  return res;
}
async function toRes(r, via) {
  const rem = r.headers.get('x-ratelimit-remaining'), reset = r.headers.get('x-ratelimit-reset'), lim = r.headers.get('x-ratelimit-limit');
  if (rem != null) { RATE.remaining = +rem; RATE.reset = +reset * 1000; RATE.limit = +lim || RATE.limit; RATE.via = via; }
  let data = null; try { data = await r.json(); } catch (e) { /* empty */ }
  if (r.ok) return { ok: true, status: r.status, data };
  const limited = (r.status === 403 || r.status === 429) && (rem === '0' || /rate limit/i.test((data && data.message) || ''));
  if (limited) return { ok: false, status: r.status, kind: 'ratelimit', reset: (+reset * 1000) || Date.now() + 3600e3 };
  if (r.status === 404) return { ok: false, status: 404, kind: 'notfound' };
  if (r.status === 409) return { ok: false, status: 409, kind: 'empty' };
  return { ok: false, status: r.status, kind: 'other', msg: (data && data.message) || ('GitHub said ' + r.status) };
}
const rawUrl = (Rp, p) => RAW + '/' + encPath(Rp.full) + '/' + encPath(Rp.branch) + '/' + encPath(p);
const blobUrl = (Rp, p) => 'https://github.com/' + Rp.full + '/blob/' + encPath(Rp.branch) + '/' + encPath(p);
const treeUrl = (Rp, p) => 'https://github.com/' + Rp.full + (p ? '/tree/' + encPath(Rp.branch) + '/' + encPath(p) : '');
const rawMem = new Map();
async function rawText(Rp, p, max = MAX_FILE) {
  const k = Rp.full + '@' + Rp.branch + ':' + p; if (rawMem.has(k)) return rawMem.get(k);
  const r = await fetch(rawUrl(Rp, p)); if (!r.ok) throw new Error('HTTP ' + r.status);
  let t = await r.text(); if (t.length > max) t = t.slice(0, max);
  rawMem.set(k, t); return t;
}

// ---------- repo model ----------
const repos = new Map();
function emptyDir() { return { dirs: [], files: [], count: 0 }; }
function fromEntries(list, base) {
  const L = emptyDir();
  for (const [p, ty, size, sha] of list) { const name = base ? p : p; const nm = baseName(name);
    if (ty === 't') L.dirs.push({ name: nm, path: base ? base + '/' + nm : nm, sha, count: -1 }); else L.files.push({ name: nm, path: base ? base + '/' + nm : nm, size, sub: ty === 'c' }); }
  sortDir(L); return L;
}
function sortDir(L) { const cmp = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); L.dirs.sort(cmp); L.files.sort(cmp); L.count = L.dirs.length + L.files.length; }
async function loadRepo(full) {
  const key = full.toLowerCase(); if (repos.has(key)) return { ok: true, repo: repos.get(key) };
  const ir = await gh('/repos/' + full); if (!ir.ok) return ir;
  const i = ir.data;
  const Rp = { full: i.full_name, owner: i.owner.login, name: i.name, info: i, branch: i.default_branch || 'main', lazy: i.size > LAZY_KB, truncated: false, empty: false, dirs: new Map() };
  if (!Rp.lazy) {
    const tr = await gh('/repos/' + i.full_name + '/git/trees/' + encodeURIComponent(Rp.branch) + '?recursive=1');
    if (!tr.ok && tr.kind === 'empty') { Rp.empty = true; Rp.dirs.set('', emptyDir()); }
    else if (!tr.ok && tr.kind !== 'notfound') return tr;
    else if (!tr.ok || tr.data.truncated) { Rp.lazy = true; Rp.truncated = true; }
    else {
      const D = Rp.dirs; D.set('', emptyDir());
      for (const [p, ty] of tr.data.t) if (ty === 't') D.set(p, emptyDir());
      for (const [p, ty, size] of tr.data.t) { const par = D.get(dirName(p)); if (!par) continue; const nm = baseName(p);
        if (ty === 't') par.dirs.push({ name: nm, path: p, count: 0 }); else par.files.push({ name: nm, path: p, size, sub: ty === 'c' }); }
      for (const L of D.values()) { sortDir(L); for (const d of L.dirs) d.count = (D.get(d.path) || emptyDir()).dirs.length + (D.get(d.path) || emptyDir()).files.length; }
    }
  } else Rp.truncated = true;
  repos.set(key, Rp);
  return { ok: true, repo: Rp };
}
async function listing(Rp, path) {
  if (Rp.dirs.has(path)) return { ok: true, L: Rp.dirs.get(path) };
  if (!Rp.lazy) return { ok: false, kind: 'nopath' };
  let sha;
  if (!path) sha = Rp.branch;
  else { const pr = await listing(Rp, dirName(path)); if (!pr.ok) return pr; const d = pr.L.dirs.find(x => x.name === baseName(path)); if (!d) return { ok: false, kind: 'nopath' }; sha = d.sha; }
  const tr = await gh('/repos/' + Rp.full + '/git/trees/' + encodeURIComponent(sha));
  if (!tr.ok) return tr.kind === 'empty' ? { ok: true, L: emptyDir() } : tr;
  const L = fromEntries(tr.data.t, path); Rp.dirs.set(path, L);
  return { ok: true, L };
}
function parseRepoInput(s) {
  s = String(s || '').trim().replace(/^git@github\.com:/i, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/[?#].*$/, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const seg = s.split('/').filter(Boolean); if (seg.length < 2) return null;
  const [o, r] = seg; if (!OWNER_RE.test(o) || !REPO_RE.test(r) || r === '.' || r === '..') return null;
  let path = '';
  if ((seg[2] === 'tree' || seg[2] === 'blob') && seg.length > 4) path = seg.slice(4).join('/');
  return { full: o + '/' + r, path: safePath(path), file: seg[2] === 'blob' };
}
function safePath(p) { return String(p || '').split('/').filter(x => x && x !== '.' && x !== '..').join('/').slice(0, 400); }

// ---------- sprite factory (cached canvases) ----------
const spr = new Map();
function sprite(key, w, h, fn) { if (spr.has(key)) return spr.get(key); const [c, g] = mk(w, h); fn(g); spr.set(key, c); return c; }
const HUES = [['#2f6f8f', '#3f8fb0', '#1d4a60'], ['#6b4f9f', '#8a6cc4', '#45306c'], ['#2e7d63', '#3fa07f', '#1d5442'], ['#8f5a3a', '#b0744e', '#5e3a24'], ['#7a3f5f', '#9c5580', '#4f2840'], ['#4a5a9a', '#5f72c0', '#2f3a66'], ['#7d7a3a', '#a09c4e', '#52501f'], ['#3a6f7d', '#4e93a5', '#244852']];
function labelBox(g, s, cx, y, col = C.ink, bg = '#0b0e1cdd') { s = pix(s); const w = textW(s) + 6; box(g, Math.round(cx - w / 2), y, w, 9, bg, col); text(g, s, Math.round(cx - w / 2 + 3), y + 2, col); }
// folder building: walls, windows by item count, roof in the folder's color, door
function buildingSprite(name, floors, wide) {
  const hue = HUES[hash(name) % HUES.length], W = wide ? 64 : 48, H = 22 + floors * 11;
  return sprite('b' + name + floors + W, W, H + 8, g => {
    R(g, 2, H + 4, W - 4, 3, 'rgba(0,0,0,0.35)');
    box(g, 3, 8, W - 6, H - 4, C.wall);
    R(g, 4, 9, W - 8, 2, C.wall2);
    for (let f = 0; f < floors; f++) for (let i = 0; i < (wide ? 5 : 3); i++) {
      const lit = (hash(name + f + i) % 3) > 0;
      box(g, 8 + i * 12, 14 + f * 11, 7, 6, lit ? '#ffe9a8' : C.glass, C.out); if (lit) R(g, 9 + i * 12, 15 + f * 11, 2, 1, '#fff7d6');
    }
    // roof
    R(g, 0, 2, W, 7, C.out); R(g, 1, 3, W - 2, 5, hue[0]); R(g, 1, 3, W - 2, 1, hue[1]); R(g, 1, 7, W - 2, 1, hue[2]);
    R(g, 6, 0, W - 12, 3, C.out); R(g, 7, 1, W - 14, 2, hue[1]);
    // folder tab on the roof
    R(g, 8, 0, 10, 2, C.yellow);
    // door
    const dx = (W >> 1) - 5; box(g, dx, H - 7, 10, 11, '#1a1f36', C.out); R(g, dx + 2, H - 5, 6, 8, hue[2]); R(g, dx + 7, H - 1, 1, 1, C.yellow);
    R(g, dx - 2, H + 3, 14, 2, C.edge);
  });
}
const EXT = {
  code: /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|swift|php|lua|sh|bash|zsh|ps1|pl|r|scala|dart|ex|exs|erl|hs|clj|vue|svelte|sol|zig|nim|asm|s|m|mm|fs|vb|groovy|gradle|cmake|mk|makefile|dockerfile)$/i,
  doc: /\.(md|mdx|markdown|txt|rst|adoc|org|tex|rtf)$/i,
  img: /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i,
  data: /\.(json|ya?ml|toml|xml|csv|tsv|ini|cfg|conf|env|lock|sql|graphql|gql|proto|plist|properties)$/i,
  web: /\.(html?|css|scss|sass|less|styl)$/i
};
function fileKind(name) {
  const n = name.toLowerCase();
  if (/^(readme|license|licence|changelog|contributing|authors|notice|copying)(\.|$)/.test(n)) return 'doc';
  if (/^(dockerfile|makefile|gemfile|rakefile|procfile|justfile)$/.test(n)) return 'code';
  if (/^\.(gitignore|gitattributes|editorconfig|npmrc|nvmrc|prettierrc|eslintrc|babelrc)/.test(n)) return 'data';
  for (const k in EXT) if (EXT[k].test(n)) return k;
  if (/\.(zip|tar|gz|tgz|7z|rar|bin|exe|dll|so|dylib|wasm|woff2?|ttf|otf|eot|mp3|mp4|wav|ogg|mov|webm|pdf|psd|jar|class|pyc)$/.test(n)) return 'bin';
  return 'misc';
}
const KIND_COL = { code: C.mint, doc: C.ink, img: C.pink, data: C.yellow, web: C.sky, bin: '#9aa0b3', misc: C.purple, sub: C.orange };
function fileSprite(kind) {
  return sprite('f' + kind, 20, 24, g => {
    R(g, 3, 21, 14, 2, 'rgba(0,0,0,0.35)');
    const c = KIND_COL[kind];
    if (kind === 'code') { box(g, 3, 4, 14, 12, '#11162a'); R(g, 4, 5, 12, 10, '#06070f'); R(g, 5, 7, 4, 1, c); R(g, 6, 9, 6, 1, '#6c789e'); R(g, 6, 11, 4, 1, c); R(g, 5, 13, 2, 1, C.ink); box(g, 8, 16, 4, 3, C.wall); box(g, 5, 19, 10, 3, C.wall2); }
    else if (kind === 'doc') { box(g, 4, 3, 12, 17, '#f3ead2'); R(g, 3, 2, 14, 3, '#c9b98e'); R(g, 3, 19, 14, 3, '#c9b98e'); for (let i = 0; i < 4; i++) R(g, 6, 7 + i * 3, 8 - (i % 2) * 3, 1, '#7a6a4a'); }
    else if (kind === 'img') { box(g, 3, 6, 14, 14, '#8f5a3a'); R(g, 4, 7, 12, 12, '#b0744e'); box(g, 5, 8, 10, 8, '#6bc6ff'); R(g, 6, 13, 3, 2, '#7ad97a'); R(g, 9, 11, 4, 4, '#2e7d63'); R(g, 12, 9, 2, 2, C.yellow); }
    else if (kind === 'data') { box(g, 3, 3, 14, 18, '#4a5390'); for (let i = 0; i < 3; i++) { box(g, 4, 4 + i * 6, 12, 5, '#5f6cb0'); R(g, 8, 6 + i * 6, 4, 1, c); } }
    else if (kind === 'web') { box(g, 3, 2, 14, 19, '#1b5a5c'); R(g, 4, 3, 12, 3, c); R(g, 5, 4, 1, 1, C.red); R(g, 7, 4, 1, 1, C.yellow); box(g, 5, 8, 10, 8, '#06070f'); text(g, '<>', 6, 10, c); R(g, 8, 18, 4, 2, C.ink); }
    else if (kind === 'bin') { box(g, 3, 7, 14, 13, '#5a5f73'); R(g, 3, 7, 14, 3, '#7a8096'); R(g, 9, 7, 2, 13, '#3b4052'); R(g, 6, 13, 8, 3, '#3b4052'); }
    else if (kind === 'sub') { box(g, 4, 4, 12, 16, C.orange2); R(g, 5, 5, 10, 3, C.orange); ring(g, 10, 13, 3, C.ink); R(g, 9, 12, 2, 2, C.yellow); }
    else { box(g, 4, 5, 12, 15, '#3b2f63'); R(g, 5, 6, 10, 3, c); R(g, 7, 11, 6, 6, '#24193f'); R(g, 9, 13, 2, 2, c); }
  });
}
function portalSprite(col, kind) {
  return sprite('p' + col + kind, 36, 44, g => {
    R(g, 2, 40, 32, 3, 'rgba(0,0,0,0.35)');
    box(g, 2, 6, 6, 36, C.wall2); box(g, 28, 6, 6, 36, C.wall2); box(g, 0, 2, 36, 7, C.wall); R(g, 1, 3, 34, 2, col);
    R(g, 8, 9, 20, 33, '#0b2b2a'); R(g, 9, 10, 18, 31, kind === 'back' ? '#2a1d3f' : '#0f3a35');
    for (let i = 0; i < 6; i++) R(g, 10 + (i * 5) % 16, 13 + i * 5, 2, 2, col);
    if (kind === 'back') { R(g, 13, 24, 8, 2, C.ink); R(g, 13, 22, 2, 6, C.ink); R(g, 12, 23, 1, 4, C.ink); }
    else if (kind === 'next') { R(g, 14, 24, 8, 2, C.ink); R(g, 21, 22, 2, 6, C.ink); R(g, 23, 23, 1, 4, C.ink); }
    else if (kind === 'prev') { R(g, 14, 24, 8, 2, C.ink); R(g, 13, 22, 2, 6, C.ink); R(g, 12, 23, 1, 4, C.ink); }
    else { E.text(g, 'GH', 13, 22, C.ink); }
  });
}
function readmeSprite() {
  return sprite('readme', 40, 36, g => {
    R(g, 4, 33, 32, 2, 'rgba(0,0,0,0.35)');
    box(g, 18, 18, 4, 16, '#5e3a24'); box(g, 1, 2, 38, 20, '#8f5a3a'); R(g, 2, 3, 36, 18, '#f3ead2');
    E.text(g, 'README', 8, 5, '#5e3a24'); for (let i = 0; i < 3; i++) R(g, 5, 12 + i * 3, 30 - i * 6, 1, '#7a6a4a');
  });
}
function boardSprite() {
  return sprite('board', 44, 40, g => {
    R(g, 4, 37, 36, 2, 'rgba(0,0,0,0.35)');
    box(g, 4, 20, 4, 18, '#5e3a24'); box(g, 36, 20, 4, 18, '#5e3a24'); box(g, 0, 2, 44, 26, '#5e3a24'); R(g, 2, 4, 40, 22, '#b0744e');
    const notes = [[4, 6, C.yellow], [16, 8, C.ink], [28, 5, C.pink], [8, 16, C.sky], [22, 17, '#7ad97a'], [33, 15, C.ink]];
    for (const [x, y, c] of notes) { R(g, x, y, 9, 7, c); R(g, x + 1, y + 2, 6, 1, '#7a6a4a'); R(g, x + 1, y + 4, 4, 1, '#7a6a4a'); R(g, x + 4, y, 1, 1, C.red); }
  });
}
function statueSprite(lv) {
  const H = 26 + lv * 6;
  return sprite('statue' + lv, 34, H + 6, g => {
    R(g, 2, H + 2, 30, 3, 'rgba(0,0,0,0.35)');
    box(g, 4, H - 10, 26, 12, '#4a5390'); R(g, 5, H - 9, 24, 2, '#5f6cb0'); box(g, 9, H - 14 - lv * 4, 16, 6 + lv * 4, '#3b4580');
    const cy = H - 22 - lv * 4, cx = 17, r = 6 + lv;
    for (let y = -r; y <= r; y++) { const w = Math.round(y < 0 ? (r + y) * 0.5 + 1 : r - (y * 0.35)); R(g, cx - Math.max(1, w), cy + y, Math.max(1, w) * 2, 1, C.yellow); }
    for (let x = -r - 2; x <= r + 2; x++) if (Math.abs(x) <= r + 2) R(g, cx + x, cy - Math.round(r * 0.15), 1, 2, C.yellow);
    R(g, cx - 1, cy - 2, 2, 2, '#fff3b0');
  });
}
function kioskSprite(col) {
  return sprite('kiosk' + col, 24, 34, g => {
    R(g, 2, 31, 20, 2, 'rgba(0,0,0,0.35)');
    box(g, 4, 6, 16, 26, C.wall); R(g, 5, 7, 14, 2, col); box(g, 6, 11, 12, 9, '#06070f'); R(g, 8, 13, 2, 2, col); R(g, 12, 13, 4, 1, C.ink); R(g, 12, 16, 3, 1, '#6c789e');
    R(g, 2, 2, 20, 5, C.out); R(g, 3, 3, 18, 3, col); box(g, 8, 23, 8, 3, '#2a3150');
  });
}
function treeSprite(v) {
  return sprite('tree' + v, 20, 28, g => {
    R(g, 3, 25, 14, 2, 'rgba(0,0,0,0.35)'); box(g, 8, 16, 4, 10, '#4a3626');
    const a = v ? '#1f6e5a' : '#2e7d63', b = v ? '#2bb894' : '#3fa07f';
    for (let y = 0; y < 16; y++) { const w = Math.round(Math.sin((y + 1) / 17 * Math.PI) * 9); R(g, 10 - w, 1 + y, w * 2, 1, y < 6 ? b : a); }
    R(g, 6, 5, 2, 2, '#7af2c8');
  });
}
function lampSprite() { return sprite('lamp', 10, 30, g => { R(g, 1, 28, 8, 2, 'rgba(0,0,0,0.35)'); box(g, 4, 8, 2, 21, '#4a5390'); box(g, 1, 2, 8, 7, '#3b4580'); R(g, 2, 3, 6, 5, '#d9fff0'); }); }

// ---------- world builder ----------
function newWorld(id, tw, th, paint) {
  const w = { id, w: tw * T, h: th * T, tw, th, solids: [], props: [], overhead: [], lights: [], targets: [], npcs: [], stars: true };
  w.isVoid = (tx, ty) => tx < 0 || ty < 0 || tx >= tw || ty >= th || paint(tx, ty) === 'void';
  const [gc, g] = mk(w.w, w.h);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const k = paint(tx, ty), x = tx * T, y = ty * T, n = hash(tx + ',' + ty);
    if (k === 'void') { R(g, x, y, T, T, C.void); if (n % 7 === 0) R(g, x + (n % 13), y + (n >> 4) % 13, 1, 1, C.star);
      if (ty > 0 && paint(tx, ty - 1) !== 'void') { R(g, x, y, T, 3, C.shore); R(g, x, y + 3, T, 2, '#12352f'); }
      continue; }
    if (k === 'street') { R(g, x, y, T, T, C.path); R(g, x, y, T, 1, C.path2); if (n % 5 === 0) R(g, x + 3, y + 7, 2, 1, C.edge); }
    else if (k === 'plaza') { R(g, x, y, T, T, (tx + ty) % 2 ? C.plaza : C.plaza2); R(g, x, y, T, 1, '#3a4364'); R(g, x, y, 1, T, '#3a4364'); }
    else if (k === 'island') { R(g, x, y, T, T, n % 2 ? C.vil1 : C.vil2); if (n % 6 === 0) R(g, x + n % 12, y + (n >> 3) % 12, 2, 1, C.vilTuft); }
    else if (k === 'lane') { R(g, x, y, T, T, C.path); R(g, x + 7, y, 2, T, (ty % 2) ? C.lane : C.path); }
    else if (k === 'bridge') { R(g, x, y, T, T, '#3a2a1e'); for (let i = 0; i < 4; i++) R(g, x, y + i * 4, T, 1, '#5e3a24'); R(g, x, y, T, 1, '#8f5a3a'); R(g, x, y + T - 1, T, 1, '#8f5a3a'); }
    else { R(g, x, y, T, T, [C.g1, C.g2, C.g3][n % 3]); if (n % 9 === 0) { R(g, x + n % 12, y + (n >> 4) % 12, 1, 2, C.tuft); R(g, x + n % 12 + 1, y + (n >> 4) % 12 + 1, 1, 1, C.tuft2); } }
  }
  w.ground = gc; w.paint = paint;
  w.put = (img, cx, by, solid) => { const x = Math.round(cx - img.width / 2), y = by - img.height; w.props.push({ y: by - 4, draw: g2 => g2.drawImage(img, x, y) }); if (solid) w.solids.push({ x: cx - solid[0] / 2, y: by - 4 - solid[1], w: solid[0], h: solid[1] }); };
  w.tag = (s, cx, y, col) => w.overhead.push(g2 => { if (Math.abs(cx - player.x) < 220 && Math.abs(y - player.y) < 180) labelBox(g2, s, cx, y, col); });
  w.light = (x, y, r, col, a = 0.5, o = {}) => w.lights.push(Object.assign({ x, y, r, col, a }, o));
  w.tree = (tx, ty) => w.put(treeSprite(hash(tx + 'x' + ty) % 2), tx * T + 8, ty * T + 14, [6, 4]);
  w.lamp = (x, y) => { w.put(lampSprite(), x, y, [4, 3]); w.light(x, y - 24, 26, '#9fffe0', 0.45, { flick: true }); };
  return w;
}
function withGo(list) { return list.map(p => p.go ? p : Object.assign(p, { go: () => { player.x = p.x; player.y = p.y; player.dir = 'up'; E.stopInput(); } })); }
function target(w, t) { const o = Object.assign({ r: 26, kind: 'item', tapR: 30 }, t); w.targets.push(o); return o; }

// ---------- navigation state ----------
let cur = { kind: 'hub' };
let navToken = 0;
const roomId = () => cur.kind === 'repo' ? (cur.repo.full + '|' + cur.path.slice(0, 200) + '|' + cur.page).toLowerCase() : cur.kind === 'hub' ? 'hub' : cur.kind === 'city' ? 'city|' + (cur.page | 0) : cur.kind === 'bld' ? 'b|' + cur.login.toLowerCase() : 'err';
function urlFor(st) {
  if (st.kind === 'city') return '/city' + (st.page ? '?page=' + (st.page + 1) : '');
  if (st.kind === 'bld') return '/b/' + encodeURIComponent(st.login);
  if (st.kind !== 'repo') return '/';
  const q = new URLSearchParams(); q.set('repo', st.repo.full);
  if (st.path) q.set('path', st.path); if (st.page) q.set('page', String(st.page + 1)); if (st.file) q.set('file', st.file);
  return '/?' + q.toString().replace(/%2F/g, '/');
}
function syncURL(push, file) {
  const st = Object.assign({}, cur, { file }); const u = urlFor(st);
  if (u === location.pathname + location.search) return;
  const state = cur.kind === 'repo' ? { repo: cur.repo.full, path: cur.path, page: cur.page, file } : cur.kind === 'city' ? { city: 1, page: cur.page } : cur.kind === 'bld' ? { bld: cur.login } : { hub: 1 };
  try { (push ? history.pushState : history.replaceState).call(history, state, '', u); } catch (e) { /* ignore */ }
}
function setDocTitle() { document.title = cur.kind === 'repo' ? cur.repo.full + (cur.path ? '/' + cur.path : '') + ' · GitWorld' : cur.kind === 'city' ? 'GitWorld City · GitWorld' : cur.kind === 'bld' ? '@' + cur.login + '\u2019s building · GitWorld' : 'GitWorld · Git it together at GitWorld'; }

// ---------- hub: GitWorld Plaza ----------
let featured = [];
function buildHub() {
  const TW = 46, TH = 36;
  const island = (tx, ty) => tx >= 31 && tx <= 43 && ty >= 6 && ty <= 32;
  const paint = (tx, ty) => {
    if (tx < 1 || ty < 1 || tx >= TW - 1 || ty >= TH - 1) return 'void';
    if (tx >= 29 && tx <= 30) return (ty >= 17 && ty <= 18) ? 'bridge' : 'void';
    if (tx > 30) return island(tx, ty) ? 'island' : 'void';
    if (Math.hypot(tx - 18.5, ty - 18) < 6.2) return 'plaza';
    if (ty >= 17 && ty <= 18 && tx >= 4) return 'street';
    if (tx >= 4 && tx <= 5 && ty >= 5 && ty <= 32) return 'lane';
    if (ty >= 30 && ty <= 31 && tx >= 4 && tx <= 28) return 'street';
    return 'ground';
  };
  const w = newWorld('hub', TW, TH, paint);
  const P = { x: 18.5 * T, y: 18 * T };
  // GITWORLD monument (big title board)
  const mon = sprite('monument', 168, 52, g => {
    R(g, 6, 49, 156, 3, 'rgba(0,0,0,0.35)'); box(g, 0, 0, 168, 46, '#0b0e1c', ACC); R(g, 1, 1, 166, 2, '#12352f');
    text(g, 'GITWORLD', 84 - textW('GITWORLD', 3) / 2, 7, ACC, 3);
    text(g, 'GIT IT TOGETHER AT GITWORLD', 84 - textW('GIT IT TOGETHER AT GITWORLD') / 2, 30, C.ink);
    box(g, 20, 46, 4, 6, C.wall); box(g, 144, 46, 4, 6, C.wall);
  });
  w.put(mon, P.x, 9 * T, [160, 10]);
  w.light(P.x, 7 * T, 70, ACC, 0.35, { pulse: true });
  target(w, { id: 'mon', x: P.x, y: 9 * T + 8, label: 'GitWorld', name: 'GitWorld monument', tapDy: 30, tapR: 70,
    card: { tag: 'WELCOME', title: 'Git it together at GitWorld', icon: ['github', ACC], body: 'Every public GitHub repo is a pixel town. Folders are buildings, files are things you can open, the README is a sign. Walk in through the GitHub Gate, or tap a building on Popular Street. Cross the bridge to GitWorld City, where every builder has a building with the repos they picked. Sign in with GitHub to build yours, see other cats live, chat and wave.', links: [{ label: 'OPEN THE GATE', fn: () => openPicker() }] } });
  // GitHub Gate
  w.put(portalSprite(ACC, 'gh'), P.x, 14 * T, [30, 8]);
  w.light(P.x, 13 * T, 34, ACC, 0.5, { pulse: true });
  w.tag('GITHUB GATE', P.x, 14 * T + 2, ACC);
  target(w, { id: 'gate', kind: 'main', mdy: 58, x: P.x, y: 14 * T + 10, label: 'Enter any repo', name: 'GitHub Gate', noAuto: true, act: () => openPicker(), tapDy: 20 });
  // sign-in kiosk
  w.put(kioskSprite(C.yellow), 22.5 * T, 23 * T, [16, 6]);
  w.tag(ME.user ? '@' + ME.user.login : 'SIGN IN', 22.5 * T, 23 * T + 2, C.yellow);
  target(w, { id: 'kiosk', x: 22.5 * T, y: 23 * T + 8, label: ME.user ? 'Your cat & building' : 'Join with GitHub', name: 'Sign-in kiosk', noAuto: true, act: () => authAction(), tapDy: 16 });
  // Popular Street
  w.tag('POPULAR STREET', 5 * T, 4 * T + 4, C.yellow);
  POPULAR.forEach(([full, desc], i) => {
    const col = i % 2, row = (i / 2) | 0;
    const bx = (col ? 11 : 7.5) * T, byy = [10, 16, 26][row] * T;
    w.put(buildingSprite(full, 2 + (hash(full) % 2), false), bx, byy, [40, 12]);
    w.tag(trunc(full.split('/')[1], 16), bx, byy + 3, C.ink);
    target(w, { id: 'pop' + i, x: bx, y: byy + 10, label: full, name: full, noAuto: true, act: () => enterRepo(full, '', 0, { push: true }), tapDy: 24, tag: desc });
  });
  // GitWorld City district: the city gate plus the newest buildings
  w.tag('GITWORLD CITY', 37 * T, 5 * T + 6, ACC);
  w.put(portalSprite(ACC, 'gh'), 37 * T, 9 * T, [30, 8]); w.light(37 * T, 8 * T, 40, ACC, 0.5, { pulse: true });
  w.tag(CITY.total + (CITY.total === 1 ? ' BUILDING' : ' BUILDINGS') + (CITY.online.size ? ' - ' + CITY.online.size + ' ONLINE' : ''), 37 * T, 9 * T + 2, C.ink);
  target(w, { id: 'citygate', kind: 'main', mdy: 58, x: 37 * T, y: 9 * T + 10, label: 'Enter GitWorld City', name: 'GitWorld City', noAuto: true, act: () => enterCity(0, { push: true }), tapDy: 22 });
  const newest = CITY.list.slice(-6).reverse();
  newest.forEach((b, i) => { const col = i % 2, row = (i / 2) | 0; putHouse(w, b, (col ? 40.5 : 33.8) * T, (16 + row * 5.5) * T); });
  if (!newest.length) {
    w.put(plotSprite(), 37 * T, 17 * T, [44, 6]);
    w.tag('OPEN PLOT', 37 * T, 17 * T - 30, ACC);
    target(w, { id: 'islandplot', x: 37 * T, y: 17 * T + 8, label: 'Open plot', name: 'Open plot', tapDy: 18, card: openPlotCard() });
  }
  // decor
  [[3, 3], [9, 3], [27, 4], [26, 10], [27, 26], [12, 33], [22, 33], [3, 24], [3, 12], [24, 2], [42, 33]].forEach(([x, y]) => { if (paint(x, y) === 'ground' || paint(x, y) === 'island') w.tree(x, y); });
  [[14, 16], [23, 16], [14, 21], [23, 21], [33, 16.5], [43, 16.5]].forEach(([x, y]) => w.lamp(x * T, y * T));
  w.places = () => withGo([{ name: 'GitHub Gate', tag: 'Enter any public repo', go: () => openPicker() }, { name: 'Plaza', tag: 'Center of GitWorld', x: P.x, y: P.y + 40 },
    { name: 'GitWorld City', tag: CITY.total + ' buildings, one per builder', go: () => enterCity(0, { push: true }) }, ...(ME.user && CITY.byKey.has(ME.user.login.toLowerCase()) ? [{ name: 'My building', tag: '@' + ME.user.login, go: () => enterBuilding(ME.user.login, { push: true }) }] : []),
    ...POPULAR.map(([f, d], i) => ({ name: f, tag: d, x: w.targets.find(t => t.id === 'pop' + i).x, y: w.targets.find(t => t.id === 'pop' + i).y })),
    ...newest.map(b => ({ name: '@' + b.login + '\u2019s building', tag: 'Newest in GitWorld City', go: () => enterBuilding(b.login, { push: true }) }))]);
  w.spawn = [P.x, 15.6 * T];
  return w;
}
function enterHub(opts = {}) {
  navToken++;
  cur = { kind: 'hub' };
  const w = buildHub(); const s = opts.at || w.spawn;
  E.setWorld(w, s[0], s[1], opts.dir || 'up');
  closePanels(); renderBar(); setDocTitle(); if (opts.push !== undefined) syncURL(opts.push);
  RT.enter();
}
// ---------- GitWorld City: every profile is a building ----------
const CITY = { list: [], byKey: new Map(), online: new Set(), total: 0, store: null, loaded: false, at: 0 };
const CITY_PER = 30, CITY_COLS = 6;
const avatars = new Map();
function avatarImg(login) {
  const k = login.toLowerCase(); if (avatars.has(k)) return avatars.get(k);
  const im = new Image(); im.referrerPolicy = 'no-referrer'; im.decoding = 'async'; im.src = avatarUrl(login); avatars.set(k, im); return im;
}
const plural = (n, w) => (n | 0) + ' ' + w + ((n | 0) === 1 ? '' : 's');
const isMine = login => !!(ME.user && login && ME.user.login.toLowerCase() === String(login).toLowerCase());
const bldUrl = login => location.origin + '/b/' + encodeURIComponent(login);
function cityIndex(login) { const k = String(login).toLowerCase(); return CITY.list.findIndex(b => b.login.toLowerCase() === k); }
async function loadCity(rebuild = true) {
  try {
    const r = await fetch('/api/buildings', { cache: 'no-store' }); if (!r.ok) return;
    const d = await r.json();
    CITY.list = (d.buildings || []).filter(b => b && typeof b.login === 'string' && OWNER_RE.test(b.login));
    CITY.byKey = new Map(CITY.list.map(b => [b.login.toLowerCase(), b]));
    CITY.online = new Set((d.online || []).map(s => String(s).toLowerCase())); CITY.total = d.total || CITY.list.length; CITY.store = d.store || null; CITY.loaded = true; CITY.at = Date.now();
    featured = []; for (const b of CITY.list.slice().reverse()) for (const rp of (b.repos || [])) if (featured.length < 24 && parseRepoInput(rp.full)) featured.push({ full: rp.full, desc: rp.desc, stars: rp.stars, by: b.login });
    if (rebuild && !panelOpen() && (cur.kind === 'hub' || cur.kind === 'city')) { const x = player.x, y = player.y, d2 = player.dir, w = cur.kind === 'hub' ? buildHub() : buildCity(cur.page); E.setWorld(w, x, y, d2); RT.reattach(); }
  } catch (e) { /* offline */ }
}
setInterval(() => { if (!document.hidden && (cur.kind === 'hub' || cur.kind === 'city') && Date.now() - CITY.at > 14000) loadCity(true); }, 5000);
function loadFeatured() { return loadCity(true); }

// sprites
function houseSprite(login, floors, mine) {
  const hue = HUES[hash(login.toLowerCase()) % HUES.length], W = 60, H = 26 + floors * 11;
  return sprite('h' + login + floors + (mine ? 1 : 0), W, H + 8, g => {
    R(g, 2, H + 4, W - 4, 3, 'rgba(0,0,0,0.35)');
    box(g, 3, 8, W - 6, H - 4, C.wall); R(g, 4, 9, W - 8, 2, C.wall2);
    // avatar frame (the avatar itself is drawn live on top, see putHouse)
    box(g, (W >> 1) - 9, 11, 18, 18, '#06070f', mine ? ACC : hue[1]);
    for (let f = 0; f < floors; f++) for (let i = 0; i < 4; i++) { if (f === 0 && (i === 1 || i === 2)) continue; const lit = (hash(login + f + i) % 3) > 0; box(g, 7 + i * 13, 14 + f * 11 + (f ? 8 : 0), 7, 6, lit ? '#ffe9a8' : C.glass, C.out); }
    R(g, 0, 2, W, 7, C.out); R(g, 1, 3, W - 2, 5, mine ? '#12352f' : hue[0]); R(g, 1, 3, W - 2, 1, mine ? ACC : hue[1]); R(g, 1, 7, W - 2, 1, hue[2]);
    R(g, 8, 0, W - 16, 3, C.out); R(g, 9, 1, W - 18, 2, mine ? ACC : hue[1]);
    const dx = (W >> 1) - 5; box(g, dx, H - 7, 10, 11, '#1a1f36', C.out); R(g, dx + 2, H - 5, 6, 8, hue[2]); R(g, dx + 7, H - 1, 1, 1, C.yellow);
    R(g, dx - 2, H + 3, 14, 2, C.edge);
  });
}
function plotSprite() {
  return sprite('plot', 56, 30, g => {
    R(g, 2, 27, 52, 2, 'rgba(0,0,0,0.3)'); R(g, 4, 10, 48, 16, '#3a2a1e'); for (let i = 0; i < 6; i++) R(g, 6 + i * 8, 12 + (i % 2) * 6, 3, 1, '#5e3a24');
    for (let i = 0; i < 7; i++) box(g, 3 + i * 8, 6, 3, 20, '#c9b98e'); R(g, 2, 9, 52, 2, '#c9b98e'); R(g, 2, 19, 52, 2, '#c9b98e');
  });
}
function standSprite(full) {
  const hue = HUES[hash(full.toLowerCase()) % HUES.length];
  return sprite('st' + full, 26, 34, g => {
    R(g, 2, 31, 22, 2, 'rgba(0,0,0,0.35)'); box(g, 4, 20, 18, 12, hue[0]); R(g, 5, 21, 16, 2, hue[1]);
    box(g, 1, 0, 24, 20, '#11162a', hue[1]); R(g, 3, 2, 20, 16, '#06070f');
    R(g, 5, 5, 7, 1, ACC); R(g, 6, 8, 12, 1, '#6c789e'); R(g, 6, 11, 9, 1, hue[1]); R(g, 6, 14, 5, 1, C.ink);
  });
}
function bellSprite() {
  return sprite('bell', 22, 34, g => {
    R(g, 2, 31, 18, 2, 'rgba(0,0,0,0.35)'); box(g, 9, 10, 4, 22, '#5e3a24'); box(g, 1, 6, 20, 4, '#5e3a24');
    for (let y = 0; y < 9; y++) { const w = 2 + Math.round(y * 0.7); R(g, 11 - w, 10 + y, w * 2, 1, y < 2 ? '#fff3b0' : C.yellow); } R(g, 10, 19, 2, 2, '#8f5a3a');
  });
}
function putHouse(w, b, cx, by) {
  const mine = isMine(b.login), on = CITY.online.has(b.login.toLowerCase());
  const floors = clamp(1 + Math.ceil((b.repos || []).length / 2), 1, 4), img = houseSprite(b.login, floors, mine);
  w.put(img, cx, by, [52, 12]);
  // live avatar in the frame on the facade
  const top = by - img.height + 12; w.props.push({ y: by - 3, draw: g2 => { const im = avatarImg(b.login); if (im.complete && im.naturalWidth) { try { g2.drawImage(im, Math.round(cx - 8), top, 16, 16); } catch (e) { /* */ } } } });
  if (on) w.light(cx, by - 20, 34, ACC, 0.4, { pulse: true });
  w.tag((mine ? 'YOU @' : '@') + trunc(b.login, 14), cx, by + 3, mine ? ACC : on ? C.mint : C.ink);
  return target(w, { id: 'bld:' + b.login.toLowerCase(), x: cx, y: by + 10, r: 24, tapR: 36, tapDy: 28, noAuto: true,
    label: '@' + b.login + ' \u00b7 ' + (b.repos || []).length + ' repos \u00b7 ' + (b.v || 0) + ' visits' + (on ? ' \u00b7 online' : ''), name: '@' + b.login, act: () => enterBuilding(b.login, { push: true }) });
}
function openPlotCard() {
  return { tag: 'OPEN PLOT', title: ME.user ? (CITY.byKey.has(ME.user.login.toLowerCase()) ? 'Saved for the next builder' : 'This plot is yours') : 'Your building could go here', icon: ['github', ACC],
    body: ME.user ? 'Every GitWorld profile gets a building in the city. Pick your cat and the public repos you want inside, and your building goes up for everyone to visit.' : ME.auth ? 'Sign in with GitHub, pick a cat and the public repos you want to show, and a building with your name goes up here. Share the link with friends so they can walk in.' : 'Soon you can sign in with GitHub and build here. Every profile adds a building and a cat to the city.',
    links: ME.user ? [{ label: CITY.byKey.has(ME.user.login.toLowerCase()) ? 'EDIT MY BUILDING' : 'BUILD MINE', fn: () => openOnboard() }] : ME.auth ? [{ label: 'SIGN IN WITH GITHUB', fn: () => signIn() }] : [] };
}
function demoCard() {
  return { tag: 'DEMO MODE', title: 'The city database is not connected yet', icon: ['shield', C.yellow], body: 'GitWorld is running on a temporary in-memory store, so buildings, visits and waves can reset when the server restarts, and players on different servers may not see each other. It switches to the shared live database as soon as Redis is connected.' };
}
function buildCity(page = 0) {
  const pages = Math.max(1, Math.ceil((CITY.list.length + 3) / CITY_PER)); page = clamp(page | 0, 0, pages - 1);
  const slice = CITY.list.slice(page * CITY_PER, (page + 1) * CITY_PER);
  const rem = (CITY_COLS - slice.length % CITY_COLS) % CITY_COLS, openN = page === pages - 1 ? (rem >= 3 ? rem : rem + CITY_COLS) : 0;
  const n = slice.length + openN, rows = Math.max(1, Math.ceil(n / CITY_COLS));
  const X0 = 4, TOP = 12, TW = X0 + CITY_COLS * 6 + 3, TH = TOP + rows * 6 + 2;
  const paint = (tx, ty) => {
    if (tx < 1 || ty < 1 || tx >= TW - 1 || ty >= TH - 1) return 'void';
    if (tx >= 2 && tx <= 3) return 'lane';
    if (ty >= 3 && ty <= 8 && tx >= 6 && tx <= TW - 5) return 'plaza';
    if (ty === 10 || ty === 11) return 'street';
    if (ty >= TOP && (ty - TOP) % 6 === 5) return 'street';
    return 'ground';
  };
  const w = newWorld('city', TW, TH, paint), mid = (TW / 2) * T;
  // city sign
  const label = 'GITWORLD CITY', sub = CITY.total + (CITY.total === 1 ? ' BUILDING' : ' BUILDINGS') + ' - ' + CITY.online.size + ' ONLINE';
  const sw = Math.max(textW(label, 2), textW(pix(sub))) + 20;
  w.put(sprite('citysign' + sub, sw, 40, g => { R(g, 4, 37, sw - 8, 2, 'rgba(0,0,0,0.35)'); box(g, 0, 0, sw, 28, '#0b0e1c', ACC); text(g, label, sw / 2 - textW(label, 2) / 2, 5, ACC, 2); text(g, pix(sub), sw / 2 - textW(pix(sub)) / 2, 18, C.ink); box(g, 10, 28, 4, 10, C.wall); box(g, sw - 14, 28, 4, 10, C.wall); }), mid, 6 * T, [sw - 8, 6]);
  w.light(mid, 4 * T, 60, ACC, 0.3, { pulse: true });
  target(w, { id: 'citysign', x: mid, y: 6 * T + 10, tapDy: 24, tapR: 60, label: 'GitWorld City', name: 'GitWorld City',
    card: { tag: 'GITWORLD CITY' + (pages > 1 ? ' \u00b7 STREET ' + (page + 1) + '/' + pages : ''), title: CITY.total + ' builders live here', icon: ['github', ACC], body: 'Every GitWorld profile is a building. Walk into one to see the repos its owner picked, wave at them, and say hi to whoever is around. Lit-up buildings mean the owner is online right now.',
      links: [...(ME.user && CITY.byKey.has(ME.user.login.toLowerCase()) ? [{ label: 'MY BUILDING', fn: () => enterBuilding(ME.user.login, { push: true }) }] : ME.user ? [{ label: 'BUILD MINE', fn: () => openOnboard() }] : ME.auth ? [{ label: 'SIGN IN TO BUILD', fn: () => signIn() }] : []), { label: 'COPY CITY LINK', alt: true, fn: () => shareLink(location.origin + '/city', 'GitWorld City') }] } });
  // back to plaza
  w.put(portalSprite(C.purple, 'back'), 4 * T, 7 * T, [26, 8]); w.tag('PLAZA', 4 * T, 7 * T + 2, C.purple);
  target(w, { id: 'back', x: 4 * T, y: 7 * T + 10, label: 'Back to GitWorld Plaza', name: 'Back', noAuto: true, act: () => enterHub({ push: true, at: [37 * T, 10.5 * T] }), tapDy: 22 });
  if (CITY.store === 'memory') { w.put(readmeSprite(), mid + 9 * T, 8.6 * T, [30, 6]); w.tag('DEMO MODE', mid + 9 * T, 8.6 * T + 2, C.yellow); target(w, { id: 'demo', x: mid + 9 * T, y: 8.6 * T + 8, label: 'Demo mode', name: 'Demo mode', tapDy: 20, card: demoCard() }); }
  if (page > 0) { w.put(portalSprite(C.sky, 'prev'), (TW - 4) * T, 4.5 * T, [26, 8]); w.tag('STREET ' + page, (TW - 4) * T, 4.5 * T + 2, C.sky); target(w, { id: 'prev', x: (TW - 4) * T, y: 4.5 * T + 10, label: 'Previous street', name: 'Prev', noAuto: true, act: () => enterCity(page - 1, { push: true }), tapDy: 22 }); }
  if (page < pages - 1) { w.put(portalSprite(C.sky, 'next'), (TW - 4) * T, 8.5 * T, [26, 8]); w.tag('STREET ' + (page + 2), (TW - 4) * T, 8.5 * T + 2, C.sky); target(w, { id: 'next', x: (TW - 4) * T, y: 8.5 * T + 10, label: 'Next street', name: 'Next', noAuto: true, act: () => enterCity(page + 1, { push: true }), tapDy: 22 }); }
  const spots = new Map();
  for (let i = 0; i < n; i++) {
    const c = i % CITY_COLS, r = (i / CITY_COLS) | 0, cx = (X0 + c * 6 + 3) * T, by = (TOP + r * 6 + 4) * T;
    const b = slice[i];
    if (b) { putHouse(w, b, cx, by); spots.set(b.login.toLowerCase(), [cx, by + 14]); }
    else { w.put(plotSprite(), cx, by, [44, 6]); w.tag('OPEN PLOT', cx, by - 30, ACC); target(w, { id: 'plot' + i, x: cx, y: by + 8, r: 24, tapR: 32, tapDy: 18, label: 'Open plot', name: 'Open plot', card: openPlotCard() }); }
  }
  [[1.5, 2], [TW - 2, 2], [TW - 2, TH - 2]].forEach(([x, y]) => { if (paint(x | 0, y) === 'ground') w.tree(x | 0, y); });
  w.lamp(mid - 5 * T, 9.5 * T); w.lamp(mid + 5 * T, 9.5 * T);
  const mineB = ME.user && CITY.byKey.get(ME.user.login.toLowerCase());
  w.places = () => withGo([{ name: 'City sign', tag: 'GitWorld City', x: mid, y: 7.5 * T }, ...(mineB ? [{ name: 'My building', tag: '@' + mineB.login, go: () => enterBuilding(mineB.login, { push: true }) }] : []),
    { name: 'Back to Plaza', tag: 'GitWorld Plaza', go: () => enterHub({ push: true }) },
    ...slice.slice(0, 40).map(b => ({ name: '@' + b.login, tag: (b.repos || []).length + ' repos \u00b7 ' + (b.v || 0) + ' visits' + (CITY.online.has(b.login.toLowerCase()) ? ' \u00b7 online' : ''), x: spots.get(b.login.toLowerCase())[0], y: spots.get(b.login.toLowerCase())[1] }))]);
  w.spots = spots; w.spawn = [mid, 9 * T]; w.page = page; w.pages = pages;
  return w;
}
async function enterCity(page = 0, opts = {}) {
  navToken++; closePanels();
  if (!CITY.loaded || Date.now() - CITY.at > 5000) await loadCity(false);
  cur = { kind: 'city', page };
  const w = buildCity(page); cur.page = w.page;
  const sp = (opts.focus && w.spots.get(opts.focus.toLowerCase())) || w.spawn;
  E.setWorld(w, sp[0], sp[1], opts.focus ? 'down' : 'up');
  renderBar(); setDocTitle(); if (opts.push !== undefined) syncURL(opts.push);
  RT.enter();
}

// building interior
function buildInterior(b) {
  const TW = 26, TH = 18, mine = isMine(b.login), repos = (b.repos || []).filter(r => parseRepoInput(r.full)).slice(0, 6);
  const paint = (tx, ty) => (tx < 1 || ty < 1 || tx >= TW - 1 || ty >= TH - 1) ? 'void' : (tx >= 12 && tx <= 13 && ty >= 11) ? 'street' : 'plaza';
  const w = newWorld('bld', TW, TH, paint), mid = 13 * T, hue = HUES[hash(b.login.toLowerCase()) % HUES.length];
  // back wall with owner's name
  const title = '@' + trunc(b.login, 18), sub = trunc(b.name && b.name !== b.login ? b.name : 'GITWORLD BUILDER', 26);
  const sw = Math.max(textW(pix(title), 2), textW(pix(sub))) + 44;
  w.put(sprite('own' + b.login + sub, sw, 40, g => { R(g, 4, 37, sw - 8, 2, 'rgba(0,0,0,0.35)'); box(g, 0, 0, sw, 30, '#0b0e1c', mine ? ACC : hue[1]); box(g, 5, 5, 20, 20, '#06070f', hue[1]); text(g, pix(title), 30, 6, mine ? ACC : C.ink, 2); text(g, pix(sub), 30, 19, '#aab4d0'); box(g, 10, 30, 4, 8, C.wall); box(g, sw - 14, 30, 4, 8, C.wall); }), mid, 5 * T, [sw - 8, 6]);
  const signTop = 5 * T - 40; w.props.push({ y: 5 * T - 3, draw: g2 => { const im = avatarImg(b.login); if (im.complete && im.naturalWidth) { try { g2.drawImage(im, Math.round(mid - sw / 2 + 7), signTop + 7, 16, 16); } catch (e) { /* */ } } } });
  w.light(mid, 3 * T, 70, mine ? ACC : hue[1], 0.35, { pulse: true });
  const shareFn = () => shareLink(bldUrl(b.login), '@' + b.login + '\u2019s building in GitWorld');
  target(w, { id: 'owner', x: mid, y: 5 * T + 10, tapDy: 26, tapR: 70, label: '@' + b.login + '\u2019s building', name: '@' + b.login,
    card: { tag: mine ? 'YOUR BUILDING' : 'BUILDING', title: '@' + b.login + (b.name && b.name !== b.login ? ' \u00b7 ' + b.name : ''), icon: ['github', ACC],
      body: (repos.length ? repos.length + (repos.length === 1 ? ' repo' : ' repos') + ' on display. ' : 'No repos on display yet. ') + plural(b.v, 'visit') + ', ' + plural(b.w, 'wave') + '.' + (mine ? ' Share your link so friends can walk in.' : ''),
      links: [{ label: 'SHARE LINK', fn: shareFn }, ...(mine ? [{ label: 'EDIT REPOS', alt: true, fn: () => openOnboard() }] : [{ label: 'GITHUB PROFILE', alt: true, href: 'https://github.com/' + encodeURIComponent(b.login) }])] } });
  // owner's cat on a pedestal
  const look = b.cat && E.lookFromDNA(b.cat);
  if (look) {
    const ped = sprite('ped' + b.cat, 24, 34, g => { R(g, 2, 31, 20, 2, 'rgba(0,0,0,0.35)'); box(g, 2, 20, 20, 12, '#4a5390'); R(g, 3, 21, 18, 2, '#5f6cb0'); g.drawImage(E.catSprite(look, 'down', 0), 4, 4); if (look.acc && look.acc !== 'none') E.drawAcc(g, look.acc, 4, 4, 0, true); });
    w.put(ped, 5 * T, 6 * T, [18, 6]);
    target(w, { id: 'cat', x: 5 * T, y: 6 * T + 8, tapDy: 20, label: E.dnaName(b.cat) || 'Owner\u2019s cat', name: 'Owner\u2019s cat', card: { tag: 'OWNER\u2019S CAT', title: E.dnaName(b.cat) || 'A GitWorld cat', icon: ['github', ACC], body: '@' + b.login + ' walks around GitWorld as this cat. ' + (CITY.online.has(b.login.toLowerCase()) || b.on ? 'They are online right now, so say hi!' : 'They are not online right now.') } });
  }
  // visitor board
  w.put(boardSprite(), 21 * T, 6 * T, [40, 6]); w.tag((b.v || 0) + ((b.v || 0) === 1 ? ' VISIT' : ' VISITS'), 21 * T, 6 * T + 2, C.yellow);
  const waves = mine && ME.building && ME.building.waves ? ME.building.waves : [];
  target(w, { id: 'visits', x: 21 * T, y: 6 * T + 10, tapDy: 22, label: plural(b.v, 'visit') + ' \u00b7 ' + plural(b.w, 'wave'), name: 'Visitor board',
    card: { tag: 'VISITOR BOARD', title: plural(b.v, 'visit') + ' \u00b7 ' + plural(b.w, 'wave'), icon: ['chart', C.yellow], body: mine ? (waves.length ? 'Latest waves: ' + waves.map(x => '@' + x.by).join(', ') + '.' : 'No waves yet. Share your building link and friends can wave at you.') : 'Visits count once per visitor every few hours. Ring the bell to wave at @' + b.login + '.' } });
  // wave bell
  if (!mine) {
    w.put(bellSprite(), 21 * T, 14 * T, [12, 5]); w.tag('WAVE', 21 * T, 14 * T + 2, C.yellow); w.light(21 * T, 13 * T, 22, C.yellow, 0.35, { pulse: true });
    target(w, { id: 'bell', x: 21 * T, y: 14 * T + 8, tapDy: 22, noAuto: true, label: 'Wave at @' + b.login, name: 'Wave bell', act: () => waveAt(b) });
  }
  // the repos on display
  if (repos.length) {
    const gap = Math.min(4, 20 / repos.length);
    repos.forEach((rp, i) => {
      const cx = (13 - (repos.length - 1) * gap / 2 + i * gap) * T, by = 10 * T;
      w.put(standSprite(rp.full), cx, by, [20, 6]); w.tag(trunc(rp.full.split('/')[1], 12), cx, by + 3, ACC);
      w.light(cx, by - 20, 16, ACC, 0.25);
      target(w, { id: 'repo' + i, x: cx, y: by + 10, r: 22, tapR: 26, tapDy: 22, label: rp.full, name: rp.full,
        card: { tag: 'REPO' + (rp.lang ? ' \u00b7 ' + rp.lang : '') + (rp.stars ? ' \u00b7 \u2605 ' + fmtN(rp.stars) : ''), title: rp.full, icon: ['github', ACC], body: rp.desc || 'No description.',
          links: [{ label: 'WALK IN', fn: () => enterRepo(rp.full, '', 0, { push: true }) }, { label: 'OPEN ON GITHUB', alt: true, href: 'https://github.com/' + rp.full }] } });
    });
  } else {
    w.put(readmeSprite(), mid, 10 * T, [30, 6]);
    target(w, { id: 'empty', x: mid, y: 10 * T + 8, tapDy: 20, label: 'Nothing on display yet', name: 'Empty display', card: { tag: 'DISPLAY', title: 'Nothing on display yet', icon: ['github', ACC], body: mine ? 'Pick which of your public repos go in your building.' : '@' + b.login + ' has not picked any repos yet.', links: mine ? [{ label: 'PICK MY REPOS', fn: () => openOnboard() }] : [] } });
  }
  // exit door
  w.put(portalSprite(C.purple, 'back'), mid, 16.4 * T, [26, 6]); w.tag('CITY', mid, 16.4 * T + 2, C.purple);
  target(w, { id: 'back', x: mid, y: 16.4 * T + 8, label: 'Back to GitWorld City', name: 'Exit', noAuto: true, act: () => exitBuilding(b.login), tapDy: 22 });
  w.lamp(3 * T, 14 * T); w.lamp(23 * T, 10 * T);
  w.places = () => withGo([{ name: 'Owner sign', tag: '@' + b.login, x: mid, y: 7 * T }, ...repos.map((rp, i) => ({ name: rp.full, tag: rp.desc || 'Repo on display', x: w.targets.find(t => t.id === 'repo' + i).x, y: w.targets.find(t => t.id === 'repo' + i).y })),
    ...(mine ? [] : [{ name: 'Wave bell', tag: 'Wave at @' + b.login, x: 21 * T, y: 15 * T }]), { name: 'Back to GitWorld City', tag: 'Exit', go: () => exitBuilding(b.login) }]);
  w.spawn = [mid, 14.6 * T];
  return w;
}
function exitBuilding(login) { const i = cityIndex(login); enterCity(i >= 0 ? Math.floor(i / CITY_PER) : 0, { push: true, focus: login }); }
async function enterBuilding(login, opts = {}) {
  const tok = ++navToken; closePanels();
  if (!OWNER_RE.test(login || '')) { enterCity(0, { push: opts.push }); return; }
  let b = CITY.byKey.get(login.toLowerCase()) || null;
  try { const r = await fetch('/api/b/' + encodeURIComponent(login), { cache: 'no-store' }); if (r.ok) { const d = await r.json(); if (d.building) b = d.building; } else if (r.status === 404) b = null; } catch (e) { /* use cached */ }
  if (tok !== navToken) return;
  if (!b) {
    if (!CITY.loaded) await loadCity(false);
    await enterCity(0, { push: opts.push });
    E.showToast('@' + login + ' has not built in GitWorld yet. ' + (ME.user ? 'Invite them!' : 'Maybe you will be first?'), 4500); return;
  }
  CITY.byKey.set(b.login.toLowerCase(), Object.assign(CITY.byKey.get(b.login.toLowerCase()) || {}, b));
  cur = { kind: 'bld', login: b.login, b };
  const w = buildInterior(b); E.setWorld(w, w.spawn[0], w.spawn[1], 'up');
  renderBar(); setDocTitle(); if (opts.push !== undefined) syncURL(opts.push);
  RT.enter();
  countVisit(b);
  if (opts.welcome) setTimeout(() => { if (E.world === w) E.openDialog(w.targets.find(t => t.id === 'owner')); }, 400);
}
async function countVisit(b) {
  if (isMine(b.login)) return;
  const k = 'gwv.' + b.login.toLowerCase(); try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) { /* */ }
  try { const r = await fetch('/api/b/' + encodeURIComponent(b.login) + '/visit', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json().catch(() => ({})); if (r.ok && typeof d.v === 'number' && d.v !== b.v) { b.v = d.v; if (cur.kind === 'bld' && cur.login === b.login) refreshInterior(); } } catch (e) { /* */ }
}
function refreshInterior() { if (cur.kind !== 'bld') return; const x = player.x, y = player.y, d = player.dir, w = buildInterior(cur.b); E.setWorld(w, x, y, d); RT.reattach(); }
async function waveAt(b) {
  if (!ME.user) { if (ME.auth) { E.showToast('Sign in with GitHub to wave at @' + b.login + '.', 3000); signIn(); } else E.showToast('Waving switches on with GitHub sign-in, coming soon.', 3000); return; }
  try {
    const r = await fetch('/api/b/' + encodeURIComponent(b.login) + '/wave', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { E.showToast(d.error || 'Wave not sent.', 3000); return; }
    if (RT.on) sendChat({ e: 'wave' });
    E.blip(880);
    if (d.already) E.showToast('You already waved at @' + b.login + ' today. They will see it!', 3000);
    else { b.w = d.w; E.showToast('\ud83d\udc4b You waved at @' + b.login + '!', 2500); refreshInterior(); }
  } catch (e) { E.showToast('Wave not sent (offline?).', 2500); }
}
function shareLink(u, title) {
  const done = () => E.showToast('Link copied: ' + u.replace(/^https?:\/\//, ''), 2600);
  if (E.isTouch && navigator.share) { navigator.share({ title, url: u }).catch(() => {}); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, () => prompt('Copy this link', u)); else prompt('Copy this link', u);
}

// ---------- repo towns ----------
function buildTown(Rp, path, L, page) {
  const items = [...L.dirs.map(d => ({ d })), ...L.files.map(f => ({ f }))];
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE)); page = clamp(page, 0, pages - 1);
  const slice = items.slice(page * PER_PAGE, (page + 1) * PER_PAGE), n = slice.length;
  const cols = clamp(Math.ceil(Math.sqrt(n * 1.6)), 3, 6), rows = Math.max(1, Math.ceil(n / cols));
  const X0 = 4, SQ = 11, TW = Math.max(cols * 5 + X0 + 2, 30), TH = 2 + SQ + rows * 5 + 2;
  const gx0 = X0 + Math.floor((TW - X0 - 2 - cols * 5) / 2);
  const paint = (tx, ty) => {
    if (tx < 1 || ty < 1 || tx >= TW - 1 || ty >= TH - 1) return 'void';
    if (ty >= 2 && ty < 2 + SQ) return (ty === 1 + SQ || ty === 2 + SQ - 2) ? 'street' : (tx >= 3 && tx <= TW - 4 && ty >= 3 && ty <= SQ - 1) ? 'plaza' : 'ground';
    const ry = ty - (2 + SQ); if (ry >= 0 && ry < rows * 5 && ry % 5 === 4) return 'street';
    if (tx >= 2 && tx <= 3 && ty >= 2) return 'lane';
    return 'ground';
  };
  const w = newWorld('town', TW, TH, paint);
  const isRoot = !path, mid = (TW / 2) * T;
  // back gate (to parent folder or plaza)
  const back = isRoot ? { label: 'Back to GitWorld Plaza', go: () => enterHub({ push: true }) } : { label: 'Up to /' + (dirName(path) || Rp.name), go: () => enterRepo(Rp.full, dirName(path), 0, { push: true, from: path }) };
  w.put(portalSprite(C.purple, 'back'), 4 * T, 8 * T, [26, 8]); w.tag(isRoot ? 'PLAZA' : 'UP ..', 4 * T, 8 * T + 2, C.purple);
  w.light(4 * T, 7 * T, 30, C.purple, 0.4);
  target(w, { id: 'back', x: 4 * T, y: 8 * T + 10, label: back.label, name: 'Back', noAuto: true, act: back.go, tapDy: 22 });
  // repo sign
  const info = Rp.info, title = isRoot ? Rp.full : baseName(path) + '/';
  const signW = clamp(textW(pix(trunc(title, 34))) + 14, 70, 150);
  const sign = sprite('sign' + Rp.full + path, signW, 34, g => {
    R(g, 4, 31, signW - 8, 2, 'rgba(0,0,0,0.35)'); box(g, 0, 0, signW, 22, '#0b0e1c', ACC);
    text(g, pix(trunc(title, 34)), 7, 4, ACC); text(g, pix(isRoot ? (info.language || 'REPO') + '  *' + fmtN(info.stargazers_count) : L.count + ' ITEMS'), 7, 13, C.ink);
    box(g, 8, 22, 3, 10, C.wall); box(g, signW - 11, 22, 3, 10, C.wall);
  });
  w.put(sign, mid, 6 * T, [signW - 6, 6]);
  target(w, { id: 'sign', x: mid, y: 6 * T + 10, label: isRoot ? Rp.full : path, name: 'Town sign', tapDy: 22, tapR: 40,
    card: { tag: isRoot ? 'REPO · ' + (info.language || 'code') : 'FOLDER · ' + Rp.full, title: isRoot ? Rp.full : path, icon: ['github', ACC],
      body: (isRoot ? (info.description || 'No description.') + '  ' : '') + L.dirs.length + ' folders, ' + L.files.length + ' files here' + (pages > 1 ? ' across ' + pages + ' streets.' : '.') + (Rp.truncated ? ' (Huge repo: folders load one at a time.)' : ''),
      links: [{ label: 'OPEN ON GITHUB', fn: () => window.open(treeUrl(Rp, path), '_blank', 'noopener') }, { label: 'COPY LINK', alt: true, fn: () => copyLink() }] } });
  // README sign
  const readme = L.files.find(f => /^readme(\.(md|markdown|mdx|txt|rst))?$/i.test(f.name)) || L.files.find(f => /^readme/i.test(f.name));
  if (readme) {
    w.put(readmeSprite(), mid - 7 * T, 9 * T, [30, 6]);
    target(w, { id: 'readme', kind: 'main', mdy: 48, x: mid - 7 * T, y: 9 * T + 8, label: 'Read ' + readme.name, name: 'README', noAuto: true, act: () => openReadme(Rp, readme.path), tapDy: 20 });
  }
  // root only: stars statue + commits board
  if (isRoot) {
    const lv = clamp(Math.round(Math.log10((info.stargazers_count || 0) + 1)), 0, 6);
    w.put(statueSprite(lv), mid + 7 * T, 9 * T, [24, 8]); w.light(mid + 7 * T, 7 * T, 30 + lv * 6, C.yellow, 0.45, { pulse: true });
    target(w, { id: 'statue', x: mid + 7 * T, y: 9 * T + 8, label: fmtN(info.stargazers_count) + ' stars', name: 'Stars statue', tapDy: 30,
      card: { tag: 'STARS STATUE', title: fmtN(info.stargazers_count) + ' stars', icon: ['chart', C.yellow], body: '\u2605 ' + (info.stargazers_count || 0).toLocaleString() + ' stars · ' + (info.forks_count || 0).toLocaleString() + ' forks · ' + (info.open_issues_count || 0).toLocaleString() + ' open issues' + (info.license && info.license.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? ' · ' + info.license.spdx_id : '') + (info.archived ? ' · archived' : '') + '. The statue grows with every 10x more stars.', links: [{ label: 'STARGAZERS', fn: () => window.open('https://github.com/' + Rp.full + '/stargazers', '_blank', 'noopener') }] } });
    w.put(boardSprite(), mid + 12 * T > (TW - 3) * T ? mid + 3 * T : mid + 12 * T, 6 * T, [40, 6]);
    const bx = mid + 12 * T > (TW - 3) * T ? mid + 3 * T : mid + 12 * T;
    target(w, { id: 'board', kind: 'main', mdy: 50, x: bx, y: 6 * T + 10, label: 'Recent commits', name: 'Notice board', noAuto: true, act: () => openCommits(Rp), tapDy: 22 });
  }
  // paging streets
  if (page > 0) { w.put(portalSprite(C.sky, 'prev'), 8 * T, 12 * T, [26, 8]); w.tag('STREET ' + page, 8 * T, 12 * T + 2, C.sky);
    target(w, { id: 'prev', x: 8 * T, y: 12 * T + 10, label: 'Previous street (' + page + '/' + pages + ')', name: 'Prev', noAuto: true, act: () => enterRepo(Rp.full, path, page - 1, { push: true }), tapDy: 22 }); }
  if (page < pages - 1) { w.put(portalSprite(C.sky, 'next'), (TW - 5) * T, 12 * T, [26, 8]); w.tag('STREET ' + (page + 2), (TW - 5) * T, 12 * T + 2, C.sky);
    target(w, { id: 'next', x: (TW - 5) * T, y: 12 * T + 10, label: 'Next street (' + (page + 2) + '/' + pages + ')', name: 'Next', noAuto: true, act: () => enterRepo(Rp.full, path, page + 1, { push: true }), tapDy: 22 }); }
  // the grid: folders are buildings, files are props
  const spots = new Map();
  slice.forEach((it, i) => {
    const c = i % cols, r = (i / cols) | 0, cx = (gx0 + c * 5 + 2.5) * T, by = (2 + SQ + r * 5 + 4) * T;
    if (it.d) {
      const d = it.d, cnt = d.count >= 0 ? d.count : 4, floors = clamp(1 + Math.floor(Math.log2(cnt + 1) / 1.6), 1, 4);
      w.put(buildingSprite(d.name, floors, false), cx, by, [40, 12]);
      w.tag(trunc(d.name, 18) + '/', cx, by + 3, C.yellow);
      target(w, { id: 'd:' + d.path, x: cx, y: by + 10, r: 22, label: d.name + '/' + (d.count >= 0 ? ' (' + d.count + ')' : ''), name: d.name + '/', noAuto: true, act: () => enterRepo(Rp.full, d.path, 0, { push: true }), tapDy: 26, tapR: 34 });
      spots.set(d.path, [cx, by + 12]);
    } else {
      const f = it.f, kind = f.sub ? 'sub' : fileKind(f.name);
      w.put(fileSprite(kind), cx, by, [14, 5]);
      w.tag(trunc(f.name, 18), cx, by + 3, KIND_COL[kind]);
      if (kind === 'code' || kind === 'web') w.light(cx, by - 12, 12, KIND_COL[kind], 0.3);
      target(w, { id: 'f:' + f.path, x: cx, y: by + 8, r: 20, label: f.name + (f.size ? ' · ' + fmtB(f.size) : ''), name: f.name, noAuto: true, act: () => openFile(Rp, f), tapDy: 14, tapR: 26 });
      spots.set(f.path, [cx, by + 10]);
    }
  });
  if (!n) { w.tag(Rp.empty ? 'THIS REPO IS EMPTY' : 'EMPTY FOLDER', mid, (2 + SQ + 2) * T, C.ink); }
  [[2, 2], [TW - 3, 2], [TW - 3, SQ - 1]].forEach(([x, y]) => { if (paint(x, y) === 'ground') w.tree(x, y); });
  w.lamp(mid - 3 * T, 10 * T); w.lamp(mid + 3 * T, 10 * T);
  // contributors wander the town square (root only, loaded lazily)
  if (isRoot) loadContribs(Rp, w, [3 * T, 3 * T, (TW - 3) * T, (SQ) * T]);
  w.places = () => withGo([{ name: isRoot ? 'Back to Plaza' : 'Up a folder', tag: back.label, go: back.go }, { name: 'Town square', tag: Rp.full, x: mid, y: 9 * T },
    ...(readme ? [{ name: 'README', tag: readme.path, go: () => openReadme(Rp, readme.path) }] : []),
    ...(isRoot ? [{ name: 'Recent commits', tag: 'Notice board', go: () => openCommits(Rp) }] : []),
    { name: 'Visit another repo', tag: 'GitHub Gate', go: () => openPicker() }]);
  w.spots = spots; w.spawn = [mid, 11 * T]; w.page = page; w.pages = pages;
  return w;
}
async function loadContribs(Rp, w, bounds) {
  const r = await gh('/repos/' + Rp.full + '/contributors?per_page=8', 60 * 60e3);
  if (!r.ok || !Array.isArray(r.data) || E.world !== w) return;
  r.data.filter(c => c && c.login && c.type !== 'Bot').slice(0, 8).forEach((c, i) => {
    const login = String(c.login).slice(0, 39);
    const pal = Object.assign({}, E.VILLAGE_PALS[hash(login) % E.VILLAGE_PALS.length]);
    const n = { x: bounds[0] + 30 + (i * 53) % (bounds[2] - bounds[0] - 60), y: bounds[1] + 40 + (i * 37) % Math.max(10, bounds[3] - bounds[1] - 60), pal, dir: 'down', frame: 0, ft: 0, wait: Math.random() * 2, meow: 0, bounds, label: pix(trunc(login, 16)),
      extra: (g, nn) => { if (Math.hypot(nn.x - player.x, nn.y - player.y) < 70 && nn.meow <= 0) { const s = pix(trunc(login, 16)); text(g, s, Math.round(nn.x - textW(s) / 2), Math.round(nn.y - 24), '#aab4d0'); } } };
    w.npcs.push(n);
  });
}
function errorWorld(kind, extra) {
  const TW = 24, TH = 16;
  const w = newWorld('err', TW, TH, (tx, ty) => (tx < 1 || ty < 1 || tx >= TW - 1 || ty >= TH - 1) ? 'void' : (ty >= 9 && ty <= 10) ? 'street' : 'ground');
  const msg = {
    notfound: ['REPO NOT FOUND', 'No public repo called ' + (extra || 'that') + '. Check the spelling (owner/name), or it may be private.'],
    nopath: ['NO SUCH FOLDER', 'That folder is not in this repo (maybe it moved).'],
    ratelimit: ['GITHUB NEEDS A BREAK', 'GitHub\u2019s guest limit (60 requests an hour) is used up. It resets at ' + fmtTime(extra || Date.now() + 3600e3) + '. Sign in with GitHub to use your own, much higher limit. Everything you already visited still works from cache.'],
    network: ['OFFLINE?', 'Could not reach GitHub. Check your connection and try again.'],
    other: ['SOMETHING WENT WRONG', String(extra || 'GitHub returned an error.')]
  }[kind] || ['SOMETHING WENT WRONG', String(extra || '')];
  const s = sprite('err' + kind, 120, 34, g => { R(g, 4, 31, 112, 2, 'rgba(0,0,0,0.35)'); box(g, 0, 0, 120, 22, '#2a1d3f', C.red); text(g, msg[0], 60 - textW(msg[0]) / 2, 8, C.ink); box(g, 10, 22, 3, 10, C.wall); box(g, 107, 22, 3, 10, C.wall); });
  w.put(s, 12 * T, 6 * T, [110, 6]);
  target(w, { id: 'errsign', x: 12 * T, y: 6 * T + 10, label: msg[0], name: msg[0], tapDy: 20, tapR: 50, card: { tag: 'OOPS', title: msg[0].toLowerCase().replace(/^./, c => c.toUpperCase()), icon: ['shield', C.red], body: msg[1],
    links: [{ label: 'TRY ANOTHER REPO', fn: () => openPicker() }, ...(kind === 'ratelimit' && ME.auth && !ME.user ? [{ label: 'SIGN IN', alt: true, fn: () => signIn() }] : [])] } });
  w.put(portalSprite(C.purple, 'back'), 5 * T, 12 * T, [26, 8]); w.tag('PLAZA', 5 * T, 12 * T + 2, C.purple);
  target(w, { id: 'back', x: 5 * T, y: 12 * T + 10, label: 'Back to GitWorld Plaza', name: 'Back', noAuto: true, act: () => enterHub({ push: true }), tapDy: 22 });
  w.put(portalSprite(ACC, 'gh'), 19 * T, 12 * T, [26, 8]); w.tag('GATE', 19 * T, 12 * T + 2, ACC);
  target(w, { id: 'gate', x: 19 * T, y: 12 * T + 10, label: 'Try another repo', name: 'Gate', noAuto: true, act: () => openPicker(), tapDy: 22 });
  w.places = () => withGo([{ name: 'Back to Plaza', tag: 'GitWorld Plaza', go: () => enterHub({ push: true }) }, { name: 'GitHub Gate', tag: 'Try another repo', go: () => openPicker() }]);
  w.spawn = [12 * T, 9 * T];
  return w;
}
function showError(kind, extra, label) {
  cur = { kind: 'err', label: label || '' };
  const w = errorWorld(kind, extra); E.setWorld(w, w.spawn[0], w.spawn[1], 'up');
  renderBar(); RT.enter();
  setTimeout(() => { if (E.world === w) E.openDialog(w.targets[0]); }, 50);
}
let loadingToast = 0;
async function enterRepo(full, path = '', page = 0, opts = {}) {
  const tok = ++navToken; closePanels();
  const p = parseRepoInput(full); if (!p) { showError('notfound', String(full).slice(0, 60)); return; }
  path = safePath(path);
  const lt = setTimeout(() => E.showToast('Walking to ' + p.full + (path ? '/' + path : '') + '\u2026', 8000), 150); loadingToast = lt;
  const res = await loadRepo(p.full);
  if (tok !== navToken) return;
  if (!res.ok) { clearTimeout(lt); E.hideToast(); showError(res.kind, res.kind === 'ratelimit' ? res.reset : res.kind === 'notfound' ? p.full : res.msg, p.full); if (opts.push !== undefined) { cur = { kind: 'err' }; } return; }
  const Rp = res.repo;
  const lr = await listing(Rp, path);
  if (tok !== navToken) return;
  clearTimeout(lt); E.hideToast();
  if (!lr.ok) { showError(lr.kind === 'nopath' ? 'nopath' : lr.kind, lr.kind === 'ratelimit' ? lr.reset : lr.msg); return; }
  cur = { kind: 'repo', repo: Rp, path, page };
  const w = buildTown(Rp, path, lr.L, page); cur.page = w.page;
  const sp = (opts.from && w.spots.get(opts.from)) || w.spawn;
  E.setWorld(w, sp[0], sp[1], opts.from ? 'down' : 'up');
  remember(Rp);
  renderBar(); setDocTitle();
  if (opts.push !== undefined) syncURL(opts.push, opts.file);
  RT.enter();
  if (opts.file) { const f = lr.L.files.find(x => x.path === opts.file); if (f) openFile(Rp, f, true); }
  if (Rp.truncated && !path && !opts.quiet) E.showToast('Big repo! Folders load one at a time as you walk in.', 3500);
}
function remember(Rp) { const list = LS.get('recent', []).filter(x => x.toLowerCase() !== Rp.full.toLowerCase()); list.unshift(Rp.full); LS.set('recent', list.slice(0, 8)); }

// ---------- HTML panels (DOM only, textContent only: nothing from GitHub is ever parsed as HTML) ----------
const PANELS = ['ghPick', 'ghView', 'ghRead', 'onboard', 'pCard'];
function openPanel(id) { PANELS.forEach(p => $(p).classList.toggle('hidden', p !== id)); document.body.classList.add('ghp'); E.stopInput(); E.closeDialog(false); E.closePlaces(); E.hideToast(); }
function closePanels() { PANELS.forEach(p => $(p).classList.add('hidden')); document.body.classList.remove('ghp'); if (cur.kind === 'repo' && new URLSearchParams(location.search).get('file')) syncURL(false); }
const panelOpen = () => PANELS.some(p => !$(p).classList.contains('hidden'));
document.querySelectorAll('.pclose').forEach(b => b.addEventListener('click', () => closePanels()));
PANELS.forEach(p => $(p).addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closePanels(); } }));

// breadcrumb bar
function renderBar() {
  const cr = $('ghCrumbs'); cr.textContent = '';
  const add = (label, fn, isCur) => { if (cr.childNodes.length) cr.appendChild(el('i', null, '/')); const b = el('button', isCur ? 'cur' : null, label); b.addEventListener('click', fn); cr.appendChild(b); };
  document.body.classList.toggle('inrepo', cur.kind === 'repo' || cur.kind === 'city' || cur.kind === 'bld');
  if (cur.kind === 'repo') {
    const Rp = cur.repo, segs = cur.path ? cur.path.split('/') : [];
    add(Rp.full, () => enterRepo(Rp.full, '', 0, { push: true, from: segs.length ? segs[0] : undefined }), !segs.length);
    segs.forEach((s, i) => { const p = segs.slice(0, i + 1).join('/'); add(trunc(s, 24), () => enterRepo(Rp.full, p, 0, { push: true, from: segs[i + 1] ? segs.slice(0, i + 2).join('/') : undefined }), i === segs.length - 1); });
    const w = E.world; $('ghPage').textContent = w.pages > 1 ? 'STREET ' + (w.page + 1) + '/' + w.pages : '';
  } else if (cur.kind === 'city') { add('GitWorld City', () => {}, true); const w = E.world; $('ghPage').textContent = w.pages > 1 ? 'STREET ' + (w.page + 1) + '/' + w.pages : ''; }
  else if (cur.kind === 'bld') { add('GitWorld City', () => exitBuilding(cur.login)); add('@' + cur.login, () => {}, true); $('ghPage').textContent = ''; }
  else { add(cur.kind === 'hub' ? 'GitWorld Plaza' : (cur.label || 'Lost'), () => {}, true); $('ghPage').textContent = ''; }
  cr.lastChild && cr.lastChild.scrollIntoView && setTimeout(() => { try { $('ghBar').scrollLeft = 1e5; } catch (e) { /* */ } }, 0);
}
$('ghHome').addEventListener('click', () => enterHub({ push: true }));

// repo picker (the GitHub Gate)
function openPicker() {
  openPanel('ghPick'); $('ghErr').textContent = '';
  const sg = $('ghSuggest'); sg.textContent = '';
  const mkBtn = (full, sub) => { const b = el('button', null, full); if (sub) b.appendChild(el('small', null, sub)); b.addEventListener('click', () => enterRepo(full, '', 0, { push: true })); return b; };
  POPULAR.forEach(([f, d]) => sg.appendChild(mkBtn(f, d)));
  featured.slice(0, 6).forEach(f => sg.appendChild(mkBtn(f.full, 'Featured by @' + f.by)));
  const rc = LS.get('recent', []); $('ghRecentH').classList.toggle('hidden', !rc.length); const rl = $('ghRecent'); rl.textContent = '';
  rc.forEach(f => rl.appendChild(mkBtn(f)));
  $('ghRate').textContent = RATE.remaining != null ? (RATE.via === 'proxy' ? 'Your GitHub budget: ' : 'Guest GitHub budget: ') + RATE.remaining + '/' + RATE.limit + ' left' + (RATE.remaining < 10 ? ', resets ' + fmtTime(RATE.reset) : '') + '. Visited repos are cached.' : 'Guests share GitHub\u2019s 60 requests/hour per IP; repos are cached after the first visit.';
  if (!E.isTouch) setTimeout(() => $('ghInput').focus(), 30);
}
$('ghForm').addEventListener('submit', e => {
  e.preventDefault(); const p = parseRepoInput($('ghInput').value);
  if (!p) { $('ghErr').textContent = 'Type owner/name, like vercel/next.js, or paste a github.com link.'; return; }
  $('ghInput').value = ''; $('ghInput').blur(); enterRepo(p.full, p.path, 0, { push: true });
});

// file viewer
function copyLink(extra) {
  const u = location.origin + urlFor(Object.assign({}, cur, extra || {}));
  const done = () => E.showToast('Link copied!', 1800);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, () => prompt('Copy this link', u)); else prompt('Copy this link', u);
}
async function openFile(Rp, f, fromUrl) {
  if (f.sub) { window.open(blobUrl(Rp, f.path).replace('/blob/', '/tree/'), '_blank', 'noopener'); return; }
  openPanel('ghView');
  const kind = fileKind(f.name);
  $('gvTag').textContent = (Rp.full + '/' + dirName(f.path)).replace(/\/$/, '') + ' · ' + (f.size != null ? fmtB(f.size) : '');
  $('gvTitle').textContent = f.name;
  $('gvGh').href = blobUrl(Rp, f.path);
  $('gvCopy').onclick = () => copyLink({ file: f.path });
  if (!fromUrl) syncURL(false, f.path);
  const body = $('gvBody'); body.textContent = ''; body.scrollTop = 0; body.scrollLeft = 0;
  if (kind === 'img') { const d = el('div', 'vimg'), im = new Image(); im.alt = f.name; im.referrerPolicy = 'no-referrer'; im.src = rawUrl(Rp, f.path); im.onerror = () => { d.textContent = 'Could not load this image.'; }; d.appendChild(im); body.appendChild(d); return; }
  if (kind === 'bin') { body.appendChild(el('div', 'vmsg', 'This is a binary file (' + fmtB(f.size || 0) + '), so there is nothing readable to show. Open it on GitHub to download it.')); return; }
  if ((f.size || 0) > MAX_FILE * 5) { body.appendChild(el('div', 'vmsg', 'This file is ' + fmtB(f.size) + ', too big to show here. Open it on GitHub.')); return; }
  const msg = el('div', 'vmsg', 'Loading\u2026'); body.appendChild(msg);
  let t; try { t = await rawText(Rp, f.path); } catch (e) { msg.textContent = 'Could not load this file (' + e.message + ').'; return; }
  if ($('ghView').classList.contains('hidden') || $('gvTitle').textContent !== f.name) return;
  body.textContent = '';
  if (t.indexOf('\u0000') !== -1) { body.appendChild(el('div', 'vmsg', 'This looks like a binary file, so there is nothing readable to show.')); return; }
  if (/\.(md|markdown|mdx)$/i.test(f.name)) { const md = el('div', 'md'); renderMarkdown(md, t, Rp, dirName(f.path)); body.appendChild(md); return; }
  const lines = t.split(/\r?\n/); if (lines.length > 5000) lines.length = 5000;
  const wrap = el('div', 'code'), ln = el('pre', 'ln'), src = el('pre', 'src');
  ln.textContent = lines.map((_, i) => i + 1).join('\n'); src.textContent = lines.join('\n');
  wrap.appendChild(ln); wrap.appendChild(src); body.appendChild(wrap);
  if ((f.size || 0) > MAX_FILE || lines.length >= 5000) body.appendChild(el('div', 'vmsg', 'Showing the first part only. Open on GitHub for the full file.'));
}

// README reader + commit board share one panel
async function openReadme(Rp, p) {
  openPanel('ghRead'); $('grTag').textContent = Rp.full + ' · README'; $('grTitle').textContent = baseName(p);
  setReadLinks([['OPEN ON GITHUB', blobUrl(Rp, p)]]);
  const b = $('grBody'); b.className = 'vbody md'; b.textContent = 'Loading\u2026'; b.scrollTop = 0;
  let t; try { t = await rawText(Rp, p, 120 * 1024); } catch (e) { b.textContent = 'Could not load the README.'; return; }
  b.textContent = '';
  if (/\.(md|markdown|mdx)$/i.test(p) || !/\./.test(baseName(p))) renderMarkdown(b, t, Rp, dirName(p)); else { const pre = el('pre'); pre.textContent = t; b.appendChild(pre); }
}
async function openCommits(Rp) {
  openPanel('ghRead'); $('grTag').textContent = Rp.full + ' · NOTICE BOARD'; $('grTitle').textContent = 'Recent commits';
  setReadLinks([['ALL COMMITS', 'https://github.com/' + Rp.full + '/commits']]);
  const b = $('grBody'); b.className = 'vbody md'; b.textContent = 'Loading\u2026';
  const r = await gh('/repos/' + Rp.full + '/commits?per_page=12&sha=' + encodeURIComponent(Rp.branch), 10 * 60e3);
  b.textContent = '';
  if (!r.ok || !Array.isArray(r.data)) { b.textContent = r.kind === 'ratelimit' ? 'GitHub\u2019s guest limit is used up until ' + fmtTime(r.reset) + '. Sign in for your own limit.' : 'Could not load commits.'; return; }
  if (!r.data.length) { b.textContent = 'No commits yet.'; return; }
  for (const c of r.data) {
    const d = el('div', 'commit'), msg = String((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 200);
    const a = el('a'); a.href = 'https://github.com/' + Rp.full + '/commit/' + encodeURIComponent(String(c.sha || '')); a.target = '_blank'; a.rel = 'noopener'; a.appendChild(el('b', null, msg || '(no message)')); d.appendChild(a);
    const who = (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || 'someone', when = c.commit && c.commit.author && c.commit.author.date;
    d.appendChild(el('small', null, String(c.sha || '').slice(0, 7) + ' · ' + String(who).slice(0, 40) + (when ? ' · ' + new Date(when).toLocaleDateString() : '')));
    b.appendChild(d);
  }
}
function setReadLinks(list) { const L = $('grLinks'); L.textContent = ''; list.forEach(([label, href]) => { const a = el('a', null, label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; L.appendChild(a); }); }

// tiny safe markdown: headings, lists, quotes, code, links, bold/italic. HTML tags are stripped; DOM is built with textContent.
function safeHref(u, Rp, base) {
  u = String(u || '').trim(); if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return null; // javascript:, data:, etc.
  if (u.startsWith('#')) return null;
  const clean = u.replace(/[?#].*$/, ''); const p = safePath(clean.startsWith('/') ? clean : (base ? base + '/' : '') + clean);
  return blobUrl(Rp, p);
}
function inline(parent, s, Rp, base) {
  const re = /(`[^`]+`)|(!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(https?:\/\/[^\s<>()]+)/g;
  let i = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > i) parent.appendChild(document.createTextNode(s.slice(i, m.index)));
    if (m[1]) parent.appendChild(el('code', null, m[1].slice(1, -1)));
    else if (m[2]) { const img = m[2][0] === '!', href = safeHref(m[4], Rp, base);
      if (img) parent.appendChild(el('span', 'img', '[image: ' + (m[3] || 'picture') + ']'));
      else if (href) { const a = el('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener nofollow'; inline(a, m[3] || href, Rp, base); parent.appendChild(a); }
      else parent.appendChild(document.createTextNode(m[3])); }
    else if (m[5]) { const b = el('strong'); inline(b, m[5].slice(2, -2), Rp, base); parent.appendChild(b); }
    else if (m[6]) { const b = el('em'); b.textContent = m[6].slice(1, -1); parent.appendChild(b); }
    else if (m[7]) { const a = el('a', null, m[7]); a.href = m[7]; a.target = '_blank'; a.rel = 'noopener nofollow'; parent.appendChild(a); }
    i = re.lastIndex;
  }
  if (i < s.length) parent.appendChild(document.createTextNode(s.slice(i)));
}
function renderMarkdown(root, src, Rp, base) {
  src = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[image: $1]').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '');
  src = src.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const lines = src.split(/\r?\n/); let para = [], i = 0;
  const flush = () => { if (para.length) { const p = el('p'); inline(p, para.join(' '), Rp, base); root.appendChild(p); para = []; } };
  while (i < lines.length && root.childNodes.length < 1500) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { flush(); const fence = l.trim().slice(0, 3), buf = []; i++; while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]); i++; const pre = el('pre'), c = el('code'); c.textContent = buf.join('\n'); pre.appendChild(c); root.appendChild(pre); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { flush(); const h = el('h' + Math.min(4, m[1].length)); inline(h, m[2], Rp, base); root.appendChild(h); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); root.appendChild(el('hr')); i++; continue; }
    if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l))) { flush(); const d = el('div', 'li'); d.appendChild(document.createTextNode((/\d/.test(m[1]) ? m[1] + ' ' : '\u2022 '))); inline(d, m[2].replace(/^\[( |x)\]\s*/i, (s0, x) => x === ' ' ? '\u2610 ' : '\u2611 '), Rp, base); root.appendChild(d); i++; continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(l))) { flush(); const q = el('blockquote'); inline(q, m[1], Rp, base); root.appendChild(q); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { flush(); if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) { const p = el('p'); inline(p, l.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim()).join('  \u00b7  '), Rp, base); root.appendChild(p); } i++; continue; }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  if (!root.childNodes.length) root.appendChild(el('p', null, '(This README is empty.)'));
}

// ---------- sign in (Auth.js; tokens stay server-side in an encrypted, httpOnly session cookie) ----------
async function authForm(action, extra) {
  let csrf = ''; try { const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' }); csrf = (await r.json()).csrfToken; } catch (e) { E.showToast('Sign-in is unavailable right now.', 3000); return; }
  const f = document.createElement('form'); f.method = 'POST'; f.action = action; f.style.display = 'none';
  const add = (k, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); };
  add('csrfToken', csrf); add('callbackUrl', location.pathname + location.search); if (extra) Object.entries(extra).forEach(([k, v]) => add(k, v));
  document.body.appendChild(f); f.submit();
}
function signIn() { if (!ME.auth) { E.showToast('GitHub sign-in is not switched on yet here. Explore as a guest meanwhile!', 3500); return; } LS.set('wantJoin', 1); authForm('/api/auth/signin/github'); }
function signOut() { authForm('/api/auth/signout'); }
function authAction() { if (!ME.user) signIn(); else openOnboard(); }
function renderAuth() {
  const b = $('btnAuth'); b.textContent = '';
  if (ME.user) { b.classList.add('me'); const im = new Image(); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = avatarUrl(ME.user.login); b.appendChild(im); b.appendChild(document.createTextNode(trunc('@' + ME.user.login, 14))); b.title = 'Your cat & building'; }
  else { b.classList.remove('me'); b.textContent = 'SIGN IN'; b.title = ME.auth ? 'Sign in with GitHub to join the live world' : 'Sign-in is not switched on yet'; }
  $('btnChat').classList.toggle('hidden', !RT.on);
  $('chatBar').classList.toggle('hidden', !RT.on);
  $('spSignin').classList.toggle('hidden', !!ME.user);
  $('spSignin').disabled = !ME.auth;
  $('spNote').textContent = ME.user ? 'Signed in as @' + ME.user.login + '.' : ME.auth ? 'Guests can explore every public repo. Sign in with GitHub (read-only: we only ask for your public profile) to see other cats live, chat, and feature your repos.' : 'Guests can explore every public repo. Live multiplayer and GitHub sign-in are switching on soon.';
  renderLive();
}
$('btnAuth').addEventListener('click', () => authAction());
const avatarUrl = login => 'https://avatars.githubusercontent.com/' + encodeURIComponent(login) + '?s=80';

// ---------- onboarding: pick a cat, pick public repos to feature ----------
let obPick = null, obCodes = [], obSel = new Set();
function drawCatCard(cv, code) { const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; const v = E.cmParse(code); if (v) E.renderPortrait(g, v, 0); }
function rollCats() {
  obCodes = [0, 1, 2].map(() => E.randomCat());
  if (ME.profile && ME.profile.cat && E.cmParse(ME.profile.cat) && !rollCats.rolled) obCodes[0] = ME.profile.cat;
  rollCats.rolled = true; obPick = obCodes[0];
  const box2 = $('obCats'); box2.textContent = '';
  obCodes.forEach(code => {
    const v = E.cmParse(code), b = el('button'), cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; drawCatCard(cv, code);
    b.appendChild(cv); b.appendChild(document.createTextNode(E.cmName(v))); b.appendChild(el('br')); b.appendChild(el('small', null, E.cmRarity(v)));
    b.classList.toggle('on', code === obPick);
    b.addEventListener('click', () => { obPick = code; [...box2.children].forEach(x => x.classList.toggle('on', x === b)); });
    box2.appendChild(b);
  });
}
$('obReroll').addEventListener('click', () => rollCats());
async function openOnboard() {
  if (!ME.user) return signIn();
  openPanel('onboard'); $('obErr').textContent = '';
  $('obLogin').textContent = '@' + ME.user.login; $('obName').textContent = 'Pick the cat you will walk around as, then choose which of your public repos go in your building in GitWorld City. Your building link: ' + bldUrl(ME.user.login).replace(/^https?:\/\//, '');
  rollCats.rolled = false; rollCats();
  obSel = new Set(((ME.profile && ME.profile.featured) || []).map(s => s.toLowerCase()));
  const list = $('obRepos'); list.textContent = 'Loading your public repos\u2026';
  if (!$('obOut')) { const so = el('button', 'small', 'SIGN OUT'); so.id = 'obOut'; so.style.marginLeft = '8px'; so.addEventListener('click', () => signOut()); $('obSave').after(so); }
  try {
    const r = await fetch('/api/me/repos', { credentials: 'same-origin' }); const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    list.textContent = '';
    if (!d.repos.length) list.textContent = 'You have no public repos yet. You can still pick a cat!';
    d.repos.forEach(rp => {
      const lab = el('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = obSel.has(rp.full.toLowerCase());
      lab.classList.toggle('on', cb.checked);
      cb.addEventListener('change', () => { const k = rp.full.toLowerCase(); if (cb.checked && obSel.size >= 6) { cb.checked = false; $('obErr').textContent = 'Your building holds up to 6 repos.'; return; } cb.checked ? obSel.add(k) : obSel.delete(k); lab.classList.toggle('on', cb.checked); $('obErr').textContent = ''; });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(rp.full)); lab.appendChild(el('small', null, (rp.desc || 'No description') + ' \u00b7 \u2605 ' + fmtN(rp.stars || 0)));
      list.appendChild(lab);
    });
  } catch (e) { list.textContent = 'Could not load your repos (' + e.message + '). You can still pick a cat.'; }
}
$('obSave').addEventListener('click', async () => {
  $('obErr').textContent = ''; $('obSave').disabled = true;
  try {
    const r = await fetch('/api/me', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cat: obPick, featured: [...obSel] }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    const first = !ME.building; ME.profile = d.profile; if (d.building) ME.building = Object.assign(ME.building || {}, d.building); if (d.store) ME.store = d.store;
    E.setMe(ME.profile.cat); closePanels(); renderAuth(); RT.start();
    E.showToast((first ? 'Your building is up! ' : 'Building updated! ') + 'Welcome, ' + E.dnaName(ME.profile.cat) + '.', 3000);
    await loadCity(false);
    enterBuilding(ME.user.login, { push: true, welcome: true });
  } catch (e) { $('obErr').textContent = 'Could not save: ' + e.message; }
  $('obSave').disabled = false;
});

// ---------- multiplayer ----------
const EMOTES = { wave: 'WAVE!', heart: 'heart', star: 'star', meow: 'MEOW!', lol: 'LOL', ship: 'SHIP IT!' };
const EMOTE_KEYS = Object.keys(EMOTES);
const muted = new Set(LS.get('muted', [])), blocked = new Set(LS.get('blocked', []));
const saveMB = () => { LS.set('muted', [...muted]); LS.set('blocked', [...blocked]); };
const RT = {
  on: false, room: null, remote: new Map(), seq: 0, timer: 0, busy: false, full: false, me: { say: null, emote: null }, fails: 0,
  start() { RT.on = !!(ME.rt && ME.user && ME.profile && ME.profile.cat); renderAuth(); if (RT.on) { RT.enter(); } },
  enter() { const r = roomId(); if (r !== RT.room) { RT.room = r; RT.remote.clear(); RT.seq = 0; RT.full = false; clearChatLog(); } RT.attach(E.world); if (RT.on) RT.kick(0); renderLive(); },
  reattach() { RT.attach(E.world); },
  attach(w) {
    if (!w || w.rtAttached) return; w.rtAttached = true;
    w.onRender = (g, t) => drawBubble(g, player.x, player.y - (E.world && ME.profile ? 30 : 30), RT.me, t);
    for (const ent of RT.remote.values()) addEnt(w, ent);
  },
  kick(ms) { clearTimeout(RT.timer); RT.timer = setTimeout(RT.tick, ms); },
  async tick() {
    if (!RT.on) return;
    if (document.hidden || RT.busy) { RT.kick(document.hidden ? 4000 : 300); return; }
    RT.busy = true; const room = RT.room;
    try {
      const r = await fetch('/api/rt/sync', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, x: Math.round(player.x), y: Math.round(player.y), d: player.dir[0], m: player.moving ? 1 : 0, since: RT.seq }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { RT.on = false; ME.user = null; renderAuth(); return; }
      if (!r.ok) { RT.fails++; if (r.status === 503) { RT.on = false; renderAuth(); return; } }
      else if (room === RT.room) { RT.fails = 0; applySync(d); }
    } catch (e) { RT.fails++; }
    finally { RT.busy = false; }
    RT.kick(RT.fails ? Math.min(10000, 1000 * 2 ** RT.fails) : RT.remote.size ? 700 : 1600);
  }
};
function applySync(d) {
  if (d.full && !RT.full) E.showToast('This spot is full right now. You can look around, but other cats are hidden.', 4000);
  RT.full = !!d.full;
  const seen = new Set(), w = E.world;
  for (const p of (d.players || [])) {
    if (!p || typeof p.l !== 'string' || (ME.user && p.l === ME.user.login) || blocked.has(p.l.toLowerCase())) continue;
    seen.add(p.l);
    let ent = RT.remote.get(p.l);
    if (!ent) { ent = makeEnt(p); RT.remote.set(p.l, ent); addEnt(w, ent); }
    if (p.c !== ent.cat) { ent.cat = p.c; ent.pal = E.lookFromDNA(p.c) || E.VILLAGE_PALS[hash(p.l) % 5]; }
    ent.tx = +p.x || 0; ent.ty = +p.y || 0; ent.rdir = { u: 'up', d: 'down', l: 'left', r: 'right' }[p.d] || 'down'; ent.rmv = !!p.m;
  }
  for (const [l, ent] of RT.remote) if (!seen.has(l)) { RT.remote.delete(l); removeEnt(ent); }
  for (const c of (d.chat || [])) {
    if (!c || c.s <= RT.seq) continue; RT.seq = c.s;
    const login = String(c.l || ''); if (blocked.has(login.toLowerCase()) || muted.has(login.toLowerCase())) continue;
    const mine = ME.user && login === ME.user.login;
    if (mine && c.s <= RT.mySeq) continue;
    showChat(login, c.t, c.e, mine);
  }
  if (typeof d.seq === 'number' && d.seq > RT.seq) RT.seq = d.seq;
  renderLive(d.n);
}
function makeEnt(p) {
  const ent = { login: p.l, cat: p.c, pal: E.lookFromDNA(p.c) || E.VILLAGE_PALS[hash(p.l) % 5], x: +p.x || 0, y: +p.y || 0, tx: +p.x || 0, ty: +p.y || 0, dir: 'down', rdir: 'down', frame: 0, ft: 0, meow: 0, wait: 0, bounds: [0, 0, 0, 0], say: null, emote: null };
  ent.ctl = (dt, n) => {
    const ex = n.tx - n.x, ey = n.ty - n.y, dd = Math.hypot(ex, ey);
    if (dd > 160) { n.x = n.tx; n.y = n.ty; }
    else if (dd > 0.5) { const sp = Math.max(72, dd * 5) * dt, k = Math.min(1, sp / dd); n.x += ex * k; n.y += ey * k; n.dir = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 'right' : 'left') : (ey > 0 ? 'down' : 'up'); }
    const moving = dd > 1.5 || n.rmv; if (!moving) n.dir = n.rdir;
    if (moving) { n.ft += dt; if (n.ft > 0.14) { n.ft = 0; n.frame ^= 1; } } else n.frame = 0;
  };
  ent.extra = (g, n, t) => {
    const s = pix(trunc(n.login, 16)), up = n.pal.acc && n.pal.acc !== 'none' ? 34 : 25;
    const w = textW(s) + 4, x = Math.round(n.x - w / 2), y = Math.round(n.y - up);
    R(g, x, y, w, 7, 'rgba(11,14,28,0.75)'); text(g, s, x + 2, y + 1, muted.has(n.login.toLowerCase()) ? '#6c789e' : ACC);
    drawBubble(g, n.x, n.y - up - 2, n, t);
  };
  ent.tgt = { id: 'p:' + p.l, kind: 'player', r: 20, tapR: 14, tapDy: 8, label: '@' + p.l, name: '@' + p.l, noAuto: true, act: () => openPlayerCard(ent) };
  Object.defineProperty(ent.tgt, 'x', { get: () => ent.x }); Object.defineProperty(ent.tgt, 'y', { get: () => ent.y + 4 });
  return ent;
}
function addEnt(w, ent) { if (!w.npcs.includes(ent)) w.npcs.push(ent); if (!w.targets.includes(ent.tgt)) w.targets.push(ent.tgt); }
function removeEnt(ent) { const w = E.world; const i = w.npcs.indexOf(ent); if (i >= 0) w.npcs.splice(i, 1); const j = w.targets.indexOf(ent.tgt); if (j >= 0) w.targets.splice(j, 1); }
function drawBubble(g, x, y, who, t) {
  const now = performance.now();
  if (who.emote && who.emote.until > now && (who.emote.e === 'heart' || who.emote.e === 'star')) {
    const bx = Math.round(x), by = Math.round(y - 8 - Math.sin(t * 6) * 1.5), col = who.emote.e === 'heart' ? C.pink : C.yellow;
    if (who.emote.e === 'heart') { R(g, bx - 3, by, 2, 1, col); R(g, bx + 1, by, 2, 1, col); R(g, bx - 4, by + 1, 8, 2, col); R(g, bx - 3, by + 3, 6, 1, col); R(g, bx - 2, by + 4, 4, 1, col); R(g, bx - 1, by + 5, 2, 1, col); }
    else { R(g, bx - 1, by - 1, 2, 7, col); R(g, bx - 4, by + 1, 8, 2, col); R(g, bx - 3, by + 3, 2, 2, col); R(g, bx + 1, by + 3, 2, 2, col); }
    return;
  }
  let s = null;
  if (who.emote && who.emote.until > now) s = EMOTES[who.emote.e];
  else if (who.say && who.say.until > now) s = who.say.text;
  if (!s) return;
  const lines = wrapPix(pix(s), 26).slice(0, 3), w = Math.max(...lines.map(l => textW(l))) + 6, h = lines.length * 7 + 3;
  const bx = Math.round(x - w / 2), by = Math.round(y - h - 3);
  box(g, bx, by, w, h, C.ink); R(g, Math.round(x) - 1, by + h, 3, 2, C.ink); R(g, Math.round(x), by + h + 2, 1, 1, C.ink);
  lines.forEach((l, i) => text(g, l, bx + 3, by + 2 + i * 7, C.out));
}
function wrapPix(s, n) { const out = []; let line = ''; for (const wd of s.split(' ')) { if ((line + ' ' + wd).trim().length > n) { if (line) out.push(line); line = wd.slice(0, n); } else line = (line + ' ' + wd).trim(); } if (line) out.push(line); return out.length ? out : ['']; }
function clearChatLog() { $('chatLog').textContent = ''; }
function chatLine(login, msg, sys) {
  const log = $('chatLog'), d = el('div', sys ? 'sys' : null);
  if (login) { const b = el('b', null, '@' + login); b.addEventListener('click', () => { const ent = RT.remote.get(login); if (ent) openPlayerCard(ent); }); d.appendChild(b); }
  d.appendChild(document.createTextNode(msg)); log.appendChild(d);
  while (log.childNodes.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function showChat(login, t, e, mine) {
  const who = mine ? RT.me : RT.remote.get(login);
  const until = performance.now() + 5000;
  if (e && EMOTES[e]) { if (who) who.emote = { e, until: performance.now() + 2500 }; chatLine(login, ' ' + (e === 'heart' ? '\u2764' : e === 'star' ? '\u2605' : EMOTES[e].toLowerCase()), true); }
  else if (t) { if (who) who.say = { text: String(t), until }; chatLine(login, String(t)); }
}
let chatBusy = false;
async function sendChat(body) {
  if (!RT.on || chatBusy) return; chatBusy = true;
  try {
    const r = await fetch('/api/rt/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ room: RT.room }, body)) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { E.showToast(d.error || 'Message not sent.', 2500); return false; }
    RT.mySeq = Math.max(RT.mySeq || 0, d.s || 0);
    showChat(ME.user.login, d.t, d.e, true); RT.kick(150); return true;
  } catch (e) { E.showToast('Message not sent (offline?).', 2500); return false; }
  finally { chatBusy = false; }
}
$('chatForm').addEventListener('submit', async e => {
  e.preventDefault(); const v = $('chatInput').value.trim(); if (!v) { $('chatInput').blur(); return; }
  if (await sendChat({ t: v.slice(0, 120) })) $('chatInput').value = '';
  if (E.isTouch) $('chatInput').blur();
});
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Escape') { $('chatInput').blur(); e.stopPropagation(); } });
$('emotes').addEventListener('click', e => { const b = e.target.closest('button[data-e]'); if (b) sendChat({ e: b.dataset.e }); });
$('btnChat').addEventListener('click', () => { const cb = $('chatBar'); cb.classList.toggle('collapsed'); if (!cb.classList.contains('collapsed') && !E.isTouch) $('chatInput').focus(); });
if (E.isTouch) $('chatBar').classList.add('collapsed');
function renderLive(n) {
  const L = $('ghLive');
  if (RT.on) L.textContent = '\u25cf ' + (RT.remote.size + 1) + ' here' + (RT.full ? ' (full)' : '') + (ME.store === 'memory' ? ' \u00b7 DEMO' : '');
  else if (ME.user && !ME.rt) L.textContent = 'LIVE: SOON';
  else if (!ME.user) L.textContent = 'GUEST';
  else L.textContent = '';
  void n;
}
// player card: mute / block / report
let cardEnt = null;
function openPlayerCard(ent) {
  cardEnt = ent; openPanel('pCard');
  $('pcAvatar').src = avatarUrl(ent.login); $('pcAvatar').referrerPolicy = 'no-referrer'; $('pcAvatar').alt = '';
  $('pcName').textContent = '@' + ent.login + (ent.cat && E.dnaName(ent.cat) ? ' · ' + E.dnaName(ent.cat) : '');
  $('pcLink').href = 'https://github.com/' + encodeURIComponent(ent.login); $('pcLink').textContent = 'github.com/' + ent.login;
  $('pcVisit').classList.toggle('hidden', !CITY.byKey.has(ent.login.toLowerCase()));
  renderCard();
}
function renderCard() {
  const k = cardEnt.login.toLowerCase();
  $('pcMute').textContent = muted.has(k) ? 'UNMUTE' : 'MUTE'; $('pcMute').classList.toggle('on', muted.has(k));
  $('pcBlock').textContent = blocked.has(k) ? 'UNBLOCK' : 'BLOCK';
  $('pcNote').textContent = 'Mute hides their chat. Block hides their cat and chat for you. Report sends their name and this spot to the GitWorld moderators.';
}
$('pcVisit').addEventListener('click', () => { if (cardEnt) enterBuilding(cardEnt.login, { push: true }); });
$('pcMute').addEventListener('click', () => { const k = cardEnt.login.toLowerCase(); muted.has(k) ? muted.delete(k) : muted.add(k); saveMB(); renderCard(); });
$('pcBlock').addEventListener('click', () => { const k = cardEnt.login.toLowerCase(); if (blocked.has(k)) blocked.delete(k); else { blocked.add(k); RT.remote.delete(cardEnt.login); removeEnt(cardEnt); } saveMB(); renderCard(); });
$('pcReport').addEventListener('click', async () => {
  try { const r = await fetch('/api/rt/report', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: cardEnt.login, room: RT.room, reason: 'abuse' }) });
    const d = await r.json().catch(() => ({})); $('pcNote').textContent = r.ok ? 'Thanks. @' + cardEnt.login + ' was reported.' : (d.error || 'Could not send the report.'); } catch (e) { $('pcNote').textContent = 'Could not send the report.'; }
});

// ---------- title screen ----------
function showSplash() {
  document.body.classList.add('splash'); $('splash').classList.remove('hidden');
  const cv = $('splashCats'), g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 96, 24);
  for (let i = 0; i < 4; i++) { const look = E.lookFromDNA(E.randomCat()); g.drawImage(E.catSprite(look, i < 2 ? 'right' : 'left', 0), 8 + i * 22, 6); if (look.acc && look.acc !== 'none') E.drawAcc(g, look.acc, 8 + i * 22, 6, 0, true); }
  setTimeout(() => { try { $('spGuest').focus({ preventScroll: true }); } catch (e) { /* */ } }, 50);
}
function hideSplash() { document.body.classList.remove('splash'); $('splash').classList.add('hidden'); }
const splashOpen = () => !$('splash').classList.contains('hidden');
$('spGuest').addEventListener('click', () => { hideSplash(); E.showToast(E.isTouch ? 'Tap anywhere to walk. Walk into the GitHub Gate to open any repo.' : 'Arrow keys / WASD to walk, E to interact, G opens the GitHub Gate.', 4500); });
$('spSignin').addEventListener('click', () => signIn());

// ---------- keyboard (the engine asks us first) ----------
window.GitWorld = {
  onKey(e) {
    if (splashOpen()) { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') { if (document.activeElement && document.activeElement.tagName === 'BUTTON') return true; e.preventDefault(); $('spGuest').click(); } return true; }
    if (panelOpen()) { if (e.code === 'Escape') { e.preventDefault(); closePanels(); } return true; }
    if (e.code === 'KeyG') { e.preventDefault(); openPicker(); return true; }
    if ((e.code === 'KeyT' || e.code === 'Slash') && RT.on) { e.preventDefault(); $('chatBar').classList.remove('collapsed'); $('chatInput').focus(); return true; }
    if (/^Digit[1-6]$/.test(e.code) && RT.on) { sendChat({ e: EMOTE_KEYS[+e.code.slice(5) - 1] }); return true; }
    if (e.code === 'Backspace' && (cur.kind === 'city' || cur.kind === 'bld')) { e.preventDefault(); const b = E.world.targets.find(t => t.id === 'back'); if (b) b.act(); return true; }
    if (e.code === 'Backspace' && cur.kind === 'repo') { e.preventDefault(); const b = E.world.targets.find(t => t.id === 'back'); if (b) b.act(); return true; }
    return false;
  },
  openPicker, enterRepo, enterHub, enterCity, enterBuilding, get city() { return { total: CITY.total, store: CITY.store, logins: CITY.list.map(b => b.login), online: [...CITY.online] }; }, get state() { return { kind: cur.kind, repo: cur.repo && cur.repo.full, login: cur.login, path: cur.path, page: cur.page, room: RT.room, rt: RT.on, players: [...RT.remote.keys()] }; }, RATE
};

// ---------- URL routing: /?repo=owner/name&path=src&page=2&file=a.js and /gh/owner/name[/tree/branch/path] ----------
function routeFromURL() {
  const q = new URLSearchParams(location.search);
  const bm = /^\/b\/([^/?#]+)\/?$/.exec(location.pathname);
  if (bm) { const l = decodeURIComponent(bm[1]); return { kind: 'bld', login: OWNER_RE.test(l) ? l : '' }; }
  if (/^\/city\/?$/.test(location.pathname)) return { kind: 'city', page: Math.max(0, (parseInt(q.get('page'), 10) || 1) - 1) };
  let full = q.get('repo'), path = q.get('path') || '', page = Math.max(0, (parseInt(q.get('page'), 10) || 1) - 1), file = q.get('file') || '';
  const m = /^\/gh\/(.+)$/.exec(location.pathname);
  if (!full && m) { const p = parseRepoInput(decodeURIComponent(m[1])); if (p) { full = p.full; if (p.file) { file = p.path; path = dirName(p.path); } else path = p.path || safePath(decodeURIComponent(m[1]).split('/').slice(2).join('/')); } else full = decodeURIComponent(m[1]).split('/').slice(0, 2).join('/'); }
  if (full) { const p = parseRepoInput(full); if (p) { full = p.full; if (p.path && !path) path = p.path; } }
  file = safePath(file); if (file && !path) path = dirName(file);
  return full ? { kind: 'repo', full, path: safePath(path), page, file } : null;
}
addEventListener('popstate', () => { const r = routeFromURL(); hideSplash(); if (r && r.kind === 'bld') enterBuilding(r.login); else if (r && r.kind === 'city') enterCity(r.page); else if (r) enterRepo(r.full, r.path, r.page, { file: r.file || undefined, from: (cur.kind === 'repo' && cur.path.startsWith(r.path ? r.path + '/' : '') && cur.path !== r.path) ? cur.path.split('/').slice(0, (r.path ? r.path.split('/').length : 0) + 1).join('/') : undefined }); else enterHub({}); });

// ---------- boot ----------
(async function boot() {
  const r = routeFromURL();
  enterHub({});
  const cityP = loadCity(false);
  if (r && r.kind === 'bld') enterBuilding(r.login, { push: false, welcome: true });
  else if (r && r.kind === 'city') enterCity(r.page, { push: false });
  else if (r) { enterRepo(r.full, r.path, r.page, { push: false, file: r.file || undefined }); }
  else showSplash();
  await loadMe();
  if (ME.store === 'memory' && ME.user) E.showToast('Demo mode: the city database is not connected yet, so buildings may reset.', 4500);
  if (ME.user && ME.profile && ME.profile.cat) { E.setMe(ME.profile.cat); hideSplash(); }
  else if (ME.user) { hideSplash(); openOnboard(); }
  if (ME.user && !RT.on) RT.start();
  await cityP;
  if (cur.kind === 'hub' || cur.kind === 'city') { const x = player.x, y = player.y, w = cur.kind === 'hub' ? buildHub() : buildCity(cur.page); E.setWorld(w, x, y, player.dir); RT.reattach(); }
  else if (cur.kind === 'bld' && isMine(cur.login)) refreshInterior();
})();
})();
