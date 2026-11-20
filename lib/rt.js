import { LOGIN_RE } from './guard';
import { registerMemScript } from './redis';

export const ROOM_CAP = 30, STALE_MS = 10000;
export const ONLINE_KEY = 'online', ONLINE_MS = 30000;
// 'hub', 'err', 'city|page', 'b|login' (inside a player's building), or 'owner/repo|path|page' (lowercased by the client)
const ROOM_RE = /^(hub|err|city\|\d{1,3}|b\|[a-z0-9][a-z0-9-]{0,38}|[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}\|[^|\u0000-\u001f]{0,250}\|\d{1,4})$/;
export const validRoom = r => typeof r === 'string' && r.length <= 400 && ROOM_RE.test(r) && !/(^|\/)\.\.?(\/|\|)/.test(r.split('|')[1] || '');
export const roomKey = r => 'rp:' + r;
export const chatKey = r => 'rc:' + r;
export const validLogin = l => typeof l === 'string' && LOGIN_RE.test(l);

// One round trip per sync: leave the previous room, enforce the cap, sanity-check speed, prune stale cats,
// store our state and return everyone in the room plus recent chat.
export const SYNC_LUA = `
local rk, uk, ck, ok = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local login, state, now, cap, stale, x, y = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
local prev = redis.call('GET', uk)
if prev and prev ~= rk then redis.call('HDEL', prev, login) end
local all = redis.call('HGETALL', rk)
local n, mine = 0, nil
for i = 1, #all, 2 do
  local ok, p = pcall(cjson.decode, all[i + 1])
  if (not ok) or (now - (p.t or 0) > stale) then redis.call('HDEL', rk, all[i])
  else
    if all[i] == login then mine = p end
    n = n + 1
  end
end
if (not mine) and n >= cap then
  return {1, '[]', '[]'}
end
local warped = 0
if mine and prev == rk then
  local dt = math.max(0.05, (now - mine.t) / 1000)
  local dist = math.sqrt((x - mine.x) ^ 2 + (y - mine.y) ^ 2)
  if dist > dt * 110 + 900 then warped = 1 end
end
if warped == 1 then
  mine.t = now
  redis.call('HSET', rk, login, cjson.encode(mine))
else
  redis.call('HSET', rk, login, state)
end
redis.call('PEXPIRE', rk, 30000)
redis.call('SET', uk, rk, 'EX', 30)
if ok then
  redis.call('ZADD', ok, now, login)
  redis.call('ZREMRANGEBYSCORE', ok, 0, now - 30000)
  redis.call('PEXPIRE', ok, 120000)
end
local out = redis.call('HVALS', rk)
local chat = redis.call('LRANGE', ck, 0, 29)
return {0, '[' .. table.concat(out, ',') .. ']', '[' .. table.concat(chat, ',') .. ']'}
`;

export const CHAT_LUA = `
local ck, sk = KEYS[1], KEYS[2]
local s = redis.call('INCR', sk)
redis.call('EXPIRE', sk, 86400)
local msg = string.gsub(ARGV[1], '"s":0', '"s":' .. s, 1)
redis.call('LPUSH', ck, msg)
redis.call('LTRIM', ck, 0, 49)
redis.call('EXPIRE', ck, 900)
return s
`;

// JS twins of the scripts above for the in-memory demo store (lib/redis.js). Same inputs, same outputs.
registerMemScript(SYNC_LUA, async (r, [rk, uk, ck, ok], [login, state, nowS, capS, staleS, xS, yS]) => {
  const now = Number(nowS), cap = Number(capS), stale = Number(staleS), x = Number(xS), y = Number(yS);
  const prev = await r.get(uk);
  if (prev && prev !== rk) await r.hdel(prev, login);
  const all = (await r.hgetall(rk)) || {};
  let n = 0, mine = null;
  for (const [l, v] of Object.entries(all)) {
    let p = null; try { p = JSON.parse(v); } catch (e) { /* bad */ }
    if (!p || now - (p.t || 0) > stale) await r.hdel(rk, l); else { if (l === login) mine = p; n++; }
  }
  if (!mine && n >= cap) return [1, '[]', '[]'];
  let warped = false;
  if (mine && prev === rk) { const dt = Math.max(0.05, (now - mine.t) / 1000); if (Math.hypot(x - mine.x, y - mine.y) > dt * 110 + 900) warped = true; }
  if (warped) { mine.t = now; await r.hset(rk, { [login]: JSON.stringify(mine) }); } else await r.hset(rk, { [login]: state });
  await r.pexpire(rk, 30000); await r.set(uk, rk, { ex: 30 });
  if (ok) { await r.zadd(ok, { score: now, member: login }); await r.zremrangebyscore(ok, 0, now - 30000); await r.pexpire(ok, 120000); }
  return [0, '[' + (await r.hvals(rk)).join(',') + ']', '[' + (await r.lrange(ck, 0, 29)).join(',') + ']'];
});
registerMemScript(CHAT_LUA, async (r, [ck, sk], [msg]) => {
  const s = await r.incr(sk); await r.expire(sk, 86400);
  await r.lpush(ck, msg.replace('"s":0', '"s":' + s)); await r.ltrim(ck, 0, 49); await r.expire(ck, 900);
  return s;
});
