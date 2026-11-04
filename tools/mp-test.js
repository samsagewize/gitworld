// Local multiplayer check: two signed-in players (fake sessions minted with a throwaway local AUTH_SECRET) on a local Redis.
const { chromium, devices } = require('/workspace/rainworld/tools/node_modules/playwright');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:3200', OUT = '/workspace/gitworld';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mint = l => execFileSync('node', [__dirname + '/mint.mjs', l], { env: process.env }).toString().trim();
async function player(browser, login, opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([{ name: 'authjs.session-token', value: mint(login), url: BASE, httpOnly: true }]);
  const page = await ctx.newPage(); const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); return { ctx, page, errs, login };
}
(async () => {
  const browser = await chromium.launch(); let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
  const A = await player(browser, 'alice-cat', { viewport: { width: 1280, height: 800 } });
  const B = await player(browser, 'bob-cat', { ...devices['iPhone 13'] });
  for (const P of [A, B]) {
    const ob = await P.page.waitForSelector('#onboard:not(.hidden)', { timeout: 8000 }).then(() => true).catch(() => false);
    if (ob) {
      check(true, P.login + ' sees onboarding');
      await P.page.screenshot({ path: `${OUT}/${P === A ? 'desktop' : 'iphone'}-20-onboarding.png` });
      const n = await P.page.$$eval('#obCats button', b => b.length); check(n === 3, P.login + ' offered 3 cats');
      await P.page.click('#obCats button:nth-child(2)'); await P.page.click('#obSave');
      await P.page.waitForSelector('#onboard.hidden', { state: 'attached', timeout: 5000 });
    } else check(true, P.login + ' already onboarded');
    await P.page.evaluate(() => { const s = document.getElementById('splash'); if (s && !s.classList.contains('hidden')) document.getElementById('spGuest').click(); });
  }
  await sleep(2500);
  const sa = await A.page.evaluate(() => window.GitWorld.state), sb = await B.page.evaluate(() => window.GitWorld.state);
  check(sa.rt && sa.room === 'hub' && sa.players.includes('bob-cat'), 'alice sees bob in the plaza ' + JSON.stringify(sa.players));
  check(sb.rt && sb.players.includes('alice-cat'), 'bob sees alice in the plaza ' + JSON.stringify(sb.players));
  // chat from alice (desktop) with profanity + link + HTML
  await A.page.keyboard.press('KeyT'); await A.page.keyboard.type('hi bob <img src=x onerror=alert(1)> see http://x.io'); await A.page.keyboard.press('Enter');
  await sleep(2500);
  const logB = await B.page.$eval('#chatLog', e => e.textContent); check(/hi bob/.test(logB) && !/<img/.test(logB) && /\[link\]/.test(logB), 'bob got sanitized chat: ' + logB.slice(-80));
  const imgs = await B.page.$$eval('#chatLog img', x => x.length); check(imgs === 0, 'no HTML injected in chat');
  await A.page.keyboard.press('Escape'); await sleep(2100);
  // bob walks right a bit (tap to walk on iPhone), then alice sends a heart emote and bob a wave
  const vp = B.page.viewportSize(); await B.page.touchscreen.tap(vp.width / 2 + 90, vp.height / 2 + 30); await sleep(1500);
  await A.page.keyboard.press('Digit2'); await B.page.evaluate(() => document.querySelector('#chatBar [data-e="wave"], #chatBar button[title*="ave" i]')?.click()); await sleep(900);
  const pos = await A.page.evaluate(() => { const n = window.GW.world.npcs.find(n => n.login === 'bob-cat'); return n && [Math.round(n.x), Math.round(n.y)]; }); console.log('bob seen at', pos);
  await A.page.screenshot({ path: `${OUT}/desktop-21-multiplayer.png` }); await B.page.screenshot({ path: `${OUT}/iphone-21-multiplayer.png` });
  // both go to the same repo: same room
  await A.page.evaluate(() => window.GitWorld.enterRepo('samsagewize/rain-world')); await B.page.evaluate(() => window.GitWorld.enterRepo('samsagewize/rain-world'));
  await sleep(4000);
  const ra = await A.page.evaluate(() => window.GitWorld.state); check(ra.room === 'samsagewize/rain-world||0' && ra.players.includes('bob-cat'), 'same repo room shared: ' + ra.room + ' ' + JSON.stringify(ra.players));
  await A.page.screenshot({ path: `${OUT}/desktop-22-multiplayer-town.png` });
  // bob goes into a folder: alice no longer sees him
  await B.page.evaluate(() => window.GitWorld.enterRepo('samsagewize/rain-world', 'tools')); await sleep(4000);
  const rb = await A.page.evaluate(() => window.GitWorld.state); check(!rb.players.includes('bob-cat'), 'rooms are per folder (bob left alice room)');
  // block / report through the player card
  await B.page.evaluate(() => window.GitWorld.enterRepo('samsagewize/rain-world')); await sleep(4000);
  const opened = await A.page.evaluate(() => { const t = window.GW.world.targets.find(t => t.kind === 'bot' || /bob-cat/.test(t.label || t.name || '')); if (!t) return false; t.act ? t.act() : window.GW.openDialog(t); return true; });
  await sleep(400);
  const cardVis = await A.page.$eval('#pCard', e => !e.classList.contains('hidden')).catch(() => false);
  check(opened && cardVis, 'player card opens for bob');
  if (cardVis) {
    await A.page.screenshot({ path: `${OUT}/desktop-23-player-card.png` });
    await A.page.click('#pcReport'); await sleep(600); const note = await A.page.$eval('#pcNote', e => e.textContent); check(/reported/.test(note), 'report sent: ' + note);
    await A.page.click('#pcBlock'); await sleep(2500);
    const st = await A.page.evaluate(() => window.GitWorld.state); check(!st.players.includes('bob-cat'), 'blocked bob is hidden');
    await A.page.click('#pcBlock'); 
  }
  check(A.errs.length === 0 && B.errs.length === 0, 'no console errors ' + JSON.stringify(A.errs.concat(B.errs)));
  await browser.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
