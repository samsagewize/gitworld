// Local GitWorld City check: guests and signed-in players (fake sessions minted with a throwaway local AUTH_SECRET,
// GitHub faked by tools/fake-github.cjs) against a local server. Screenshots go to OUT.
const { chromium, devices } = require(process.env.PW || 'playwright');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:3200', OUT = process.env.OUT || '/workspace/spaces';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mint = l => execFileSync('node', [__dirname + '/mint.mjs', l], { env: process.env }).toString().trim();
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
async function open(browser, login, opts, path) {
  const ctx = await browser.newContext(opts);
  if (login) await ctx.addCookies([{ name: 'authjs.session-token', value: mint(login), url: BASE, httpOnly: true }]);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(BASE + path); await sleep(1800);
  await page.evaluate(() => { const s = document.getElementById('splash'); if (s && !s.classList.contains('hidden')) document.getElementById('spGuest').click(); });
  return { ctx, page, errs, login };
}
const st = p => p.evaluate(() => window.GitWorld.state);
const shot = (p, name) => p.screenshot({ path: OUT + '/gitworld-' + name + '.png' });
async function walkTo(p, id) { await p.evaluate(id => { const t = window.GW.world.targets.find(t => t.id === id); window.GW.player.x = t.x; window.GW.player.y = t.y + 2; }, id); await sleep(500); }
(async () => {
  const browser = await chromium.launch();
  const D = { viewport: { width: 1280, height: 800 } }, I = { ...devices['iPhone 13'] };
  // 1. guest: hub district, city, building, share link
  const G = await open(browser, null, D, '/');
  await walkTo(G.page, 'citygate'); await shot(G.page, 'desktop-hub-city-gate');
  check((await G.page.textContent('#prompt')).includes('GitWorld City'), 'guest sees the city gate on the plaza island');
  await G.page.keyboard.press('KeyE'); await sleep(1200);
  let s = await st(G.page); check(s.kind === 'city' && new URL(G.page.url()).pathname === '/city', 'gate opens /city: ' + s.kind);
  await shot(G.page, 'desktop-city');
  const c = await G.page.evaluate(() => window.GitWorld.city); check(c.total >= 6 && c.store === 'memory', 'city lists buildings: ' + c.total + ' ' + c.store);
  await walkTo(G.page, 'bld:octocat'); await G.page.keyboard.press('KeyE'); await sleep(1500);
  s = await st(G.page); check(s.kind === 'bld' && s.login === 'octocat' && G.page.url().endsWith('/b/octocat'), 'walk into octocat building -> /b/octocat');
  await walkTo(G.page, 'repo0'); await sleep(400);
  check(!(await G.page.isHidden('#dialog')) && /Hello-World/.test(await G.page.textContent('#dlgTitle')), 'repo stand shows its card');
  await shot(G.page, 'desktop-building-repo-card');
  await G.page.click('#dlgLinks button:has-text("WALK IN")'); await sleep(3000);
  s = await st(G.page); check(s.kind === 'repo' && /hello-world/i.test(s.repo || ''), 'WALK IN enters the repo town: ' + s.repo);
  await G.page.goBack(); await sleep(1500); s = await st(G.page); check(s.kind === 'bld' && s.login === 'octocat', 'browser Back returns to the building');
  await G.page.keyboard.press('Backspace'); await sleep(1500); s = await st(G.page); check(s.kind === 'city', 'Backspace exits to the city');
  await G.page.goto(BASE + '/b/nobody-xyz'); await sleep(2200); s = await st(G.page); check(s.kind === 'city', 'unknown building link falls back to the city');
  check(G.errs.length === 0, 'guest: no page errors ' + G.errs.join(' | '));
  // 2. signed in: octocat (desktop) visits samsagewize; samsagewize on iPhone in his own building
  const A = await open(browser, 'octocat', D, '/b/samsagewize');
  const B = await open(browser, 'samsagewize', I, '/b/samsagewize');
  await sleep(3000);
  const sa = await st(A.page), sb = await st(B.page);
  check(sa.kind === 'bld' && sa.rt && sa.room === 'b|samsagewize', 'octocat lands in samsagewize building live: ' + sa.room);
  check(sa.players.includes('samsagewize') && sb.players.includes('octocat'), 'both see each other inside: ' + JSON.stringify([sa.players, sb.players]));
  await walkTo(A.page, 'bell'); await A.page.keyboard.press('KeyE'); await sleep(2500);
  check(/waved at @samsagewize|already waved/.test(await A.page.textContent('#toast')), 'wave bell: ' + (await A.page.textContent('#toast')));
  await walkTo(A.page, 'visits'); await sleep(300); await shot(A.page, 'desktop-building-visitors');
  const logB = await B.page.$eval('#chatLog', e => e.textContent); check(/octocat/.test(logB) && /wave/.test(logB), 'owner sees the wave emote in chat: ' + logB.slice(-60));
  await B.page.evaluate(() => { const cb = document.getElementById('chatBar'); cb.classList.add('collapsed'); });
  await walkTo(B.page, 'owner'); await sleep(600); await shot(B.page, 'iphone-own-building');
  const ob = await B.page.textContent('#dlgBody'); check(/visit/.test(ob) && (await B.page.textContent('#dlgLinks')).includes('SHARE LINK'), 'owner card has visits + SHARE LINK');
  // iPhone: tap through to the city and onto a player card
  await B.page.evaluate(() => window.GitWorld.enterCity(0, { push: true })); await sleep(1500);
  await shot(B.page, 'iphone-city');
  // 3. a new player builds a building
  const N = await open(browser, 'newbie-dev', I, '/');
  check(!(await N.page.isHidden('#onboard')), 'new player sees onboarding');
  await N.page.click('#obRepos label:nth-child(1) input'); await N.page.click('#obRepos label:nth-child(2) input');
  await shot(N.page, 'iphone-onboarding');
  await N.page.click('#obSave'); await sleep(2500);
  s = await st(N.page); check(s.kind === 'bld' && s.login === 'newbie-dev' && N.page.url().endsWith('/b/newbie-dev'), 'after saving, the new player walks into their new building');
  await shot(N.page, 'iphone-new-building');
  const c2 = await A.page.evaluate(async () => (await (await fetch('/api/buildings')).json()).total); check(c2 === c.total + 1, 'city grew by one building: ' + c2);
  // player card -> visit building
  await A.page.evaluate(() => window.GitWorld.enterCity(0, { push: true })); await sleep(2500);
  const hasN = await A.page.evaluate(() => window.GitWorld.state.players);
  check(Array.isArray(hasN), 'city room players: ' + JSON.stringify(hasN));
  await A.page.evaluate(() => window.GitWorld.enterBuilding('samsagewize', { push: true })); await sleep(1200);
  await walkTo(A.page, 'cat'); await sleep(400); await shot(A.page, 'desktop-building-owner-cat');
  for (const P of [A, B, N]) check(P.errs.length === 0, P.login + ': no page errors ' + P.errs.join(' | '));
  await browser.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
