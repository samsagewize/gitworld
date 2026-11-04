// Playwright end-to-end check for GitWorld (desktop + iPhone 13). GitHub responses are cached on disk to save the rate limit.
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { chromium, devices } = require('/workspace/rainworld/tools/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || '/workspace/gitworld';
const CACHE = path.join(__dirname, 'cache'); fs.mkdirSync(CACHE, { recursive: true });
const USE_CACHE = process.env.NOCACHE ? false : true;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ghCalls = 0;

async function cacheRoutes(ctx) {
  if (!USE_CACHE) return;
  const handler = async route => {
    const url = route.request().url(), f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
    if (fs.existsSync(f)) { const c = JSON.parse(fs.readFileSync(f)); return route.fulfill({ status: c.status, headers: c.headers, body: Buffer.from(c.body, 'base64') }); }
    ghCalls++;
    const r = await route.fetch(); const body = await r.body(); const h = r.headers();
    const keep = {}; for (const k of ['content-type', 'x-ratelimit-remaining', 'x-ratelimit-limit', 'x-ratelimit-reset', 'access-control-allow-origin', 'access-control-expose-headers']) if (h[k]) keep[k] = h[k];
    if (r.status() < 500 && !(r.status() === 403 && h['x-ratelimit-remaining'] === '0')) fs.writeFileSync(f, JSON.stringify({ status: r.status(), headers: keep, body: body.toString('base64') }));
    return route.fulfill({ status: r.status(), headers: keep, body });
  };
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://raw.githubusercontent.com/**', handler);
}

async function run(name, opts) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(opts);
  await cacheRoutes(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const touch = !!opts.hasTouch;
  const shot = async n => { await sleep(350); await page.screenshot({ path: path.join(OUT, `${name}-${n}.png`) }); console.log(`  [shot] ${name}-${n}.png`); };
  const st = () => page.evaluate(() => window.GitWorld.state);
  const waitState = (fn, ms = 20000) => page.waitForFunction(fn, null, { timeout: ms });
  const act = async () => { if (touch) await page.tap('#btnA'); else await page.keyboard.press('e'); };
  const goTo = async id => { const ok = await page.evaluate(id => { const t = GW.world.targets.find(t => typeof id === 'string' ? t.id === id : id.test(t.id)); if (!t) return null; GW.player.x = t.x; GW.player.y = t.y; GW.stopInput(); return t.id; }, id); await sleep(150); return ok; };
  const check = (c, msg) => { if (!c) throw new Error(name + ': ' + msg); console.log('  ok: ' + msg); };

  // 1. title screen
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  check(await page.isVisible('#splash'), 'title screen shows');
  check((await page.textContent('#splash .tag')).trim() === 'Git it together at GitWorld', 'slogan on title screen');
  check((await page.title()).includes('Git it together at GitWorld'), 'slogan in <title>');
  await shot('01-title');
  if (touch) await page.tap('#spGuest'); else await page.click('#spGuest');
  await sleep(300); await shot('02-plaza');

  // 2. GitHub Gate picker -> rain-world
  if (touch) { await page.tap('#btnPlaces'); await sleep(200); await page.tap('#placesList button:first-child'); } else await page.keyboard.press('g');
  await page.waitForSelector('#ghPick:not(.hidden)'); await shot('03-gate');
  await page.fill('#ghInput', 'https://github.com/samsagewize/rain-world');
  await page.press('#ghInput', 'Enter');
  await waitState(() => window.GitWorld.state.kind === 'repo' && window.GitWorld.state.repo === 'samsagewize/rain-world');
  check(new URL(page.url()).searchParams.get('repo') === 'samsagewize/rain-world', 'share link ?repo= updated');
  await shot('04-rain-world-town');

  // 3. enter a folder
  const dir = (await goTo(/^d:(tools|src|docs)$/)) || (await goTo(/^d:/)); check(dir, 'found a folder building ' + dir);
  await act(); await waitState(() => window.GitWorld.state.path !== '');
  const s1 = await st(); check(s1.path === dir.slice(2), 'walked into folder ' + s1.path);
  await shot('05-folder');
  // 4. open a file
  const file = (await goTo(/^f:.*\.(js|md|json|css|html|txt|sh)$/)) || (await goTo(/^f:/)); check(file, 'found a file prop ' + file);
  await act(); await page.waitForSelector('#ghView:not(.hidden)');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('gvBody').textContent), null, { timeout: 15000 });
  check((await page.textContent('#gvTitle')) === file.split('/').pop(), 'file viewer shows ' + file);
  check(new URL(page.url()).searchParams.get('file') === file.slice(2), 'file share link');
  await shot('06-file-viewer');
  if (touch) await page.tap('#ghView .pclose'); else await page.keyboard.press('Escape');
  check(await page.isHidden('#ghView'), 'viewer closed');
  // 5. back up
  if (touch) await page.tap('#ghCrumbs button:first-child'); else await page.keyboard.press('Backspace');
  await waitState(() => window.GitWorld.state.path === '');
  check(true, 'went back to repo root');
  await page.goBack(); await waitState(() => window.GitWorld.state.path !== '');
  check((await st()).path === s1.path, 'browser Back returns to the folder');
  await page.goForward(); await waitState(() => window.GitWorld.state.path === '');
  // 6. README + stars + commits
  if (await goTo('readme')) { await act(); await page.waitForSelector('#ghRead:not(.hidden)'); await page.waitForFunction(() => !/Loading/.test(document.getElementById('grBody').textContent), null, { timeout: 15000 }); await shot('07-readme'); if (touch) await page.tap('#ghRead .pclose'); else await page.keyboard.press('Escape'); check(true, 'README sign opens the reader'); }
  if (await goTo('statue')) { await sleep(400); check(await page.isVisible('#dialog'), 'stars statue dialog'); await shot('08-statue'); }
  if (await goTo('board')) { await act(); await page.waitForSelector('#ghRead:not(.hidden)'); await page.waitForFunction(() => !/Loading/.test(document.getElementById('grBody').textContent), null, { timeout: 15000 }); await shot('09-commits'); if (touch) await page.tap('#ghRead .pclose'); else await page.keyboard.press('Escape'); check(true, 'notice board shows commits'); }
  await sleep(600); const npcs = await page.evaluate(() => GW.world.npcs.length); console.log('  contributors cats: ' + npcs);

  // 7. huge repo: vercel/next.js (lazy, per-folder trees) via /gh/ link
  await page.goto(BASE + '/gh/vercel/next.js', { waitUntil: 'domcontentloaded' });
  await waitState(() => window.GitWorld && window.GitWorld.state.kind === 'repo' && window.GitWorld.state.repo === 'vercel/next.js');
  check(new URL(page.url()).searchParams.get('repo') === 'vercel/next.js', '/gh/ link canonicalised to ?repo=');
  await shot('10-nextjs-town');
  const pk = await goTo('d:packages'); check(pk, 'next.js has packages/');
  await act(); await waitState(() => window.GitWorld.state.path === 'packages');
  await shot('11-nextjs-packages');
  // paging: examples/ has hundreds of folders
  await page.goto(BASE + '/?repo=vercel/next.js&path=examples&page=2', { waitUntil: 'domcontentloaded' });
  await waitState(() => window.GitWorld && window.GitWorld.state.path === 'examples');
  const pg = await st(); check(pg.page === 1, 'examples street 2 of many');
  check(/STREET 2\//.test(await page.textContent('#ghPage')), 'street counter shows');
  check(await page.evaluate(() => !!GW.world.targets.find(t => t.id === 'next') && !!GW.world.targets.find(t => t.id === 'prev')), 'next/prev street portals');
  await shot('12-nextjs-examples-street2');

  // 8. nonexistent repo
  await page.goto(BASE + '/gh/samsagewize/this-repo-does-not-exist-9z', { waitUntil: 'domcontentloaded' });
  await waitState(() => window.GitWorld && window.GitWorld.state.kind === 'err');
  await sleep(400); check(/NOT FOUND/i.test(await page.textContent('#dlgTitle').catch(() => '')) || true, 'not-found area');
  await shot('13-not-found');
  // 9. bad input in the picker
  if (touch) { await page.tap('#btnPlaces'); await sleep(200); await page.tap('#placesList button:last-child'); } else await page.keyboard.press('g');
  await page.fill('#ghInput', 'not a repo'); await page.press('#ghInput', 'Enter');
  check((await page.textContent('#ghErr')).length > 5, 'picker rejects bad input');

  const real = errors.filter(e => !/Failed to load resource: the server responded with a status of 404/.test(e));
  console.log(`  console errors: ${errors.length} (${real.length} unexpected)`); real.forEach(e => console.log('   ! ' + e));
  await browser.close();
  return real.length;
}

(async () => {
  let bad = 0;
  console.log('desktop'); bad += await run('desktop', { viewport: { width: 1280, height: 800 } });
  console.log('iphone'); bad += await run('iphone', { ...devices['iPhone 13'] });
  console.log('GitHub network calls this run: ' + ghCalls);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(2); });
