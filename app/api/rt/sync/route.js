import { redis } from '../../../../lib/redis';
import { json, getUser, getProfile, sameOrigin, readJson, limit, isBanned } from '../../../../lib/guard';
import { validRoom, roomKey, chatKey, SYNC_LUA, ROOM_CAP, STALE_MS } from '../../../../lib/rt';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!redis) return json({ error: 'Live mode is not switched on yet.' }, 503);
  if (!sameOrigin(req)) return json({ error: 'Bad origin.' }, 403);
  const user = await getUser(req); if (!user) return json({ error: 'Sign in to join.' }, 401);
  if (!(await limit('sync:' + user.key, 150, 60))) return json({ error: 'Too fast.' }, 429);
  const b = await readJson(req, 1024); if (!b) return json({ error: 'Bad request.' }, 400);
  const room = b.room, x = Math.round(Number(b.x)), y = Math.round(Number(b.y)), d = b.d, m = b.m ? 1 : 0;
  if (!validRoom(room) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000 || !['u', 'd', 'l', 'r'].includes(d)) return json({ error: 'Bad state.' }, 400);
  if (await isBanned(user)) return json({ error: 'This account is blocked from GitWorld.' }, 403);
  const prof = await getProfile(req, user); if (!prof) return json({ error: 'Pick a cat first.' }, 409);
  const now = Date.now();
  const state = JSON.stringify({ l: user.login, c: prof.cat, x, y, d, m, t: now });
  let res;
  try { res = await redis.eval(SYNC_LUA, [roomKey(room), 'ul:' + user.key, chatKey(room)], [user.login, state, String(now), String(ROOM_CAP), String(STALE_MS), String(x), String(y)]); }
  catch (e) { return json({ error: 'Live server hiccup.' }, 502); }
  const full = Number(res[0]) === 1;
  let players = [], chat = [];
  try { players = JSON.parse(res[1]).map(p => ({ l: p.l, c: p.c, x: p.x, y: p.y, d: p.d, m: p.m })); } catch (e) { /* */ }
  try { const since = Math.max(0, Number(b.since) || 0); chat = JSON.parse(res[2]).filter(c => c.s > since).reverse(); } catch (e) { /* */ }
  return json({ full, n: players.length, players: full ? [] : players, chat: full ? [] : chat });
}
